import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rememberedShops, rememberShop } from './shopNames';

/**
 * これまでに入れた店名を覚えておく（追加仕様: 店名）。
 *
 * ★ この端末の中だけに置いています。
 *   店名は打ち直せば済むものなので、端末を変えたら候補が出ない、
 *   というのは許せる不便さだと判断しました。
 *   （記録そのものは Firestore にあるので消えません）
 */

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('覚える', () => {
  it('入れた店名が候補になる', () => {
    rememberShop('c1', '大戸屋');
    expect(rememberedShops('c1')).toEqual(['大戸屋']);
  });

  it('★ 新しいものが先に来る', () => {
    // ★ 直近に行った店ほど、また行きます
    rememberShop('c1', '大戸屋');
    rememberShop('c1', 'やよい軒');
    expect(rememberedShops('c1')).toEqual(['やよい軒', '大戸屋']);
  });

  it('同じ店は増えない（先頭に来るだけ）', () => {
    rememberShop('c1', '大戸屋');
    rememberShop('c1', 'やよい軒');
    rememberShop('c1', '大戸屋');
    expect(rememberedShops('c1')).toEqual(['大戸屋', 'やよい軒']);
  });

  it('空の店名は覚えない', () => {
    rememberShop('c1', '');
    rememberShop('c1', '   ');
    expect(rememberedShops('c1')).toEqual([]);
  });

  it('前後の空白は落とす', () => {
    rememberShop('c1', '  大戸屋  ');
    expect(rememberedShops('c1')).toEqual(['大戸屋']);
  });

  it('★ 契約者ごとに分かれている', () => {
    // ★ 1台を共有することは無いはずですが、混ざると気味が悪いです
    rememberShop('c1', '大戸屋');
    rememberShop('c2', 'やよい軒');
    expect(rememberedShops('c1')).toEqual(['大戸屋']);
    expect(rememberedShops('c2')).toEqual(['やよい軒']);
  });

  it('増えすぎない', () => {
    for (let i = 0; i < 30; i += 1) rememberShop('c1', `店${String(i)}`);
    expect(rememberedShops('c1')).toHaveLength(20);
    expect(rememberedShops('c1')[0]).toBe('店29');
  });
});

describe('★ 読めなくても落ちない', () => {
  it('何も入っていなければ空', () => {
    expect(rememberedShops('c1')).toEqual([]);
  });

  it('壊れたものが入っていても空', () => {
    window.localStorage.setItem('pt-shops:c1', 'これはJSONではありません');
    expect(rememberedShops('c1')).toEqual([]);
  });

  it('配列でないものが入っていても空', () => {
    window.localStorage.setItem('pt-shops:c1', '{"a":1}');
    expect(rememberedShops('c1')).toEqual([]);
  });

  it('文字でないものは混ぜない', () => {
    window.localStorage.setItem('pt-shops:c1', '["大戸屋", 5, null]');
    expect(rememberedShops('c1')).toEqual(['大戸屋']);
  });
});
