import { describe, expect, it } from 'vitest';
import { APP_NOTICES } from './appNotices';

/**
 * 全員に出るお知らせ（追加仕様: お知らせ欄）。
 *
 * ★ ここは**足し忘れる**場所です。実績があります。
 *
 *   8/29 にお知らせ欄を作ったあと、筋肉量・メニュー・単位換算・
 *   マスタの反映・版の表示と5回配って、**1件も足しませんでした。**
 *   使う人から見れば「更新されない欄」です。そうなればもう見に来ません。
 *   お知らせ欄そのものが死にます。
 *
 * ★ ただし、テストで「足し忘れ」は捕まえられません。
 *   配ったかどうかを、テストは知らないからです。
 *   ここで見張れるのは、並びと重複という**壊れ方のほう**だけです。
 *   足し忘れは手順で防ぎます（docs/00_DESIGN.md の配布の手順）。
 */

describe('お知らせの並び', () => {
  it('新しいものが上に来る', () => {
    // ★ 一覧はこの順でそのまま出ます。混ざると、古い変更が最新に見えます。
    const times = APP_NOTICES.map((n) => n.at);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('★ 目印が重ならない', () => {
    // ★ 目印は「読んだかどうか」の記録に使います。
    //   重なると、片方を読んだだけでもう片方も既読になります。
    const ids = APP_NOTICES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('全部 app の種類で、開く先の日付は持たない', () => {
    for (const notice of APP_NOTICES) {
      expect(notice.kind).toBe('app');
      // 全員に同じものが出るので、特定の日には結び付きません
      expect(notice.date).toBeNull();
    }
  });

  it('時刻がちゃんとした数字になっている', () => {
    // ★ 日付の書き方を間違えると NaN になり、並びが静かに壊れます
    for (const notice of APP_NOTICES) {
      expect(Number.isFinite(notice.at)).toBe(true);
    }
  });

  it('題と本文が空でない', () => {
    for (const notice of APP_NOTICES) {
      expect(notice.title.length).toBeGreaterThan(0);
      expect(notice.body.length).toBeGreaterThan(0);
    }
  });
});
