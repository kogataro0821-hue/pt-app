import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { DEFAULT_TARGETS, INITIAL_RANK, toRank, type Rank, type Targets } from '@pt/core';
import { clientIdToEmail, getFirebaseConfig } from '@/config/firebase';
import { getDb } from '@/lib/firebase';
import {
  DEFAULT_PERMISSIONS,
  emptyClient,
  type AiConsent,
  type Client,
  type ClientPermissions,
  type ProvisionStatus,
  type ReviewMode,
  type Sex,
} from './clientTypes';

/**
 * 契約者データの読み書き（設計書 §6.5）。
 *
 * ★ Cloud Functions がないため、契約者の作成もブラウザから行います。
 *   素朴に createUserWithEmailAndPassword を呼ぶと「作ったユーザーで自動的にログイン」
 *   してしまい、管理者のセッションが切れます。
 *   それを避けるため、別の Firebase インスタンスを一時的に作って使います。
 */

// -----------------------------------------------------------------------------
// 読み取り
// -----------------------------------------------------------------------------

export async function listClients(): Promise<Client[]> {
  const snap = await getDocs(query(collection(getDb(), 'clients'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => toClient(d.id, d.data()));
}

export async function getClient(clientId: string): Promise<Client | null> {
  const snap = await getDoc(doc(getDb(), 'clients', clientId));
  return snap.exists() ? toClient(snap.id, snap.data()) : null;
}

export async function clientIdExists(clientId: string): Promise<boolean> {
  const snap = await getDoc(doc(getDb(), 'clients', clientId));
  return snap.exists();
}

// -----------------------------------------------------------------------------
// 作成
// -----------------------------------------------------------------------------

export type CreateClientError =
  'idTaken' | 'weakPassword' | 'emailInUse' | 'permissionDenied' | 'unknown';

export class ClientOperationError extends Error {
  constructor(
    readonly kind: CreateClientError,
    readonly step: 'reserve' | 'auth' | 'link' | 'finalize',
  ) {
    super(`${kind}@${step}`);
    this.name = 'ClientOperationError';
  }
}

/**
 * 契約者を作る。
 *
 * サーバーが無いのでトランザクションを張れません。そこで順番を工夫し、
 * 途中で失敗しても「未完了の契約者」として画面に残り、やり直せるようにしています。
 *
 *   1. clients/{id} を provisioning 状態で先に作る  ← ここで重複IDを弾ける
 *   2. 別インスタンスで Auth ユーザーを作る          ← 管理者のセッションは無傷
 *   3. users/{uid} に権限を書く
 *   4. clients/{id} を ready にする
 */
export async function createClient(input: {
  clientId: string;
  displayName: string;
  initialPassword: string;
  targets?: Targets;
  reviewMode?: ReviewMode;
  permissions?: ClientPermissions;
}): Promise<void> {
  const db = getDb();
  const { clientId } = input;

  // --- 1. 予約 -------------------------------------------------------------
  if (await clientIdExists(clientId)) {
    throw new ClientOperationError('idTaken', 'reserve');
  }

  // 会員整理番号を、いまある番号の次にする（追加仕様: 会員ランク）
  const existing = await listClients();
  const memberNo =
    existing.reduce((n, c) => (c.memberNo !== null && c.memberNo > n ? c.memberNo : n), 0) + 1;

  const base: Client = {
    ...emptyClient(clientId),
    displayName: input.displayName.trim(),
    targets: input.targets ?? { ...DEFAULT_TARGETS },
    reviewMode: input.reviewMode ?? 'standard',
    permissions: input.permissions ?? { ...DEFAULT_PERMISSIONS },
    rank: INITIAL_RANK,
    memberNo,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    await setDoc(doc(db, 'clients', clientId), toFirestore(base));
  } catch (error) {
    throw new ClientOperationError(mapError(error), 'reserve');
  }

  // --- 2. Auth ユーザーを作る（管理者のセッションを触らない）-----------------
  let uid: string;
  const secondary = initializeApp(getFirebaseConfig(), `provisioning-${Date.now()}`);
  try {
    const secondaryAuth = getAuth(secondary);
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      clientIdToEmail(clientId),
      input.initialPassword,
    );
    uid = credential.user.uid;
    await signOut(secondaryAuth);
  } catch (error) {
    throw new ClientOperationError(mapError(error), 'auth');
  } finally {
    await safeDeleteApp(secondary);
  }

  // --- 3. 権限を書く -------------------------------------------------------
  try {
    await setDoc(doc(db, 'users', uid), {
      role: 'client',
      clientId,
      active: true,
      displayName: base.displayName,
      createdAt: Date.now(),
    });
  } catch (error) {
    throw new ClientOperationError(mapError(error), 'link');
  }

  // --- 4. 完了にする -------------------------------------------------------
  try {
    await setDoc(
      doc(db, 'clients', clientId),
      { authUid: uid, provisionStatus: 'ready' satisfies ProvisionStatus, updatedAt: Date.now() },
      { merge: true },
    );
  } catch (error) {
    throw new ClientOperationError(mapError(error), 'finalize');
  }
}

// -----------------------------------------------------------------------------
// 更新
// -----------------------------------------------------------------------------

/** プロフィールと目標を更新する。契約者IDは変更できない（データのパスに使うため）。 */
export async function updateClient(
  clientId: string,
  patch: Partial<Omit<Client, 'clientId' | 'authUid' | 'provisionStatus' | 'createdAt'>>,
): Promise<void> {
  await setDoc(
    doc(getDb(), 'clients', clientId),
    { ...stripUndefined(patch), updatedAt: Date.now() },
    { merge: true },
  );
}

/**
 * 会員ランクを変える（追加仕様: 会員ランク）。
 *
 * ★ 管理者だけが呼びます。Rules 側でも、契約者は rank を書けません
 *   （clients の update で契約者に許した項目に入っていないため）。
 *
 * ★ 上げるときも下げるときも、同じ入口を通します。
 *   自動での降格はありませんが、トレーナーの判断で下げることはできます。
 */
export async function setClientRank(clientId: string, rank: Rank): Promise<void> {
  const now = Date.now();
  await setDoc(
    doc(getDb(), 'clients', clientId),
    { rank, rankUpdatedAt: now, updatedAt: now },
    { merge: true },
  );
}

/**
 * 次に使う会員整理番号（追加仕様: 会員ランク）。
 *
 * ★ 「いまある番号のいちばん大きいもの + 1」です。
 *   サーバーが無いので厳密な連番は保証できませんが、
 *   契約者を作るのは管理者1人なので、実用上ぶつかりません。
 *
 * ★ 自動では振りません。
 *
 *   動作確認用のアカウントや、トレーナー自身のアカウントには
 *   番号を振りたくない／別の番号にしたい、ということがあります。
 *   画面を開いただけで勝手に番号が付くと、あとから直す手間になります。
 *   番号を入れるのは、人が決めたときだけにします。
 */
export async function nextMemberNo(): Promise<number> {
  const all = await listClients();
  return all.reduce((n, c) => (c.memberNo !== null && c.memberNo > n ? c.memberNo : n), 0) + 1;
}

/**
 * 契約者の有効／無効を切り替える（設計書 §6.6）。
 *
 * ★ アカウントは削除しません。データを残したまま、アクセスだけを止めます。
 *   users/{uid}.active を false にすると、Rules 側で自分のデータも読めなくなります。
 */
export async function setClientActive(client: Client, active: boolean): Promise<void> {
  const db = getDb();

  await setDoc(
    doc(db, 'clients', client.clientId),
    { active, updatedAt: Date.now() },
    { merge: true },
  );

  if (client.authUid !== null) {
    await setDoc(doc(db, 'users', client.authUid), { active }, { merge: true });
  }
}

/**
 * 作成に失敗して途中で止まった契約者の枠を消す。
 * ★ ready の契約者には使いません（データを失うため）。
 */
export async function deleteProvisioningClient(client: Client): Promise<void> {
  if (client.provisionStatus === 'ready') {
    throw new Error('作成が完了した契約者は、この操作では削除できません。');
  }
  const db = getDb();
  if (client.authUid !== null) {
    await deleteDoc(doc(db, 'users', client.authUid));
  }
  await deleteDoc(doc(db, 'clients', client.clientId));
}

// -----------------------------------------------------------------------------
// 変換
// -----------------------------------------------------------------------------

function toClient(id: string, data: Record<string, unknown>): Client {
  const base = emptyClient(id);
  const targets = (data.targets ?? {}) as Partial<Targets>;
  const permissions = (data.permissions ?? {}) as Partial<ClientPermissions>;

  return {
    ...base,
    displayName: str(data.displayName) ?? '',
    age: num(data.age),
    sex: (str(data.sex) as Sex | undefined) ?? 'unspecified',
    heightCm: num(data.heightCm),
    startDate: str(data.startDate),
    memo: str(data.memo) ?? '',
    active: data.active !== false,
    targets: {
      kcal: num(targets.kcal) ?? DEFAULT_TARGETS.kcal,
      p: num(targets.p) ?? DEFAULT_TARGETS.p,
      f: num(targets.f) ?? DEFAULT_TARGETS.f,
      c: num(targets.c) ?? DEFAULT_TARGETS.c,
      weightKg: num(targets.weightKg),
      bodyFatPct: num(targets.bodyFatPct),
      exercise: str(targets.exercise) ?? '',
    },
    reviewMode: (str(data.reviewMode) as ReviewMode | undefined) ?? 'standard',
    permissions: {
      pastEditWindowDays:
        num(permissions.pastEditWindowDays) ?? DEFAULT_PERMISSIONS.pastEditWindowDays,
      allowFoodCreate: permissions.allowFoodCreate !== false,
      allowRecipeCreate: permissions.allowRecipeCreate !== false,
    },
    authUid: str(data.authUid),
    provisionStatus: data.provisionStatus === 'ready' ? 'ready' : 'provisioning',
    passwordChangedAt: num(data.passwordChangedAt),
    aiConsent: toConsent(data.aiConsent),
    rank: toRank(data.rank),
    rankUpdatedAt: num(data.rankUpdatedAt),
    memberNo: num(data.memberNo),
    extra: (data.extra as Record<string, unknown> | undefined) ?? {},
    createdAt: num(data.createdAt),
    updatedAt: num(data.updatedAt),
  };
}

function toFirestore(client: Client): Record<string, unknown> {
  return {
    displayName: client.displayName,
    age: client.age,
    sex: client.sex,
    heightCm: client.heightCm,
    startDate: client.startDate,
    memo: client.memo,
    active: client.active,
    targets: client.targets,
    reviewMode: client.reviewMode,
    permissions: client.permissions,
    authUid: client.authUid,
    provisionStatus: client.provisionStatus,
    passwordChangedAt: client.passwordChangedAt,
    aiConsent: client.aiConsent,
    rank: client.rank,
    rankUpdatedAt: client.rankUpdatedAt,
    memberNo: client.memberNo,
    extra: client.extra,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

function toConsent(raw: unknown): AiConsent {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    granted: data.granted === true,
    updatedAt: num(data.updatedAt),
    version: typeof data.version === 'number' ? data.version : 0,
  };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function mapError(error: unknown): CreateClientError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  if (code === 'auth/email-already-in-use') return 'emailInUse';
  if (code === 'auth/weak-password') return 'weakPassword';
  if (code === 'permission-denied' || code === 'auth/operation-not-allowed') {
    return 'permissionDenied';
  }
  return 'unknown';
}

async function safeDeleteApp(app: FirebaseApp): Promise<void> {
  try {
    await deleteApp(app);
  } catch {
    // 後始末に失敗しても本処理には影響しない
  }
}

export function createClientErrorMessage(error: ClientOperationError): string {
  switch (error.kind) {
    case 'idTaken':
      return 'その契約者IDはすでに使われています。別のIDにしてください。';
    case 'emailInUse':
      return 'その契約者IDのログインアカウントはすでに存在します。過去に作成して削除しきれていない可能性があります。別のIDを使うか、Firebase コンソールで確認してください。';
    case 'weakPassword':
      return '初期パスワードが短すぎます。8文字以上にしてください。';
    case 'permissionDenied':
      return '権限がありません。管理者としてログインしているか確認してください。';
    case 'unknown':
      return `契約者の作成に失敗しました（${error.step}）。通信状態を確認して、もう一度お試しください。`;
  }
}
