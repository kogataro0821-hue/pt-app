import type { DecimalNutrients } from '../nutrition/types';

/**
 * 栄養成分表示の読み取り結果を、100gあたりへ直す（設計書 §47 / 追加仕様: 成分表示の読み取り）。
 *
 * ★ 換算はAIにやらせません。
 *
 *   AIの仕事は「表示に何と書いてあるか」を読むところまでです。
 *   割り算はここでやります。設計書 §47 の
 *   「AI(推定) → 人間の確認 → 決定論的計算」をそのまま守ります。
 *
 *   AIに「100gあたりに直して」と頼むと、途中の計算が見えなくなります。
 *   263kcal が 461kcal になった理由が説明できないと、
 *   間違っていたときに気づけません。
 *
 * ★ わからないものは、推測しません。
 *
 *   「1本当たり」としか書いていない表示から100gあたりは出せません。
 *   原理的に情報が足りないので、止めて人に聞きます。
 *   ここを賢くしようとすると、根拠のない数字が全員のマスタに入り、
 *   あとから気づけなくなります。
 */

/** 表示の基準量 */
export type LabelBasis =
  /** 100g当たり */
  | 'per100g'
  /** 100ml当たり */
  | 'per100ml'
  /** 1食(57g)当たり など、1回分あたり */
  | 'perServing';

/** AIが読み取った、表示そのままの値 */
export interface LabelReading {
  basis: LabelBasis;
  /** perServing のときの1回分のグラム数。書いていなければ null */
  servingGrams: number | null;
  kcal: number;
  p: number;
  f: number;
  /** 炭水化物。表示が「糖質／食物繊維」に分かれている場合は null */
  c: number | null;
  /** 糖質。表示に無ければ null */
  sugar: number | null;
  /** 食物繊維。表示に無ければ null */
  fiber: number | null;
  /** 食塩相当量(g)。表示に無ければ null */
  salt: number | null;
  /** ナトリウム(mg)。食塩相当量が無く、ナトリウムだけの表示のときに使う */
  sodiumMg: number | null;
}

export type LabelConversion =
  | { ok: true; per100g: DecimalNutrients; notes: string[] }
  | { ok: false; reason: LabelProblem; message: string };

export type LabelProblem =
  /** 1回分のグラム数が書かれていないので換算できない */
  | 'need-serving-grams'
  /** 炭水化物も糖質も読めなかった */
  | 'need-carbs'
  /** 値が数値として成立していない */
  | 'invalid';

/**
 * ナトリウム(mg) から食塩相当量(g) への換算係数。
 * 食塩相当量 = ナトリウム × 2.54 ÷ 1000（食品表示法の計算式）
 */
const SODIUM_TO_SALT = 2.54;

export function labelToPer100g(reading: LabelReading): LabelConversion {
  const notes: string[] = [];

  // ---- 1. 100gあたりにするための倍率 ----------------------------------------

  let factor: number;

  if (reading.basis === 'per100g') {
    factor = 1;
  } else if (reading.basis === 'per100ml') {
    factor = 1;
    // ★ mlとgは同じではありません（牛乳は約1.03倍、油は約0.92倍）。
    //   ここで密度を推測すると、根拠のない数字になります。
    //   同じものとして扱ったことを明示し、判断は人に委ねます。
    notes.push('100mlを100gとして扱いました。飲み物の場合、実際の重さは少しずれます。');
  } else {
    const grams = reading.servingGrams;
    if (grams === null || !Number.isFinite(grams) || grams <= 0) {
      return {
        ok: false,
        reason: 'need-serving-grams',
        message:
          '「1食当たり」などと書かれていますが、1回分が何グラムかが読み取れませんでした。グラム数を入力してください。',
      };
    }
    factor = 100 / grams;
  }

  // ---- 2. 炭水化物 -----------------------------------------------------------

  // ★ 表示が「糖質＋食物繊維」に分かれていることがあります。
  //   炭水化物 = 糖質 + 食物繊維 なので、足せば済みます。
  let carbs = reading.c;
  if (carbs === null) {
    if (reading.sugar === null) {
      return {
        ok: false,
        reason: 'need-carbs',
        message: '炭水化物（または糖質）が読み取れませんでした。数値を手で入力してください。',
      };
    }
    carbs = reading.sugar + (reading.fiber ?? 0);
    notes.push(
      reading.fiber === null
        ? '炭水化物の表示が無かったため、糖質の値を使いました。'
        : '炭水化物の表示が無かったため、糖質と食物繊維を足しました。',
    );
  }

  // ---- 3. 食塩相当量 ---------------------------------------------------------

  let salt = reading.salt;
  if (salt === null && reading.sodiumMg !== null) {
    salt = (reading.sodiumMg * SODIUM_TO_SALT) / 1000;
    notes.push('ナトリウムの表示から食塩相当量を計算しました。');
  }

  // ---- 4. 換算 ---------------------------------------------------------------

  const values = [reading.kcal, reading.p, reading.f, carbs];
  if (values.some((v) => !Number.isFinite(v) || v < 0)) {
    return {
      ok: false,
      reason: 'invalid',
      message: '読み取った数値が正しくありません。手で入力してください。',
    };
  }

  const per100g: DecimalNutrients = {
    kcal: round1(reading.kcal * factor),
    p: round1(reading.p * factor),
    f: round1(reading.f * factor),
    c: round1(carbs * factor),
    fiber: reading.fiber === null ? 0 : round1(reading.fiber * factor),
    salt: salt === null ? 0 : round1(salt * factor),
  };

  if (reading.basis === 'perServing') {
    notes.push(
      `1回分${reading.servingGrams}gの表示から、100gあたりに直しました（${round1(factor * 100) / 100}倍）。`,
    );
  }

  return { ok: true, per100g, notes };
}

/**
 * 小数第1位まで。
 *
 * ★ マスタの値は人が読み書きする単位で持っています（設計書 §13）。
 *   小数第1位までにしておくと、表示と保存値が一致します。
 *   合計の計算は内部表現（1/1000単位の整数）で行うので、
 *   ここで丸めても「食材合計 == 食事合計」は崩れません。
 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 基準量の日本語表記。画面に「何として読んだか」を出すために使う。 */
export function labelBasisLabel(reading: Pick<LabelReading, 'basis' | 'servingGrams'>): string {
  switch (reading.basis) {
    case 'per100g':
      return '100g当たり';
    case 'per100ml':
      return '100ml当たり';
    case 'perServing':
      return reading.servingGrams === null
        ? '1回分当たり（グラム数不明）'
        : `1回分(${reading.servingGrams}g)当たり`;
  }
}
