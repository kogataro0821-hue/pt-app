import { useCallback, useEffect, useRef, useState } from 'react';
import { greetingWithName, SHARD_UNIT } from '@pt/core';
import { ShardIcon } from './ShardIcon';

/**
 * その日ぶんのかけらが入ったときの演出（追加仕様: 導入の演出）。
 *
 * ★ 出るのは1日1回だけです。
 *
 *   かけらは1日1つしかたまりません。だから
 *   「受け取れた瞬間」に出すだけで、自然に1日1回になります。
 *   回数を数える仕掛けは要りません。
 *
 *   このアプリは1日に何度も開きます（朝昼晩の記録のため）。
 *   開くたびに演出が入ると、3日で「早く終われ」になります。
 *   記録アプリで入口が重いのは致命的です。
 *
 * ★ どこも塞ぎません。
 *
 *   裏の画面はもう出来上がっていて、これはその上に重なるだけです。
 *   **どこを触ってもすぐ消えます。** 消えるのを待たせません。
 *   放っておいても数秒で消えます。
 *
 * ★ 動きを減らす設定の端末では、そもそも出しません（PointsCard 側で判定）。
 *   画面いっぱいに動くものが出るのは、人によっては具合が悪くなります。
 *   受け取れた事実は札の数字に出ているので、演出は無くても困りません。
 */

/** 放っておいたときに消えるまで。 */
const AUTO_CLOSE_MS = 2800;

/** 消える動きのぶん。これを待ってから親に伝えます。 */
const LEAVE_MS = 260;

export function DailyShardIntro({
  name,
  gained,
  total,
  onClose,
}: {
  name: string;
  /** 増えた数 */
  gained: number;
  /** 増えたあとの残高 */
  total: number;
  onClose: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const closed = useRef(false);

  /**
   * ★ 親から渡された onClose を、そのまま useEffect の材料にしません。
   *
   *   親は毎回その場で関数を作って渡します（onClose={() => ...}）。
   *   材料にすると **描き直すたびにタイマーが張り直され**、
   *   いつまでも消えない、という形になりかねません。
   *   入れ物に置いて中身だけ差し替え、タイマーは1回だけ張ります。
   */
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  }, [onClose]);

  /** ★ 2回呼ばれても1回しか閉じません（連打とタイマーの競合） */
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    setLeaving(true);
    window.setTimeout(() => latestClose.current(), LEAVE_MS);
  }, []);

  // 放っておいても消えます。触り方が分からない人を閉じ込めないためです。
  useEffect(() => {
    const t = window.setTimeout(close, AUTO_CLOSE_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [close]);

  // ★ キーボードでも閉じられるようにします。
  //   閉じ方が1つしかないと、それが効かない人が詰みます。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') close();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);

  return (
    <div
      className={leaving ? 'shard-intro leaving' : 'shard-intro'}
      role="button"
      tabIndex={0}
      aria-label="閉じる"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') close();
      }}
    >
      {/* ★ 中身は「読み上げの対象」にしていません（aria-hidden）。
             受け取れたことは、裏の札が role="status" で伝えています。
             ここでも伝えると **二重に読み上げられます**。
             加えて、同じ役割の要素が2つあると検査でも取り違えます
             （実際に1件それで落ちました）。見せるのは目だけで足ります。 */}
      <div className="shard-intro-inner" aria-hidden="true">
        <p className="shard-intro-hello">{greetingWithName(name)}</p>

        {/* ★ 石が降ってきて、着いたところで光ります。
               降りながら光らせると、何が起きたのか読み取れません。
               落ちる → 着く → 光る、の順に見せます。 */}
        <div className="shard-intro-stone">
          <ShardIcon size="88px" />
        </div>

        <p className="shard-intro-gained">
          きょうのぶん +{gained.toLocaleString('ja-JP')} {SHARD_UNIT}
        </p>

        <p className="shard-intro-total">
          ぜんぶで {total.toLocaleString('ja-JP')} {SHARD_UNIT}
        </p>

        <p className="shard-intro-skip">どこでも触ると閉じます</p>
      </div>
    </div>
  );
}
