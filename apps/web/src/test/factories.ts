import { ZERO, computeItemNutrients, toInternal, type MealItem, type Nutrients } from '@pt/core';
import { emptyClient, type Client } from '@/features/clients/clientTypes';
import type { Food } from '@/features/foods/foodsRepo';
import type { FoodRequest, LabelCandidate, RequestEntry } from '@/features/foods/requestsRepo';

/**
 * テスト用のダミーデータ。
 *
 * ★ 実在の契約者のデータは使いません。ここで作った架空のものだけです。
 *
 * ★ 「既定値＋必要なところだけ上書き」の形にしています。
 *   テストごとに全項目を書くと、そのテストが何を確かめたいのかが
 *   埋もれてしまいます。上書きした項目＝そのテストの主題、になるようにします。
 */

export function aClient(over: Partial<Client> = {}): Client {
  return {
    ...emptyClient('tanaka01'),
    displayName: '田中 花子',
    provisionStatus: 'ready',
    authUid: 'uid-tanaka',
    passwordChangedAt: 1_700_000_000_000,
    ...over,
  };
}

export function aFood(over: Partial<Food> = {}): Food {
  return {
    id: 'しろまい',
    name: '白米',
    aliases: ['ごはん'],
    per100g: { kcal: 156, p: 2.5, f: 0.3, c: 37.1 },
    unitConversions: [],
    note: '',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

/** 栄養値が決まっている食材1件（合計に入る） */
export function anItem(over: Partial<MealItem> = {}): MealItem {
  const per100g: Nutrients = toInternal({ kcal: 156, p: 2.5, f: 0.3, c: 37.1 });
  return {
    id: 'i1',
    name: '白米',
    grams: 100,
    per100g,
    nutrients: per100g,
    foodId: 'しろまい',
    pending: false,
    provisional: false,
    ...over,
  };
}

/** 栄養値がまだ決まっていない食材1件（合計に入らない） */
export function aPendingItem(over: Partial<MealItem> = {}): MealItem {
  return {
    id: 'i9',
    name: 'カップヌードル',
    grams: 77,
    per100g: ZERO,
    nutrients: ZERO,
    foodId: null,
    pending: true,
    provisional: false,
    ...over,
  };
}

/** 契約者が仮の値を入れた食材1件（合計に入るが「うち仮」として分かれる） */
export function aProvisionalItem(over: Partial<MealItem> = {}): MealItem {
  const per100g: Nutrients = toInternal({ kcal: 400, p: 20, f: 10, c: 50 });
  return {
    id: 'i8',
    name: 'ささみジャーキー',
    grams: 50,
    per100g,
    nutrients: computeItemNutrients(per100g, 50),
    foodId: null,
    pending: true,
    provisional: true,
    ...over,
  };
}

export function aCandidate(over: Partial<LabelCandidate> = {}): LabelCandidate {
  return {
    source: 'label',
    per100g: { kcal: 461.4, p: 10, f: 18.1, c: 65.3, fiber: 0, salt: 4.2 },
    note: '1食57gあたりの表示から換算しました。',
    // 1×1の透明な画像。中身は問わないので、いちばん短いもので足ります。
    photo:
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    ...over,
  };
}

export function anEntry(over: Partial<RequestEntry> = {}): RequestEntry {
  return {
    clientId: 'tanaka01',
    variant: 'カップヌードル',
    count: 2,
    dates: ['2026-08-26', '2026-08-28'],
    candidate: null,
    ...over,
  };
}

export function aRequest(over: Partial<FoodRequest> = {}): FoodRequest {
  const from = over.from ?? [anEntry()];
  return {
    id: 'かっぷぬーどる',
    name: 'カップヌードル',
    variants: ['カップヌードル'],
    count: from.reduce((n, e) => n + e.count, 0),
    updatedAt: 1_700_000_000_000,
    ...over,
    from,
  };
}
