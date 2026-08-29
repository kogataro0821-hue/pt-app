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
 * 契約者を完全に削除する処理（追加仕様: 契約者の完全削除）。
 *
 * ★ ここも「見落とすと誰も気づけない」場所です。
 *   Firestore は親を消しても下位コレクションが残ります。
 *   新しいコレクションを増やして、この処理に足し忘れると、
 *   **消したはずの契約者のデータが、画面から見えないまま残り続けます。**
 *   いちばんたちの悪い残り方です。
 */
const deleteClient = readFileSync(
  fileURLToPath(new URL('../../apps/web/src/features/clients/deleteClient.ts', import.meta.url)),
  'utf8',
);

/**
 * 契約者に紐づかない、共有のコレクション。
 * 契約者を1人消しても、これは消しません。
 */
const SHARED_COLLECTIONS = new Set(['config']);

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

describe('契約者を消したときに、消し残しが出ないか', () => {
  for (const name of collectionsInRules()) {
    if (SHARED_COLLECTIONS.has(name)) continue;

    it(`${name} を消している`, () => {
      expect(
        new RegExp(`['\`]${name}['\`]`).test(deleteClient),
        `ルールに match /${name} がありますが、deleteClient.ts で消していません。` +
          `契約者を完全に削除しても、ここのデータだけが残ります。` +
          `消す対象に足すか、共有のものなら SHARED_COLLECTIONS に足してください。`,
      ).toBe(true);
    });
  }

  it('親より先に、下位のものを消している', () => {
    // ★ 親（clients/{cid}）を先に消すと、途中で失敗したときに
    //   「どの契約者のものか分からない孤児」が大量に残ります。
    const days = deleteClient.indexOf("'days'");
    const client = deleteClient.lastIndexOf("'clients', cid");
    expect(days).toBeGreaterThan(0);
    expect(client).toBeGreaterThan(days);
  });

  it('ログインアカウントが消えないことを、画面で伝えている', () => {
    // ★ Admin SDK が無いので、ここでは消せません。
    //   黙って残すと、同じ契約者IDで作り直せない理由が分からなくなります。
    const zone = readFileSync(
      fileURLToPath(new URL('../../apps/web/src/features/clients/DangerZone.tsx', import.meta.url)),
      'utf8',
    );
    expect(zone).toContain('ログインアカウントは、ここでは消せません');
    expect(zone).toContain('pt-app.local');
  });
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

  it('★ 変更履歴の書き換えは、誰にも許していない', () => {
    // ★ 削除は管理者に許しました（契約者の完全削除のため）。
    //   でも書き換えを許すと、トレーナーが「別の数字だったことにする」ことができます。
    //   履歴が守っているのは、まさにそこです。
    expect(rules).toMatch(/match\s+\/audits\/\{auditId\}[\s\S]*?allow\s+update:\s*if\s+false;/);
  });

  it('契約者判定に、本人かどうかの比較が入っている', () => {
    // ★ ここが落ちると、契約者どうしが見え合います。このアプリで最も重い1行です
    expect(rules).toMatch(/function\s+isClient\(cid\)[\s\S]*?me\(\)\.clientId\s*==\s*cid/);
  });

  it('未認証を締め出す土台が、契約者判定にも入っている', () => {
    expect(rules).toMatch(/function\s+isClient\(cid\)\s*\{\s*return\s+signedIn\(\)/);
  });
});
