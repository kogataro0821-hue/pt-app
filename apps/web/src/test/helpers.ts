/**
 * テストを読みやすくするための小道具。
 *
 * ★ mock.calls[0] は「呼ばれていないかもしれない」型なので、
 *   そのまま分解すると型が通りません。毎回 if で書くと、
 *   テストの主題より前置きのほうが長くなります。
 *   呼ばれていなければその場で分かるエラーにして、1行で済ませます。
 */
export function firstCall<Args extends unknown[]>(fn: {
  mock: { calls: Args[] };
}): Args {
  const call = fn.mock.calls[0];
  if (call === undefined) {
    throw new Error('呼ばれていません（1回目の呼び出しがありません）');
  }
  return call;
}
