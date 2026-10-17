/**
 * これまでに入れた店名を覚えておく（追加仕様: 店名）。
 *
 * ★ この端末の中だけに置きます。
 *
 *   同じ店に何度も行くので、毎回打たせるのは手間なだけです。
 *   かといって、このためだけに Firestore を読み書きすると、
 *   食事を開くたびに通信が増えます。無料枠は食事の記録に使いたい。
 *
 *   店名は**打ち直せば済む**ものです。端末を変えたら候補が出ない、
 *   というのは許せる不便さだと判断しました。
 *   （記録そのものは Firestore に入っているので、消えません）
 *
 * ★ 読めなくても落ちません。
 *   プライベートモードなどでは保存できません。そのときは
 *   候補が出ないだけで、入力はふつうにできます。
 */

/** 覚えておく件数。多すぎると候補から探すほうが面倒になります。 */
const MAX_REMEMBERED = 20;

function key(clientId: string): string {
  return `pt-shops:${clientId}`;
}

export function rememberedShops(clientId: string): string[] {
  try {
    const raw = window.localStorage.getItem(key(clientId));
    if (raw === null) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

/**
 * 店名を覚える。
 *
 * ★ 新しいものが先頭に来ます。直近に行った店ほど、また行きます。
 */
export function rememberShop(clientId: string, shop: string): void {
  const name = shop.trim();
  if (name.length === 0) return;

  try {
    const next = [name, ...rememberedShops(clientId).filter((s) => s !== name)].slice(
      0,
      MAX_REMEMBERED,
    );
    window.localStorage.setItem(key(clientId), JSON.stringify(next));
  } catch {
    // 覚えられなくても、候補が出ないだけです
  }
}
