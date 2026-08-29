import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aCandidate, aFood, aRequest, anEntry } from '@/test/factories';
import { firstCall } from '@/test/helpers';
import { RequestsScreen } from './RequestsScreen';
import type * as RequestsRepo from './requestsRepo';
import type * as FoodsRepo from './foodsRepo';

/**
 * 登録依頼をさばく画面（設計書 §21 / 追加仕様: 成分表示の読み取り）。
 *
 * ★ ここは実際に2つのバグが出た場所です。両方をテストで固定します。
 *
 *   1. 成分表示の写真が、「新しく登録する」を押した瞬間に消えていた。
 *      値を入れているあいだこそ見比べたいのに、いちばん必要な場面で
 *      判断材料が画面から消えていました。
 *
 *   2. 保存しても依頼が一覧に残っていた。
 *      登録し終えたのに残っていると、やり残しがあるようにしか見えません。
 *      押し忘れれば、同じ食材の依頼をもう一度開くことになります。
 */

vi.mock('./requestsRepo', async () => {
  const actual = await vi.importActual<typeof RequestsRepo>('./requestsRepo');
  return { ...actual, listRequests: vi.fn(), resolveRequest: vi.fn() };
});

vi.mock('./foodsRepo', async () => {
  const actual = await vi.importActual<typeof FoodsRepo>('./foodsRepo');
  return { ...actual, loadFoods: vi.fn(), saveFood: vi.fn(), addAlias: vi.fn() };
});

vi.mock('./bulkReplace', () => ({ replacePastRecords: vi.fn() }));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    state: { status: 'signedIn', user: { uid: 'uid-admin', role: 'admin', clientId: null } },
  }),
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

const { listRequests, resolveRequest } = await import('./requestsRepo');
const { loadFoods, saveFood, addAlias } = await import('./foodsRepo');
const { replacePastRecords } = await import('./bulkReplace');

const WITH_PHOTO = aRequest({
  from: [anEntry({ candidate: aCandidate() })],
});

beforeEach(() => {
  vi.mocked(listRequests).mockResolvedValue([WITH_PHOTO]);
  vi.mocked(loadFoods).mockResolvedValue([]);
  vi.mocked(saveFood).mockImplementation(async (f) => f);
  vi.mocked(addAlias).mockImplementation(async (f) => f);
  vi.mocked(resolveRequest).mockResolvedValue(undefined);
  vi.mocked(replacePastRecords).mockResolvedValue({ items: 2, meals: 2, days: 2 });
});

async function openRequest() {
  render(<RequestsScreen />);
  await userEvent.click(await screen.findByRole('button', { name: '対応する' }));
}

describe('一覧', () => {
  it('誰が何回使ったかを出す', async () => {
    render(<RequestsScreen />);
    expect(await screen.findByText('カップヌードル')).toBeInTheDocument();
    expect(screen.getByText(/1人が使用 · 記録2件/)).toBeInTheDocument();
  });

  it('依頼が無ければ、その旨を出す', async () => {
    vi.mocked(listRequests).mockResolvedValue([]);
    render(<RequestsScreen />);
    expect(await screen.findByText('未処理の依頼はありません。')).toBeInTheDocument();
  });

  it('権限で読めないときは、Rules の貼り直しを案内する', async () => {
    // ★ 「通信状態を確認してください」と出していたせいで、
    //   通信を疑って時間を使った実例があります
    vi.mocked(listRequests).mockRejectedValue({ code: 'permission-denied' });
    render(<RequestsScreen />);
    expect(await screen.findByText(/firebase\/firestore\.rules/)).toBeInTheDocument();
  });
});

describe('成分表示の写真', () => {
  it('依頼を開くと、読み取った値と写真が出る', async () => {
    await openRequest();
    expect(screen.getByText('契約者が撮った成分表示')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '成分表示を拡大' })).toBeInTheDocument();
  });

  it('「新しく登録する」を押しても、写真は消えない', async () => {
    // ★ ここが直したバグそのものです。
    //   値を入れているあいだこそ、表示と見比べる必要があります。
    await openRequest();
    await userEvent.click(screen.getByRole('button', { name: '新しく登録する' }));

    expect(screen.getByRole('button', { name: '成分表示を拡大' })).toBeInTheDocument();
    expect(screen.getByText('契約者が撮った成分表示')).toBeInTheDocument();
  });

  it('撮っていない依頼では、写真の欄を出さない', async () => {
    vi.mocked(listRequests).mockResolvedValue([aRequest({ from: [anEntry()] })]);
    await openRequest();
    expect(screen.queryByText('契約者が撮った成分表示')).not.toBeInTheDocument();
  });

  it('読み取った値が、登録の初期値として入っている', async () => {
    await openRequest();
    await userEvent.click(screen.getByRole('button', { name: '新しく登録する' }));
    expect(screen.getByLabelText('kcal')).toHaveValue(461.4);
  });
});

