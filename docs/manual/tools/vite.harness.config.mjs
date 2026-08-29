import { fileURLToPath, URL } from 'node:url';
import { existsSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * 説明書の画面写真を撮るためだけのビルド設定（製品には使いません）。
 *
 * ★ アプリ本体のファイルは1行も書き換えません。
 *
 *   Firebase と AI の呼び出しだけを、この設定の中で偽物に差し替えます。
 *   本体を書き換えて撮ると、戻し忘れたまま公開してしまう危険があるためです。
 *
 * 使い方（リポジトリの一番上で）:
 *   npx vite build --config docs/manual/tools/vite.harness.config.mjs
 */

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const WEB = here('../../../apps/web');

// ★ 架空のデータは作られるもので、リポジトリには入れていません。
//   無いまま進むと「./seed.js が見つからない」という分かりにくい形で失敗するので、
//   ここで止めて、何をすればよいかを出します。
if (!existsSync(here('stubs/seed.js'))) {
  console.error(
    '\n架空のデータ（tools/stubs/seed.js）がありません。先に次の2つを実行してください:\n' +
      '  python3 docs/manual/tools/make_photos.py\n' +
      '  python3 docs/manual/tools/make_seed.py\n',
  );
  process.exit(1);
}
const GEMINI = here('../../../apps/web/src/features/ai/gemini.ts');

/**
 * AI の呼び出し口を偽物に差し替える。
 *
 * '@/features/ai/gemini' と './gemini' の両方の書き方で参照されているので、
 * 文字列ではなく「解決した先のファイル」で判定します。
 */
function stubGemini() {
  return {
    name: 'stub-gemini',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (importer === undefined) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved !== null && resolved.id === GEMINI) return here('stubs/gemini.js');
      return null;
    },
  };
}

export default defineConfig({
  root: WEB,
  base: '/pt-app/',
  plugins: [react(), stubGemini()],
  resolve: {
    alias: {
      'firebase/app': here('stubs/firebase-app.js'),
      'firebase/auth': here('stubs/firebase-auth.js'),
      'firebase/firestore': here('stubs/firebase-firestore.js'),
      '@': WEB + '/src',
      '@pt/core': here('../../../packages/core/src/index.ts'),
      '@pt/ai-contract': here('../../../packages/ai-contract/src/index.ts'),
    },
  },
  define: {
    // AI のボタンを画面に出すために、中継役のURLが入っている状態にする
    'import.meta.env.VITE_AI_RELAY_URL': JSON.stringify('https://example.invalid/ai'),
  },
  build: { outDir: here('../out/dist'), emptyOutDir: true, sourcemap: false },
});
