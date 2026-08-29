import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LabelItemPanel } from './LabelItemPanel';
import { firstCall } from '@/test/helpers';

/**
 * 成分表示から食材を起こす（設計書 §47 / 追加仕様: 成分表示の読み取り）。
 *
 * ★ 袋に書いてある数字でも、その場で記録には入りません。
 *
 *   桁の読み違いも、参考値の取り違えも起こります。
 *   （カップ麺は「1食263kcal」と「めん・かやく243kcal」で2割ちがいます）
 *   全員のマスタに入る数値を決めるのは管理者、という線をここでも守ります。
 */

/** 読み取りそのものは LabelScanner の担当なので、ここでは結果だけを差し込む */
vi.mock('@/features/foods/LabelScanner', () => ({
  LabelScanner: ({
    onDone,
  }: {
    onDone: (r: {
      per100g: { kcal: number; p: number; f: number; c: number; fiber: number; salt: number };
      note: string;
      photo: string;
      productName: string;
      servingGrams: number | null;
    }) => void;
    onCancel: () => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          onDone({
            per100g: { kcal: 461.4, p: 10, f: 18.1, c: 65.3, fiber: 0, salt: 4.2 },
            note: '1食57gあたりの表示から換算しました。',
            photo: 'data:image/gif;base64,AAAA',
            productName: 'カップヌードル',
            servingGrams: 57,
          })
        }
      >
        読めた（1回分57g）
      </button>
      <button
        type="button"
        onClick={() =>
          onDone({
            per100g: { kcal: 156, p: 2.5, f: 0.3, c: 37.1, fiber: 0, salt: 0 },
            note: '100g当たりの表示です。',
            photo: 'data:image/gif;base64,BBBB',
            productName: 'レトルトごはん',
            servingGrams: null,
          })
        }
      >
        読めた（100g当たり表示）
      </button>
    </>
  ),
}));

function setup() {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(<LabelItemPanel onAdd={onAdd} onClose={onClose} />);
  return { onAdd, onClose };
}

describe('読み取ったあと', () => {
  it('商品名と1回分のグラム数が、そのまま入る', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: '読めた（1回分57g）' }));

    expect(screen.getByLabelText(/食材の名前/)).toHaveValue('カップヌードル');
    expect(screen.getByLabelText(/食べた量（g）/)).toHaveValue(57);
  });

  it('100g当たり表示の商品では、量を空のままにする', async () => {
    // ★ 100gを勝手に入れると、直し忘れがそのまま記録に残ります。
    //   分からないものは空にして、本人に入れてもらいます。
    setup();
    await userEvent.click(screen.getByRole('button', { name: '読めた（100g当たり表示）' }));

    expect(screen.getByLabelText(/食べた量（g）/)).toHaveValue(null);
    expect(
      screen.getByText(/100g当たりの表示だったため、量は書かれていませんでした/),
    ).toBeInTheDocument();
  });

  it('読み取った値が仮として合計に入ること、承認で置き換わることを伝える', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: '読めた（1回分57g）' }));

    expect(screen.getByText(/461.4kcal/)).toBeInTheDocument();
    expect(screen.getByText(/仮の値として、この日の合計に入れます/)).toBeInTheDocument();
    expect(screen.getByText(/承認されると、正しい値に置き換わります/)).toBeInTheDocument();
  });
});

describe('追加したとき', () => {
  it('★ 袋の数字は「仮」として入る。マスタの値として確定はしない', async () => {
    // ★ ここが線引きです。
    //   合計には入れます（撮った意味があるように）。
    //   でも foodId は付かず、pending のままです。
    //   マスタの値になるかどうかを決めるのは、これまでどおり管理者です。
    const { onAdd } = setup();
    await userEvent.click(screen.getByRole('button', { name: '読めた（1回分57g）' }));
    await userEvent.click(screen.getByRole('button', { name: 'この食材を追加する' }));

    const [item] = firstCall(onAdd);
    expect(item.provisional).toBe(true);
    expect(item.pending).toBe(true);
    expect(item.foodId).toBeNull();

    // 読み取った100gあたりの値が、そのまま入っている
    expect(item.per100g.kcal).toBe(461_400);
    expect(item.per100g.p).toBe(10_000);
    // 461.4kcal/100g × 57g = 263.0kcal（表示の「1食263kcal」に戻る）
    expect(item.nutrients.kcal).toBe(262_998);
  });

  it('読み取った値と写真は、登録依頼の候補として一緒に渡す', async () => {
    // ★ 数字だけでは、受け取った管理者が確かめようがありません。
    //   どの欄を読んだかを見抜けるのは、表示そのものを見たときだけです。
    const { onAdd } = setup();
    await userEvent.click(screen.getByRole('button', { name: '読めた（1回分57g）' }));
    await userEvent.click(screen.getByRole('button', { name: 'この食材を追加する' }));

    const [, requestName, candidate] = firstCall(onAdd);
    expect(requestName).toBe('カップヌードル');
    expect(candidate.per100g.kcal).toBe(461.4);
    expect(candidate.photo).toBe('data:image/gif;base64,AAAA');
    expect(candidate.note).toContain('1食57gあたりの表示から換算');
  });

  it('量を直せば、直したほうが記録に入る（半分だけ食べた日）', async () => {
    const { onAdd } = setup();
    await userEvent.click(screen.getByRole('button', { name: '読めた（1回分57g）' }));

    const grams = screen.getByLabelText(/食べた量（g）/);
    await userEvent.clear(grams);
    await userEvent.type(grams, '28.5');
    await userEvent.click(screen.getByRole('button', { name: 'この食材を追加する' }));

    expect(firstCall(onAdd)[0].grams).toBe(28.5);
  });

  it('名前も直せる', async () => {
    const { onAdd } = setup();
    await userEvent.click(screen.getByRole('button', { name: '読めた（1回分57g）' }));

    const name = screen.getByLabelText(/食材の名前/);
    await userEvent.clear(name);
    await userEvent.type(name, 'カップ麺（しょうゆ）');
    await userEvent.click(screen.getByRole('button', { name: 'この食材を追加する' }));

    expect(firstCall(onAdd)[0].name).toBe('カップ麺（しょうゆ）');
    expect(firstCall(onAdd)[1]).toBe('カップ麺（しょうゆ）');
  });

  it('量が空のままでは追加できない', async () => {
    const { onAdd } = setup();
    await userEvent.click(screen.getByRole('button', { name: '読めた（100g当たり表示）' }));

    expect(screen.getByRole('button', { name: 'この食材を追加する' })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('やめれば、何も渡さずに閉じる', async () => {
    const { onAdd, onClose } = setup();
    await userEvent.click(screen.getByRole('button', { name: '読めた（1回分57g）' }));
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }));

    expect(onClose).toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
