/**
 * HTML の説明書を PDF にする。
 *
 *   node docs/manual/tools/topdf.mjs
 *
 * 出力: docs/manual/pdf/*.pdf
 *
 * ★ 日本語のフォントは埋め込まれます（Noto Sans CJK JP）。
 *   フォントが入っていない環境で作ると、豆腐（□）だらけの PDF ができます。
 *   下で足りているか確かめてから作ります。
 */
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
mkdirSync(here('../pdf'), { recursive: true });

const require = createRequire(import.meta.url);
let chromium;
for (const id of [
  'playwright',
  '/home/claude/.npm-global/lib/node_modules/playwright/index.js',
  '@playwright/test',
]) {
  try {
    ({ chromium } = require(id));
    break;
  } catch {
    /* 次を試す */
  }
}
if (chromium === undefined) {
  console.error('Playwright が見つかりません。 npm i -g playwright を実行してください。');
  process.exit(1);
}

const launchOptions = {};
if (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')) {
  launchOptions.executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
}
const browser = await chromium.launch(launchOptions);

const BOOKS = [
  ['client.html', 'PT-Manager-使い方ガイド-契約者用.pdf', '契約者用'],
  ['admin.html', 'PT-Manager-運用ガイド-管理者用.pdf', '管理者用'],
];

let bad = 0;

for (const [src, out, footer] of BOOKS) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  await page.goto('file://' + here('../' + src), { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // ★ 読めなかった画像がないか、作る前に確かめる。
  //   PDF になってから気づくと、どの章のものか探すのに時間がかかります。
  const missing = await page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .filter((i) => i.naturalWidth === 0)
      .map((i) => i.getAttribute('src')),
  );

  await page.pdf({
    path: here('../pdf/' + out),
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-size:8pt;color:#8a8f80;font-family:sans-serif;' +
      'padding:0 16mm;display:flex;justify-content:space-between;">' +
      `<span>PT Manager ${footer}</span><span class="pageNumber"></span></div>`,
    margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
  });

  const ok = missing.length === 0 && errs.length === 0;
  if (!ok) bad += 1;
  console.log(
    `${out}\n  読めなかった画像: ${missing.length > 0 ? missing.join(', ') : 'なし'}` +
      `\n  エラー: ${errs.length > 0 ? errs.join(', ') : 'なし'}`,
  );
  await page.close();
}

await browser.close();

if (bad > 0) {
  console.error('\n問題があります。上の行を確認してください。');
  process.exit(1);
}
console.log('\nできました。docs/manual/pdf/ を見てください。');
