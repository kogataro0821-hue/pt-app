import { describe, expect, it } from 'vitest';
import {
  formatLedgerAt,
  MAX_LEDGER_TEXT,
  sortLedger,
  summarize,
  toLedgerEntry,
  type LedgerEntry,
} from './ledger';

/**
 * かけらの帳簿（追加仕様: かけらの帳簿）。
 *
 * ★ 守りたいのは3つです。
 *
 *   1. 壊れた行が1つあっても、画面ごと落ちないこと
 *   2. 新しい順に並ぶこと
 *   3. 合計が「人が動かしたぶん」を表すこと
 */

const row = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'e1',
  delta: -3,
  balance: 2,
  text: 'プロテイン',
  kind: 'redeem',
  at: 1_700_000_000_000,
  ...over,
});

describe('保存された1行を読む', () => {
  it('ふつうに読める', () => {
    const e = toLedgerEntry('e1', {
      delta: -3,
      balance: 2,
      text: 'プロテイン',
      kind: 'redeem',
      at: 1_700_000_000_000,
    });
    expect(e).toEqual(row());
  });

  it('サーバー時刻（Timestamp）も読める', () => {
    const e = toLedgerEntry('e1', { at: { toMillis: () => 1_700_000_000_000 } });
    expect(e.at).toBe(1_700_000_000_000);
  });

  it('★ 書き込んだ直後で時刻が未確定でも、落ちない', () => {
    // ★ サーバー時刻は、書いた瞬間だけ null で返ることがあります
    expect(toLedgerEntry('e1', { at: null }).at).toBe(0);
    expect(toLedgerEntry('e1', {}).at).toBe(0);
  });

  it('★ 壊れた行でも落ちない', () => {
    const e = toLedgerEntry('e1', {
      delta: 'たくさん',
      balance: -5,
      text: 42,
      kind: 'なにか',
      at: 'きのう',
    });
    expect(e.delta).toBe(0);
    expect(e.balance).toBe(0);
    expect(e.text).toBe('');
    expect(e.kind).toBe('grant');
    expect(e.at).toBe(0);
  });

  it('長すぎる説明は切る', () => {
    const e = toLedgerEntry('e1', { text: 'あ'.repeat(200) });
    expect(e.text.length).toBe(MAX_LEDGER_TEXT);
  });

  it('知らない種類は、トレーナーぶんとして読む', () => {
    // ★ 「本人が交換した」に化けるほうが、意味の取り違えとして重いためです
    expect(toLedgerEntry('e1', { kind: 'redeem' }).kind).toBe('redeem');
    expect(toLedgerEntry('e1', { kind: 'xxx' }).kind).toBe('grant');
  });
});

describe('並び', () => {
  it('新しい順', () => {
    const rows = [row({ id: 'a', at: 100 }), row({ id: 'b', at: 300 }), row({ id: 'c', at: 200 })];
    expect(sortLedger(rows).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('同じ時刻なら、順番が入れ替わらない（毎回同じ並び）', () => {
    // ★ まとめて書いた行は時刻が同じになります。
    //   開くたびに並びが変わると、読んでいる人が混乱します
    const rows = [row({ id: 'a', at: 100 }), row({ id: 'b', at: 100 })];
    expect(sortLedger(rows).map((r) => r.id)).toEqual(['b', 'a']);
    expect(sortLedger([...rows].reverse()).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('元の配列は変えない', () => {
    const rows = [row({ id: 'a', at: 100 }), row({ id: 'b', at: 300 })];
    sortLedger(rows);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('★ 合計', () => {
  it('渡したぶんと、使ったぶんを分けて数える', () => {
    const rows = [row({ delta: 5 }), row({ delta: -3 }), row({ delta: 10 }), row({ delta: -2 })];
    expect(summarize(rows)).toEqual({ gained: 15, spent: 5 });
  });

  it('使ったぶんは、正の数で返す', () => {
    // ★ 画面で「使った −5」と出ると読みにくいためです
    expect(summarize([row({ delta: -5 })]).spent).toBe(5);
  });

  it('空なら0', () => {
    expect(summarize([])).toEqual({ gained: 0, spent: 0 });
  });
});

describe('時刻の表示', () => {
  it('日本時間で出る', () => {
    // 2023-11-14 22:13:20 UTC → JST 翌日 07:13
    expect(formatLedgerAt(1_700_000_000_000)).toBe('11月15日 07:13');
  });

  it('時刻が無いときは、何も出さない', () => {
    expect(formatLedgerAt(0)).toBe('');
  });
});
