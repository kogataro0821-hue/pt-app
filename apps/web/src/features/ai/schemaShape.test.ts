import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AI に渡す「返してほしい形」の作法を見張る（追加仕様: 登録依頼のAI）。
 *
 * ★ これは、実際に 400 で断られてから書いたテストです。
 *
 *   新しく足した問い合わせだけが、中継役から 400 で返ってきました。
 *   同じ中継役・同じ鍵・同じモデルで、ほかの問い合わせは動いています。
 *   違ったのは**要求の形**でした。
 *
 *       per100g: { type: 'object', nullable: true, ... }
 *       required: [..., 'per100g']
 *
 *   Gemini は、入れ子の object を nullable にした形や、
 *   nullable な項目を required に入れた形を受け付けません。
 *
 * ★ 動いていた成分表示の読み取りは、こうでした。
 *
 *       kcal: { type: 'number', nullable: true }   ← 平ら
 *       required: ['basis', 'productName', ...]     ← nullable は入っていない
 *
 *   その問い合わせ自体はやめましたが、**この見張りは残します。**
 *   次に誰かが新しい問い合わせを足したときに、同じ穴に落ちないためです。
 *   （半日つぶした失敗なので、教訓のほうを残します）
 *
 * ★ ファイルを読んで確かめます。動かさないので、通信も鍵も要りません。
 */

// ★ import.meta.url は、この環境では file: になりません。
//   テストの実行場所（apps/web）からの相対で読みます。
const source = readFileSync(resolve(process.cwd(), 'src/features/ai/gemini.ts'), 'utf8');

interface Schema {
  name: string;
  body: string;
}

/** `const XXX_RESPONSE_SCHEMA = { ... } as const;` を拾う */
function schemas(): Schema[] {
  const found: Schema[] = [];
  const re = /const (\w*RESPONSE_SCHEMA) = (\{[\s\S]*?\n\}) as const;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    found.push({ name: m[1] as string, body: m[2] as string });
  }
  return found;
}

/** required: [...] の中身 */
function requiredOf(body: string): string[] {
  const m = /required: \[([^\]]*)\]/.exec(body);
  if (m === null) return [];
  return (m[1] as string)
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter((s) => s.length > 0);
}

/** nullable: true が付いている項目の名前 */
function nullableOf(body: string): string[] {
  const names: string[] = [];
  const re = /(\w+): \{[^{}]*nullable: true/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) names.push(m[1] as string);
  return names;
}

describe('返してほしい形の作法', () => {
  const all = schemas();

  it('形を拾えている（拾い方が壊れていないかの確認）', () => {
    // ★ 数が急に減ったら、上の正規表現が壊れています
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.map((s) => s.name)).toContain('LABEL_RESPONSE_SCHEMA');
    expect(all.map((s) => s.name)).toContain('PHOTO_RESPONSE_SCHEMA');
  });

  for (const { name, body } of all) {
    it(`${name}: ★ nullable な項目を required に入れていない`, () => {
      const required = requiredOf(body);
      const nullable = nullableOf(body);
      const bad = nullable.filter((n) => required.includes(n));

      expect(
        bad,
        `${name} で ${bad.join(' / ')} が nullable かつ required です。` +
          `この形は Gemini が 400 で断ります。required から外してください。`,
      ).toEqual([]);
    });

    it(`${name}: ★ 入れ子の object を nullable にしていない`, () => {
      // ★ 「分からないときは null」を入れ子で表そうとすると、これになります。
      //   中の数値を平らに並べて、1つずつ nullable にしてください。
      const bad = /type: 'object',\s*\n\s*nullable: true/.test(body);

      expect(
        bad,
        `${name} で、入れ子の object に nullable: true を付けています。` +
          `中身を平らに並べて、1つずつ nullable にしてください。`,
      ).toBe(false);
    });
  }
});
