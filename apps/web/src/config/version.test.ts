import { describe, expect, it } from 'vitest';
import { APP_VERSION, BUILD_AT, COMMIT, versionLine } from './version';

/**
 * 版の表示（追加仕様: 版の表示）。
 *
 * ★ このテストが動いている場所には、埋め込みがありません。
 *
 *   版・組み立て時刻・コミットは、本番のビルドのときだけ埋め込まれます。
 *   テストでは入っていないので、**この状態で落ちないこと**が
 *   ここでいちばん確かめたいことです。
 *
 *   版が出せないだけでアプリが真っ白になるのは、
 *   直そうとしている問題より、明らかにひどい結果です。
 */

describe('埋め込みが無くても落ちない', () => {
  it('版は、それらしい形で返る', () => {
    expect(typeof APP_VERSION).toBe('string');
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });

  it('組み立て時刻とコミットは、空でもよい', () => {
    expect(typeof BUILD_AT).toBe('string');
    expect(typeof COMMIT).toBe('string');
  });

  it('★ 1行にしたときも、必ず何かは出る', () => {
    const line = versionLine();
    expect(line.startsWith('ver ')).toBe(true);
    // 空の項目で「· ·」のような間抜けな並びにならない
    expect(line).not.toMatch(/·\s*·/);
    expect(line.trim()).toBe(line);
  });
});
