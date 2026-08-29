import { toInternal, ZERO } from '@pt/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aFood, aProvisionalItem } from '@/test/factories';
import { firstCall } from '@/test/helpers';
import { ItemForm } from './ItemForm';
import type * as FoodsRepo from '@/features/foods/foodsRepo';

/**
 * 食材を1件入れる画面（設計書 §21 / Phase 9）。
 *
 * ★ このアプリでいちばん大事な線が、ここに引かれています。
 *
 *   契約者が決めるのは「何を・何g」だけ。
 *   100gあたりの栄養値を決めるのは管理者だけ。
 *
 *   この線が崩れると、「白米」が人によって156kcalだったり200kcalだったりして、
 *   トレーナーが数字を根拠に指導できなくなります。
 *   画面を作り替えたときに崩れていないか、ここで機械的に確かめます。
 */

vi.mock('@/features/foods/foodsRepo', async () => {
  const actual = await vi.importActual<typeof FoodsRepo>('@/features/foods/foodsRepo');
  return { ...actual, loadFoods: vi.fn() };
});

const { loadFoods } = await import('@/features/foods/foodsRepo');

/** マスタに「白米」だけがある状態 */
function withMaster(foods = [aFood()]) {
  vi.mocked(loadFoods).mockResolvedValue(foods);
}

beforeEach(() => {
  withMaster();
});

function setup(over: Partial<Parameters<typeof ItemForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <ItemForm canEditNutrition={false} onSubmit={onSubmit} onCancel={onCancel} {...over} />,
  );
  return { onSubmit, onCancel };
}

describe('契約者が使うとき（canEditNutrition = false）', () => {
  // ★★ ここがこのアプリでいちばん重い一線です（追加仕様: 仮の栄養値）。
  //
  //   契約者が仮の値を入れられるようにしました。ただし**マスタに無い食材だけ**です。
  //   マスタにある食材の値を触れるようにすると、「白米」が人によって
  //   156kcal だったり 200kcal だったりして、数字を根拠にした指導ができなくなります。
  //
  //   守り方は「禁止する」ではなく「**入力欄を出さない**」です。
  //   出さなければ、ぶつかりようがありません。
  it('★ マスタにある食材の栄養値は、入力欄そのものが出ない', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), '白米');

    // 値は見えるが、打てる場所はどこにも無い
    expect(screen.getByText('100gあたり（共通マスタ）')).toBeInTheDocument();
    expect(screen.queryByLabelText('kcal')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('P')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('F')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('C')).not.toBeInTheDocument();
  });

  it('マスタに無い食材なら、仮の値を入れられる', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), 'サラダチキン');

    expect(screen.getByText('100gあたりの栄養値（仮）')).toBeInTheDocument();
    expect(screen.getByLabelText('kcal')).toBeInTheDocument();
  });

  it('仮の値だと分かる言い方をする（確定した値と取り違えさせない）', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), 'サラダチキン');

    expect(screen.getByText(/この日の合計に入ります/)).toBeInTheDocument();
    expect(screen.getByText(/正しい値に置き換わります/)).toBeInTheDocument();
    // 入れないという選択も、はっきり示す
    expect(screen.getByText(/分からなければ空欄のままで大丈夫です/)).toBeInTheDocument();
  });

  it('仮の値を入れると、その値で計算され、依頼にも候補として付く', async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), 'サラダチキン');
    await userEvent.type(screen.getByLabelText('食べた量（g）'), '110');
    await userEvent.type(screen.getByLabelText('kcal'), '105');
    await userEvent.type(screen.getByLabelText('P'), '23');
    await userEvent.type(screen.getByLabelText('F'), '2');
    await userEvent.type(screen.getByLabelText('C'), '0');
    await userEvent.click(screen.getByRole('button', { name: '追加する' }));

    const [item, requestName, candidate] = firstCall(onSubmit);
    expect(item.provisional).toBe(true);
    // まだ確定していない（管理者の承認待ち）ことは変わらない
    expect(item.pending).toBe(true);
    expect(item.foodId).toBeNull();
    // 105 × 110 ÷ 100 = 115.5kcal
    expect(item.nutrients.kcal).toBe(115_500);

    // 管理者には「手で入れた値」として届く。写真つきの候補と区別できること
    expect(requestName).toBe('サラダチキン');
    expect(candidate?.source).toBe('manual');
    expect(candidate?.per100g.kcal).toBe(105);
  });

  it('1つでも空欄なら、仮の値としては使わない', async () => {
    // ★ 半端な値で合計を動かさないための線引きです。
    //   kcal だけ入れて P/F/C が空だと、たんぱく質0gの日として評価されます
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), 'サラダチキン');
    await userEvent.type(screen.getByLabelText('食べた量（g）'), '110');
    await userEvent.type(screen.getByLabelText('kcal'), '105');
    await userEvent.click(screen.getByRole('button', { name: '追加する' }));

    const [item, , candidate] = firstCall(onSubmit);
    expect(item.provisional).toBe(false);
    expect(item.nutrients).toEqual(ZERO);
    expect(candidate).toBeNull();
  });

  it('仮の値を入れなければ、これまでどおり栄養値0・登録待ち', async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), 'サラダチキン');
    await userEvent.type(screen.getByLabelText('食べた量（g）'), '110');
    await userEvent.click(screen.getByRole('button', { name: '追加する' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [item, requestName] = firstCall(onSubmit);
    expect(item.pending).toBe(true);
    expect(item.provisional).toBe(false);
    expect(item.nutrients).toEqual(ZERO);
    expect(item.per100g).toEqual(ZERO);
    expect(item.foodId).toBeNull();
    expect(item.grams).toBe(110);
    // 同時に、管理者への登録依頼が出る
    expect(requestName).toBe('サラダチキン');
  });

  it('マスタにある食材なら、その値がそのまま使われる', async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), '白米');
    await userEvent.type(screen.getByLabelText('食べた量（g）'), '180');

    // 値は「表示だけ」。編集できる欄としては出ない
    expect(screen.getByText('100gあたり（共通マスタ）')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '追加する' }));
    const [item, requestName] = firstCall(onSubmit);
    expect(item.pending).toBe(false);
    expect(item.foodId).toBe('しろまい');
    expect(item.per100g).toEqual(toInternal({ kcal: 156, p: 2.5, f: 0.3, c: 37.1 }));
    // 156 × 180 ÷ 100 = 280.8kcal
    expect(item.nutrients.kcal).toBe(280_800);
    // すでにマスタにあるので、依頼は出さない
    expect(requestName).toBeNull();
  });

  it('別名で打っても、マスタの食材に当たる', async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), 'ごはん');
    await userEvent.type(screen.getByLabelText('食べた量（g）'), '180');
    await userEvent.click(screen.getByRole('button', { name: '追加する' }));

    const [item] = firstCall(onSubmit);
    expect(item.pending).toBe(false);
    // 記録に残る名前は、マスタの代表表記に揃う
    expect(item.name).toBe('白米');
  });

  it('似た食材があれば、そちらを選ぶよう促す', async () => {
    withMaster([aFood({ id: 'とりむねにく', name: '鶏むね肉', aliases: [] })]);
    setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), '鶏むね肉（皮なし）');

    expect(
      await screen.findByText('似た食材があります。同じものならこちらを選んでください。'),
    ).toBeInTheDocument();
  });
});

