import { DEFAULT_TARGETS, type Targets } from '@pt/core';

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
