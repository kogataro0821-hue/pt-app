import type {
  DailyReview,
  EditOperation,
  MealRecognition,
  PhotoInput,
  ReviewInput,
  TextInput,
  EditInput,
} from './schemas';

/**
 * AIプロバイダーの抽象インターフェース（設計書 §30 / §9.1）。
 *
 * ★ アプリ本体は「どのAI事業者を使っているか」を一切知らない。
 *   実装（Gemini / OpenAI / Claude）は worker/src/ai/providers/ に置き、
 *   環境変数1つで差し替えられるようにする。
 *
 * ★ 責任分離（設計書 §37）
 *   AI がやること: 画像認識・食品認識・重量推定・自然言語解析・評価文の作成
 *   AI がやらないこと: kcal / PFC の計算、合計の算出
 *
 *   そのため MealRecognition には kcal / P / F / C が含まれない。
 *   唯一の例外は packageLabel（商品パッケージの栄養成分表示を読み取った値）で、
 *   これは §13 の優先度2の情報として扱う。
 */
export interface AIProvider {
  /** 'gemini' | 'openai' | 'claude' など */
  readonly id: string;

  /** 写真から食品候補を認識する（設計書 §10）。 */
  analyzeMealPhoto(input: PhotoInput): Promise<MealRecognition>;

  /** 「白米180gと鶏ささみ150g」のようなテキストから食品候補を作る。 */
  parseMealText(input: TextInput): Promise<MealRecognition>;

  /**
   * 「白米180gを150gに変更」のような指示を、操作のリストに翻訳する（設計書 §18）。
   * 数値の計算はしない。何をどうするか、だけを返す。
   */
  interpretEditCommand(input: EditInput): Promise<EditOperation[]>;

  /** 1日の数値と目標から評価文を作る（設計書 §26）。医療的な診断はしない。 */
  generateDailyReview(input: ReviewInput): Promise<DailyReview>;
}

/** プロバイダーの識別子。増えたらここに足す。 */
export const AI_PROVIDER_IDS = ['gemini', 'openai', 'claude'] as const;
export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

/** AI呼び出しが失敗したときのエラー。呼び出し側は必ず手動入力へフォールバックする（§9.8）。 */
export class AIProviderError extends Error {
  readonly kind: 'timeout' | 'invalid_output' | 'rate_limited' | 'unavailable';

  constructor(
    message: string,
    kind: 'timeout' | 'invalid_output' | 'rate_limited' | 'unavailable',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AIProviderError';
    this.kind = kind;
  }
}
