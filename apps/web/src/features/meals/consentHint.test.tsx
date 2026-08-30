import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Meal } from '@pt/core';
import { AI_CONSENT_VERSION, type AiConsent } from '@/features/clients/clientTypes';
import { MealsSection } from './MealsSection';

/**
 * 「文章から」「写真から」「成分表示から」が出ない理由を伝える（設計書 §35）。
 *
 * ★ これは、実際に使っていて詰まった箇所です。
 *
 *   AIの利用に同意していないと、この3つの入口は出ません。
 *   同意していない人のデータをAIへ送らないための、意図した動きです。
 *
 *   ところが**理由が画面に出ていませんでした。**
 *   ボタンが無いのと機能が無いのは、使う側からは区別が付きません。
 *   作った本人でさえ「入口が消えた」と思ったので、契約者ならなおさらです。
 *
 * ★ ただし、中継役（Worker）が未設定のときは何も言いません。
 *   同意しても出ないので、案内したところで行き止まりになります。
 */

let relayUrl: string | null = 'https://relay.example';

vi.mock('@/config/firebase', () => ({
  get AI_RELAY_URL() {
    return relayUrl;
  },
}));

const listMeals = vi.fn();

vi.mock('./mealsRepo', () => ({
  listMeals: (...a: unknown[]): unknown => listMeals(...a),
  saveMeal: vi.fn(async () => undefined),
  deleteMeal: vi.fn(async () => undefined),
  syncDayMealFlag: vi.fn(async () => undefined),
  newMealId: (): string => 'm-new',
}));

vi.mock('@/features/foods/requestsRepo', () => ({ requestFood: vi.fn() }));
vi.mock('@/features/ai/AiTextPanel', () => ({ AiTextPanel: () => null }));
vi.mock('./LabelItemPanel', () => ({ LabelItemPanel: () => null }));
vi.mock('./ItemForm', () => ({ ItemForm: () => null }));

function aMeal(over: Partial<Meal> = {}): Meal {
  return {
    id: 'm1',
    order: 0,
    label: '1食目',
    items: [],
    memo: '',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

const AGREED: AiConsent = { granted: true, updatedAt: 1, version: AI_CONSENT_VERSION };
const NOT_AGREED: AiConsent = { granted: false, updatedAt: null, version: 0 };
/** 昔に同意したが、説明文が新しくなって取り直しが要る状態 */
const OUTDATED: AiConsent = { granted: true, updatedAt: 1, version: AI_CONSENT_VERSION - 1 };

async function show(aiConsent: AiConsent, isAdmin = false, canEdit = true) {
  render(
    <MemoryRouter>
      <MealsSection
        clientId="taro"
        date="2026-08-29"
        targets={{ kcal: 1800, p: 130, f: 50, c: 200, weightKg: null, bodyFatPct: null, muscleKg: null, exercise: '' }}
        canEdit={canEdit}
        isAdmin={isAdmin}
        aiConsent={aiConsent}
      />
    </MemoryRouter>,
  );
  // 食事の名前は、書ける日は入力欄・読むだけの日は文字。両方で待てる目印を使います
  if (canEdit) await screen.findAllByRole('button', { name: /食材/ });
  else await screen.findByText('1食目');
}

beforeEach(() => {
  relayUrl = 'https://relay.example';
  listMeals.mockReset();
  listMeals.mockResolvedValue([aMeal()]);
});

describe('同意しているとき', () => {
  it('3つの入口が出る', async () => {
    await show(AGREED);

    expect(screen.getByRole('button', { name: '文章から' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '写真から' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '成分表示から' })).toBeInTheDocument();
  });

  it('理由の案内は出さない', async () => {
    await show(AGREED);
    expect(screen.queryByText(/AIの利用に同意が必要です/)).not.toBeInTheDocument();
  });
});

describe('★ 同意していないとき', () => {
  it('3つの入口は出ない（ここは今までどおり）', async () => {
    await show(NOT_AGREED);

    expect(screen.queryByRole('button', { name: '文章から' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '写真から' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '成分表示から' })).not.toBeInTheDocument();
  });

  it('手で入れる道は、ちゃんと残っている', async () => {
    await show(NOT_AGREED);
    expect(screen.getByRole('button', { name: '+ 食材を追加' })).toBeInTheDocument();
  });

  it('★ なぜ出ないのかを、その場に書く', async () => {
    await show(NOT_AGREED);
    expect(
      screen.getByText(/文章・写真・成分表示から入れるには、AIの利用に同意が必要です/),
    ).toBeInTheDocument();
  });

  it('★ どこへ行けば同意できるかも出す', async () => {
    // ★ 「同意が要ります」だけでは、どこで同意するのか分かりません
    await show(NOT_AGREED);
    expect(screen.getByRole('link', { name: '設定を開く' })).toHaveAttribute(
      'href',
      '/c/taro/settings',
    );
  });

  it('説明文が新しくなっただけのときは、取り直しだと伝える', async () => {
    await show(OUTDATED);
    expect(screen.getByText(/同意し直してください/)).toBeInTheDocument();
  });
});

describe('管理者が見るとき', () => {
  it('★ 「設定を開く」は出さない（管理者は代わりに同意できない）', async () => {
    // ★ 押しても何もできないリンクを出すと、代われると誤解させます
    await show(NOT_AGREED, true);

    expect(screen.getByText(/同意はご本人だけが行えます/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '設定を開く' })).not.toBeInTheDocument();
  });
});

describe('★ 中継役（Worker）が未設定のとき', () => {
  it('何も案内しない（同意しても出ないため）', async () => {
    // ★ 案内どおりに同意しても入口が出ないのは、いちばん困らせる形です
    relayUrl = null;
    await show(NOT_AGREED);

    expect(screen.queryByText(/AIの利用に同意が必要です/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ 食材を追加' })).toBeInTheDocument();
  });
});

describe('出す場所', () => {
  it('★ 食事が何件あっても、案内は1つだけ', async () => {
    // ★ 食事ごとに出すと、同じ文が画面に何度も並びます
    listMeals.mockResolvedValue([aMeal(), aMeal({ id: 'm2', order: 1, label: '2食目' })]);
    await show(NOT_AGREED);

    await waitFor(() => {
      expect(screen.getAllByText(/AIの利用に同意が必要です/)).toHaveLength(1);
    });
  });

  it('読むだけの日（過去など）には出さない', async () => {
    await show(NOT_AGREED, false, false);
    expect(screen.queryByText(/AIの利用に同意が必要です/)).not.toBeInTheDocument();
  });
});
