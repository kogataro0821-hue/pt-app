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

const { suggestFoodDraft, requestDayReview } = await import('./gemini');

/** Gemini の形をした、最低限の成功応答 */
function ok(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200 },
  );
}

// ★ AI が返してくる形は「平ら」です（入れ子の object を nullable にすると 400 になります）
const DRAFT = {
  kcal: 105,
  p: 23.3,
  f: 1.9,
  c: 0.1,
  confidence: 0.8,
  assumed: '鶏むね肉',
  aliases: [],
  sameAs: null,
  sameAsReason: '',
};

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
  it('下書きを作らせるときは、考える時間を0にする', async () => {
    fetchMock.mockResolvedValue(ok(DRAFT));
    await suggestFoodDraft('蒸し鶏', []);

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
  it('★ 考えない設定が原因の400なら、外してやり直す', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'bad_request', detail: 'unknown field thinkingConfig' }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(ok(DRAFT));

    const result = await suggestFoodDraft('蒸し鶏', []);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 2回目には、考えない設定が入っていない
    expect(generationConfig(1).thinkingConfig).toBeUndefined();
    // ちゃんと結果が返る（速さより、動くことが先）
    expect(result.per100g).toEqual({ kcal: 105, p: 23.3, f: 1.9, c: 0.1 });
  });

  it('やり直すときも、中身は変えない', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'thinkingConfig is not supported' }), { status: 400 }),
      )
      .mockResolvedValueOnce(ok(DRAFT));

    await suggestFoodDraft('蒸し鶏', []);

    expect(sentBody(1).contents).toEqual(sentBody(0).contents);
    expect(generationConfig(1).responseSchema).toEqual(generationConfig(0).responseSchema);
  });

  it('★ 関係ない400では、やり直さない', async () => {
    // ★ どんな400でもやり直すと、鍵の設定ミスのようなときに
    //   1日の回数を2つ食べてしまいます。
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'API key not valid' }), { status: 400 }),
    );

    await expect(suggestFoodDraft('蒸し鶏', [])).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('やり直しても駄目なら、ちゃんと失敗する', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'thinkingConfig' }), { status: 400 }),
    );

    await expect(suggestFoodDraft('蒸し鶏', [])).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('通信そのものが駄目なときは、やり直さない', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(suggestFoodDraft('蒸し鶏', [])).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
