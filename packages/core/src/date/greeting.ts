/**
 * 時間帯のあいさつ（追加仕様: 導入の演出）。
 *
 * ★ 境目は、寝起きの感覚に合わせています。
 *
 *   朝4時〜10時台 … おはようございます
 *   11時〜17時台  … こんにちは
 *   18時〜朝3時台 … こんばんは
 *
 *   深夜2時は「こんばんは」です。かけらの1日は朝4時区切りですが、
 *   あいさつは時計どおりにします。午前2時に「おはよう」と言われると、
 *   気味が悪いだけです。
 *
 * ★ 「こんばんは」の幅がいちばん広いのは、わざとです。
 *   このアプリを開く人は、夜に1日ぶんを書きに来ることが多いためです。
 */

/** JST の時刻で判定します（端末の時間帯設定に左右されません）。 */
export function greetingFor(nowMs: number = Date.now()): string {
  const jstHour = new Date(nowMs + 9 * 3600_000).getUTCHours();

  if (jstHour >= 4 && jstHour < 11) return 'おはようございます';
  if (jstHour >= 11 && jstHour < 18) return 'こんにちは';
  return 'こんばんは';
}

/**
 * 「こんばんは、田中さん」のように、名前を添えて。
 *
 * ★ 名前が空のときは、あいさつだけにします。
 *   「こんばんは、さん」になるほうが、よほど失礼です。
 */
export function greetingWithName(name: string, nowMs: number = Date.now()): string {
  const trimmed = name.trim();
  const hello = greetingFor(nowMs);
  return trimmed.length === 0 ? hello : `${hello}、${trimmed}さん`;
}
