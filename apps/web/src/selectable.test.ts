import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 文字を選べること（追加仕様: 文字を選べるようにする）。
 *
 * ★ 一度これで困りました。
 *
 *   body に user-select: none を置いていました。長押しで文字が
 *   選択されるのを防ぐためです。アプリらしい手触りのつもりでした。
 *
 *   その結果、**アプリ内の文字を1つもコピーできません**でした。
 *   食材名も、トレーナーの評価の文章も、交換の内容も、帳簿の数字も。
 *   手触りのために、必要なことを潰していました。
 *
 * ★ CSS は画面のテストでは確かめられません（jsdom は実際に
 *   選択できるかを知りません）。なので、**書いてある中身**を見ます。
 *   粗いやり方ですが、同じ間違いを二度としないためには足ります。
 */

// ★ import.meta.url は画面テストの環境では file: になりません。
//   実行場所（apps/web）からの位置で読みます。
const raw = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8');

/**
 * 注釈を外す。
 *
 * ★ 注釈の中に「user-select: none」と書いてあります
 *   （なぜやめたかの説明です）。外さないと、説明文を決まりと
 *   読み違えて落ちます。実際に一度落ちました。
 */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * body { ... } の中身を全部取り出す。
 *
 * ★ body の決まりは1か所ではありません（最初に余白を0にする決まりが
 *   別にあります）。1つ目だけ見ると、本体を見落とします。
 */
function bodyBlocks(): string[] {
  const out: string[] = [];
  let at = css.indexOf('\nbody {');
  while (at > -1) {
    const end = css.indexOf('\n}', at);
    out.push(css.slice(at, end));
    at = css.indexOf('\nbody {', end);
  }
  expect(out.length).toBeGreaterThan(0);
  return out;
}

describe('★ 文字が選べること', () => {
  it('body で選択を止めていない', () => {
    // ★ ここを none にすると、アプリ全体で何もコピーできなくなります
    for (const block of bodyBlocks()) {
      expect(block).not.toContain('user-select: none');
    }
  });

  it('body で、はっきり選べるようにしてある', () => {
    // ★ 書かないでおくと、あとから「なぜ無いのか」が分かりません
    expect(bodyBlocks().some((b) => b.includes('user-select: text'))).toBe(true);
  });

  it('★ 押すためのものは、選べないままにしてある', () => {
    // ★ ボタンを長押ししたときに文字が反転すると、
    //   押したのか選んだのか分からなくなります
    expect(css).toMatch(/\nbutton,\s*\nselect,/);
  });

  it('入力欄は、長押しのメニューが出る', () => {
    // ★ 貼り付けができないと、QRの内容などを持ち込めません
    expect(css).toContain('-webkit-touch-callout: default');
  });
});
