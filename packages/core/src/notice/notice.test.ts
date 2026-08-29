import { describe, expect, it } from 'vitest';
import {
  NOTICE_KEEP,
  addNotice,
  commentNoticeId,
  isUnread,
  mergeNotices,
  rankUpNoticeId,
  sortNotices,
  toNotices,
  unreadCount,
  type Notice,
} from './notice';

function aNotice(over: Partial<Notice> = {}): Notice {
  return {
    id: 'n1',
    kind: 'comment',
    at: 1_700_000_000_000,
    title: 'トレーナーからコメントが届きました',
    body: '',
    date: null,
    ...over,
  };
}

describe('addNotice', () => {
  it('新しいものが先に来る', () => {
    const list = addNotice([aNotice({ id: 'a', at: 100 })], aNotice({ id: 'b', at: 200 }));
    expect(list.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('★ 同じ出来事なら、増やさずに置き換える', () => {
    // ★ 同じ日のコメントを3回直しても、お知らせは1件のままです。
    //   直すたびに増えると、ベルの数字ばかり大きくなって中身が読まれません。
    const id = commentNoticeId('2026-08-29');
    let list: Notice[] = [];
    list = addNotice(list, aNotice({ id, at: 100 }));
    list = addNotice(list, aNotice({ id, at: 200 }));
    list = addNotice(list, aNotice({ id, at: 300 }));

    expect(list).toHaveLength(1);
    expect(list[0]?.at).toBe(300);
  });

  it('日が違えば、別のお知らせになる', () => {
    let list: Notice[] = [];
    list = addNotice(list, aNotice({ id: commentNoticeId('2026-08-28'), at: 100 }));
    list = addNotice(list, aNotice({ id: commentNoticeId('2026-08-29'), at: 200 }));

    expect(list).toHaveLength(2);
  });

  it('★ 溜まりすぎないように、古いものから捨てる', () => {
    // ★ 契約者ドキュメントの中に入れているので、無限には持てません。
    //   お知らせで膨らむと、カレンダーを開くたびに重くなります。
    let list: Notice[] = [];
    for (let i = 0; i < NOTICE_KEEP + 10; i += 1) {
      list = addNotice(list, aNotice({ id: `n${i}`, at: 1000 + i }));
    }

    expect(list).toHaveLength(NOTICE_KEEP);
    // 残っているのは新しいほう
    expect(list[0]?.id).toBe(`n${NOTICE_KEEP + 9}`);
  });

  it('元の配列は変えない', () => {
    const before: Notice[] = [aNotice({ id: 'a', at: 100 })];
    addNotice(before, aNotice({ id: 'b', at: 200 }));
    expect(before).toHaveLength(1);
  });
});

describe('sortNotices', () => {
  it('時刻が同じでも、並び順は毎回同じ', () => {
    // ★ 呼ぶたびに順番が変わると、画面がちらつきます
    const list = [aNotice({ id: 'b', at: 100 }), aNotice({ id: 'a', at: 100 })];
    expect(sortNotices(list).map((n) => n.id)).toEqual(['a', 'b']);
    expect(sortNotices(list).map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('unreadCount', () => {
  it('一度も読んでいなければ、全部が未読', () => {
    const list = [aNotice({ id: 'a', at: 100 }), aNotice({ id: 'b', at: 200 })];
    expect(unreadCount(list, null)).toBe(2);
  });

  it('読んだ時刻より新しいものだけを数える', () => {
    const list = [aNotice({ id: 'a', at: 100 }), aNotice({ id: 'b', at: 300 })];
    expect(unreadCount(list, 200)).toBe(1);
  });

  it('全部読んでいれば0', () => {
    const list = [aNotice({ id: 'a', at: 100 }), aNotice({ id: 'b', at: 200 })];
    expect(unreadCount(list, 200)).toBe(0);
  });

  it('★ 読んだあとに新しく届けば、また未読になる', () => {
    // ★ 「閉じる」は、そのときまでのお知らせを読んだという意味です。
    //   以後のお知らせまで既読にはしません。
    const read = 200;
    const list = addNotice([aNotice({ id: 'a', at: 100 })], aNotice({ id: 'b', at: 300 }));
    expect(unreadCount(list, read)).toBe(1);
  });

  it('お知らせが無ければ0', () => {
    expect(unreadCount([], null)).toBe(0);
  });
});

describe('isUnread', () => {
  it('読んだ時刻ちょうどのものは、既読とみなす', () => {
    expect(isUnread(aNotice({ at: 200 }), 200)).toBe(false);
    expect(isUnread(aNotice({ at: 201 }), 200)).toBe(true);
  });
});

describe('mergeNotices', () => {
  it('個人あてとアプリ同梱を、まとめて新しい順に並べる', () => {
    const personal = [aNotice({ id: 'p', at: 100 })];
    const app = [aNotice({ id: 'a', kind: 'app', at: 200 })];
    expect(mergeNotices(personal, app).map((n) => n.id)).toEqual(['a', 'p']);
  });

  it('どちらかが空でも動く', () => {
    expect(mergeNotices([], [aNotice({ id: 'a' })])).toHaveLength(1);
    expect(mergeNotices([aNotice({ id: 'p' })], [])).toHaveLength(1);
  });
});

describe('rankUpNoticeId / commentNoticeId', () => {
  it('ランクごと・日ごとに違う目印になる', () => {
    expect(rankUpNoticeId('RUBY')).not.toBe(rankUpNoticeId('DIAMOND'));
    expect(commentNoticeId('2026-08-28')).not.toBe(commentNoticeId('2026-08-29'));
  });

  it('コメントとランクの目印がぶつからない', () => {
    expect(commentNoticeId('RUBY')).not.toBe(rankUpNoticeId('RUBY'));
  });
});

describe('toNotices', () => {
  it('配列でなければ、空とみなす', () => {
    expect(toNotices(undefined)).toEqual([]);
    expect(toNotices(null)).toEqual([]);
    expect(toNotices('お知らせ')).toEqual([]);
  });

  it('★ 形のおかしいものは、黙って捨てる', () => {
    // ★ お知らせが1件おかしいだけで画面が真っ白になるのは、割に合いません
    const list = toNotices([
      { id: 'ok', kind: 'comment', at: 100, title: 'あ', body: '', date: null },
      null,
      'ごみ',
      { kind: 'comment', at: 100 }, // id が無い
      { id: 'no-at', kind: 'comment' }, // 時刻が無い
    ]);
    expect(list.map((n) => n.id)).toEqual(['ok']);
  });

  it('知らない種類は app 扱いにする（消さない）', () => {
    const list = toNotices([{ id: 'x', kind: 'なにか', at: 100 }]);
    expect(list[0]?.kind).toBe('app');
  });

  it('文字が入っていなくても、空文字で埋める', () => {
    const list = toNotices([{ id: 'x', at: 100 }]);
    expect(list[0]?.title).toBe('');
    expect(list[0]?.body).toBe('');
    expect(list[0]?.date).toBeNull();
  });

  it('読んだ時点で、新しい順に並んでいる', () => {
    const list = toNotices([
      { id: 'a', at: 100 },
      { id: 'b', at: 300 },
      { id: 'c', at: 200 },
    ]);
    expect(list.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('多すぎるときは、読む時点でも切る', () => {
    const raw = Array.from({ length: NOTICE_KEEP + 5 }, (_, i) => ({ id: `n${i}`, at: 1000 + i }));
    expect(toNotices(raw)).toHaveLength(NOTICE_KEEP);
  });
});
