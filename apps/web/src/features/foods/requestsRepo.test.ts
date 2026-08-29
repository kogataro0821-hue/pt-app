import { foodKey } from '@pt/core';
import { describe, expect, it } from 'vitest';
import { aCandidate, aRequest, anEntry } from '@/test/factories';
import { firstCandidate, requestId } from './requestsRepo';

/**
 * 登録依頼のID（設計書 §21 / Phase 9）。
 *
 * ★ ここは実際に事故が起きたところです。
 *
 *   依頼のIDと、食品マスタの照合キーを別々に作っていたせいで、
 *   「1/2カット」のような名前で食い違いが起き、
 *   過去の記録の置き換えが**エラーも出さずに取りこぼす**状態でした。
 *   気づけるのは「置き換えたのに数字が変わらない」と言われたときだけです。
 *
 *   2つが同じ作り方であることを、ここで機械的に固定します。
 */

describe('requestId', () => {
  it('食品マスタの照合キーと、まったく同じものを返す', () => {
    for (const name of [
      'カップヌードル',
      'サラダチキン',
      '鶏むね肉（皮なし）',
      '1/2カット',
      'ﾊﾟﾝ',
      'A#B$C[D]',
    ]) {
      expect(requestId(name)).toBe(foodKey(name));
    }
  });

  it('表記がゆれても、同じ依頼にまとまる', () => {
    // まとまらないと、管理者の画面が同じ食材で埋まります
    const id = requestId('サラダチキン');
    expect(requestId('サラダ チキン')).toBe(id);
    expect(requestId('サラダ　チキン')).toBe(id);
    expect(requestId('ｻﾗﾀﾞﾁｷﾝ')).toBe(id);
    expect(requestId('さらだちきん')).toBe(id);
  });

  it('Firestore のドキュメントIDに使えない文字は入らない', () => {
    const id = requestId('1/2カット #特売 [限定]');
    for (const ng of ['/', '\\', '#', '$', '[', ']', '?', '*']) {
      expect(id).not.toContain(ng);
    }
  });

  it('長い名前でも100文字を超えない', () => {
    expect(requestId('あ'.repeat(300)).length).toBeLessThanOrEqual(100);
  });

  it('記号だけの名前は空になる（依頼を積まない目印になる）', () => {
    expect(requestId('###')).toBe('');
    expect(requestId('   ')).toBe('');
  });
});

describe('firstCandidate', () => {
  it('誰も成分表示を撮っていなければ null', () => {
    expect(firstCandidate(aRequest({ from: [anEntry()] }))).toBeNull();
  });

  it('撮った人がいれば、その候補を返す', () => {
    const candidate = aCandidate();
    const found = firstCandidate(aRequest({ from: [anEntry({ candidate })] }));
    expect(found).toBe(candidate);
  });

  it('撮っていない人が先に並んでいても、撮った人の候補を見つける', () => {
    // 1人目に候補が無いだけで諦めると、写真が管理者に届きません
    const candidate = aCandidate();
    const found = firstCandidate(
      aRequest({
        from: [
          anEntry({ clientId: 'suzuki02', candidate: null }),
          anEntry({ clientId: 'tanaka01', candidate }),
        ],
      }),
    );
    expect(found).toBe(candidate);
  });

  it('依頼元が空でも落ちない', () => {
    expect(firstCandidate(aRequest({ from: [] }))).toBeNull();
  });
});
