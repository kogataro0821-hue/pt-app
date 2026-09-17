import { useCallback, useEffect, useRef } from 'react';
import { quoteOfDay, quoteToText, todayKey } from '@pt/core';
import { APP_NAME } from '@/config/firebase';
import { ShardIcon } from '@/features/points/ShardIcon';

/**
 * ログイン画面の前に1枚だけ出る画面（追加仕様: 導入の演出）。
 *
 * ★ 3行の言葉が、1行ずつ **にじみ出る** ように現れます。
 *
 *   上下に動かしていません。その場でぼけた状態から焦点が合い、
 *   濃くなっていきます。動かすと「出てきた」に見えますが、
 *   動かさないほうが「浮かび上がってきた」に見えます。
 *
 * ★ 出来上がるのを待たせません。
 *
 *   動いている途中でも、触ればすぐ進みます。
 *   「見終わるまで進めない」作りにすると、
 *   急いでログインしたい人の邪魔しかしません。
 *   2回目以降はとくにそうです。
 *
 * ★ 進み方が分からない人を、閉じ込めません。
 *
 *   「次へ進む」は最初から見えています。画面のどこを触っても、
 *   キーボードでも、放っておいても進めます。
 *   触り方が1つしかない全画面は、それが効かない人には行き止まりです。
 *
 * ★ この画面だけは、明暗の設定に関係なく濃紺です。
 *
 *   アプリの地色（明るい緑がかった白）とは別にしてあります。
 *   入口だけ世界が違うほうが、切り替わった感じが出ます。
 *   白文字を乗せる前提なので、明るい地色に変わると読めなくなります。
 *   だから色をここで固定しています。
 *
 * ★ ログアウトしているときにだけ出ます。
 *   ログインしたままの人には出ません。
 */

/**
 * 1行ずつの間隔。
 *
 * ★ ゆっくりにしてあります。
 *
 *   速いと「表示された」だけで終わります。
 *   1行ずつ読める間を置くことで、言葉として届きます。
 *   急いでいる人は途中で触れば進めるので、遅くしても邪魔になりません。
 */
const LINE_STEP_MS = 1400;

/** 1行が、にじみ出きるまで。 */
const LINE_FADE_MS = 1500;

/** 最初の1行が出はじめるまで。 */
const FIRST_DELAY_MS = 600;

/**
 * 放っておいたときに進むまで。
 *
 * ★ 出そろってから、さらに読む間を置いています。
 *   読んでいる途中で勝手に進むと不快です。
 *   あくまで「行き止まりにしない」ための逃げ道です。
 */
const AUTO_MS = FIRST_DELAY_MS + LINE_STEP_MS * 2 + LINE_FADE_MS + 6000;

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const quote = quoteOfDay(todayKey());
  const done = useRef(false);

  const go = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  // ★ 動きを減らす設定の端末では、最初から出そろった状態にします。
  const calm =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const t = window.setTimeout(go, AUTO_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [go]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') go();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [go]);

  return (
    <div
      className={calm ? 'splash calm' : 'splash'}
      role="button"
      tabIndex={0}
      aria-label={`${quoteToText(quote)} 次へ進む`}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') go();
      }}
    >
      <div className="splash-inner" aria-hidden="true">
        {/* ★ アプリの顔を先に出します。
               言葉だけだと、何のアプリを開いたのか分かりません。 */}
        <div className="splash-badge">
          <span className="splash-badge-tile">
            <ShardIcon size="34px" />
          </span>
          <span className="splash-badge-name">{APP_NAME}</span>
        </div>

        {/* ★ 1行ずつ浮かび上がります。
               どこで切るかは言葉の側で決めてあります（core の QUOTES）。
               画面に折り返させると、切れ目が意味とずれます。 */}
        <p className="splash-quote">
          {quote.map((line, i) => (
            <span
              key={`${line}-${String(i)}`}
              className="splash-line"
              style={
                calm ? undefined : { animationDelay: `${String(FIRST_DELAY_MS + i * LINE_STEP_MS)}ms` }
              }
            >
              {line}
            </span>
          ))}
        </p>
      </div>

      {/* ★ 最初から出しておきます。
             出そろうまで隠す形も試しましたが、**急いでいる人には
             「まだ押せない」ように見える**ほうが不親切でした。
             ゆっくり読ませる演出なので、逃げ道は最初から見えている
             べきです。ボタンに見えますが、どこを触っても進みます。 */}
      <span className="splash-next" aria-hidden="true">
        次へ進む
      </span>
    </div>
  );
}
