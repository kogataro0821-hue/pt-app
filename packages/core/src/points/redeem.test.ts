import { describe, expect, it } from 'vitest';
import {
  afterRedeem,
  canAfford,
  isValidRedeem,
  MAX_REDEEM,
  MAX_REDEEM_TEXT,
  parseRedeem,
  readScannedRedeem,
  redeemUrl,
} from './redeem';

/**
 * かけらの交換（追加仕様: かけらの交換QR）。
 *
 * ★ 守りたいのは3つです。
 *
 *   1. おかしいQRでは交換画面を出さないこと
 *   2. 足りないのに交換できないこと
 *   3. QRのURLが、読んだとおりに戻ること
 */

describe('QRに入れるURL', () => {
  it('数と内容が入る', () => {
    const url = redeemUrl('https://example.github.io', '/pt-app/', {
      amount: 3,
      text: 'プロテイン1杯',
    });
    expect(url).toContain('https://example.github.io/pt-app/redeem?');
    expect(url).toContain('a=3');
  });

  it('★ 読み書きして、元に戻る', () => {
    // ★ ここがずれると、棚に貼ったQRが全部おかしな数になります
    const req = { amount: 30, text: 'タオル & ドリンク' };
    const url = redeemUrl('https://example.github.io', '/pt-app/', req);
    const back = parseRedeem(new URL(url).searchParams);
    expect(back).toEqual(req);
  });

  it('日本語も記号も、そのまま戻る', () => {
    const req = { amount: 1, text: '＋10分の延長／半額' };
    const url = redeemUrl('https://x.io', '/a/', req);
    expect(parseRedeem(new URL(url).searchParams)).toEqual(req);
  });

  it('置き場所の / が足りなくても、URLが壊れない', () => {
    const url = redeemUrl('https://x.io/', '/a', { amount: 1, text: 'x' });
    expect(url).toContain('https://x.io/a/redeem?');
  });
});

describe('★ おかしいQRは、交換画面を出さない', () => {
  const p = (s: string) => parseRedeem(new URLSearchParams(s));

  it('数が無い', () => {
    expect(p('t=%E3%83%97%E3%83%AD%E3%83%86%E3%82%A4%E3%83%B3')).toBeNull();
  });

  it('内容が無い', () => {
    expect(p('a=3')).toBeNull();
  });

  it('内容が空っぽ', () => {
    expect(p('a=3&t=')).toBeNull();
    expect(p('a=3&t=%20%20')).toBeNull();
  });

  it('★ 数が0やマイナス', () => {
    // ★ マイナスを通すと、QRを読むだけでかけらが増えます
    expect(p('a=0&t=x')).toBeNull();
    expect(p('a=-5&t=x')).toBeNull();
  });

  it('数が数字でない', () => {
    expect(p('a=たくさん&t=x')).toBeNull();
    expect(p('a=3.5&t=x')).toBeNull();
  });

  it('★ 桁が大きすぎる', () => {
    expect(p(`a=${MAX_REDEEM + 1}&t=x`)).toBeNull();
    expect(p(`a=${MAX_REDEEM}&t=x`)).not.toBeNull();
  });

  it('内容が長すぎる', () => {
    expect(p(`a=1&t=${'あ'.repeat(MAX_REDEEM_TEXT + 1)}`)).toBeNull();
  });

  it('前後の空白は落として読む', () => {
    expect(p('a=3&t=%20%E3%82%BF%E3%82%AA%E3%83%AB%20')?.text).toBe('タオル');
  });
});

describe('交換として成立するか', () => {
  it('ふつうの中身', () => {
    expect(isValidRedeem({ amount: 3, text: 'プロテイン' })).toBe(true);
  });

  it('境目ちょうど', () => {
    expect(isValidRedeem({ amount: 1, text: 'x' })).toBe(true);
    expect(isValidRedeem({ amount: MAX_REDEEM, text: 'x' })).toBe(true);
    expect(isValidRedeem({ amount: 0, text: 'x' })).toBe(false);
  });
});

describe('★ 足りるかどうか', () => {
  it('足りていれば交換できる', () => {
    expect(canAfford(5, 3)).toBe(true);
    expect(afterRedeem(5, 3)).toBe(2);
  });

  it('ちょうどでも交換できる', () => {
    expect(canAfford(3, 3)).toBe(true);
    expect(afterRedeem(3, 3)).toBe(0);
  });

  it('★ 足りなければ、引かない', () => {
    // ★ 0で止めたりもしません。「足りないのに交換できた」に見えるのが
    //   いちばんまずいためです
    expect(canAfford(2, 3)).toBe(false);
    expect(afterRedeem(2, 3)).toBeNull();
  });

  it('0の人は、何も交換できない', () => {
    expect(afterRedeem(0, 1)).toBeNull();
  });
});

describe('★ 読み取ったQRを、そのまま信じない', () => {
  const ORIGIN = 'https://example.github.io';
  const BASE = '/pt-app/';
  const read = (s: string) => readScannedRedeem(s, ORIGIN, BASE);

  it('自分のサイトの交換URLなら、読める', () => {
    const url = redeemUrl(ORIGIN, BASE, { amount: 3, text: 'プロテイン' });
    expect(read(url)).toEqual({ amount: 3, text: 'プロテイン' });
  });

  it('★ よそのサイトのURLは、通さない', () => {
    // ★ 誰でもQRは作れます。中身が正しい形でも、置き場所が違えば別物です
    expect(read('https://evil.example.com/pt-app/redeem?a=999&t=x')).toBeNull();
  });

  it('★ 同じサイトでも、交換以外のページは通さない', () => {
    expect(read(`${ORIGIN}${BASE}clients?a=3&t=x`)).toBeNull();
  });

  it('URLですらない文字列は、通さない', () => {
    expect(read('4901234567894')).toBeNull(); // 商品のバーコード
    expect(read('こんにちは')).toBeNull();
    expect(read('')).toBeNull();
  });

  it('Wi-Fi設定などの別の形式も、通さない', () => {
    expect(read('WIFI:S:MyHome;T:WPA;P:secret;;')).toBeNull();
  });

  it('自分のサイトでも、中身がおかしければ通さない', () => {
    expect(read(`${ORIGIN}${BASE}redeem?a=0&t=x`)).toBeNull();
    expect(read(`${ORIGIN}${BASE}redeem?a=-5&t=x`)).toBeNull();
    expect(read(`${ORIGIN}${BASE}redeem`)).toBeNull();
  });
});
