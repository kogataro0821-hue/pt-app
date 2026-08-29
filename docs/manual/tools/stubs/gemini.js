// 説明書の画面写真を撮るためだけの偽AI。製品には入りません。
// 本物と同じ形の結果を、通信せずにその場で返します。

export class AiError extends Error {
  constructor(kind, detail) {
    super(kind);
    this.kind = kind;
    this.detail = detail;
  }
}

export function aiErrorMessage(kind, detail) {
  const base = {
    not_configured: 'AIの設定がまだ済んでいません。トレーナーにご連絡ください。',
    unauthenticated: 'ログインし直してから、もう一度お試しください。',
    rate_limited:
      'AIの利用が混み合っています。しばらく待ってからお試しください。手で入力することもできます。',
    unavailable: 'AIに接続できませんでした。手で入力してください。',
    invalid_output:
      'AIの回答を読み取れませんでした。表現を変えてお試しいただくか、手で入力してください。',
    network: '通信に失敗しました。電波の状態を確認してください。',
  }[kind];
  return detail === undefined ? base : `${base}（${detail}）`;
}

function item(name, grams, evidence, opts = {}) {
  return {
    name,
    brand: null,
    productName: null,
    quantity: { value: grams, unit: 'g' },
    quantityStatus: opts.status ?? 'estimated',
    quantityRange: opts.range ?? null,
    cookingMethod: null,
    packageLabel: null,
    confidence: opts.confidence ?? 0.9,
    evidence,
    needsUserInput: false,
    question: null,
  };
}

export function parseMealText() {
  return Promise.resolve({
    mealLabelSuggestion: null,
    items: [
      item('白米', 180, '白米180g', { status: 'estimated' }),
      item('鶏むね肉', 150, '鶏むね肉150g', { status: 'estimated' }),
      item('ブロッコリー', 60, 'ブロッコリー少し', {
        status: 'estimated',
        range: { min: 40, max: 80 },
      }),
    ],
    unidentified: [],
    notes: [],
  });
}

export function analyzeMealPhoto() {
  return Promise.resolve({
    mealLabelSuggestion: null,
    items: [
      item('白米', 180, '手前の茶碗', { range: { min: 150, max: 210 } }),
      item('鮭', 80, '皿の中央の切り身', { range: { min: 70, max: 90 } }),
      item('ほうれん草のおひたし', 50, '右奥の小鉢', { range: { min: 40, max: 60 } }),
    ],
    unidentified: [{ description: '奥の小皿にある茶色いもの', confidence: 0.3 }],
    notes: [],
  });
}

export function readNutritionLabel() {
  return Promise.resolve({
    basis: 'perServing',
    servingGrams: 57,
    kcal: 263,
    p: 5.7,
    f: 10.3,
    c: 37.2,
    sugar: null,
    fiber: null,
    salt: 2.4,
    sodiumMg: null,
    productName: 'カップヌードル',
    evidence: '「1食（77g）当たり」の欄。めん・かやく（57g）当たりの数値を読みました。',
    notes: ['「1食当たり」と「めん・かやく当たり」の2つの欄がありました。'],
  });
}

export function requestDayReview() {
  return Promise.resolve(
    'タンパク質は目標130gに対して118gで、あと12gです。夕食に卵を1つ足すか、' +
      '朝の乳製品を増やすと届きます。脂質は58gで目標より8g多めですが、' +
      '揚げものが入った日としては収まっているほうです。' +
      '炭水化物は目標どおりでした。運動は25分の記録があります。' +
      '明日はタンパク質を先に決めてから、残りで主食の量を決めると組み立てやすくなります。',
  );
}
