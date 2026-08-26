/**
 * 配色トークン（設計書 §11.4）。
 *
 * 方針:
 *   ・清潔／現代的／余白広め。彩度を抑えたベースに、PFCだけをアクセントに使う
 *   ・P / F / C は必ず同じ色。リング・積み上げバー・凡例・内訳表で色を揃える
 *   ・過剰を赤で煽らない。目標との差は数値とバーで表現する
 *   ・ダークモード対応。色を直接書かず必ずこのトークンを経由すること
 */

export interface ThemeTokens {
  ground: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  rule: string;
  accent: string;
  accentSoft: string;
  /** たんぱく質 */
  p: string;
  /** 脂質 */
  f: string;
  /** 炭水化物 */
  c: string;
  /** 「要確認」「推定値」の注意色。エラーではないので赤にしない */
  attention: string;
  attentionSoft: string;
  danger: string;
}

export const lightTheme: ThemeTokens = {
  ground: '#F3F5F2',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF0EC',
  ink: '#14201E',
  inkMuted: '#3D4A47',
  inkFaint: '#6D7873',
  rule: '#DBE0DA',
  accent: '#0F5C55',
  accentSoft: '#DCEAE7',
  p: '#2E6F9E',
  f: '#B0722A',
  c: '#48864D',
  attention: '#A2601D',
  attentionSoft: '#F6EDE0',
  danger: '#A2401D',
};

export const darkTheme: ThemeTokens = {
  ground: '#0E1312',
  surface: '#161C1B',
  surfaceAlt: '#1D2423',
  ink: '#E7EBE7',
  inkMuted: '#B7C0BC',
  inkFaint: '#8B9793',
  rule: '#2A3231',
  accent: '#5CC3B6',
  accentSoft: '#152A28',
  p: '#77B4DC',
  f: '#DBA860',
  c: '#82C088',
  attention: '#D9A46B',
  attentionSoft: '#2A2118',
  danger: '#E0906E',
};

/** 余白・角丸・文字サイズも同じ考え方で1箇所に集約する。 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const fontSize = {
  caption: 12,
  small: 13,
  body: 15,
  bodyLg: 17,
  title: 20,
  display: 28,
} as const;
