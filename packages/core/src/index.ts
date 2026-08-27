/**
 * @pt/core — 純粋ロジックのみを置くパッケージ。
 *
 * 設計書 §3.1 / §14 / §37:
 *   AI は「何を・どれだけ食べたか」を推定するだけ。
 *   kcal / PFC の計算はすべてこのパッケージの決定論的な関数が行う。
 *
 * ここには Firebase も AI も React Native も import しない。
 * （eslint.config.mjs の no-restricted-imports で機械的に禁止している）
 */

export * from './nutrition/types';
export * from './nutrition/convert';
export * from './nutrition/sum';
export * from './nutrition/format';
export * from './units/types';
export * from './client/id';
export * from './client/targets';
export * from './date/day';
export * from './meal/meal';
export * from './chart/series';
export * from './food/matching';
export * from './food/label';
export * from './photo/retention';
export * from './review/safety';
