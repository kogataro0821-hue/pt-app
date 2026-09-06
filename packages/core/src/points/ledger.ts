/**
 * かけらの帳簿（追加仕様: かけらの帳簿）。
 *
 * ★ 何のために残すのか。
 *
 *   かけらは実物と交換します。1か月後に
 *   「先週プロテインと交換したはず」という話になったとき、
 *   残高だけ見ても、何にいくつ使ったかは分かりません。
 *   出入りを1件ずつ残しておけば、後から突き合わせられます。
 *
 * ★ 毎日の受け取り（+1）は、帳簿に入れません。
 *
 *   10人×365日で年に数千件になります。開くたびに重くなるわりに、
 *   「これまで◯日」で分かる話です。
 *   帳簿に残すのは **人が動かしたぶんだけ** にします。
 *   もめるのは、いつもそちらです。
 *
 * ★ 契約者は、書き足せますが消せません。
 *
 *   自分の交換は自分で書きます（そうしないと交換できません）。
 *   ただし Rules で update と delete を管理者だけにしてあるので、
 *   **後から都合の悪い行を消すことはできません。**
 */

/** 誰がかけらを動かしたか。 */
export type LedgerKind =
  /** 契約者がQRを読んで交換した */
  | 'redeem'
  /** 管理者が付けた・引いた */
  | 'grant';

/** 帳簿の1行。 */
export interface LedgerEntry {
  id: string;
  /** 動いた数。減ったならマイナス */
  delta: number;
  /** 動いたあとの残高 */
  balance: number;
  /** 何のために動かしたか */
  text: string;
  kind: LedgerKind;
  /** 動いた時刻（ミリ秒）。サーバー時刻で入ります */
  at: number;
}

/** 帳簿に書ける説明文の長さ。 */
export const MAX_LEDGER_TEXT = 60;

/**
 * 保存されている1行を読む。壊れていても落ちません。
 *
 * ★ 帳簿が1行おかしいだけで、画面全体が開けなくなるほうが困ります。
 */
export function toLedgerEntry(id: string, raw: Record<string, unknown>): LedgerEntry {
  return {
    id,
    delta: typeof raw.delta === 'number' && Number.isFinite(raw.delta) ? Math.trunc(raw.delta) : 0,
    balance:
      typeof raw.balance === 'number' && Number.isFinite(raw.balance)
        ? Math.max(0, Math.trunc(raw.balance))
        : 0,
    text: typeof raw.text === 'string' ? raw.text.slice(0, MAX_LEDGER_TEXT) : '',
    kind: raw.kind === 'redeem' ? 'redeem' : 'grant',
    at: toMillis(raw.at),
  };
}

/**
 * 時刻を読む。
 *
 * ★ サーバー時刻（Timestamp）で入りますが、書き込んだ直後の一瞬だけ
 *   まだ確定していないことがあります。そこで落ちないようにします。
 */
function toMillis(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw !== null && typeof raw === 'object') {
    const t = raw as { toMillis?: () => number };
    if (typeof t.toMillis === 'function') return t.toMillis();
  }
  return 0;
}

/** 新しい順。同じ時刻なら、あとから入ったほうを先に。 */
export function sortLedger(rows: readonly LedgerEntry[]): LedgerEntry[] {
  return [...rows].sort((a, b) => (b.at === a.at ? b.id.localeCompare(a.id) : b.at - a.at));
}

/** 帳簿の要約（画面の見出し用）。 */
export interface LedgerSummary {
  /** 人が付けた合計 */
  gained: number;
  /** 人が引いた合計（正の数で返します） */
  spent: number;
}

/**
 * 出入りを合計する。
 *
 * ★ 毎日の受け取りは帳簿に入っていないので、
 *   ここの合計は **残高と一致しません**。それでいいのです。
 *   知りたいのは「人が動かしたぶん」だからです。
 */
export function summarize(rows: readonly LedgerEntry[]): LedgerSummary {
  let gained = 0;
  let spent = 0;
  for (const r of rows) {
    if (r.delta > 0) gained += r.delta;
    else spent += -r.delta;
  }
  return { gained, spent };
}

/** 「9月6日 15:04」のように。 */
export function formatLedgerAt(at: number): string {
  if (at <= 0) return '';
  const d = new Date(at + 9 * 3600_000);
  const mm = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mm}月${dd}日 ${hh}:${mi}`;
}
