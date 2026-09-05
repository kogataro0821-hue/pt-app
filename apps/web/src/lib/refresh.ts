/**
 * アプリを、いま置いてある最新のものに入れ替える（追加仕様: 版の表示）。
 *
 * ★ ホーム画面から開いたアプリは、勝手には新しくなりません。
 *
 *   仕組みとしては自動で入れ替わることになっていますが、
 *   実際には「他のアプリに切り替えて戻った」だけでは動き直しません。
 *   端末に居座っている古い一式が、そのまま使われ続けます。
 *   直したものが届いているのかを確かめる術がないまま、
 *   「まだ直っていない」と何度もやりとりすることになります。
 *
 *   自分で押せるボタンを1つ用意して、そこを断ち切ります。
 *
 * ★ やることは3つです。順番に意味があります。
 *
 *     1. 居座っている一式（Service Worker）を外す
 *     2. その一式が抱えている保存（Cache）を捨てる
 *     3. 入口のファイルを、通信で取り直してから開き直す
 *
 *   1だけだと、保存されたファイルが残ったままです。
 *   2まででも、ブラウザ自身の保存から古い入口が返ることがあります。
 *   3で取り直して、ようやく最新になります。
 *
 * ★ ただし、これでも直らない場合が1つだけあります。
 *   GitHub Pages 側が、公開した直後の10分ほど前のファイルを返すことがあります。
 *   そのときは少し待って、もう一度押すしかありません。
 *   （こちらから制御できない部分です。画面にもそう書いてあります）
 */

/** どれも「無い環境」がありえます。無くても落とさず、できるところまでやります。 */
export async function refreshToLatest(): Promise<void> {
  await unregisterWorkers();
  await clearCaches();
  await refetchEntry();
  reload();
}

async function unregisterWorkers(): Promise<void> {
  try {
    const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (container === undefined) return;
    const registrations = await container.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  } catch {
    // 外せなくても、続けます（次の手が効くことがあります）
  }
}

async function clearCaches(): Promise<void> {
  try {
    const store = globalThis.caches as CacheStorage | undefined;
    if (store === undefined) return;
    const keys = await store.keys();
    await Promise.all(keys.map((k) => store.delete(k)));
  } catch {
    // 同上
  }
}

/**
 * 入口のファイルを、保存を無視して取り直す。
 *
 * ★ ここが無いと、開き直してもブラウザ自身の保存から
 *   古い入口が返ってきて、結局そのままになります。
 */
async function refetchEntry(): Promise<void> {
  try {
    await fetch(window.location.href, { cache: 'reload' });
  } catch {
    // 通信できなければ、そのまま開き直します
  }
}

function reload(): void {
  window.location.reload();
}
