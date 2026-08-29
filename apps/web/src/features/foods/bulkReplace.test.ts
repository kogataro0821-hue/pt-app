import { describe, expect, it } from 'vitest';
import { aRequest, anEntry } from '@/test/factories';
import { replaceTargets } from './bulkReplace';

/**
 * 過去の記録を置き換えるとき、どの日を調べるか（設計書 §21）。
 *
 * ★ ここを広げすぎると無料枠を使い切ります。
 *   全員の全日をさらうのではなく、依頼に記録された「使った日」だけを見ます。
 *   その約束をここで固定します。
 */

describe('replaceTargets', () => {
  it('依頼に記録された日だけを対象にする', () => {
    const targets = replaceTargets(
      aRequest({ from: [anEntry({ clientId: 'tanaka01', dates: ['2026-08-26', '2026-08-28'] })] }),
    );
    expect(targets).toEqual([
      { clientId: 'tanaka01', date: '2026-08-26' },
      { clientId: 'tanaka01', date: '2026-08-28' },
    ]);
  });

  it('複数の契約者ぶんをまとめて返す', () => {
    const targets = replaceTargets(
      aRequest({
        from: [
          anEntry({ clientId: 'suzuki02', dates: ['2026-08-25'] }),
          anEntry({ clientId: 'tanaka01', dates: ['2026-08-20'] }),
        ],
      }),
    );
    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.clientId)).toEqual(['suzuki02', 'tanaka01']);
  });

  it('同じ人の同じ日は1回だけにする', () => {
    // 同じ日を2度書き換えにいくと、読み書きが無駄に2倍になります
    const targets = replaceTargets(
      aRequest({
        from: [
          anEntry({ clientId: 'tanaka01', dates: ['2026-08-28', '2026-08-28'] }),
          anEntry({ clientId: 'tanaka01', dates: ['2026-08-28'] }),
        ],
      }),
    );
    expect(targets).toEqual([{ clientId: 'tanaka01', date: '2026-08-28' }]);
  });

  it('別の人の同じ日は、別々に扱う', () => {
    const targets = replaceTargets(
      aRequest({
        from: [
          anEntry({ clientId: 'tanaka01', dates: ['2026-08-28'] }),
          anEntry({ clientId: 'suzuki02', dates: ['2026-08-28'] }),
        ],
      }),
    );
    expect(targets).toHaveLength(2);
  });

  it('契約者ごと・日付順に並べる（途中で止まっても、どこまで進んだか分かるように）', () => {
    const targets = replaceTargets(
      aRequest({
        from: [
          anEntry({ clientId: 'tanaka01', dates: ['2026-08-28', '2026-08-01'] }),
          anEntry({ clientId: 'aoki03', dates: ['2026-08-15'] }),
        ],
      }),
    );
    expect(targets).toEqual([
      { clientId: 'aoki03', date: '2026-08-15' },
      { clientId: 'tanaka01', date: '2026-08-01' },
      { clientId: 'tanaka01', date: '2026-08-28' },
    ]);
  });

  it('日付が1つも無ければ、何も調べない', () => {
    expect(replaceTargets(aRequest({ from: [anEntry({ dates: [] })] }))).toEqual([]);
  });

  it('依頼元が空でも落ちない', () => {
    expect(replaceTargets(aRequest({ from: [] }))).toEqual([]);
  });
});
