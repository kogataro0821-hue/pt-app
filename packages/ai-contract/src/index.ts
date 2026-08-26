/**
 * @pt/ai-contract — AI との「契約」だけを置くパッケージ。
 *
 * 設計書 §30:
 *   AIプロバイダーは固定しない。アプリ本体と AI を密結合させない。
 *
 * ここにあるのはインターフェースとスキーマだけで、実装は含まない。
 * 実装（Gemini / OpenAI / Claude）は worker/ 側に置く。
 */

export * from './schemas';
export * from './provider';
export * from './guard';
export * from './wire';
