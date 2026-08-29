import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ルールの網羅を、機械的に見張る（Phase 11B）。
 *
 * ★ なぜこれが要るのか。
 *
 *   Rules のテストは161件ありました。数だけ見れば十分に思えます。
 *   ところが1行ずつ数えたところ、**テストが1件も無い match ブロックが5つ**
 *   ありました（お気に入り、個人レシピ、AIの会話本文、共通レシピ、既定の全拒否）。
 *   そこは、壊しても誰も気づけない状態でした。
 *
 *   同じことを繰り返さないための見張りです。
 *   新しいコレクションをルールに足したのにテストを書かなければ、ここで止まります。
 *
 * ★ このテストはエミュレータを使いません。
 *   ファイルを読んで突き合わせるだけなので、どこでも動きます。
 *   Rules の中身が正しいかは見ていません。見ているのは「見落としが無いか」だけです。
 */

const rules = readFileSync(
  fileURLToPath(new URL('../firestore.rules', import.meta.url)),
  'utf8',
);
const tests = readFileSync(fileURLToPath(new URL('./rules.test.ts', import.meta.url)), 'utf8');

/**
 * ルールの中の match ブロックから、コレクション名を拾う。
 *
 *   match /clients/{cid}/days/{date}/photos/{photoId}  →  clients, days, photos
 *
 * ワイルドカード（{...}）と、いちばん外側の databases/documents は数えません。
 */
function collectionsInRules(): string[] {
  const found = new Set<string>();

  for (const line of rules.split('\n')) {
    const m = /^\s*match\s+(\/[^{\s]*(?:\{[^}]*\}[^{\s]*)*)\s*\{/.exec(line);
    const path = m?.[1];
    if (path === undefined) continue;

    for (const seg of path.split('/')) {
      if (seg.length === 0) continue;
      if (seg.startsWith('{')) continue;
      if (seg === 'databases' || seg === 'documents') continue;
      found.add(seg);
    }
  }

  return [...found].sort();
}

/** テストの中で、そのコレクションがパスとして使われているか */
function isExercised(name: string): boolean {
  return new RegExp(`['/]${name}[/']`).test(tests);
}

describe('Rules のコレクションに、テストの取りこぼしが無いか', () => {
  const names = collectionsInRules();

  it('match ブロックを拾えている（拾い方が壊れていないかの確認）', () => {
    // 数が急に減ったら、上の正規表現が壊れています
    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(names).toContain('clients');
    expect(names).toContain('foodRequests');
  });

  for (const name of collectionsInRules()) {
    it(`${name} を触るテストがある`, () => {
      expect(
        isExercised(name),
        `ルールに match /${name} がありますが、rules.test.ts でこのパスを一度も触っていません。` +
          `テストを足すか、使わなくなった match ブロックを消してください。`,
      ).toBe(true);
    });
  }
});

describe('ルールの土台が外れていないか', () => {
  it('既定の全拒否が残っている', () => {
    // ★ これが外れると、書き忘れたパスが「誰でも読み書きできる」状態になります
    expect(rules).toMatch(/match\s+\/\{document=\*\*\}\s*\{\s*[\s\S]*?allow\s+read,\s*write:\s*if\s+false;/);
  });

  it('既定の全拒否を試すテストがある', () => {
    // ルールに書いていないパスへ触るテスト。これが無いと、上の1行が消えても気づけません
    expect(tests).toContain('somethingNew');
  });

  it('ログインの有無を見る土台（signedIn）が残っている', () => {
    expect(rules).toMatch(/function\s+signedIn\(\)\s*\{\s*return\s+request\.auth\s*!=\s*null;/);
  });

  it('管理者判定に「有効なアカウントか」が入っている', () => {
    // ★ ここから active の判定が落ちると、無効にした管理者が生き返ります
    expect(rules).toMatch(/function\s+isAdmin\(\)[\s\S]*?me\(\)\.active\s*==\s*true/);
  });

  it('契約者判定に、本人かどうかの比較が入っている', () => {
    // ★ ここが落ちると、契約者どうしが見え合います。このアプリで最も重い1行です
    expect(rules).toMatch(/function\s+isClient\(cid\)[\s\S]*?me\(\)\.clientId\s*==\s*cid/);
  });

  it('未認証を締め出す土台が、契約者判定にも入っている', () => {
    expect(rules).toMatch(/function\s+isClient\(cid\)\s*\{\s*return\s+signedIn\(\)/);
  });
});
