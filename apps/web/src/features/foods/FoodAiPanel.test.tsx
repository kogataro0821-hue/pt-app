import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiFoodDraft } from '@pt/ai-contract';
import { aFood } from '@/test/factories';
import type * as Gemini from '@/features/ai/gemini';
import { FoodAiPanel } from './FoodAiPanel';

/**
 * 登録依頼のAI（追加仕様: 登録依頼のAI）。
 *
 * ★ ここで守りたいのは、たった1つです。
 *
 *   **AI はマスタに1バイトも書かない。**
 *
 *   マスタの1件は、全契約者の集計に効きます。
 *   ほかの画面なら「まあ直せばいい」で済みますが、ここは違います。
 *   間違った値が入ると、それを使った全員の過去の数字が狂います。
 *
 *   ですからAIがするのは下書きまでで、確定は必ず人が行います。
 */

const suggestFoodDraft = vi.fn();

vi.mock('@/features/ai/gemini', async () => {
  const actual = await vi.importActual<typeof Gemini>('@/features/ai/gemini');
  return {
    ...actual,
    suggestFoodDraft: (...a: unknown[]): unknown => suggestFoodDraft(...a),
  };
});

function aDraft(over: Partial<AiFoodDraft> = {}): AiFoodDraft {
  return {
    per100g: { kcal: 105, p: 23.3, f: 1.9, c: 0.1 },
    confidence: 0.8,
    assumed: '皮なしの鶏むね肉（生）',
    aliases: [],
    sameAs: null,
    sameAsReason: '',
    ...over,
  };
}

const MASTER = [
  aFood({ id: 'しろまい', name: '白米', aliases: ['ごはん'] }),
  aFood({
    id: 'とりむね',
    name: '鶏むね肉',
    aliases: [],
    per100g: { kcal: 105, p: 23.3, f: 1.9, c: 0.1 },
  }),
];

const onUsePer100g = vi.fn();
const onUseAliases = vi.fn();
const onAbsorbInto = vi.fn();

function show(name = '蒸し鶏') {
  render(
    <FoodAiPanel
      name={name}
      foods={MASTER}
      busy={false}
      onUsePer100g={onUsePer100g}
      onUseAliases={onUseAliases}
      onAbsorbInto={onAbsorbInto}
    />,
  );
}

async function ask() {
  await userEvent.click(screen.getByRole('button', { name: 'AIに下書きを作らせる' }));
  await screen.findByText('AIの下書き');
}

beforeEach(() => {
  suggestFoodDraft.mockReset();
  onUsePer100g.mockReset();
  onUseAliases.mockReset();
  onAbsorbInto.mockReset();
  suggestFoodDraft.mockResolvedValue(aDraft());
});

describe('★ 押したときだけ聞く', () => {
  it('開いただけでは、AIに聞かない', () => {
    // ★ 自分で分かる食材にも回数を使ってしまいます（1人1日50回まで）
    show();
    expect(suggestFoodDraft).not.toHaveBeenCalled();
  });

  it('ボタンを押したら聞く', async () => {
    show();
    await ask();
    expect(suggestFoodDraft).toHaveBeenCalledTimes(1);
  });
});

describe('★ AI に送る情報', () => {
  it('★ 送るのは、食材名とマスタの名前だけ', async () => {
    // ★ 誰が依頼したか・いつ食べたか・仮の値は送りません（設計書 §35）。
    //   送らなければ、AI 側で誰の記録かを結び付けられません。
    show('蒸し鶏');
    await ask();

    expect(suggestFoodDraft).toHaveBeenCalledWith('蒸し鶏', ['白米', '鶏むね肉']);
  });

  it('栄養値そのものは送らない（名前だけで足りる）', async () => {
    show();
    await ask();

    const [, names] = suggestFoodDraft.mock.calls[0] as [string, string[]];
    expect(names.every((n) => typeof n === 'string')).toBe(true);
    expect(JSON.stringify(names)).not.toContain('105');
  });
});

describe('★ マスタには書かない', () => {
  it('下書きが出ても、何も保存されない', async () => {
    show();
    await ask();

    expect(onUsePer100g).not.toHaveBeenCalled();
    expect(onUseAliases).not.toHaveBeenCalled();
    expect(onAbsorbInto).not.toHaveBeenCalled();
  });

  it('★ 「入力欄に入れる」でも、保存ではなく受け渡しだけ', async () => {
    show();
    await ask();
    await userEvent.click(screen.getByRole('button', { name: 'この値を入力欄に入れる' }));

    expect(onUsePer100g).toHaveBeenCalledWith(
      { kcal: 105, p: 23.3, f: 1.9, c: 0.1 },
      expect.stringContaining('AIの推定'),
    );
  });

  it('渡すメモに「要確認」を残す（あとから見て推定と分かるように）', async () => {
    show();
    await ask();
    await userEvent.click(screen.getByRole('button', { name: 'この値を入力欄に入れる' }));

    const [, note] = onUsePer100g.mock.calls[0] as [unknown, string];
    expect(note).toContain('要確認');
  });
});

