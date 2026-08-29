import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * お知らせが自動で作られること（追加仕様: お知らせ欄）。
 *
 * ★ お知らせは、人が書くのではなく出来事から作ります。
 *
 *     契約者を作った     → 登録が完了しました
 *     昇格させた         → ランクが上がりました
 *     コメントを保存した → コメントが届きました（NotesSection 側で確認）
 *
 *   「管理者が書く欄」にすると、忙しい日は書かれません。
 *   書かれない欄は、契約者もやがて見なくなります。
 *
 * ★ 下げたときは、お知らせを出しません。
 *   降格をアプリが通知するのは、トレーナーの仕事を奪う形になります。
 *   伝えるなら人の言葉で伝えるべき話です。
 */

const getDoc = vi.fn();
const getDocs = vi.fn();
const setDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...a: unknown[]): unknown => ({ path: a }),
  doc: (...a: unknown[]): unknown => ({ path: a }),
  deleteDoc: vi.fn(),
  getDoc: (...a: unknown[]): unknown => getDoc(...a),
  getDocs: (...a: unknown[]): unknown => getDocs(...a),
  orderBy: (...a: unknown[]): unknown => ({ orderBy: a }),
  query: (...a: unknown[]): unknown => ({ query: a }),
  setDoc: (...a: unknown[]): unknown => setDoc(...a),
}));

vi.mock('firebase/app', () => ({
  initializeApp: (): unknown => ({ name: 'secondary' }),
  deleteApp: vi.fn(async () => undefined),
}));

vi.mock('firebase/auth', () => ({
  getAuth: (): unknown => ({}),
  signOut: vi.fn(async () => undefined),
  createUserWithEmailAndPassword: vi.fn(async () => ({ user: { uid: 'uid-1' } })),
}));

vi.mock('@/lib/firebase', () => ({ getDb: (): unknown => ({}) }));

vi.mock('@/config/firebase', () => ({
  clientIdToEmail: (id: string): string => `${id}@pt-app.local`,
  getFirebaseConfig: (): unknown => ({}),
}));

const { createClient, setClientRank } = await import('@/features/clients/clientsRepo');
const { aClient } = await import('@/test/factories');
const { WELCOME_NOTICE_ID, rankUpNoticeId } = await import('@pt/core');

/** clients に書かれた内容のうち、最後の1件 */
function lastWritten(): Record<string, unknown> {
  const calls = setDoc.mock.calls as [unknown, Record<string, unknown>][];
  return calls[calls.length - 1]![1];
}

beforeEach(() => {
  getDoc.mockReset();
  getDocs.mockReset();
  setDoc.mockReset();
  getDoc.mockResolvedValue({ exists: () => false });
  getDocs.mockResolvedValue({ docs: [] });
  setDoc.mockResolvedValue(undefined);
});

describe('契約者を作ったとき', () => {
  it('★ 最初から「登録が完了しました」が入っている', async () => {
    // ★ 空のベルを見せても、そこに何が出るのか伝わりません。
    //   初回ログインの時点で1件入っている状態にします。
    await createClient({
      clientId: 'tanaka01',
      displayName: '田中 花子',
      initialPassword: 'password123',
    });

    const [, written] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    const notices = written.notices as { id: string; kind: string }[];
    expect(notices).toHaveLength(1);
    expect(notices[0]?.id).toBe(WELCOME_NOTICE_ID);
    expect(notices[0]?.kind).toBe('welcome');
  });
});

describe('ランクを変えたとき', () => {
  it('★ 上げたときは、お知らせが増える', async () => {
    const client = aClient({ clientId: 'taro', rank: 'PLATINUM', notices: [] });

    await setClientRank(client, 'RUBY');

    const notices = lastWritten().notices as { id: string }[];
    expect(notices).toHaveLength(1);
    expect(notices[0]?.id).toBe(rankUpNoticeId('RUBY'));
  });

  it('★ 下げたときは、お知らせを出さない', async () => {
    // ★ 降格をアプリが通知するのは、トレーナーの仕事を奪う形になります
    const client = aClient({ clientId: 'taro', rank: 'EMERALD', notices: [] });

    await setClientRank(client, 'RUBY');

    // 書き込みは「ランクの変更」1回だけ。お知らせの書き込みは起きない
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(lastWritten().rank).toBe('RUBY');
    expect(lastWritten().notices).toBeUndefined();
  });

  it('同じランクに付け直しても、お知らせは出ない', async () => {
    const client = aClient({ clientId: 'taro', rank: 'RUBY', notices: [] });

    await setClientRank(client, 'RUBY');

    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('ランクは、お知らせの成否によらず必ず保存される', async () => {
    // ★ 順番が大事です。ランクを先に書いてから、お知らせを足します。
    //   逆にすると、お知らせが失敗したときにランクまで上がりません。
    const client = aClient({ clientId: 'taro', rank: 'PLATINUM', notices: [] });

    await setClientRank(client, 'RUBY');

    const [, first] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(first.rank).toBe('RUBY');
  });

  it('前のお知らせは消えない', async () => {
    const client = aClient({
      clientId: 'taro',
      rank: 'PLATINUM',
      notices: [
        { id: WELCOME_NOTICE_ID, kind: 'welcome', at: 1, title: '登録', body: '', date: null },
      ],
    });

    await setClientRank(client, 'RUBY');

    const notices = lastWritten().notices as { id: string }[];
    expect(notices.map((n) => n.id)).toContain(WELCOME_NOTICE_ID);
    expect(notices).toHaveLength(2);
  });
});
