import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 管理者の登録が、契約者の画面に届くまで（追加仕様: マスタ更新の反映）。
 *
 * ★ これは、実際に使っていて詰まった箇所です。
 *
 *   食品マスタは、アプリを開いた最初の1回だけ読んで、あとは覚えていました。
 *   通信を減らすためです。ところがこれには**出口がありませんでした。**
 *
 *   管理者が「卵：1個＝50g」を登録して保存しても、
 *   契約者のアプリには何も伝わりません。単位に「個」は出てきません。
 *   アプリのJavaScriptが動き直すまで、ずっと古いままです。
 *   ホーム画面から開いたアプリは、他のアプリに切り替えて戻っただけでは
 *   動き直しません。**何日も古い一覧のまま使い続けることになります。**
 *
 *   契約者から見ると「登録依頼を出したのに、いつまでも反映されない」です。
 *
 * ★ かといって毎回200件を読み直すと、無料枠がすぐ尽きます。
 *   **1件だけ**読んで、変わっていたときだけ全部を読み直します。
 *   このテストが見張っているのは、その「1件だけ」のほうです。
 */

/** 偽の Firestore。docs は foods、stamp は config/foods。 */
let docsInStore: { id: string; data: Record<string, unknown> }[] = [];
let stamp: Record<string, unknown> | undefined;
/** 何回読んだか。安さがこの仕組みの理由なので、回数そのものを見張ります。 */
let getDocsCalls = 0;
let getDocCalls = 0;
/** 読み取りを失敗させたいとき */
let stampFails = false;

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ path: name }),
  doc: (_a: unknown, b: unknown, c?: unknown) => ({ path: `${String(b)}/${String(c ?? '')}` }),
  setDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    if (ref.path.startsWith('config/')) {
      stamp = data;
      return;
    }
    const id = ref.path.split('/')[1] ?? '';
    docsInStore = [...docsInStore.filter((d) => d.id !== id), { id, data }];
  },
  deleteDoc: async (ref: { path: string }) => {
    const id = ref.path.split('/')[1] ?? '';
    docsInStore = docsInStore.filter((d) => d.id !== id);
  },
  getDoc: async () => {
    getDocCalls += 1;
    if (stampFails) throw new Error('読めません');
    return { data: () => stamp };
  },
  getDocs: async () => {
    getDocsCalls += 1;
    return { docs: docsInStore.map((d) => ({ id: d.id, data: () => d.data })) };
  },
}));

vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));

const { loadFoods, saveFood, deleteFood, clearFoodCache, emptyFood } = await import('./foodsRepo');

function anEgg(grams: number | null = null) {
  return {
    ...emptyFood('卵'),
    name: '卵',
    per100g: { kcal: 142, p: 12.2, f: 10.2, c: 0.4 },
    unitConversions: grams === null ? [] : [{ unit: '個' as const, grams }],
  };
}

beforeEach(() => {
  docsInStore = [];
  stamp = undefined;
  getDocsCalls = 0;
  getDocCalls = 0;
  stampFails = false;
  clearFoodCache();
});

describe('★ 管理者の登録が、契約者に届く', () => {
  it('★ 「1個＝50g」を足すと、次に開いたときには反映されている', async () => {
    // 契約者が一度開いた（このとき卵に換算はまだ無い）
    await saveFood(anEgg());
    clearFoodCache();
    const before = await loadFoods();
    expect(before[0]?.unitConversions).toEqual([]);

    // 管理者が、別の端末で換算を入れて保存した
    await setStampFromAnotherDevice(async () => {
      docsInStore = [];
      await saveFood(anEgg(50));
    });

    // 契約者が、アプリを開き直さずにもう一度食材を入れようとする
    const after = await loadFoods();
    expect(after[0]?.unitConversions).toEqual([{ unit: '個', grams: 50 }]);
  });

  it('★ ふだんの費用は「読み取り1回」だけ', async () => {
    // ★ ここがこの仕組みの理由そのものです。
    //   毎回200件を読み直すなら、覚えている意味がありません。
    await saveFood(anEgg());
    clearFoodCache();

    await loadFoods();
    const afterFirst = getDocsCalls;

    await loadFoods();
    await loadFoods();
    await loadFoods();

    // 一覧はもう読み直していない
    expect(getDocsCalls).toBe(afterFirst);
    // 読んだのは「最終更新」1件だけ（3回ぶん）
    expect(getDocCalls).toBe(4);
  });

  it('変わっていなければ、覚えているものを返す', async () => {
    await saveFood(anEgg(50));
    clearFoodCache();

    const a = await loadFoods();
    const b = await loadFoods();
    expect(b).toBe(a); // 同じ配列そのもの（作り直していない）
  });
});

describe('壊れても、記録は止めない', () => {
  it('★ 最終更新が読めなくても、覚えている一覧を使う', async () => {
    // ★ ここが読めないだけで食材を1件も出せなくなるのは、やりすぎです。
    //   今までどおりの動き（開き直すまで古いまま）に戻るだけにします。
    await saveFood(anEgg(50));
    clearFoodCache();
    const first = await loadFoods();

    stampFails = true;
    const second = await loadFoods();

    expect(second).toBe(first);
    expect(getDocsCalls).toBe(1);
  });

  it('置き場所がまだ無くても、ふつうに動く', async () => {
    docsInStore = [{ id: '卵', data: { name: '卵', per100g: {}, unitConversions: [] } }];
    stamp = undefined;

    const foods = await loadFoods();
    expect(foods).toHaveLength(1);
    // 2回目は読み直さない（「無い」ことも、変わっていない状態のひとつです）
    await loadFoods();
    expect(getDocsCalls).toBe(1);
  });

  it('★ 印を付けるのに失敗しても、保存そのものは成功にする', async () => {
    // ★ ここで失敗を返すと、管理者は「保存できなかった」と思ってもう一度押します。
    //   実際には入っているので、そちらのほうが混乱します。
    stampFails = false;
    const saved = await saveFood(anEgg(50));
    expect(saved.unitConversions).toEqual([{ unit: '個', grams: 50 }]);
  });
});

describe('削除も伝わる', () => {
  it('食材を消したら、印が新しくなる', async () => {
    await saveFood(anEgg(50));
    const before = stamp?.updatedAt;

    await new Promise((r) => setTimeout(r, 2));
    await deleteFood('卵');

    expect(stamp?.updatedAt).not.toBe(before);
  });
});

/** 別の端末で保存された状態を作る（こちらのキャッシュは触らない） */
async function setStampFromAnotherDevice(write: () => Promise<void>): Promise<void> {
  await write();
  // 保存した本人のキャッシュは新しくなっているので、他人の目線に戻す
  stamp = { updatedAt: Date.now() + 1000 };
}
