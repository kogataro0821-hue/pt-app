/**
 * お知らせ（追加仕様: お知らせ欄）。
 *
 * ★ お知らせは、人が書くのではなく**アプリが自動で作ります。**
 *
 *   「管理者が書く欄」にすると、忙しい日は書かれません。
 *   書かれない欄は、契約者もやがて見なくなります。
 *   起きたこと（登録・昇格・コメント）から自動で作れば、必ず出ます。
 *
 * ★ 置き場所は契約者ドキュメントの中（配列）です。
 *
 *   別のコレクションにすると、開くたびに読み取りが増えます。
 *   契約者ドキュメントはカレンダーを開いた時点ですでに読んでいるので、
 *   その中に入れておけば**追加の読み取りは0回**です。
 *
 *   そのかわり、無限には溜められません。NOTICE_KEEP 件で切ります。
 */

export type NoticeKind =
  /** 登録が完了した */
  | 'welcome'
  /** ランクが上がった */
  | 'rankUp'
  /** トレーナーからコメントが届いた */
  | 'comment'
  /** アプリが新しくなった（アプリに同梱） */
  | 'app';

export interface Notice {
  /**
   * 同じ出来事に2件作らないための目印。
   *
   * ★ 時刻ではなく「出来事」から作ります。
   *   同じ日のコメントを3回直しても、お知らせは1件のままです。
   */
  id: string;
  kind: NoticeKind;
  /** 作られた時刻（ミリ秒） */
  at: number;
  title: string;
  body: string;
  /** 開く先の日付。無ければ null */
  date: string | null;
}

/**
 * 1人あたりに残す件数。
 *
 * ★ 30件にしてあります。
 *   契約者ドキュメントには目標値やランクも入っています。
 *   お知らせだけで膨らむと、カレンダーを開くたびに重くなります。
 *   1日1件のコメント通知でも1か月ぶん残る計算です。
 */
export const NOTICE_KEEP = 30;

/** 同じ日のコメントは、何度直しても1件 */
export function commentNoticeId(date: string): string {
  return `comment-${date}`;
}

/** 同じランクへの昇格は1件（下げてから上げ直せば、時刻だけ新しくなります） */
export function rankUpNoticeId(rank: string): string {
  return `rankup-${rank}`;
}

export const WELCOME_NOTICE_ID = 'welcome';

/**
 * お知らせを1件足す。
 *
 * ★ 同じ id があれば**置き換えます**（増やしません）。
 *   同じ日のコメントを直すたびにお知らせが増えると、
 *   ベルの数字ばかり大きくなって、中身が読まれなくなります。
 *
 * ★ 置き換えたときは、時刻も新しくなります。
 *   直したことは伝わってほしいので、未読に戻します。
 */
export function addNotice(list: readonly Notice[], notice: Notice): Notice[] {
  const others = list.filter((n) => n.id !== notice.id);
  return sortNotices([notice, ...others]).slice(0, NOTICE_KEEP);
}

/**
 * 新しい順に並べる。
 *
 * ★ 時刻が同じときは id で並べます。
 *   並び順が呼ぶたびに変わると、画面がちらつきます。
 */
export function sortNotices(list: readonly Notice[]): Notice[] {
  return [...list].sort((a, b) => (b.at !== a.at ? b.at - a.at : a.id.localeCompare(b.id)));
}

/**
 * 個人あてのお知らせと、アプリ同梱のお知らせを1つに並べる。
 *
 * ★ 同梱のほうは Firestore に入っていません。
 *   アプリの中の定数なので、読み取りは0回です。
 */
export function mergeNotices(personal: readonly Notice[], app: readonly Notice[]): Notice[] {
  return sortNotices([...personal, ...app]);
}

/**
 * まだ読んでいない件数。
 *
 * ★ 既読は「1件ずつ」ではなく「いつまで読んだか」の時刻1つで持ちます。
 *
 *   1件ずつ持つと、既読の印がお知らせと同じだけ増えます。
 *   契約者が書ける場所は限られているので、小さく持ちたいところです。
 *   「閉じる」を押した時刻より古いものは、すべて読んだものとみなします。
 */
export function unreadCount(list: readonly Notice[], readAt: number | null): number {
  const since = readAt ?? 0;
  return list.filter((n) => n.at > since).length;
}

/** そのお知らせが未読か */
export function isUnread(notice: Notice, readAt: number | null): boolean {
  return notice.at > (readAt ?? 0);
}

/**
 * Firestore から読んだ値を、お知らせの形に直す。
 *
 * ★ 形が違うものは黙って捨てます。
 *   お知らせが1件おかしいだけで画面が真っ白になるのは、割に合いません。
 */
export function toNotices(raw: unknown): Notice[] {
  if (!Array.isArray(raw)) return [];

  const out: Notice[] = [];
  for (const item of raw) {
    const n = toNotice(item);
    if (n !== null) out.push(n);
  }
  return sortNotices(out).slice(0, NOTICE_KEEP);
}

const KINDS: readonly NoticeKind[] = ['welcome', 'rankUp', 'comment', 'app'];

function toNotice(raw: unknown): Notice | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;

  const id = typeof d.id === 'string' && d.id.length > 0 ? d.id : null;
  const at = typeof d.at === 'number' && Number.isFinite(d.at) ? d.at : null;
  if (id === null || at === null) return null;

  const kind = KINDS.find((k) => k === d.kind) ?? 'app';

  return {
    id,
    kind,
    at,
    title: typeof d.title === 'string' ? d.title : '',
    body: typeof d.body === 'string' ? d.body : '',
    date: typeof d.date === 'string' && d.date.length > 0 ? d.date : null,
  };
}
