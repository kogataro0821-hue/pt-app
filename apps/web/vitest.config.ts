import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * 画面のテスト設定（設計書 §16.1 / Phase 11）。
 *
 * ★ vite.config.ts とは別にしています。
 *
 *   本番のビルド設定には PWA の生成やチャンク分割が入っていて、
 *   テストには要らないものばかりです。混ぜると、テストを直したいだけのときに
 *   本番のビルドを壊す余地ができます。
 *
 * ★ 別名（@ / @pt/core）は本番と同じにしてあります。
 *   ここがずれると、テストでは通るのに本番で解決できない、という
 *   いちばん気づきにくい食い違いが起きます。
 */
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@pt/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@pt/ai-contract': fileURLToPath(
        new URL('../../packages/ai-contract/src/index.ts', import.meta.url),
      ),
    },
  },

  test: {
    // 画面を描いて確かめるので、ブラウザの代わりになる環境が要ります
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // 撮影用の道具や生成物は対象外
    exclude: ['node_modules/**', 'dist/**'],
  },
});
