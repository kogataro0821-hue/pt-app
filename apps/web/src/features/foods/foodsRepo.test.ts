import { foodKey, toInternal } from '@pt/core';
import { describe, expect, it } from 'vitest';
import { aFood } from '@/test/factories';
import { emptyFood, foodPer100gInternal, hasNutrition, newFoodId } from './foodsRepo';

describe('newFoodId', () => {
  it('名前から照合キーを作る', () => {
    expect(newFoodId('白米')).toBe(foodKey('白米'));
  });

  it('表記がゆれても同じIDになる（同じ食材が2件できない）', () => {
    expect(newFoodId('サラダ チキン')).toBe(newFoodId('サラダチキン'));
  });

  it('キーが作れない名前でも、必ず何かのIDを返す', () => {
    // 空のIDで保存しようとすると Firestore が受け付けず、
    // 「保存を押しても何も起きない」状態になります
    expect(newFoodId('###').length).toBeGreaterThan(0);
    expect(newFoodId('').length).toBeGreaterThan(0);
  });
});

describe('hasNutrition', () => {
  it('4つとも0なら「未設定」とみなす', () => {
    expect(hasNutrition(emptyFood('白米'))).toBe(false);
  });

  it('どれか1つでも入っていれば設定済み', () => {
    expect(hasNutrition(aFood({ per100g: { kcal: 156, p: 0, f: 0, c: 0 } }))).toBe(true);
    expect(hasNutrition(aFood({ per100g: { kcal: 0, p: 0, f: 0, c: 37.1 } }))).toBe(true);
  });

  it('水のように本当に0kcalの食材は「未設定」になる', () => {
    // いまの作りではここを区別できません。困ったときに気づけるよう、
    // 仕様として書き残しておきます（登録依頼として上がり直すだけで、害はありません）
    expect(hasNutrition(aFood({ name: '水', per100g: { kcal: 0, p: 0, f: 0, c: 0 } }))).toBe(false);
  });
});

describe('emptyFood', () => {
  it('栄養値は0、別名なしで始まる', () => {
    const f = emptyFood('白米');
    expect(f.name).toBe('白米');
    expect(f.per100g).toEqual({ kcal: 0, p: 0, f: 0, c: 0 });
    expect(f.aliases).toEqual([]);
  });
});

describe('foodPer100gInternal', () => {
  it('人間の単位を、内部の1/1000単位に直す', () => {
    const n = foodPer100gInternal(aFood({ per100g: { kcal: 156, p: 2.5, f: 0.3, c: 37.1 } }));
    expect(n).toEqual(toInternal({ kcal: 156, p: 2.5, f: 0.3, c: 37.1 }));
    expect(n.kcal).toBe(156_000);
  });

  it('小数の値でも、足し算で誤差が出ない整数になる', () => {
    // 0.1 + 0.2 が 0.30000000000000004 になる問題を避けるための作りです
    const n = foodPer100gInternal(aFood({ per100g: { kcal: 0.1, p: 0.2, f: 0, c: 0 } }));
    expect(Number.isInteger(n.kcal)).toBe(true);
    expect(Number.isInteger(n.p)).toBe(true);
  });
});
