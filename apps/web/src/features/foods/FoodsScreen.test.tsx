import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aFood } from '@/test/factories';
import { FoodsScreen } from './FoodsScreen';
import type * as FoodsRepo from './foodsRepo';

/**
 * 食品マスタの一覧で、名前のぶつかりに印を出す（追加仕様: 名前の重複に印）。
 *
 * ★ これは実際に起きて、原因を突き止めるのに何往復もかかりました。
 *
 *   「卵」が2件ありました。片方は F 10.2、もう片方は古い F 1.2 です。
 *   管理者は新しいほうを直していたのに、契約者の画面には
 *   **古いほうの数字が出ていました。**
 *
 *   食材を探す処理は、当たった中の先頭を黙って返します。
 *   どちらが選ばれるかは並び順しだいで、画面には何も出ません。
 *   トレーナーが数字を根拠に指導するアプリで、
 *   「どの数字が使われるか分からない」は、あってはならない状態です。
 */

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock('./FoodEditor', () => ({ FoodEditor: () => null }));

vi.mock('./foodsRepo', async () => {
  const actual = await vi.importActual<typeof FoodsRepo>('./foodsRepo');
  return { ...actual, loadFoods: vi.fn(), deleteFood: vi.fn(), clearFoodCache: vi.fn() };
});

const { loadFoods } = await import('./foodsRepo');

/** 実際に起きた形。「卵（別名たまご）」と、古い「たまご」 */
const EGG = aFood({
  id: 'たまご',
  name: '卵',
  aliases: ['たまご'],
  per100g: { kcal: 142, p: 12.2, f: 10.2, c: 0.4 },
});
const EGG_OLD = aFood({
  id: 'e2',
  name: 'たまご',
  aliases: [],
  per100g: { kcal: 142, p: 12.2, f: 1.2, c: 0.4 },
});
const RICE = aFood();

async function show(foods = [EGG, EGG_OLD]) {
  vi.mocked(loadFoods).mockResolvedValue(foods);
  render(<FoodsScreen />);
  await screen.findByText('食品マスタ');
}

beforeEach(() => {
  vi.mocked(loadFoods).mockReset();
});

describe('★ ぶつかっているとき', () => {
  it('一覧の上に、件数を出す', async () => {
    // ★ 印だけだと、下までたどらないと気づけません
    await show();
    await waitFor(() => {
      expect(screen.getByText('名前がぶつかっている食材が2件あります')).toBeInTheDocument();
    });
  });

  it('★ 同じものが2件ある、と書く', async () => {
    // ★ 「重複しています」だけでは、放っておいていいものに見えます。
    //   何が起きているのか（同じものが2件ある）まで書きます。
    //
    // ★ 以前は「どちらの数字が使われるか決まりません」と書いていました。
    //   いまは決まらないときは選ばせるので、その文は嘘になりました。
    //   残る問題は「選ぶ画面に出しても見分けられないこと」です。
    await show();
    await waitFor(() => {
      expect(screen.getByText(/同じものが2件登録されている/)).toBeInTheDocument();
    });
    expect(screen.getByText(/同じ名前が並ぶだけで見分けられません/)).toBeInTheDocument();
  });

  it('★ ぶつかっている相手を名指しする', async () => {
    // ★ 「ぶつかっています」だけでは、どこを直せばいいか分かりません
    await show();
    await waitFor(() => {
      expect(screen.getByText(/「たまご」がたまごとぶつかっています/)).toBeInTheDocument();
    });
    expect(screen.getByText(/「たまご」が卵とぶつかっています/)).toBeInTheDocument();
  });

  it('ぶつかっている行だけに印が付く', async () => {
    await show([EGG, EGG_OLD, RICE]);
    await waitFor(() => {
      expect(document.querySelectorAll('.conflicted')).toHaveLength(2);
    });
  });
});

describe('ぶつかっていないとき', () => {
  it('何も出さない', async () => {
    // ★ 常に出ていると、出ていること自体に意味がなくなります
    await show([RICE]);
    await waitFor(() => {
      expect(screen.getByText('白米')).toBeInTheDocument();
    });

    expect(screen.queryByText(/名前がぶつかっている/)).not.toBeInTheDocument();
    expect(document.querySelectorAll('.conflicted')).toHaveLength(0);
  });
});

describe('★ 検索との関係', () => {
  it('★ 相手が検索の外にいても、印は出たままにする', async () => {
    // ★ 絞ったあとで数えると、相手が画面外にいるときに
    //   「ぶつかっていない」ように見えます。いちばん困る嘘です。
    await show([EGG, EGG_OLD, RICE]);
    await waitFor(() => {
      expect(screen.getByText('名前がぶつかっている食材が2件あります')).toBeInTheDocument();
    });
  });
});

/**
 * まとめ呼び（追加仕様: まとめ呼び）。
 *
 * ★ 以前はこれも「ぶつかっています。直してください」と出していました。
 *
 *   すると管理者は「同じ別名を複数に付けてはいけない」と読みます。
 *   実際そう読まれて、まとめ呼びが使われませんでした。
 *   ひらがなで当てる手段が、警告のせいで封じられていた形です。
 */
describe('★ まとめ呼びのとき', () => {
  const MOMEN = aFood({ id: 'm', name: '木綿豆腐', aliases: ['とうふ'] });
  const KINU = aFood({ id: 'k', name: '絹豆腐', aliases: ['とうふ'] });

  it('★ 警告を出さない', async () => {
    await show([MOMEN, KINU]);
    expect(screen.queryByText(/名前がぶつかっている/)).not.toBeInTheDocument();
  });

  it('何がまとめ呼びなのか、一覧で見える', async () => {
    // ★ 別名は食材ごとの編集画面に散らばっています。
    //   一覧にしないと「いま『とうふ』で何が出るのか」を誰も把握できません
    await show([MOMEN, KINU]);
    expect(screen.getByText('まとめ呼び（1件）')).toBeInTheDocument();
    expect(screen.getByText(/木綿豆腐・絹豆腐/)).toBeInTheDocument();
  });

  it('まとめ呼びが無ければ、その欄自体を出さない', async () => {
    await show([RICE]);
    expect(screen.queryByText(/まとめ呼び/)).not.toBeInTheDocument();
  });

  it('★ 本名が取られているものは、今までどおり警告に出る', async () => {
    // ★ 「とうふ」という食材が別にあるなら、選ぶ画面でも見分けられません
    const PLAIN = aFood({ id: 'p', name: 'とうふ', aliases: [] });
    await show([MOMEN, PLAIN]);
    expect(screen.getByText('名前がぶつかっている食材が2件あります')).toBeInTheDocument();
  });
});
