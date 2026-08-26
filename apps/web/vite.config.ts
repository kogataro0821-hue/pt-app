import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * ホーム画面に追加して使う Web アプリ（PWA）としてビルドする設定。
 *
 * 契約者は Safari で URL を開き、共有ボタン →「ホーム画面に追加」するだけで
 * アプリとして使えるようになります。App Store の審査も年会費も不要です。
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // アイコンなどビルド対象外のファイルもキャッシュに含める
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        // ★アプリ名はここと src/config/app.ts の2箇所。設計書 §5
        name: 'PT Manager',
        short_name: 'PT Manager',
        description: '食事・運動・体重を記録して、PFCを正確に管理するアプリ',
        lang: 'ja',
        // standalone にすると、ホーム画面から開いたときに Safari のバーが消えて
        // 普通のアプリのように全画面で表示されます
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
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
        // Firestore への通信はキャッシュしない。常に最新のデータを取りに行く
        navigateFallbackDenylist: [/^\/__/],
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
  },
});
