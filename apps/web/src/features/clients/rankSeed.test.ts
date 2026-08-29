import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 初期ランクの枠は、システム全体で1人だけ（追加仕様: 会員ランク）。
 *
 * ★ 画面（ClientCreateScreen）でも欄を閉じていますが、ここでも確かめます。
 *
 *   画面の作りは、あとから変わります。欄を閉じ忘れる日も来ます。
 *   契約者を作る道は必ず createClient を通るので、
 *   **最後の関所をここに置いて**あります。
 *
 * ★ なぜ1人だけなのか。
 *
 *   初期ランクを何人にも付けられるなら、ランクは「頑張った印」ではなく
 *   「作るときに選ぶ飾り」になります。それでは持つ意味がありません。
 *   トレーナー自身のアカウントのような、本当の例外1つのためだけの枠です。
 */

const getDoc = vi.fn();
const getDocs = vi.fn();
const setDoc = vi.fn();
const createUserWithEmailAndPassword = vi.fn();

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
  createUserWithEmailAndPassword: (...a: unknown[]): unknown =>
    createUserWithEmailAndPassword(...a),
}));

vi.mock('@/lib/firebase', () => ({ getDb: (): unknown => ({}) }));

vi.mock('@/config/firebase', () => ({
  clientIdToEmail: (id: string): string => `${id}@pt-app.local`,
  getFirebaseConfig: (): unknown => ({}),
}));

const { ClientOperationError, createClient, seededRankClient } = await import('./clientsRepo');

/** clients コレクションに、この人たちがいることにする */
function clientsAre(docs: { id: string; data: Record<string, unknown> }[]) {
  getDocs.mockResolvedValue({ docs: docs.map((d) => ({ id: d.id, data: () => d.data })) });
}

beforeEach(() => {
  getDoc.mockReset();
  getDocs.mockReset();
  setDoc.mockReset();
  createUserWithEmailAndPassword.mockReset();

  // 契約者IDはまだ空いている
  getDoc.mockResolvedValue({ exists: () => false });
  clientsAre([]);
  setDoc.mockResolvedValue(undefined);
  createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'uid-1' } });
});

describe('seededRankClient', () => {
  it('誰も使っていなければ null', async () => {
    clientsAre([{ id: 'tanaka01', data: { displayName: '田中 花子' } }]);
    expect(await seededRankClient()).toBeNull();
  });

  it('使っている人がいれば、その契約者を返す', async () => {
    clientsAre([
      { id: 'tanaka01', data: { displayName: '田中 花子' } },
      { id: 'kintaro', data: { displayName: '金太郎', rank: 'DIAMOND', rankSeeded: true } },
    ]);
    const seeded = await seededRankClient();
    expect(seeded?.clientId).toBe('kintaro');
  });
});

describe('★ 初期ランクを指定して作れるのは、1人だけ', () => {
  it('1人目は、上のランクで作れる', async () => {
    await createClient({
      clientId: 'kintaro',
      displayName: '金太郎',
      initialPassword: '19190721',
      rank: 'DIAMOND',
    });

    const [, written] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(written.rank).toBe('DIAMOND');
    expect(written.rankSeeded).toBe(true);
  });

  it('★ 2人目は、断る', async () => {
    clientsAre([
      { id: 'kintaro', data: { displayName: '金太郎', rank: 'DIAMOND', rankSeeded: true } },
    ]);

    await expect(
      createClient({
        clientId: 'ginjiro',
        displayName: '銀次郎',
        initialPassword: 'password123',
        rank: 'CROWN',
      }),
    ).rejects.toMatchObject({ kind: 'rankAlreadySeeded' });
  });

  it('★ 断るときは、1件も書かない', async () => {
    // ★ 途中まで書いてしまうと「作りかけの契約者」が残ります。
    clientsAre([
      { id: 'kintaro', data: { displayName: '金太郎', rank: 'DIAMOND', rankSeeded: true } },
    ]);

    await expect(
      createClient({
        clientId: 'ginjiro',
        displayName: '銀次郎',
        initialPassword: 'password123',
        rank: 'CROWN',
      }),
    ).rejects.toBeInstanceOf(ClientOperationError);

    expect(setDoc).not.toHaveBeenCalled();
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('枠が使われていても、PLATINUM の契約者はいつでも作れる', async () => {
    clientsAre([
      { id: 'kintaro', data: { displayName: '金太郎', rank: 'DIAMOND', rankSeeded: true } },
    ]);

    await createClient({
      clientId: 'tanaka01',
      displayName: '田中 花子',
      initialPassword: 'password123',
      rank: 'PLATINUM',
    });

    const [, written] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(written.rank).toBe('PLATINUM');
    expect(written.rankSeeded).toBe(false);
  });

  it('ランクを指定しなければ、枠は使わない', async () => {
    await createClient({
      clientId: 'tanaka01',
      displayName: '田中 花子',
      initialPassword: 'password123',
    });

    const [, written] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(written.rank).toBe('PLATINUM');
    expect(written.rankSeeded).toBe(false);
  });

  it('★ 枠を使った契約者を消せば、枠は空く', async () => {
    // ★ 「使った回数」を数えずに、実在する契約者で数えているためです。
    //   数だけ持つと、消したあとに合わなくなって二度と使えなくなります。
    clientsAre([{ id: 'tanaka01', data: { displayName: '田中 花子' } }]);

    await createClient({
      clientId: 'kintaro',
      displayName: '金太郎',
      initialPassword: '19190721',
      rank: 'DIAMOND',
    });

    const [, written] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(written.rankSeeded).toBe(true);
  });
});
