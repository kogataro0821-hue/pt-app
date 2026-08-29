/**
 * 説明書に貼る画面写真を、実際のアプリを描画して撮る。
 *
 * 前提:
 *   1. python3 docs/manual/tools/make_photos.py
 *   2. python3 docs/manual/tools/make_seed.py
 *   3. npx vite build --config docs/manual/tools/vite.harness.config.mjs
 *   4. node docs/manual/tools/shoot.mjs
 *
 * 出力: docs/manual/img/*.png
 *
 * ★ 撮る対象はカードの見出しで指定します。
 *   画面全体をそのまま貼っても、縦に長すぎて誌面では読めません。
 *   見出しで切り出しておくと、画面の並びが変わっても撮り直しが効きます。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const ROOT = here('../out/dist');
const OUT = here('../img');
mkdirSync(OUT, { recursive: true });

if (!existsSync(ROOT)) {
  console.error(
    '確認用のビルドがありません。先に次を実行してください:\n' +
      '  npx vite build --config docs/manual/tools/vite.harness.config.mjs',
  );
  process.exit(1);
}

// Playwright はこのリポジトリの依存ではないので、入っている場所を探す
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

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/pt-app/')) p = p.slice('/pt-app'.length);
  let file = path.join(ROOT, p);
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'text/html' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(4599, r));
const BASE = 'http://127.0.0.1:4599/pt-app';

const launchOptions = {};
if (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')) {
  launchOptions.executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
}
const browser = await chromium.launch(launchOptions);

let failed = 0;

async function markCard(page, title, nth = 0) {
  const ok = await page.evaluate(
    ([t, n]) => {
      const cards = [...document.querySelectorAll('.card')].filter((c) => {
        const h = c.querySelector('.card-title');
        return h !== null && h.textContent.trim() === t;
      });
      const el = cards[n];
      if (el === undefined) return false;
      el.id = '__shot';
      return true;
    },
    [title, nth],
  );
  if (!ok) throw new Error(`カードが見つかりません: ${title} #${nth}`);
  return '#__shot';
}

async function markMeal(page, nth) {
  const ok = await page.evaluate((n) => {
    const el = document.querySelectorAll('.card.meal')[n];
    if (el === undefined) return false;
    el.id = '__shot';
    return true;
  }, nth);
  if (!ok) throw new Error(`食事カードがありません #${nth}`);
  return '#__shot';
}

async function markSel(page, sel) {
  const ok = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el === null) return false;
    el.id = '__shot';
    return true;
  }, sel);
  if (!ok) throw new Error(`見つかりません: ${sel}`);
  return '#__shot';
}

async function shot(name, url, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 414, height: opts.height ?? 900 },
    deviceScaleFactor: 2,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(opts.wait ?? 700);
    if (opts.act) await opts.act(page);

    // 遅延読み込みの画像を確実に読ませる。
    // 空欄のまま撮ってしまうと、あとから見ても気づけない。
    await page.evaluate(async () => {
      for (const img of document.querySelectorAll('img')) img.loading = 'eager';
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 250));
      window.scrollTo(0, 0);
      await Promise.all(
        [...document.querySelectorAll('img')].map((i) =>
          i.complete
            ? null
            : new Promise((r) => {
                i.onload = r;
                i.onerror = r;
              }),
        ),
      );
    });
    await page.waitForTimeout(opts.after ?? 300);

    let sel = null;
    if (opts.card) sel = await markCard(page, opts.card, opts.nth ?? 0);
    else if (opts.meal !== undefined) sel = await markMeal(page, opts.meal);
    else if (opts.sel) sel = await markSel(page, opts.sel);

    if (sel === null) {
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    } else {
      // 追従するヘッダーが切り抜きの真ん中に写り込むので、切り出すときだけ外す
      await page.addStyleTag({
        content:
          '.appbar,.appbar-nav,.viewing-bar{position:static !important;display:none !important}',
      });
      await page.waitForTimeout(150);
      await page.locator(sel).screenshot({ path: `${OUT}/${name}.png` });
    }

    if (errors.length > 0) {
      failed += 1;
      console.log(`  !! ${name}: ${errors[0]}`);
    } else {
      console.log(`  ok ${name}`);
    }
  } catch (e) {
    failed += 1;
    console.log(`  XX ${name}: ${e.message}`);
  }
  await ctx.close();
}

const C = '/c/tanaka01';
const DAY = `${C}/d/2026-08-28`;

// ============ 契約者 ============
await shot('login', '/?as=out');
await shot('first-password', '/?as=new');
await shot('cal', `${C}/m/2026-08`);
await shot('cal-warn', `${C}/m/2026-08`, { sel: '.notice' });
await shot('weight', `${C}/weight`);
await shot('day-full', DAY);

await shot('day-body', DAY, { card: 'からだ' });
await shot('day-meal', DAY, { meal: 0 });
await shot('day-pending', DAY, { meal: 1 });
await shot('day-totals', DAY, { card: 'この日の合計' });
await shot('day-photos', DAY, { card: '写真' });
await shot('day-exercise', DAY, { card: '運動' });
await shot('day-note', DAY, { card: 'トレーナーのコメント' });
await shot('day-review', DAY, { card: 'AIの評価' });
await shot('day-finalize', DAY, { card: '1日を確定する' });
await shot('entry-buttons', DAY, { sel: '.add-actions' });

await shot('item-form', DAY, {
  sel: '.item-form',
  act: async (p) => {
    await p.getByRole('button', { name: '+ 食材', exact: true }).first().click();
    await p.waitForTimeout(200);
    await p.getByLabel('食材の名前').fill('サラダチキン');
    await p.getByLabel('食べた量（g）').fill('110');
    await p.waitForTimeout(400);
  },
});

await shot('panel-text', DAY, {
  sel: '.ai-panel',
  act: async (p) => {
    await p.getByRole('button', { name: '文章から' }).first().click();
    await p.waitForTimeout(200);
    await p.locator('textarea').first().fill('白米180gと鶏むね肉150g、ブロッコリー少し');
  },
});

await shot('panel-text-result', DAY, {
  sel: '.ai-panel',
  act: async (p) => {
    await p.getByRole('button', { name: '文章から' }).first().click();
    await p.waitForTimeout(200);
    await p.locator('textarea').first().fill('白米180gと鶏むね肉150g、ブロッコリー少し');
    await p.getByRole('button', { name: 'AIに分解してもらう' }).click();
    await p.waitForTimeout(800);
  },
});

await shot('panel-photo', DAY, {
  sel: '.ai-panel',
  act: async (p) => {
    await p.getByRole('button', { name: '写真から' }).first().click();
    await p.waitForTimeout(300);
  },
});

await shot('panel-label', DAY, {
  sel: '.ai-panel',
  act: async (p) => {
    await p.getByRole('button', { name: '成分表示から' }).first().click();
    await p.waitForTimeout(300);
  },
});

await shot('ai-consent', `${C}/settings`, { card: 'AIの利用' });
await shot('ai-consent-detail', `${C}/settings`, {
  card: 'AIの利用',
  act: async (p) => {
    const b = p.getByRole('button', { name: 'AIの利用について読む' });
    if ((await b.count()) > 0) await b.click();
    await p.waitForTimeout(300);
  },
});

// ============ 管理者 ============
await shot('adm-clients', '/clients?as=admin');
await shot('adm-client-new', '/clients/new?as=admin');
await shot('adm-basic', '/clients/tanaka01/settings?as=admin', { card: '基本情報' });
await shot('adm-target', '/clients/tanaka01/settings?as=admin', { card: '目標' });
await shot('adm-tone', '/clients/tanaka01/settings?as=admin', { card: 'AI評価のトーン' });
await shot('adm-can', '/clients/tanaka01/settings?as=admin', { card: 'できること' });
await shot('adm-account', '/clients/tanaka01/settings?as=admin', { card: 'アカウント' });

await shot('adm-foods', '/foods?as=admin');
await shot('adm-food-editor', '/foods?as=admin', {
  card: '食材を編集する',
  act: async (p) => {
    await p.getByRole('button', { name: '編集' }).first().click();
    await p.waitForTimeout(400);
  },
});

await shot('adm-requests', '/foods/requests?as=admin');
await shot('adm-request-open', '/foods/requests?as=admin', {
  act: async (p) => {
    await p.getByRole('button', { name: '対応する' }).first().click();
    await p.waitForTimeout(500);
  },
});

await shot('adm-check', `${DAY}?as=admin`, { card: 'トレーナーの確認' });
await shot('adm-check-confirm', `${DAY}?as=admin`, {
  card: '確認しますか？',
  act: async (p) => {
    await p.getByRole('button', { name: '確認しました' }).click();
    await p.waitForTimeout(400);
  },
});
await shot('adm-note', `${DAY}?as=admin`, { card: 'トレーナーのコメント' });

await browser.close();
server.close();

// ★ 失敗を静かに見逃さない。
//   1枚欠けたまま組んでも、PDFになるまで気づけません。
if (failed > 0) {
  console.error(`\n${failed}枚が撮れていません。画面の文言が変わっていないか確認してください。`);
  process.exit(1);
}
console.log('\nすべて撮れました。次: python3 docs/manual/tools/finish_images.py');
