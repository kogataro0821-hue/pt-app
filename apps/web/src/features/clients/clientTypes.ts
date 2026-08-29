import { DEFAULT_TARGETS, INITIAL_RANK, type Rank, type RankGoals, type Targets } from '@pt/core';

/**
 * 契約者のデータ（設計書 §4 / §5.3）。
 *
 * 「後から項目を追加できる柔軟な構造にする」（§4）という要求のため、
 * 決まった項目のほかに `extra` という自由な入れ物を持たせています。
 */

export type ReviewMode = 'gentle' | 'standard' | 'strict' | 'very_strict';

export const REVIEW_MODES: { value: ReviewMode; label: string; description: string }[] = [
  { value: 'gentle', label: 'やさしめ', description: 'できている点を中心に、前向きに伝える' },
  { value: 'standard', label: '標準', description: '良い点と改善点をバランスよく' },
  { value: 'strict', label: '辛口', description: '改善点をはっきり指摘する' },
  { value: 'very_strict', label: '非常に辛口', description: '妥協なく厳しく指摘する' },
];

export type Sex = 'female' | 'male' | 'unspecified';

export interface ClientPermissions {
  /** 契約者が自分で過去を修正できる日数。0 なら今日だけ（設計書 §7.3） */
  pastEditWindowDays: number;
  /** 契約者が自分で食品を登録できるか（設計書 §21） */
  allowFoodCreate: boolean;
  /** 契約者が自分でレシピを登録できるか */
  allowRecipeCreate: boolean;
}

export const DEFAULT_PERMISSIONS: ClientPermissions = {
  pastEditWindowDays: 7,
  allowFoodCreate: true,
  allowRecipeCreate: true,
};

/**
 * 作成状態。
 *
 * サーバーが無いためトランザクションを張れません（設計書 §6.5）。
 * 途中で失敗した契約者を見分けられるように、状態を持たせています。
 */
export type ProvisionStatus = 'provisioning' | 'ready';

/**
 * AI利用への同意（設計書 §35 / Phase 8）。
 *
 * ★ 同意していない契約者には、AIのボタン自体を出しません。
 *   無料枠のAIに送ったデータは、提供事業者のモデル改善に使われる可能性があります。
 *   その事実を伝えたうえで、本人が選べる形にしています。
 *
 * ★ 同意は契約者本人が与え、本人がいつでも取り消せます。
 *   管理者が代わりに同意することはできません（clients の書き込み許可を
 *   aiConsent に限って本人に開けてあるのはこのためです）。
 */
export interface AiConsent {
  /** 同意しているか */
  granted: boolean;
  /** 同意（または取り消し）した時刻 */
  updatedAt: number | null;
  /** 同意時に提示した説明文の版。文面を変えたら上げる */
  version: number;
}

/** いま提示している同意文の版。文面を実質的に変えたら +1 する。 */
export const AI_CONSENT_VERSION = 1;

export const NO_CONSENT: AiConsent = { granted: false, updatedAt: null, version: 0 };

/** 同意が有効か。文面の版が上がったら、取り直しになる。 */
export function hasValidAiConsent(consent: AiConsent): boolean {
  return consent.granted && consent.version >= AI_CONSENT_VERSION;
}

export interface Client {
  clientId: string;
  displayName: string;
  age: number | null;
  sex: Sex;
  heightCm: number | null;
  startDate: string | null;
  memo: string;
  active: boolean;
  targets: Targets;
  reviewMode: ReviewMode;
  permissions: ClientPermissions;
  /** Firebase Authentication のユーザーID。作成が完了するまでは null */
  authUid: string | null;
  provisionStatus: ProvisionStatus;
  /** 初回パスワード変更が済んだ時刻。未変更なら null（設計書 §6.5） */
  passwordChangedAt: number | null;
  /** AI利用への同意（設計書 §35） */
  aiConsent: AiConsent;

  /**
   * 会員ランク（追加仕様: 会員ランク）。
   *
   * ★ 契約者は書き換えられません（Rules の update で許した項目に入っていない）。
   *   上げるのはトレーナーだけです。自動では下がりません。
   */
  rank: Rank;
  /** ランクが最後に変わった時刻 */
  rankUpdatedAt: number | null;
  /**
   * 作るときに初期ランクを指定して作られた契約者か（追加仕様: 会員ランク）。
   *
   * ★ この枠は、システム全体で**1人だけ**です。
   *
   *   初期ランクを自由に付けられると、ランクの意味が無くなります。
   *   「条件を満たした人だけが上がる」という前提が、
   *   作るときに好きな段から始められるなら成り立ちません。
   *
   *   トレーナー自身のアカウントのように、
   *   本当に例外的な1つのためだけに開けてあります。
   */
  rankSeeded: boolean;
  /**
   * DIAMOND から先の昇格条件（追加仕様: 会員ランク）。
   *
   * ★ RUBY・SAPPHIRE・EMERALD の条件は決まっていますが、
   *   その先はトレーナーが一人ひとりに決めます。
   *   決めていないランクは入っていません（＝そこから先へは上がりません）。
   */
  rankGoals: RankGoals;
  /**
   * 会員整理番号（0001 から）。
   *
   * ★ 契約者IDとは別に持ちます。
   *   契約者IDはログインに使う文字列で、会員証に出すには生々しすぎます。
   *   採番は「いまある番号のいちばん大きいもの + 1」です。
   *   サーバーが無いので厳密な連番は保証できませんが、
   *   契約者を作るのは管理者1人なので、実用上ぶつかりません。
   */
  memberNo: number | null;
  /** 後から項目を足すための入れ物（設計書 §4） */
  extra: Record<string, unknown>;
  createdAt: number | null;
  updatedAt: number | null;
}

export function emptyClient(clientId: string): Client {
  return {
    clientId,
    displayName: '',
    age: null,
    sex: 'unspecified',
    heightCm: null,
    startDate: todayInJst(),
    memo: '',
    active: true,
    targets: { ...DEFAULT_TARGETS },
    reviewMode: 'standard',
    permissions: { ...DEFAULT_PERMISSIONS },
    authUid: null,
    provisionStatus: 'provisioning',
    passwordChangedAt: null,
    aiConsent: { ...NO_CONSENT },
    rank: INITIAL_RANK,
    rankUpdatedAt: null,
    rankSeeded: false,
    rankGoals: {},
    memberNo: null,
    extra: {},
    createdAt: null,
    updatedAt: null,
  };
}

/** 日付を JST の 'yyyy-MM-dd' で返す。日付はこの形式で統一します（設計書 §7.3）。 */
export function todayInJst(): string {
  const jst = new Date(Date.now() + 9 * 3600_000);
  return jst.toISOString().slice(0, 10);
}

export function sexLabel(sex: Sex): string {
  switch (sex) {
    case 'female':
      return '女性';
    case 'male':
      return '男性';
    case 'unspecified':
      return '未設定';
  }
}

export function reviewModeLabel(mode: ReviewMode): string {
  return REVIEW_MODES.find((m) => m.value === mode)?.label ?? '標準';
}
