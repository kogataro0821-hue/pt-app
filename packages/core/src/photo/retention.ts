/**
 * 写真の保存期間（設計書 §8.2 / 追加仕様: 写真の保存期間）。
 *
 * ★ なぜ期限を設けるのか
 *
 *   写真は Firestore に base64 で入っています（Cloud Storage が使えないため）。
 *   無料枠は 1GB です。1枚あたり 300〜400KB として、
 *   2,500〜3,000枚でいっぱいになります。
 *   1人が1日3枚撮れば、3人で1年もちません。
 *
 *   つまり「そのうち消す」ではなく、「いつ消えるか決まっている」必要があります。
 *
 * ★ 消えるのは写真だけです。
 *   食材・量・kcal・PFC はすべて数値として残ります。
 *   写真は「その数値が正しいか確かめるための材料」なので、
 *   確認が済んだあとまで置いておく理由がありません。
 *
 * ★ 自動で消す仕組みは使えません。
 *   Cloud Functions にはカード登録が要るので、この構成では使えません。
 *   代わりに「誰かが画面を開いたときに、期限切れを消す」形にしています。
 *   そのぶん、消える前に本人へ知らせる仕組みが要ります（下の WARN）。
 */

/** 保存する日数。7週間。 */
export const PHOTO_RETENTION_DAYS = 49;

/** 「もうすぐ消えます」と知らせ始める残り日数。 */
export const PHOTO_WARN_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** その写真が消える時刻。 */
export function photoExpiresAt(createdAt: number): number {
  return createdAt + PHOTO_RETENTION_DAYS * DAY_MS;
}

/**
 * 残り日数。切り上げます。
 *
 * ★ 切り上げるのは、「残り0日」と出したあとに
 *   まだ半日残っている、という状態を作らないためです。
 *   残っているなら1日と数え、0は「もう消える」を意味させます。
 */
export function photoDaysLeft(createdAt: number, now: number): number {
  const left = photoExpiresAt(createdAt) - now;
  return left <= 0 ? 0 : Math.ceil(left / DAY_MS);
}

export function isPhotoExpired(createdAt: number, now: number): boolean {
  return now >= photoExpiresAt(createdAt);
}

/** 残りが少ない（＝知らせるべき）か。期限切れも含みます。 */
export function isPhotoExpiringSoon(createdAt: number, now: number): boolean {
  return photoDaysLeft(createdAt, now) <= PHOTO_WARN_DAYS;
}

/**
 * 「もうすぐ消える写真」を探すための境界値。
 *
 * この値より前に撮られた写真は、残りが PHOTO_WARN_DAYS 日以下です。
 * Firestore へ `where('photoOldestAt', '<=', ここの値)` として渡します。
 *
 * ★ 全部読んでから絞り込むのではなく、絞り込んでから読みます。
 *   1年ぶんの日を毎回読んでいたら、それだけで無料枠を使い切ります。
 */
export function photoWarnThreshold(now: number): number {
  return now - (PHOTO_RETENTION_DAYS - PHOTO_WARN_DAYS) * DAY_MS;
}

/** 期限切れを探すための境界値。これより前のものは消してよい。 */
export function photoExpiryThreshold(now: number): number {
  return now - PHOTO_RETENTION_DAYS * DAY_MS;
}

/** 「あと2日で消えます」「まもなく消えます」。 */
export function photoExpiryLabel(createdAt: number, now: number): string {
  const left = photoDaysLeft(createdAt, now);
  return left === 0 ? 'まもなく消えます' : `あと${left}日で消えます`;
}
