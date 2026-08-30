import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 「考える時間」を使わせない設定と、その保険（追加仕様: 読み取りの待ち時間）。
 *
 * ★ gemini-2.5-flash は、既定で答える前に内部で考えます。
 *
 *   筋道を立てる問いには効きますが、
 *   **成分表示の数字を書き写す**ような仕事には要りません。
 *   考えるぶんだけ待ち時間が伸びます。実際に「かなり重い」と報告がありました。
 *
 * ★ ただし、この設定が通らない相手だと 400 で返ってきます。
 *   そのとき読み取りごと失敗させると、**速くしようとして壊した**ことになります。
 *   速さより、動くことが先です。1回だけやり直します。
 */

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('@/config/firebase', () => ({ AI_RELAY_URL: 'https://relay.example' }));

vi.mock('@/lib/firebase', () => ({
  getAuthClient: () => ({ currentUser: { getIdToken: async () => 'token-1' } }),
}));

const { parseMealText, requestDayReview } = await import('./gemini');

/** Gemini の形をした、最低限の成功応答 */
function ok(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200 },
  );
}

/** 文章の読み取りが返してくる、最低限の形 */
const PARSED = { items: [], unidentified: [], notes: [] };

/** 送られた本文を読む */
function sentBody(call: number): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[call] as [string, { body: string }];
  return JSON.parse(init.body) as Record<string, unknown>;
}

function generationConfig(call: number): Record<string, unknown> {
  return sentBody(call).generationConfig as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('★ 考えさせない', () => {
  it('文章の読み取りでは、考える時間を0にする', async () => {
    fetchMock.mockResolvedValue(ok(PARSED));
    await parseMealText('白米200g');

    expect(generationConfig(0).thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('★ 評価文のときは、考えさせる', async () => {
    // ★ あちらは人に読ませる文章を組み立てる仕事です。考える価値があります。
    //   速さだけを見て、どこにでも同じ設定を入れてはいけません。
    fetchMock.mockResolvedValue(ok({ text: 'よく続いています。' }));
    await requestDayReview({
      actual: { kcal: 1800, p: 130, f: 50, c: 200 },
      target: { kcal: 1800, p: 130, f: 50, c: 200 },
      exerciseMinutes: 0,
      mealCount: 3,
      noValueCount: 0,
      provisionalCount: 0,
      reviewMode: 'standard',
    });

    expect(generationConfig(0).thinkingConfig).toBeUndefined();
  });
});

describe('★ 通らなかったときの保険', () => {
  it('★ 400 が返ったら、考えない設定を外してやり直す', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'rejected',
            status: 400,
            detail: '{"error":{"code":400,"message":"Request contains an invalid argument."}}',
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(ok(PARSED));

    const result = await parseMealText('白米200g');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(generationConfig(1).thinkingConfig).toBeUndefined();
    // やり直したほうの結果が、ちゃんと返る（速さより、動くことが先）
    expect(result.items).toEqual([]);
  });

  it('★ 相手が理由を言わなくても、やり直す', async () => {
    // ★ ここが今回の急所です。
    //
    //   最初は「応答に thinking と書いてあるときだけ」やり直していました。
    //   ところが Gemini は「Request contains an invalid argument.」としか返しません。
    //   どの項目が悪いかを言わないので、**保険が一度も効きませんでした。**
    //
    //   相手が理由を言わない以上、こちらで見分けようとするのが間違いでした。
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValueOnce(ok(PARSED));

    await parseMealText('白米200g');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('やり直すときも、中身は変えない', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 400 }))
      .mockResolvedValueOnce(ok(PARSED));

    await parseMealText('白米200g');

    expect(sentBody(1).contents).toEqual(sentBody(0).contents);
    expect(generationConfig(1).responseSchema).toEqual(generationConfig(0).responseSchema);
  });

  it('★ やり直しは1回だけ（無限に投げない）', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 400 }));

    await expect(parseMealText('白米200g')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('★ 考えない設定を付けていない問い合わせでは、やり直さない', async () => {
    // ★ 評価文には付けていません。外すものが無いので、やり直す意味もありません。
    fetchMock.mockResolvedValue(new Response('', { status: 400 }));

    await expect(
      requestDayReview({
        actual: { kcal: 1800, p: 130, f: 50, c: 200 },
        target: { kcal: 1800, p: 130, f: 50, c: 200 },
        exerciseMinutes: 0,
        mealCount: 3,
        noValueCount: 0,
        provisionalCount: 0,
        reviewMode: 'standard',
      }),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('400 以外では、やり直さない', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    await expect(parseMealText('白米200g')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('通信そのものが駄目なときは、やり直さない', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(parseMealText('白米200g')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
