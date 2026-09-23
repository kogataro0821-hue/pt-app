import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aFood } from '@/test/factories';
import { firstCall } from '@/test/helpers';
import { FoodEditor, previewFor } from './FoodEditor';
import type * as FoodsRepo from './foodsRepo';

/**
 * 食品マスタの「かぞえ方」（設計書 §10.5 / 追加仕様: 単位換算）。
 *
 * ★ 換算を持つのは、入力する人ではなく**マスタ**です。
 *
 *   各自が目分量で入れると、Aさんの卵1個が50g、Bさんが60gになります。
 *   同じ「卵1個」が人によって違うカロリーになる、という状態です。
 *   個人マスタを廃止して共通マスタ一本にしたのと、まったく同じ理由で、
 *   換算も管理者が1回だけ決めます。
 *
 * ★ ここは栄養値の欄ではありません。**物差し**です。
 *   100gあたりの値は、これを入れても1文字も変わりません。
 */

vi.mock('@/config/firebase', () => ({ AI_RELAY_URL: null }));

vi.mock('./foodsRepo', async () => {
  const actual = await vi.importActual<typeof FoodsRepo>('./foodsRepo');
  return { ...actual, saveFood: vi.fn(async (f: unknown) => f) };
});

const { saveFood } = await import('./foodsRepo');

function setup(initial = aFood({ name: '卵', per100g: { kcal: 142, p: 12.2, f: 10.2, c: 0.4 } })) {
  const onSaved = vi.fn();
  render(<FoodEditor initial={initial} all={[]} onSaved={onSaved} onCancel={vi.fn()} />);
  return { onSaved };
}

beforeEach(() => {
  vi.mocked(saveFood).mockClear();
});

describe('かぞえ方の欄', () => {
  it('4つの単位ぶん、最初から欄が出ている', () => {
    // ★ 「行を足す」形にすると、押さないと存在に気づけません
    setup();
    for (const unit of ['個', '枚', '本', 'パック']) {
      expect(screen.getByLabelText(`1${unit}あたりの重さ（g）`)).toBeInTheDocument();
    }
  });

  it('★ 危ない単位の欄は出さない', () => {
    // ★ 「1杯」が誰の茶碗かは、こちらには決めようがありません。
    //   正確そうに見えて実は目分量、が一番たちの悪い数字です。
    setup();
    expect(screen.queryByLabelText(/1杯/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/1食/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/大さじ/)).not.toBeInTheDocument();
  });

  it('入れた単位だけが保存される（空欄は登録しない）', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('1個あたりの重さ（g）'), '50');
    await userEvent.click(screen.getByRole('button', { name: '保存する' }));

    expect(firstCall(vi.mocked(saveFood))[0].unitConversions).toEqual([
      { unit: '個', grams: 50 },
    ]);
  });

  it('編集で開くと、登録済みの換算が入っている', () => {
    setup(aFood({ name: '納豆', unitConversions: [{ unit: 'パック', grams: 45 }] }));
    expect(screen.getByLabelText('1パックあたりの重さ（g）')).toHaveValue(45);
    expect(screen.getByLabelText('1個あたりの重さ（g）')).toHaveValue(null);
  });

  it('範囲から外れていたら、保存させない', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('1個あたりの重さ（g）'), '5000');
    await userEvent.click(screen.getByRole('button', { name: '保存する' }));

    expect(saveFood).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('「1個」の重さ');
  });

  it('★ 殻の重さで入れないよう、その場に書く', async () => {
    // ★ 殻ごと量った60gを入れると、2割ぶん多く計算されます。
    //   しかもこの間違いは、どこにも出ません。入れる前に伝えるしかありません。
    setup();
    expect(screen.getByText(/殻を除いて約50g/)).toBeInTheDocument();
    expect(screen.getByText(/食べる部分の重さ/)).toBeInTheDocument();
  });

  it('同じ単位で重さが違うものは、分けるよう書いてある', () => {
    // 食パンの「6枚切り」と「8枚切り」は1行では表せません
    setup();
    expect(screen.getByText(/食材を2件に分けて/)).toBeInTheDocument();
  });
});

/**
 * 「1個 ≒ 71kcal」の下見。
 *
 * ★ 保存する値ではありません。**桁の打ち間違いに気づくための鏡**です。
 *   50 を 500 と打っても、数字だけ見ていては気づけません。
 *   kcal に直すと、さすがにおかしいと分かります。
 */
describe('★ 1つぶんのカロリーを出す', () => {
  const EGG = { kcal: 142, p: 12.2, f: 10.2, c: 0.4 };

  it('卵1個（50g）は約71kcal', () => {
    expect(previewFor('個', '50', EGG)).toBe('1個 ≒ 71kcal');
  });

  it('★ 桁を間違えると、見て分かる数字になる', () => {
    expect(previewFor('個', '500', EGG)).toBe('1個 ≒ 710kcal');
  });

  it('空欄・範囲外・カロリー未入力のときは、何も出さない', () => {
    expect(previewFor('個', '', EGG)).toBe('');
    expect(previewFor('個', '  ', EGG)).toBe('');
    expect(previewFor('個', 'あ', EGG)).toBe('');
    expect(previewFor('個', '5000', EGG)).toBe('');
    expect(previewFor('個', '50', { kcal: 0, p: 0, f: 0, c: 0 })).toBe('');
  });

  it('画面にも出る', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('1個あたりの重さ（g）'), '50');
    expect(screen.getByText('1個 ≒ 71kcal')).toBeInTheDocument();
  });
});