describe('管理者が使うとき（canEditNutrition = true）', () => {
  it('未登録の食材には、栄養値の入力欄が出る', async () => {
    setup({ canEditNutrition: true });
    await userEvent.type(screen.getByLabelText('食材の名前'), 'サラダチキン');

    expect(screen.getByText('100gあたりの栄養値（新しく登録します）')).toBeInTheDocument();
    expect(screen.getByLabelText('kcal')).toBeInTheDocument();
  });

  it('空欄のままでも記録できる（あとから登録できる）', async () => {
    const { onSubmit } = setup({ canEditNutrition: true });
    await userEvent.type(screen.getByLabelText('食材の名前'), 'サラダチキン');
    await userEvent.type(screen.getByLabelText('食べた量（g）'), '110');
    await userEvent.click(screen.getByRole('button', { name: '追加する' }));

    const [item] = firstCall(onSubmit);
    expect(item.pending).toBe(true);
  });

  it('4つとも入れると、その値で計算される', async () => {
    const { onSubmit } = setup({ canEditNutrition: true });
    await userEvent.type(screen.getByLabelText('食材の名前'), 'サラダチキン');
    await userEvent.type(screen.getByLabelText('食べた量（g）'), '100');
    await userEvent.type(screen.getByLabelText('kcal'), '105');
    await userEvent.type(screen.getByLabelText('P'), '23.3');
    await userEvent.type(screen.getByLabelText('F'), '1.9');
    await userEvent.type(screen.getByLabelText('C'), '0.1');
    await userEvent.click(screen.getByRole('button', { name: '追加する' }));

    const [item] = firstCall(onSubmit);
    expect(item.pending).toBe(false);
    expect(item.nutrients.kcal).toBe(105_000);
  });
});

