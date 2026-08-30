import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@/features/clients/clientTypes';
import { WeightScreen } from './WeightScreen';

/**
 * 体重の推移（設計書 §25 / 追加仕様: 筋肉量）。
 *
 * ★ ここで固定したいのは、グラフが**必ず3つ出る**ことです。
 *
 *   筋肉量を足したとき、記録が1件も無いあいだは出さない作りにしていました。
 *   「空のグラフが3つ並ぶより2つのほうが読みやすい」と考えたためです。
 *
 *   結果、使う側からは「筋肉量の機能が入っていない」と見えました。
 *   欄が無いのと機能が無いのは、画面の外からは区別が付きません。
 *   同じ間違いを、AIの入口でも一度やっています。
 *
 *   空でも出す。中身が無いことは「記録がありません」の一文で伝わります。
 */

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const listRange = vi.fn();

vi.mock('@/features/days/daysRepo', () => ({
  listRange: (...a: unknown[]): unknown => listRange(...a),
}));

function aClient(over: Partial<Client['targets']> = {}): Client {
  return {
    clientId: 'c1',
    displayName: 'たろう',
    targets: {
      kcal: 1800,
      p: 130,
      f: 50,
      c: 200,
      weightKg: 70,
      bodyFatPct: 15,
      muscleKg: null,
      exercise: '',
      ...over,
    },
  } as Client;
}

beforeEach(() => {
  listRange.mockReset();
  listRange.mockResolvedValue([]);
});

describe('★ グラフは3つとも出す', () => {
  it('記録が1件も無くても、筋肉量のグラフが出る', async () => {
    render(<WeightScreen client={aClient()} />);

    expect(await screen.findByRole('heading', { name: '体重' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '体脂肪率' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '筋肉量' })).toBeInTheDocument();
  });

  it('記録が無いときは、その旨を書く（黙って空にしない）', async () => {
    render(<WeightScreen client={aClient()} />);
    expect(await screen.findByText('この期間に筋肉量の記録がありません。')).toBeInTheDocument();
  });

  it('記録があれば、最新の値が出る', async () => {
    listRange.mockResolvedValue([
      { date: '2026-08-01', weightKg: 70, bodyFatPct: 15, muscleKg: 55 },
      { date: '2026-08-20', weightKg: 70, bodyFatPct: 14, muscleKg: 56.2 },
    ]);

    render(<WeightScreen client={aClient({ muscleKg: 58 })} />);

    expect(await screen.findByText('56.2kg')).toBeInTheDocument();
    // ★ 「体重は変わらないが筋肉は増えている」が読める、という欄の値打ちそのものです
    expect(screen.getByText(/この期間で \+1\.2kg/)).toBeInTheDocument();
    expect(screen.getByText('目標 58kg')).toBeInTheDocument();
  });
});
