/**
 * かけらの交換（追加仕様: かけらの交換QR）。
 *
 * ★ QRに入れるのは「URL」です。
 *
 *   独自のカメラ機能は作っていません。iPhone・Android の標準カメラは
 *   QRの中のURLをそのまま読んで「開く」を出してくれます。
 *   カメラの許可も、読み取りの部品も要りません。
 *
 * ★ QRは「値札」です。1回きりの切符ではありません。
 *
 *   中身は「いくつ」と「なんの交換か」だけで、誰あてかは入りません。
 *   読んだ人が自分のぶんを払います。だから貼っておけます。
 *   （プロテインの棚に「3かけら」の紙を貼る、という使い方ができます）
 *
 * ★ 払ったことを信じるのは、契約者の画面ではありません。
 *
 *   契約者の端末が出す「済みました」の画面は、いくらでも作れます。
 *   本当に引かれたかどうかは、**トレーナー側の画面**が
 *   Firestore を見て判断します（QR画面が緑に変わります）。
 */

/** QRに入れる中身。 */
export interface RedeemRequest {
  /** 引くかけらの数 */
  amount: number;
  /** なんの交換か。契約者の画面とお知らせに出ます */
  text: string;
}

/** 一度の交換で引ける上限。 */
export const MAX_REDEEM = 1000;

/** 交換の説明文の長さの上限。 */
export const MAX_REDEEM_TEXT = 40;

/** 交換として成立する中身か。 */
export function isValidRedeem(req: RedeemRequest): boolean {
  if (!Number.isFinite(req.amount) || !Number.isInteger(req.amount)) return false;
  if (req.amount < 1 || req.amount > MAX_REDEEM) return false;
  if (req.text.trim().length === 0) return false;
  if (req.text.length > MAX_REDEEM_TEXT) return false;
  return true;
}

/**
 * QRに入れるURLを作る。
 *
 * @param origin  'https://example.github.io' のような、サイトの先頭
 * @param base    '/pt-app/' のような、アプリの置き場所
 */
export function redeemUrl(origin: string, base: string, req: RedeemRequest): string {
  const path = `${origin.replace(/\/$/, '')}${base.endsWith('/') ? base : `${base}/`}redeem`;
  const q = new URLSearchParams({ a: String(req.amount), t: req.text });
  return `${path}?${q.toString()}`;
}

/**
 * URLの ?a= と ?t= から、交換の中身を読む。
 *
 * ★ 読めない・おかしい値のときは null を返します。
 *
 *   ここに入ってくるのは、**人が撮ったQRの中身**です。
 *   打ち間違いの紙も、他所のQRも、いたずらも入ってき得ます。
 *   おかしければ交換画面を出さないのが、いちばん安全です。
 */
export function parseRedeem(params: URLSearchParams): RedeemRequest | null {
  const rawAmount = params.get('a');
  const rawText = params.get('t');
  if (rawAmount === null || rawText === null) return null;

  const amount = Number(rawAmount);
  const req: RedeemRequest = { amount, text: rawText.trim() };
  return isValidRedeem(req) ? req : null;
}

/** 交換できるだけの残高があるか。 */
export function canAfford(points: number, amount: number): boolean {
  return points >= amount;
}

/**
 * 交換したあとの残高。
 *
 * ★ 足りないときは引きません（0で止めたりもしません）。
 *   「足りないのに交換できた」ように見えるのが、いちばんまずいためです。
 *   足りるかどうかは canAfford で先に確かめてください。
 */
export function afterRedeem(points: number, amount: number): number | null {
  if (!canAfford(points, amount)) return null;
  return points - amount;
}

/**
 * 読み取ったQRの文字列から、交換の中身を取り出す（追加仕様: かけらの交換QR）。
 *
 * ★ QRには何でも入っています。
 *
 *   商品のバーコード、他所のサイト、Wi-Fiの設定、ただの文章。
 *   カメラを向ければ、そういうものも読めてしまいます。
 *   **このアプリの交換URLでなければ、何も返しません。**
 *
 * ★ 自分のサイトのものだけを通します。
 *
 *   よそのサイトが `?a=999&t=…` の付いたURLを配っても、
 *   置き場所（origin と base）が違えば通りません。
 *   ここを緩めると、他人の作ったQRで交換画面が出せてしまいます。
 *
 * @param scanned 読み取った文字列そのもの
 * @param origin  自分のサイトの先頭（window.location.origin）
 * @param base    アプリの置き場所（import.meta.env.BASE_URL）
 */
export function readScannedRedeem(
  scanned: string,
  origin: string,
  base: string,
): RedeemRequest | null {
  let url: URL;
  try {
    url = new URL(scanned);
  } catch {
    // URLですらない（ただの文字列、商品バーコードなど）
    return null;
  }

  const mine = new URL(redeemUrl(origin, base, { amount: 1, text: 'x' }));
  if (url.origin !== mine.origin) return null;
  if (url.pathname !== mine.pathname) return null;

  return parseRedeem(url.searchParams);
}