describe('入力チェック', () => {
  // ★ 押せてから叱るのではなく、押せないようにしています。
  //   エラーを読んでから直すより、押せない理由がその場で分かるほうが早いためです。
  it('名前が空のあいだは、追加ボタンを押せない', async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText('食べた量（g）'), '100');

    const button = screen.getByRole('button', { name: '追加する' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('量が空・0・5000g超のあいだは、追加ボタンを押せない', async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), '白米');
    const button = screen.getByRole('button', { name: '追加する' });
    const grams = screen.getByLabelText('食べた量（g）');

    expect(button).toBeDisabled();

    await userEvent.type(grams, '0');
    expect(button).toBeDisabled();

    await userEvent.clear(grams);
    await userEvent.type(grams, '5001');
    expect(button).toBeDisabled();

    await userEvent.clear(grams);
    await userEvent.type(grams, '180');
    expect(button).toBeEnabled();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('やめると、何も渡さずに閉じる', async () => {
    const { onSubmit, onCancel } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('編集のとき', () => {
  it('最初から名前と量が入っていて、ボタンは「変更する」になる', async () => {
    setup({
      initial: {
        id: 'i1',
        name: '白米',
        grams: 180,
        per100g: ZERO,
        nutrients: ZERO,
        foodId: null,
        pending: true,
      provisional: false,
      },
    });
    expect(screen.getByLabelText('食材の名前')).toHaveValue('白米');
    expect(screen.getByLabelText('食べた量（g）')).toHaveValue(180);
    expect(screen.getByRole('button', { name: '変更する' })).toBeInTheDocument();
  });

  it('もとの食材のIDを引き継ぐ（新しい食材が増えない）', async () => {
    const { onSubmit } = setup({
      initial: {
        id: 'i1',
        name: '白米',
        grams: 180,
        per100g: ZERO,
        nutrients: ZERO,
        foodId: null,
        pending: true,
      provisional: false,
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '変更する' }));
    expect(firstCall(onSubmit)[0].id).toBe('i1');
  });
});

// -----------------------------------------------------------------------------
// 追加仕様: 仮の栄養値 — 管理者が「仮」の食材を開いたとき
//
// ★ 開いた時点で欄に値が入っています（契約者が入れた値）。
//   そのまま保存すると、押しただけで確定値に化けます。
//   契約者の当て推量を、管理者が確かめずに承認した形になります。
//   値を確定させる道は「登録依頼」の画面だけ、と決めています。
// -----------------------------------------------------------------------------

describe('★ 管理者が「仮」の食材を開いたとき', () => {
  const provisional = aProvisionalItem({ name: 'ささみジャーキー', grams: 50 });

  it('契約者が入れた値が、欄に入っている（消えない）', async () => {
    render(
      <ItemForm initial={provisional} canEditNutrition onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    await screen.findByDisplayValue('ささみジャーキー');

    expect(screen.getByLabelText('kcal')).toHaveValue(400);
    expect(screen.getByLabelText('P')).toHaveValue(20);
  });

  it('そのまま保存しても、確定値には化けない', async () => {
    const onSubmit = vi.fn();
    render(
      <ItemForm initial={provisional} canEditNutrition onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    await screen.findByDisplayValue('ささみジャーキー');
    await userEvent.click(screen.getByRole('button', { name: '変更する' }));

    const [item] = firstCall(onSubmit);
    expect(item.provisional).toBe(true);
    expect(item.pending).toBe(true);
    expect(item.foodId).toBeNull();
  });

  it('量だけ直しても、仮のままで再計算される', async () => {
    const onSubmit = vi.fn();
    render(
      <ItemForm initial={provisional} canEditNutrition onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    await screen.findByDisplayValue('ささみジャーキー');

    const grams = screen.getByLabelText('食べた量（g）');
    await userEvent.clear(grams);
    await userEvent.type(grams, '100');
    await userEvent.click(screen.getByRole('button', { name: '変更する' }));

    const [item] = firstCall(onSubmit);
    expect(item.provisional).toBe(true);
    // 400kcal/100g × 100g = 400kcal
    expect(item.nutrients.kcal).toBe(400_000);
  });

  it('値を消せば、仮の値も外れる', async () => {
    const onSubmit = vi.fn();
    render(
      <ItemForm initial={provisional} canEditNutrition onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    await screen.findByDisplayValue('ささみジャーキー');

    for (const label of ['kcal', 'P', 'F', 'C']) {
      await userEvent.clear(screen.getByLabelText(label));
    }
    await userEvent.click(screen.getByRole('button', { name: '変更する' }));

    const [item] = firstCall(onSubmit);
    expect(item.provisional).toBe(false);
    expect(item.nutrients).toEqual(ZERO);
  });
});
