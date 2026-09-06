import { SHARD_UNIT } from '@pt/core';

/**
 * タンパク質のかけら（追加仕様: ログインポイント）。
 *
 * ★ 画像ファイルではなく、その場で描いています。
 *
 *   - 拡大しても粗くなりません（会員証の横でも、交換画面の大きい表示でも同じ絵）
 *   - 読み込みが1回も増えません。通信が細いところでも欠けません
 *   - 色を後から変えられます
 *
 * ★ 細長い菱形。丸い石より「かけら」に見えます。
 *
 *   少し傾けてあります。まっすぐ立てると記号に見えて、
 *   割れた破片という感じが出ません。
 *
 * ★ 金色。中央のたて筋を境に、左右で濃さを変えています。
 *   光は左上から。同じ金色で塗ると、ただの菱形になります。
 *
 * ★ キラキラは、光の点で作っています。
 *
 *   石そのものを光らせようとすると、色が白く飛んで金色でなくなります。
 *   そこで石は濃いまま置いて、**上に小さな光を重ねます**。
 *   光は静かに瞬きます（動きを減らす設定の端末では止まります）。
 */
export function ShardIcon({ size = '1em' }: { size?: string }) {
  return (
    <svg
      className="shard-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {/* ★ 細長い菱形。上下がとがった「割れたかけら」の形です。
             丸い石より、こちらのほうが「かけら」に見えます。
             まっすぐ立てず少し傾けてあります。真っ直ぐだと記号に見えます。 */}

      {/* ★ 面は4つ。中央のたて筋を境に、左右で濃さを変えています。
             光は左上から当たっている想定です。
             同じ金色で塗ると、ただの菱形にしか見えません。 */}
      <polygon points="14,1.5 12,12 3,13" fill="#fffbe0" />
      <polygon points="12,12 10,22.5 3,13" fill="#f2d868" />
      <polygon points="14,1.5 21,11 12,12" fill="#f7d95e" />
      <polygon points="21,11 10,22.5 12,12" fill="#cf9c1a" />

      {/* ★ 中央のたて筋。面の色差だけだと、光の加減で消えることがあります。
             薄く 線を1本置いて、折れているのを確実に見せます。 */}
      <path d="M14 1.5 L12 12 L10 22.5" fill="none" stroke="#b8860b" strokeWidth="0.5" opacity="0.55" />

      {/* ★ 輪郭。金は明るいので、線がないと白い背景で溶けます。
             黒ではなく濃い琥珀にして、金色のまま締めます。 */}
      <polygon
        points="14,1.5 21,11 10,22.5 3,13"
        fill="none"
        stroke="#8a5a00"
        strokeWidth="1"
        strokeLinejoin="round"
      />

      {/* ★ 光の点。4方向にとがった形にしてあります。
             丸い点だと「汚れ」に見え、星形だと「光」に見えます。 */}
      <g className="shard-glints" fill="#ffffff">
        <path
          className="shard-glint shard-glint-a"
          d="M9.5 4.4 Q10.15 6.35 12.1 7 Q10.15 7.65 9.5 9.6 Q8.85 7.65 6.9 7 Q8.85 6.35 9.5 4.4 Z"
        />
        <path
          className="shard-glint shard-glint-b"
          d="M16 10.7 Q16.45 12.05 17.8 12.5 Q16.45 12.95 16 14.3 Q15.55 12.95 14.2 12.5 Q15.55 12.05 16 10.7 Z"
          opacity="0.85"
        />
        <path
          className="shard-glint shard-glint-c"
          d="M11 16.2 Q11.325 17.175 12.3 17.5 Q11.325 17.825 11 18.8 Q10.675 17.825 9.7 17.5 Q10.675 17.175 11 16.2 Z"
          opacity="0.7"
        />
      </g>
    </svg>
  );
}

/**
 * 「12 ◆」のように、数とかけらの絵を並べて出す。
 *
 * ★ 画面には数と絵だけを出し、読み上げには「12 かけら」と伝えます。
 *   絵だけだと、目で見えない人に何の数字か分かりません。
 */
export function Shards({
  n,
  size,
  className,
}: {
  n: number;
  size?: string;
  className?: string;
}) {
  return (
    <span
      className={className === undefined ? 'shards' : `shards ${className}`}
      aria-label={`${n.toLocaleString('ja-JP')} ${SHARD_UNIT}`}
    >
      <span className="shards-n">{n.toLocaleString('ja-JP')}</span>
      <ShardIcon size={size} />
    </span>
  );
}

/**
 * 「+3 ◆」「−5 ◆」のように、符号を付けて出す。
 */
export function ShardDelta({ delta }: { delta: number }) {
  const sign = delta < 0 ? '−' : '+';
  return (
    <span
      className={delta < 0 ? 'shards points-delta minus' : 'shards points-delta plus'}
      aria-label={`${sign}${Math.abs(delta).toLocaleString('ja-JP')} ${SHARD_UNIT}`}
    >
      <span className="shards-n">
        {sign}
        {Math.abs(delta).toLocaleString('ja-JP')}
      </span>
      <ShardIcon />
    </span>
  );
}