describe('新しく登録する', () => {
  it('保存すると、過去の記録に反映してから依頼を片付ける', async () => {
    // ★ 「保存する」で全部終わります。別に「完了」を押す必要はありません。
    await openRequest();
    await userEvent.click(screen.getByRole('button', { name: '新しく登録する' }));
    await userEvent.click(screen.getByRole('button', { name: '保存する' }));

    await waitFor(() => expect(replacePastRecords).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(resolveRequest).toHaveBeenCalledTimes(1));
  });

  it('何件に反映したかを、数で伝える', async () => {
    await openRequest();
    await userEvent.click(screen.getByRole('button', { name: '新しく登録する' }));
    await userEvent.click(screen.getByRole('button', { name: '保存する' }));

    expect(await screen.findByText(/「カップヌードル」を登録しました。/)).toBeInTheDocument();
    // 件数は <b> で囲まれているので、要素をまたいだ形で確かめる
    expect(screen.getByText(/待っていた記録/)).toHaveTextContent(
      '待っていた記録2件に、この値を入れました（2日分）。契約者の合計に反映されています。',
    );
    expect(screen.getByText(/この依頼は処理済みとして閉じました/)).toBeInTheDocument();
  });

  it('反映する記録が無かったときも、そう伝える', async () => {
    vi.mocked(replacePastRecords).mockResolvedValue({ items: 0, meals: 0, days: 0 });
    await openRequest();
    await userEvent.click(screen.getByRole('button', { name: '新しく登録する' }));
    await userEvent.click(screen.getByRole('button', { name: '保存する' }));

    expect(
      await screen.findByText(/この値を待っている記録はありませんでした/),
    ).toBeInTheDocument();
  });

  it('置き換えたのは管理者だと分かるよう、UIDを渡す', async () => {
    await openRequest();
    await userEvent.click(screen.getByRole('button', { name: '新しく登録する' }));
    await userEvent.click(screen.getByRole('button', { name: '保存する' }));

    await waitFor(() => expect(replacePastRecords).toHaveBeenCalledTimes(1));
    expect(firstCall(vi.mocked(replacePastRecords))[2]).toBe('uid-admin');
  });

  it('反映に失敗しても、登録そのものは終わったことにする', async () => {
    // 登録は済んでいるので、やり直させると同じ食材が2件できます
    vi.mocked(replacePastRecords).mockRejectedValue({ code: 'unavailable' });
    await openRequest();
    await userEvent.click(screen.getByRole('button', { name: '新しく登録する' }));
    await userEvent.click(screen.getByRole('button', { name: '保存する' }));

    expect(await screen.findByText(/記録への反映を保存できませんでした/)).toBeInTheDocument();
  });
});

describe('既にある食材にまとめる', () => {
  beforeEach(() => {
    vi.mocked(loadFoods).mockResolvedValue([
      aFood({ id: 'かっぷめん', name: 'カップ麺', aliases: [] }),
    ]);
    vi.mocked(listRequests).mockResolvedValue([
      aRequest({ id: 'かっぷめんしょうゆ', name: 'カップ麺しょうゆ', from: [anEntry()] }),
    ]);
  });

  it('似た食材があれば、まとめる先として出す', async () => {
    await openRequest();
    expect(screen.getByRole('button', { name: /カップ麺 にまとめる/ })).toBeInTheDocument();
  });

  it('まとめると、依頼の表記が別名として足される', async () => {
    await openRequest();
    await userEvent.click(screen.getByRole('button', { name: /カップ麺 にまとめる/ }));

    await waitFor(() => expect(addAlias).toHaveBeenCalledTimes(1));
    expect(firstCall(vi.mocked(addAlias))[0].id).toBe('かっぷめん');
  });

  it('まとめたあとも、過去の記録に反映して依頼を片付ける', async () => {
    await openRequest();
    await userEvent.click(screen.getByRole('button', { name: /カップ麺 にまとめる/ }));

    await waitFor(() => expect(replacePastRecords).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(resolveRequest).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/にまとめました。/)).toBeInTheDocument();
  });
});

describe('登録せずに消す', () => {
  it('依頼だけを消す（記録には触らない）', async () => {
    await openRequest();
    await userEvent.click(screen.getByRole('button', { name: 'この依頼を消す' }));

    await waitFor(() => expect(resolveRequest).toHaveBeenCalledTimes(1));
    expect(replacePastRecords).not.toHaveBeenCalled();
  });
});
