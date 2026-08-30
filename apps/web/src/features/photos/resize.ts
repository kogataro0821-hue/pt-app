/**
 * 写真の縮小（設計書 §4.3 / §7.4）。
 *
 * ★ なぜ縮小が必須なのか
 *
 *   このアプリは Cloud Storage を使いません（カード登録が必要になるため）。
 *   そこで写真は base64 にして Firestore のドキュメントへ直接入れます。
 *
 *   ところが Firestore の1ドキュメントは **1MiB まで**という上限があります。
 *   さらに base64 にすると、元のデータの約 1.37 倍に膨らみます。
 *
 *   スマホで撮った写真はそのままだと 3〜5MB あるので、100% 入りません。
 *   縮小は「あったほうがいい」ではなく、無いと動かない処理です。
 *
 *   Security Rules 側でも 400,000 バイトの上限をかけています。
 *   ここを通り抜けても、あちらで拒否されます。
 */

/**
 * Rules と揃える上限（base64 文字列の長さ）。
 *
 * ★ Rules 側は `dataUrl.size() < 400000` です。**未満**なので、
 *   ちょうど 400,000 は拒否されます。こちらも「未満」で判定します。
 *   ここを `<=` にすると、境界の1枚だけが保存に失敗する
 *   （そして原因が分かりにくい）不具合になります。
 */
export const MAX_DATA_URL_BYTES = 400_000;

/** 長辺の最大画素数。食事の内容が判別できれば十分なので、控えめにする。 */
const MAX_EDGE = 1280;

/** 画質を落としていく段階。上から順に試す。 */
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.4] as const;

/** さらに小さくする必要があるときの、長辺の縮め方。 */
const EDGE_STEPS = [MAX_EDGE, 1024, 800, 640] as const;

/**
 * 成分表示を読み取るときの長辺（追加仕様: 読み取りの待ち時間）。
 *
 * ★ 食事の写真より小さくしています。
 *
 *   成分表示は「数字が読めればよい」だけで、盛り付けの様子は要りません。
 *   1000px あれば、パッケージ裏の表を撮った写真の数字は読めます。
 *
 *   小さくすると、送る量も AI が見る量も減り、**待ち時間が短くなります。**
 *   管理者があとで見比べる写真も少し粗くなりますが、
 *   数字が読める粗さは保ちます。
 */
export const LABEL_MAX_EDGE = 1000;

export interface ResizedPhoto {
  /** `data:image/jpeg;base64,...` 形式 */
  dataUrl: string;
  width: number;
  height: number;
  /** 保存されるおおよそのバイト数 */
  bytes: number;
}

export type PhotoError = 'notImage' | 'tooLarge' | 'decodeFailed' | 'unsupported';

export class PhotoResizeError extends Error {
  constructor(readonly kind: PhotoError) {
    super(kind);
    this.name = 'PhotoResizeError';
  }
}

export function photoErrorMessage(kind: PhotoError): string {
  switch (kind) {
    case 'notImage':
      return '画像ファイルを選んでください。';
    case 'decodeFailed':
      return 'この画像を読み込めませんでした。別の写真でお試しください。';
    case 'tooLarge':
      return '縮小しても大きすぎました。別の写真でお試しください。';
    case 'unsupported':
      return 'お使いのブラウザでは写真の処理ができません。';
  }
}

/**
 * 画像ファイルを、保存できる大きさの JPEG に縮小する。
 *
 * 手順:
 *   1. 長辺 1280px に収まるよう縮める
 *   2. 画質を 0.82 から段階的に落として、上限に収まるか試す
 *   3. それでも収まらなければ、長辺をさらに縮めて 2 をやり直す
 *
 * ★ 透過は失われます（JPEG のため）。食事の写真なので問題になりません。
 *   PNG のまま保存すると、写真では JPEG の 3〜5 倍の大きさになります。
 */
export async function resizePhoto(
  file: File,
  /** 長辺の上限。省略すると食事の写真と同じ（1280px） */
  maxEdge: number = MAX_EDGE,
): Promise<ResizedPhoto> {
  if (!file.type.startsWith('image/')) {
    throw new PhotoResizeError('notImage');
  }

  const bitmap = await loadImage(file);

  // 指定された長辺より大きい段階は飛ばします
  const steps = EDGE_STEPS.filter((e) => e <= maxEdge);
  const edges = steps.length > 0 ? steps : [maxEdge];

  try {
    for (const edge of edges) {
      const { canvas, width, height } = draw(bitmap, edge);

      for (const quality of QUALITY_STEPS) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const bytes = dataUrl.length;
        if (bytes < MAX_DATA_URL_BYTES) {
          return { dataUrl, width, height, bytes };
        }
      }
    }
  } finally {
    if ('close' in bitmap) bitmap.close();
  }

  throw new PhotoResizeError('tooLarge');
}

/**
 * ファイルを画像として読み込む。
 *
 * createImageBitmap は EXIF の回転情報を反映してくれるので優先します
 * （縦で撮った写真が横向きに保存される事故を防ぐため）。
 * 使えない環境では <img> で読み込みます。
 */
async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // 古い Safari など。下の方法へ落とす
    }
  }

  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PhotoResizeError('decodeFailed'));
    };
    img.src = url;
  });
}

function draw(
  source: ImageBitmap | HTMLImageElement,
  maxEdge: number,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const sw = 'width' in source ? source.width : 0;
  const sh = 'height' in source ? source.height : 0;
  if (sw === 0 || sh === 0) throw new PhotoResizeError('decodeFailed');

  const ratio = Math.min(1, maxEdge / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * ratio));
  const height = Math.max(1, Math.round(sh * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new PhotoResizeError('unsupported');

  // 白で塗ってから描く。透過PNGを JPEG にすると、塗らない場合に黒くなるため。
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  return { canvas, width, height };
}

/** 「約120KB」のような表示。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}バイト`;
  if (bytes < 1024 * 1024) return `約${Math.round(bytes / 1024)}KB`;
  return `約${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
