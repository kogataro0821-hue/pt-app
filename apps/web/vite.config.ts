import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * ホーム画面に追加して使う Web アプリ（PWA）としてビルドする設定。
 *
 * 契約者は Safari で URL を開き、共有ボタン →「ホーム画面に追加」するだけで
 * アプリとして使えるようになります。App Store の審査も年会費も不要です。
 *
 * 公開先は GitHub Pages です。URL は
 *     https://<GitHubのユーザー名>.github.io/pt-app/
 * のように、リポジトリ名がパスに付きます。そのため BASE を '/pt-app/' にしています。
 *
 * ★ 独自ドメインを使うようになったら BASE を '/' に変えてください。
 *   （それ以外に直す場所はありません）
 */
const BASE = '/pt-app/';

/**
 * 画面の隅に出す「版」の情報（追加仕様: 版の表示）。
 *
 * ★ これが無くて、実際に半日つぶしました。
 *
 *   パソコンでの確認手段が無いので、直したものが端末に届いているかを
 *   確かめる方法がありませんでした。「直したはずなのに直っていない」のか
 *   「まだ古いアプリが動いている」のかが、どうやっても区別できません。
 *   食品マスタの更新が届かない件を追いかけたとき、まさにここで止まりました。
 *
 * ★ 番号だけでは足りません。
 *
 *   ver 1.0.0 のような番号は人が決めるものなので、上げ忘れれば嘘になります。
 *   自動で必ず変わる**組み立てた時刻**と**コミット**を一緒に出します。
 *   コミットは GitHub の Actions の一覧に出ている文字列と同じなので、
 *   「あの緑のやつが、この端末に入っているか」がそのまま見比べられます。
 */
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version?: string };

const buildAt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).format(new Date());

// GitHub Actions が勝手に入れてくれます。手元で組み立てたときは空になります。
const commit = (process.env.GITHUB_SHA ?? '').slice(0, 7);

export default defineConfig({
  base: BASE,

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
    __BUILD_AT__: JSON.stringify(buildAt),
    __COMMIT__: JSON.stringify(commit),
  },

  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        // ★アプリ名はここと src/config/firebase.ts と index.html の3箇所。設計書 §5
        //   short_name は、ホーム画面でアイコンの真下に出る名前です（長いと省略されます）
        name: 'たろZAP',
        short_name: 'たろZAP',
        description: '食事・運動・体重を記録して、PFCを正確に管理するアプリ',
        lang: 'ja',
        // standalone にすると、ホーム画面から開いたときに Safari のバーが消えて
        // 普通のアプリのように全画面で表示されます
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        background_color: '#F3F5F2',
        theme_color: '#F3F5F2',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Firebase への通信はキャッシュしない。常に最新のデータを取りに行く
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/identitytoolkit\.googleapis\.com\/.*/,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@pt/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@pt/ai-contract': fileURLToPath(
        new URL('../../packages/ai-contract/src/index.ts', import.meta.url),
      ),
    },
  },

  server: {
    host: true,
    port: 5173,
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Firebase SDK はサイズが大きく、めったに変わりません。
        // 別ファイルに切り出しておくと、アプリを更新しても
        // 端末に残っているキャッシュがそのまま使え、再ダウンロードが減ります。
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
        },
      },
    },
  },
});
