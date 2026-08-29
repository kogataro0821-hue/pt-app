/**
 * AI評価の安全検査（設計書 §13 リスク12 / Phase 10）。
 *
 * ★ 指示文だけに頼りません。
 *
 *   システムプロンプトに「診断をしないでください」と書くのは第1層です。
 *   ですが、それは守られることを期待しているだけで、確かめてはいません。
 *   モデルが変われば挙動も変わりますし、言い回し次第ですり抜けます。
 *
 *   ここは第2層です。**生成された文章を機械的に検査**し、
 *   引っかかったら画面に出しません。
 *   期待ではなく、判定にします。
 *
 * ★ このアプリは医療行為をしません。
 *
 *   トレーナーは医師ではありません。
 *   病名・診断・薬・検査値の解釈に踏み込んだ文章が契約者に届くと、
 *   受け取った側はそれを医療的な助言として読みます。
 *   食事と運動の話にとどめます。
 *
 * ★ 迷ったら出さない、を選んでいます。
 *
 *   AI評価は無くても記録は成り立ちます。
 *   一方、まずい文章が1回届くほうの害はずっと大きい。
 *   釣り合っていないので、疑わしいものは止めます。
 */

/**
 * 病名・診断に関わる語。
 *
 * ★ 一般的な体調の話（疲れ、むくみ）は入れていません。
 *   そこまで止めると、食事指導として当たり前の会話までできなくなります。
 *   止めたいのは「診断」と「治療」に踏み込む文章です。
 */
const MEDICAL_TERMS = [
  // 病名・状態
  '糖尿病',
  '高血圧',
  '脂質異常症',
  '高脂血症',
  '動脈硬化',
  '心筋梗塞',
  '脳梗塞',
  '肝炎',
  '腎不全',
  '腎臓病',
  '痛風',
  '甲状腺',
  'メタボリックシンドローム',
  'がん',
  '癌',
  '摂食障害',
  '拒食',
  '過食症',
  'うつ病',
  '認知症',
  '骨粗しょう症',
  '骨粗鬆症',
  '貧血症',
  // 診断・治療の行為
  '診断',
  '受診',
  '通院',
  '処方',
  '薬を',
  '服用',
  'サプリメントを飲',
  '治療',
  '症状',
  '疾患',
  '病気',
  '医師の',
  '検査値',
  '血糖値',
  'コレステロール値',
  '中性脂肪値',
] as const;

/**
 * 極端な行動を促す語。
 *
 * ★ 「厳しめ」の評価モードがあるぶん、ここは要ります。
 *   厳しく言うことと、危ないことを勧めることは違います。
 */
const HARMFUL_TERMS = [
  '断食',
  '絶食',
  '食べるな',
  '抜きなさい',
  '水だけ',
  '吐い',
  '嘔吐',
  '下剤',
  '利尿剤',
  '痩せ薬',
  '極端に減ら',
  '一切食べ',
] as const;

export type ReviewRejection =
  /** 医療的な内容に踏み込んでいる */
  | 'medical'
  /** 極端・危険な行動を促している */
  | 'harmful'
  /** 中身が無い（空、または短すぎる） */
  | 'empty'
  /** 長すぎる */
  | 'too-long';

export interface ReviewCheck {
  ok: boolean;
  reason: ReviewRejection | null;
  /** 引っかかった語。管理者向けの記録に使う */
  matched: string[];
}

/** 評価文の上限。これ以上は読まれませんし、モデルの暴走の兆候でもあります。 */
export const REVIEW_MAX_LENGTH = 1200;

/** 短すぎるものは、生成に失敗しているとみなします。 */
export const REVIEW_MIN_LENGTH = 10;

/**
 * 評価文を出してよいか判定する。
 *
 * ★ 文字列をそのまま探します。表記ゆれまでは追いません。
 *   完全を目指すと、こんどは普通の文章まで止まります。
 *   ここは「明らかに踏み込んでいるもの」を止める網です。
 *   最後の砦はトレーナーが読むことです。
 */
export function checkReviewText(text: string): ReviewCheck {
  const trimmed = text.trim();

  if (trimmed.length < REVIEW_MIN_LENGTH) {
    return { ok: false, reason: 'empty', matched: [] };
  }
  if (trimmed.length > REVIEW_MAX_LENGTH) {
    return { ok: false, reason: 'too-long', matched: [] };
  }

  const harmful = HARMFUL_TERMS.filter((t) => trimmed.includes(t));
  if (harmful.length > 0) {
    return { ok: false, reason: 'harmful', matched: [...harmful] };
  }

  const medical = MEDICAL_TERMS.filter((t) => trimmed.includes(t));
  if (medical.length > 0) {
    return { ok: false, reason: 'medical', matched: [...medical] };
  }

  return { ok: true, reason: null, matched: [] };
}

/** 止めた理由を、画面に出す言葉にする。 */
export function reviewRejectionMessage(reason: ReviewRejection): string {
  switch (reason) {
    case 'medical':
      return 'AIの文章に医療に関わる内容が含まれていたため、表示していません。このアプリは食事と運動の記録を扱うもので、診断や治療の助言はしません。もう一度お試しください。';
    case 'harmful':
      return 'AIの文章に、体に負担のかかるやり方をすすめる内容が含まれていたため、表示していません。もう一度お試しください。';
    case 'empty':
      return 'AIの回答が空でした。もう一度お試しください。';
    case 'too-long':
      return 'AIの回答が長すぎたため、表示していません。もう一度お試しください。';
  }
}