describe('栄養値の欄は、これまでどおり', () => {
  it('★ かぞえ方を入れても、100gあたりの値は変わらない', () => {
    // ★ ここは物差しであって、栄養値ではありません
    // ★ 見出しを、文字ではなく囲みで探します。
    //   基準を選ぶボタンにも「100gあたり」と書いてあるので、
    //   文字で探すと2つ当たります（1袋ぶんを手で選べるようにしたため）。
    setup();
    expect(screen.getByRole('group', { name: '100gあたり' })).toBeInTheDocument();
    expect(screen.getByLabelText('1個あたりの重さ（g）')).toBeInTheDocument();
  });
});

/**
 * 「1袋ぶん」で登録する（追加仕様: 成分表示の読み取り）。
 *
 * ★ これまでは、写真を撮る道でしか選べませんでした。
 *
 *   成分表示に「1袋(80g)」のようなグラム数が書いてあれば割り算できますが、
 *   **書いていない商品があります**（コンビニの惣菜が特にそう）。
 *   その逃げ道が「1袋ぶんで登録」なのに、写真を撮らないと出てこない
 *   場所にありました。手で登録している管理者には、無い機能と同じでした。
 */
describe('★ 1袋ぶんで登録する', () => {
  it('最初は「100gあたり」が選ばれている', () => {
    setup();
    expect(screen.getByRole('radio', { name: '100gあたり' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('★ 写真を撮らなくても選べる', async () => {
    // ★ ここが本体です。手入力だけで登録している管理者も使えないと意味がありません
    setup();
    await userEvent.click(screen.getByRole('radio', { name: '1袋ぶん（全量）' }));

    expect(screen.getByLabelText('数える単位')).toHaveValue('袋');
  });

  it('見出しが「1袋あたり」に変わる', async () => {
    // ★ 見出しが「100gあたり」のままだと、何を入れる欄なのか分かりません
    setup();
    await userEvent.click(screen.getByRole('radio', { name: '1袋ぶん（全量）' }));

    expect(screen.getByText('1袋あたり')).toBeInTheDocument();
  });

  it('★ 1袋 = 100g が入り、触れなくなる', async () => {
    // ★ 本当の重さではなく、表示どおりの数字を出すための置き物です。
    //   書き換えられると、数字が合わなくなります
    setup();
    await userEvent.click(screen.getByRole('radio', { name: '1袋ぶん（全量）' }));

    const box = screen.getByLabelText('1袋あたりの重さ（g）');
    expect(box).toHaveValue(100);
    expect(box).toHaveAttribute('readonly');
  });

  it('印と換算が、両方保存される', async () => {
    // ★ 換算が無いと契約者が「1袋」と入れられず、数字だけが宙に浮きます。
    //   印が無いと、100gあたりの値だと取り違えられます
    setup();
    await userEvent.click(screen.getByRole('radio', { name: '1袋ぶん（全量）' }));
    await userEvent.click(screen.getByRole('button', { name: '保存する' }));

    const saved = firstCall(vi.mocked(saveFood))[0];
    expect(saved.servingUnit).toBe('袋');
    expect(saved.unitConversions).toEqual([{ unit: '袋', grams: 100 }]);
  });

  it('単位を選び直せる', async () => {
    setup();
    await userEvent.click(screen.getByRole('radio', { name: '1袋ぶん（全量）' }));
    await userEvent.selectOptions(screen.getByLabelText('数える単位'), '本');
    await userEvent.click(screen.getByRole('button', { name: '保存する' }));

    const saved = firstCall(vi.mocked(saveFood))[0];
    expect(saved.servingUnit).toBe('本');
    // ★ 前に選んでいた袋の 100g は残しません。混ざると入れ方で数字が変わります
    expect(saved.unitConversions).toEqual([{ unit: '本', grams: 100 }]);
  });

  it('★ 100gあたりに戻すと、置いた100gも取り消される', async () => {
    // ★ 残ると「1袋=100g」という嘘が、本物の100g食材に付いたままになります
    setup();
    await userEvent.click(screen.getByRole('radio', { name: '1袋ぶん（全量）' }));
    await userEvent.click(screen.getByRole('radio', { name: '100gあたり' }));
    await userEvent.click(screen.getByRole('button', { name: '保存する' }));

    const saved = firstCall(vi.mocked(saveFood))[0];
    expect(saved.servingUnit).toBeNull();
    expect(saved.unitConversions).toEqual([]);
  });

  it('管理者が自分で入れた重さは、戻しても消さない', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('1個あたりの重さ（g）'), '50');
    await userEvent.click(screen.getByRole('radio', { name: '1袋ぶん（全量）' }));
    await userEvent.click(screen.getByRole('radio', { name: '100gあたり' }));

    // 1袋ぶんに切り替えた時点で他の単位は消えるので、入れ直せる状態に戻る
    expect(screen.getByLabelText('1個あたりの重さ（g）')).toHaveValue(null);
  });

  it('編集で開くと、1袋ぶんが選ばれたまま出る', () => {
    setup(aFood({ servingUnit: '袋', unitConversions: [{ unit: '袋', grams: 100 }] }));
    expect(screen.getByRole('radio', { name: '1袋ぶん（全量）' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText('1袋あたり')).toBeInTheDocument();
  });
});
