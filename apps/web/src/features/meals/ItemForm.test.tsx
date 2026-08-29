import { toInternal, ZERO } from '@pt/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aFood } from '@/test/factories';
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
  it('栄養値の入力欄が出ない', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), 'サラダチキン');

    // kcal / P / F / C を打てる場所が、どこにも無いこと
    expect(screen.queryByLabelText('kcal')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('P')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('F')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('C')).not.toBeInTheDocument();
  });

  it('未登録の食材だと、「量だけ記録して依頼する」と伝える', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), 'サラダチキン');

    expect(screen.getByText(/量だけ記録し、トレーナーに登録を依頼します/)).toBeInTheDocument();
    expect(screen.getByText(/合計に含まれません/)).toBeInTheDocument();
  });

  it('未登録の食材は、栄養値0・登録待ちとして渡される', async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByLabelText('食材の名前'), 'サラダチキン');
    await userEvent.type(screen.getByLabelText('食べた量（g）'), '110');
    await userEvent.click(screen.getByRole('button', { name: '追加する' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [item, requestName] = firstCall(onSubmit);
    expect(item.pending).toBe(true);
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
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '変更する' }));
    expect(firstCall(onSubmit)[0].id).toBe('i1');
  });
});
