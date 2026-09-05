/**
 * いま動いているアプリの「版」（追加仕様: 版の表示）。
 *
 * ★ なぜ要るのか。
 *
 *   このアプリはパソコンでの確認手段を持たず、GitHub Pages に置いた
 *   ものを端末で開いて使います。そのため、直したものが端末に届いたか
 *   どうかを確かめる方法が、これまでありませんでした。
 *
 *   「直したはずなのに直っていない」のか、
 *   「まだ古いアプリが動いている」のか。**この2つが区別できません。**
 *   区別できないと、動いているコードを何度も疑うことになります。
 *   実際に、食品マスタの更新が届かない件で半日かかりました。
 *
 * ★ 番号（ver 1.0.0）だけでは足りません。
 *
 *   番号は人が決めるので、上げ忘れれば嘘になります。しかも
 *   「この端末のアプリは新しいのか」に答えられません。
 *   自動で必ず変わる**組み立てた時刻**と**コミット**を一緒に持ちます。
 *
 *   コミットは、GitHub の Actions に並んでいる文字列と同じものです。
 *   緑になったあの行と、画面の隅の文字を見比べるだけで済みます。
 */

// ビルドのときに vite.config.ts が埋め込みます。
// テストのときは埋め込まれないので、undefined になり得ます。
declare const __APP_VERSION__: string | undefined;
declare const __BUILD_AT__: string | undefined;
declare const __COMMIT__: string | undefined;

/**
 * 埋め込まれた値を読む。
 *
 * ★ 埋め込みが無いときに落ちてはいけません。
 *   版の表示ができないだけで、アプリ全体が真っ白になるのは、
 *   直そうとしている問題より明らかにひどい結果です。
 */
function embedded(read: () => string | undefined): string | null {
  try {
    const value = read();
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export const APP_VERSION =
  embedded(() => (typeof __APP_VERSION__ === 'undefined' ? undefined : __APP_VERSION__)) ?? '0.0.0';

export const BUILD_AT =
  embedded(() => (typeof __BUILD_AT__ === 'undefined' ? undefined : __BUILD_AT__)) ?? '';

export const COMMIT =
  embedded(() => (typeof __COMMIT__ === 'undefined' ? undefined : __COMMIT__)) ?? '';

/**
 * 画面に出す1行。
 *
 *   ver 1.0.0 · bd88e2a · 09/05 14:32
 *
 * 手元で組み立てたものにはコミットが入らないので、その部分は出しません。
 */
export function versionLine(): string {
  return [`ver ${APP_VERSION}`, COMMIT, BUILD_AT].filter((s) => s.length > 0).join(' · ');
}