describe('栄養値', () => {
  it('推定値を出す', async () => {
    show();
    await ask();
    expect(screen.getByText(/105kcal/)).toBeInTheDocument();
  });

  it('何として答えたかを出す（違う食品だと気づけるように）', async () => {
    show();
    await ask();
    expect(screen.getByText('皮なしの鶏むね肉（生）')).toBeInTheDocument();
  });

  it('★ 「分からない」なら、そう出す', async () => {
    // ★ それらしい数字を作らせるより、分からないと言わせるほうが安全です
    suggestFoodDraft.mockResolvedValue(aDraft({ per100g: null }));
    show();
    await ask();

    expect(screen.getByText(/AIも分かりませんでした/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'この値を入力欄に入れる' }),
    ).not.toBeInTheDocument();
  });

  it('★ ありえない値は、採用させない', async () => {
    // ★ P+F+C が 100g を超えています。出すと「まあ近いかも」で通されます
    suggestFoodDraft.mockResolvedValue(
      aDraft({ per100g: { kcal: 400, p: 50, f: 30, c: 40 } }),
    );
    show();
    await ask();

    expect(
      screen.queryByRole('button', { name: 'この値を入力欄に入れる' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/100g を超えています/)).toBeInTheDocument();
  });

  it('★ 計算が合わないときは、値は出すが印を付ける', async () => {
    // ★ 食物繊維などで説明が付くこともあるので、止めはしません。
    //   人が確かめられるように、計算値との差を見せます。
    suggestFoodDraft.mockResolvedValue(
      aDraft({ per100g: { kcal: 400, p: 2.5, f: 0.3, c: 37.1 } }),
    );
    show();
    await ask();

    expect(screen.getByText(/計算が合いません/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'この値を入力欄に入れる' })).toBeInTheDocument();
  });
});

describe('★ 既存の食材にまとめる', () => {
  it('マスタにある食材なら、まとめる案を出す', async () => {
    suggestFoodDraft.mockResolvedValue(
      aDraft({ sameAs: '鶏むね肉', sameAsReason: '同じ部位の鶏肉です。' }),
    );
    show();
    await ask();

    await userEvent.click(screen.getByRole('button', { name: /鶏むね肉 にまとめる/ }));
    expect(onAbsorbInto).toHaveBeenCalledWith(expect.objectContaining({ name: '鶏むね肉' }));
  });

  it('★ マスタに無い食材への提案は、押せる形で出さない', async () => {
    // ★ AI は一覧に無い名前を平気で返します。
    //   そのまままとめると、存在しない食材へ寄せることになります。
    suggestFoodDraft.mockResolvedValue(aDraft({ sameAs: '鶏胸肉（皮なし）' }));
    show();
    await ask();

    expect(screen.queryByRole('button', { name: /にまとめる/ })).not.toBeInTheDocument();
  });

  it('★ 捨てたことは、黙らずに伝える', async () => {
    // ★ 黙って消すと、AIが何を言ったのか分からなくなります
    suggestFoodDraft.mockResolvedValue(aDraft({ sameAs: '鶏胸肉（皮なし）' }));
    show();
    await ask();

    expect(screen.getByText(/まとめ先の提案は捨てました/)).toBeInTheDocument();
    expect(screen.getByText(/鶏胸肉（皮なし）/)).toBeInTheDocument();
  });
});

describe('★ 別名', () => {
  it('使える別名を出し、押せば渡す', async () => {
    suggestFoodDraft.mockResolvedValue(aDraft({ aliases: ['むしどり'] }));
    show();
    await ask();

    await userEvent.click(screen.getByRole('button', { name: 'この別名も入れる' }));
    expect(onUseAliases).toHaveBeenCalledWith(['むしどり']);
  });

  it('★ 他の食材が使っている名前は、出さない', async () => {
    // ★ 入れると、その言葉がどちらの食材に当たるか決まらなくなります
    suggestFoodDraft.mockResolvedValue(aDraft({ aliases: ['ごはん'] }));
    show();
    await ask();

    expect(screen.queryByRole('button', { name: 'この別名も入れる' })).not.toBeInTheDocument();
    expect(screen.getByText(/すでに「白米」が使っています/)).toBeInTheDocument();
  });
});

describe('うまくいかないとき', () => {
  it('AIに聞けなければ、そのことを出す', async () => {
    suggestFoodDraft.mockRejectedValue(new Error('offline'));
    show();
    await userEvent.click(screen.getByRole('button', { name: 'AIに下書きを作らせる' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('AIに聞けませんでした');
  });

  it('失敗しても、下書きは出ない', async () => {
    suggestFoodDraft.mockRejectedValue(new Error('offline'));
    show();
    await userEvent.click(screen.getByRole('button', { name: 'AIに下書きを作らせる' }));

    await waitFor(() => expect(screen.queryByText('AIの下書き')).not.toBeInTheDocument());
  });
});
