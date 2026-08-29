import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * ★ 設計書 §16.7 の権限テスト。
 *
 * このアプリには Cloud Functions がないため、Security Rules が唯一の防衛線です。
 * ここが緑でない状態でアプリを公開してはいけません。
 *
 * 実行:
 *     npm run test:rules
 */

let env: RulesTestEnvironment;

/** 日付を 'yyyy-MM-dd' で作る（JST基準）。 */
function jstDate(offsetDays: number): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600_000 - offsetDays * 86_400_000);
  return jst.toISOString().slice(0, 10);
}

const TODAY = jstDate(0);
const YESTERDAY = jstDate(1);
const THREE_DAYS_AGO = jstDate(3);
const TEN_DAYS_AGO = jstDate(10);
/** 写真の保存期間（49日）より前。掃除の対象になる日 */
const FIFTY_DAYS_AGO = jstDate(50);
const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'pt-app-rules-test',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8'),
    },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();

  // Rules を迂回して初期データを作る（テストの前提づくり）
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, 'users/admin-uid'), {
      role: 'admin',
      clientId: null,
      active: true,
    });
    await setDoc(doc(db, 'users/alice-uid'), {
      role: 'client',
      clientId: 'alice',
      active: true,
    });
    await setDoc(doc(db, 'users/bob-uid'), {
      role: 'client',
      clientId: 'bob',
      active: true,
    });
    // 無効化された契約者（設計書 §6.6）
    await setDoc(doc(db, 'users/carol-uid'), {
      role: 'client',
      clientId: 'carol',
      active: false,
    });
    // 食品の自己登録を止められた契約者（設計書 §21）
    await setDoc(doc(db, 'users/dave-uid'), {
      role: 'client',
      clientId: 'dave',
      active: true,
    });
    // role が 'admin' でも 'client' でもないユーザー。
    // Firebase Auth に勝手に登録された人が、ここに当たります（isKnownUser の検証用）
    await setDoc(doc(db, 'users/mallory-uid'), {
      role: 'guest',
      clientId: null,
      active: true,
    });
    // 無効にされた管理者（isAdmin の active 判定の検証用）
    await setDoc(doc(db, 'users/exadmin-uid'), {
      role: 'admin',
      clientId: null,
      active: false,
    });
    // permissions を持たない、移行前のかたちの契約者（windowDays の検証用）
    await setDoc(doc(db, 'users/frank-uid'), {
      role: 'client',
      clientId: 'frank',
      active: true,
    });

    for (const cid of ['alice', 'bob', 'carol']) {
      await setDoc(doc(db, `clients/${cid}`), {
        displayName: cid,
        active: true,
        targets: { kcal: 1800, p: 130, f: 50, c: 200 },
        permissions: { pastEditWindowDays: 7 },
        reviewMode: 'standard',
      });
    }

    await setDoc(doc(db, 'clients/dave'), {
      displayName: 'dave',
      active: true,
      targets: { kcal: 1800, p: 130, f: 50, c: 200 },
      permissions: { pastEditWindowDays: 7, allowFoodCreate: false, allowRecipeCreate: false },
      reviewMode: 'standard',
    });

    // ★ permissions が無い、移行前のかたちの契約者。
    //   inWindow が日数を取り出せないので、日付に紐づく書き込みは通りません。
    await setDoc(doc(db, 'clients/frank'), {
      displayName: 'frank',
      active: true,
      targets: { kcal: 1800, p: 130, f: 50, c: 200 },
      reviewMode: 'standard',
    });

    // 確定済みの日（設計書 §7）
    //
    // 2種類を用意する。ウィンドウ内かどうかで、できることが変わるため。
    //   昨日      … 確定済み・編集ウィンドウの中（本人が解除できる）
    //   2026-01-15 … 確定済み・ウィンドウの外（本人には手が出せない）
    await setDoc(doc(db, `clients/alice/days/${YESTERDAY}`), {
      date: YESTERDAY,
      status: 'finalized',
      finalizedAt: 1,
      updatedAt: 1,
    });
    await setDoc(doc(db, `clients/alice/days/${YESTERDAY}/meals/m1`), { label: '1食目' });

    await setDoc(doc(db, 'clients/alice/days/2026-01-15'), { status: 'finalized' });
    await setDoc(doc(db, 'clients/alice/days/2026-01-15/meals/m1'), { label: '1食目' });

    await setDoc(doc(db, 'foods/common-1'), { name: '白米', scope: 'common' });
    await setDoc(doc(db, 'clients/alice/foods/f1'), { name: 'アリスの食品' });
    await setDoc(doc(db, 'config/app'), { appName: 'PT Manager' });
  });
});

const admin = () => env.authenticatedContext('admin-uid').firestore();
const alice = () => env.authenticatedContext('alice-uid').firestore();
const bob = () => env.authenticatedContext('bob-uid').firestore();
const carol = () => env.authenticatedContext('carol-uid').firestore();
const dave = () => env.authenticatedContext('dave-uid').firestore();
const guest = () => env.unauthenticatedContext().firestore();
/** role が 'admin' でも 'client' でもないユーザー */
const mallory = () => env.authenticatedContext('mallory-uid').firestore();
/** 無効にされた管理者 */
const exAdmin = () => env.authenticatedContext('exadmin-uid').firestore();
/** permissions を持たない、移行前のかたちの契約者 */
const frank = () => env.authenticatedContext('frank-uid').firestore();

/**
 * Rules を迂回して、そのテストだけの前提を1件つくる。
 *
 * ★ 共有のシードに足すと、既存のテストで create だったものが update になり、
 *   踏む分岐が変わってしまいます。テスト固有の前提はここで作ります。
 */
async function seed(path: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

// =============================================================================

describe('★ 契約者間のデータ分離（設計書 §2 の絶対要求）', () => {
  it('契約者A は自分のプロフィールを読める', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'clients/alice')));
  });

  it('契約者A は契約者B のプロフィールを読めない', async () => {
    await assertFails(getDoc(doc(alice(), 'clients/bob')));
  });

  it('契約者A は契約者B の食事を読めない', async () => {
    await assertFails(getDoc(doc(alice(), `clients/bob/days/${TODAY}/meals/m1`)));
  });

  it('契約者A は契約者B の食事を書き込めない', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/bob/days/${TODAY}/meals/m1`), { label: '侵入' }),
    );
  });

  it('契約者A は契約者B の食品マスタを読めない', async () => {
    await assertFails(getDoc(doc(alice(), 'clients/bob/foods/f1')));
  });

  it('契約者A は契約者B の体重記録を読めない', async () => {
    await assertFails(getDoc(doc(alice(), `clients/bob/measurements/${TODAY}`)));
  });

  it('契約者A は契約者B のAI会話履歴を読めない', async () => {
    await assertFails(getDoc(doc(alice(), 'clients/bob/aiSessions/s1')));
  });

  it('契約者A は契約者一覧を取得できない', async () => {
    await assertFails(getDocs(collection(alice(), 'clients')));
  });

  it('逆向きも同じ。契約者B は契約者A のデータを読めない', async () => {
    await assertFails(getDoc(doc(bob(), 'clients/alice')));
    await assertFails(getDoc(doc(bob(), `clients/alice/days/${TODAY}/meals/m1`)));
    await assertFails(getDoc(doc(bob(), 'clients/alice/foods/f1')));
  });

  it('契約者B は自分のデータなら読み書きできる', async () => {
    await assertSucceeds(getDoc(doc(bob(), 'clients/bob')));
    await assertSucceeds(
      setDoc(doc(bob(), `clients/bob/days/${TODAY}/meals/m1`), { label: '1食目' }),
    );
  });
});

describe('★ 権限の昇格ができないこと（設計書 §6.4）', () => {
  it('契約者は自分の users ドキュメントを読める', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'users/alice-uid')));
  });

  it('契約者は自分を管理者に昇格できない', async () => {
    await assertFails(
      setDoc(doc(alice(), 'users/alice-uid'), { role: 'admin', clientId: null, active: true }),
    );
  });

  it('契約者は自分の users ドキュメントを一切書き換えられない', async () => {
    await assertFails(
      setDoc(doc(alice(), 'users/alice-uid'), { role: 'client', clientId: 'alice', active: true }),
    );
  });

  it('契約者は他人の users ドキュメントを読めない', async () => {
    await assertFails(getDoc(doc(alice(), 'users/bob-uid')));
  });

  it('契約者は自分の clientId を書き換えて他人になりすませない', async () => {
    await assertFails(
      setDoc(doc(alice(), 'users/alice-uid'), { role: 'client', clientId: 'bob', active: true }),
    );
  });

  it('管理者は users を作成・更新できる', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), 'users/new-uid'), { role: 'client', clientId: 'dave', active: true }),
    );
  });
});

describe('★ 目標値と権限設定は契約者から触れない（設計書 §2）', () => {
  it('契約者は表示名とメモを更新できる', async () => {
    await assertSucceeds(
      setDoc(
        doc(alice(), 'clients/alice'),
        { displayName: '新しい名前', memo: 'メモ', updatedAt: 1 },
        { merge: true },
      ),
    );
  });

  // 初回パスワード変更の印は契約者自身が書く（設計書 §6.5）。
  // ここが書けないと、契約者はパスワード変更画面から永久に出られなくなる。
  it('契約者は自分の passwordChangedAt を書ける', async () => {
    await assertSucceeds(
      setDoc(
        doc(alice(), 'clients/alice'),
        { passwordChangedAt: 1700000000000, updatedAt: 1700000000000 },
        { merge: true },
      ),
    );
  });

  it('契約者は他人の passwordChangedAt を書けない', async () => {
    await assertFails(
      setDoc(doc(alice(), 'clients/bob'), { passwordChangedAt: 1 }, { merge: true }),
    );
  });

  it('契約者は自分の clients ドキュメントを読める（初回判定に必要）', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'clients/alice')));
  });

  it('契約者は目標カロリーを書き換えられない', async () => {
    await assertFails(
      setDoc(
        doc(alice(), 'clients/alice'),
        { targets: { kcal: 9999, p: 130, f: 50, c: 200 } },
        { merge: true },
      ),
    );
  });

  it('契約者は編集ウィンドウの日数を伸ばせない', async () => {
    await assertFails(
      setDoc(
        doc(alice(), 'clients/alice'),
        { permissions: { pastEditWindowDays: 3650 } },
        { merge: true },
      ),
    );
  });

  it('契約者は評価モードを変えられない', async () => {
    await assertFails(
      setDoc(doc(alice(), 'clients/alice'), { reviewMode: 'gentle' }, { merge: true }),
    );
  });

  it('管理者は目標値を変更できる', async () => {
    await assertSucceeds(
      setDoc(
        doc(admin(), 'clients/alice'),
        { targets: { kcal: 1700, p: 140, f: 45, c: 190 } },
        { merge: true },
      ),
    );
  });
});

describe('★ 過去編集ウィンドウ（設計書 §7.3 / 既定7日）', () => {
  it('今日の食事は書き込める', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/meals/m1`), { label: '1食目' }),
    );
  });

  it('3日前の食事は書き込める（ウィンドウ内）', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), `clients/alice/days/${THREE_DAYS_AGO}/meals/m1`), { label: '1食目' }),
    );
  });

  it('10日前の食事は書き込めない（ウィンドウ外）', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}/meals/m1`), { label: '1食目' }),
    );
  });

  it('ウィンドウ外でも読むことはできる（設計書 §2 「過去の日付を閲覧可能」）', async () => {
    await assertSucceeds(getDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}/meals/m1`)));
  });

  it('管理者はウィンドウに関係なく書き込める', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), `clients/alice/days/${TEN_DAYS_AGO}/meals/m1`), { label: '1食目' }),
    );
  });

  it('運動記録も同じウィンドウが適用される', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}/exercises/e1`), { name: 'ベンチ' }),
    );
  });

  it('メモも同じウィンドウが適用される', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}/notes/n1`), { text: 'メモ' }),
    );
  });

  // ---- Phase 5: 体重を日ドキュメントに置いたことによる追加 -------------------

  it('今日の体重は自分で書ける', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}`), { date: TODAY, weightKg: 62.4 }),
    );
  });

  it('10日前の体重は自分では書けない（ウィンドウ外）', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}`), {
        date: TEN_DAYS_AGO,
        weightKg: 62.4,
      }),
    );
  });

  it('10日前の体重も管理者なら書ける', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), `clients/alice/days/${TEN_DAYS_AGO}`), {
        date: TEN_DAYS_AGO,
        weightKg: 62.4,
      }),
    );
  });

  // measurements は日付がIDなので、days と同じ制限が要る。
  // ここが read/write 一括許可のままだと、何年前の体重でも書き換えられてしまう。
  it('measurements にも同じウィンドウが適用される', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), `clients/alice/measurements/${TODAY}`), { weightKg: 62.4 }),
    );
    await assertFails(
      setDoc(doc(alice(), `clients/alice/measurements/${TEN_DAYS_AGO}`), { weightKg: 62.4 }),
    );
    await assertSucceeds(getDoc(doc(alice(), `clients/alice/measurements/${TEN_DAYS_AGO}`)));
  });
});

describe('★ 食事の記録（設計書 §14 / Phase 6A）', () => {
  const meal = { order: 0, label: '1食目', items: [], totals: { kcal: 0, p: 0, f: 0, c: 0 } };

  it('契約者は今日の食事を書ける', async () => {
    await assertSucceeds(setDoc(doc(alice(), `clients/alice/days/${TODAY}/meals/m9`), meal));
  });

  it('契約者は自分の食事を一覧できる', async () => {
    await assertSucceeds(getDocs(collection(alice(), `clients/alice/days/${TODAY}/meals`)));
  });

  it('契約者は他人の食事を一覧できない', async () => {
    await assertFails(getDocs(collection(alice(), `clients/bob/days/${TODAY}/meals`)));
  });

  it('契約者は他人の食事を書けない', async () => {
    await assertFails(setDoc(doc(alice(), `clients/bob/days/${TODAY}/meals/m9`), meal));
  });

  it('契約者は食事を削除できる', async () => {
    await assertSucceeds(deleteDoc(doc(alice(), `clients/alice/days/${TODAY}/meals/m9`)));
  });

  it('10日前の食事は書けない（ウィンドウ外）', async () => {
    await assertFails(setDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}/meals/m9`), meal));
  });
});

describe('★ 食品マスタは共通の1本だけ（設計書 §21 / Phase 9）', () => {
  const food = { name: 'ゆで卵', per100g: { kcal: 142, p: 12.2, f: 10.2, c: 0.4 } };

  // ★ ここがこのアプリの数字の土台。
  //   契約者が自分で栄養値を決められる状態にすると、同じ「白米」が
  //   人によって 156kcal と 168kcal になり、指導の根拠にならなくなる。
  it('契約者は共通マスタに書けない', async () => {
    await assertFails(setDoc(doc(alice(), 'foods/common-2'), food));
  });

  it('契約者は共通マスタの値を書き換えられない', async () => {
    await assertFails(setDoc(doc(alice(), 'foods/common-1'), { name: '白米', per100g: { kcal: 9999 } }));
  });

  it('契約者は共通マスタを消せない', async () => {
    await assertFails(deleteDoc(doc(alice(), 'foods/common-1')));
  });

  it('契約者は共通マスタを読める（入力候補に使うため）', async () => {
    await assertSucceeds(getDocs(collection(alice(), 'foods')));
  });

  it('管理者は共通マスタに書ける', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'foods/common-2'), food));
  });

  // ★ 個人マスタは Phase 9 で廃止した。読み取りだけ残し、新規の書き込みは通さない。
  it('契約者は個人マスタに書けなくなった（廃止済み）', async () => {
    await assertFails(setDoc(doc(alice(), 'clients/alice/foods/new1'), food));
  });

  it('移行前のデータを管理者が整理できるよう、読み取りは残してある', async () => {
    await assertSucceeds(getDocs(collection(alice(), 'clients/alice/foods')));
    await assertSucceeds(setDoc(doc(admin(), 'clients/alice/foods/new1'), food));
  });

  it('契約者は他人の個人マスタを読めない', async () => {
    await assertFails(getDocs(collection(bob(), 'clients/alice/foods')));
  });

  // ★ allowFoodCreate という設定は Phase 9 で意味を失った。
  //   設定が残っている契約者でも、他の人と同じ扱いになることを確かめる。
  //   （設定の有無で挙動が変わると、あとから読む人が混乱する）
  it('allowFoodCreate の設定が残っていても、扱いは他の契約者と同じ', async () => {
    await assertFails(setDoc(doc(dave(), 'clients/dave/foods/new1'), food));
    await assertFails(setDoc(doc(dave(), 'foods/common-2'), food));
    await assertSucceeds(getDocs(collection(dave(), 'foods')));
  });
});

describe('★ AI評価（設計書 §26 / Phase 10）', () => {
  const review = { text: 'たんぱく質は目標に届いています。', mode: 'standard', by: 'alice-uid', createdAt: 1 };

  it('契約者は自分の評価を作れる', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/review/latest`), review),
    );
  });

  it('管理者も作れる', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), `clients/alice/days/${TODAY}/review/latest`), review),
    );
  });

  // ★ ここが要。評価は個人の記録に対する言葉なので、他人には届かない。
  it('契約者は他人の評価を読めない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clients/alice/days/${TODAY}/review/latest`), review);
    });
    await assertFails(getDoc(doc(bob(), `clients/alice/days/${TODAY}/review/latest`)));
  });

  it('契約者は他人の評価を作れない', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/bob/days/${TODAY}/review/latest`), review),
    );
  });

  // ★ 1日1件。履歴を溜めない（設計書 §8.2 の考え方）。
  it('latest 以外のIDでは作れない', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/review/r2`), review),
    );
  });

  it('長すぎる評価は保存できない', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/review/latest`), {
        ...review,
        text: 'あ'.repeat(1201),
      }),
    );
  });

  it('空の評価は保存できない', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/review/latest`), { ...review, text: '' }),
    );
  });

  it('決められた項目以外は書けない', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/review/latest`), {
        ...review,
        role: 'admin',
      }),
    );
  });

  // ★ 過去を振り返って評価をもらうのは自然な使い方なので、日付では縛らない。
  it('編集ウィンドウの外の日でも作れる', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}/review/latest`), review),
    );
  });

  it('本人も管理者も消せる', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/review/latest`), review),
    );
    await assertSucceeds(deleteDoc(doc(alice(), `clients/alice/days/${TODAY}/review/latest`)));
    await assertSucceeds(
      setDoc(doc(admin(), `clients/alice/days/${TODAY}/review/latest`), review),
    );
    await assertSucceeds(deleteDoc(doc(admin(), `clients/alice/days/${TODAY}/review/latest`)));
  });

  it('契約者は他人の評価を消せない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clients/alice/days/${TODAY}/review/latest`), review);
    });
    await assertFails(deleteDoc(doc(bob(), `clients/alice/days/${TODAY}/review/latest`)));
  });
});

describe('★ トレーナーのコメント（設計書 §11.3 A-8 / Phase 10）', () => {
  const note = { text: 'よく続いています。あと少しPを増やしましょう。', by: 'admin-uid', createdAt: 1, updatedAt: 1 };

  it('管理者はコメントを書ける', async () => {
    await assertSucceeds(setDoc(doc(admin(), `clients/alice/days/${TODAY}/notes/n1`), note));
  });

  // ★ ここが要。トレーナーが言ったことを契約者が書き換えられてはいけない。
  it('契約者はコメントを書けない', async () => {
    await assertFails(setDoc(doc(alice(), `clients/alice/days/${TODAY}/notes/n1`), note));
  });

  it('契約者はコメントを書き換えられない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clients/alice/days/${TODAY}/notes/n1`), note);
    });
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/notes/n1`), { ...note, text: '書き換え' }),
    );
  });

  it('契約者はコメントを消せない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clients/alice/days/${TODAY}/notes/n1`), note);
    });
    await assertFails(deleteDoc(doc(alice(), `clients/alice/days/${TODAY}/notes/n1`)));
  });

  it('契約者は自分あてのコメントを読める', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clients/alice/days/${TODAY}/notes/n1`), note);
    });
    await assertSucceeds(getDocs(collection(alice(), `clients/alice/days/${TODAY}/notes`)));
  });

  it('契約者は他人あてのコメントを読めない', async () => {
    await assertFails(getDocs(collection(bob(), `clients/alice/days/${TODAY}/notes`)));
  });

  // ★ 確定は「今日はもう食べません」という意思表示であって、
  //   トレーナーが黙る合図ではない。
  it('確定済みの日にも管理者は書ける', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), `clients/alice/days/${YESTERDAY}/notes/n1`), note),
    );
  });

  it('編集ウィンドウの外の日にも管理者は書ける', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), `clients/alice/days/${TEN_DAYS_AGO}/notes/n1`), note),
    );
  });

  it('管理者は自分のコメントを直せる・消せる', async () => {
    await assertSucceeds(setDoc(doc(admin(), `clients/alice/days/${TODAY}/notes/n1`), note));
    await assertSucceeds(
      setDoc(doc(admin(), `clients/alice/days/${TODAY}/notes/n1`), { ...note, text: '直しました' }),
    );
    await assertSucceeds(deleteDoc(doc(admin(), `clients/alice/days/${TODAY}/notes/n1`)));
  });

  it('空のコメントは書けない', async () => {
    await assertFails(
      setDoc(doc(admin(), `clients/alice/days/${TODAY}/notes/n1`), { ...note, text: '' }),
    );
  });

  it('長すぎるコメントは書けない', async () => {
    await assertFails(
      setDoc(doc(admin(), `clients/alice/days/${TODAY}/notes/n1`), {
        ...note,
        text: 'あ'.repeat(2001),
      }),
    );
  });

  it('決められた項目以外は書けない', async () => {
    await assertFails(
      setDoc(doc(admin(), `clients/alice/days/${TODAY}/notes/n1`), { ...note, role: 'admin' }),
    );
  });
});

describe('★ 食品の登録依頼（設計書 §21 / Phase 9）', () => {
  const parent = { name: 'サラダチキン', key: 'さらだちきん', updatedAt: 1 };
  const entry = { variant: 'サラダチキン', count: 1, dates: [TODAY], updatedAt: 1 };

  it('契約者は依頼を積める', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'foodRequests/さらだちきん'), parent));
    await assertSucceeds(
      setDoc(doc(alice(), 'foodRequests/さらだちきん/from/alice'), entry),
    );
  });

  // ★★ これを見落として、依頼がひとつも積まれない状態を作りました。
  //
  //   代表の表記を「読むときに選ぶ」形に変えたとき、
  //   コードは name を書かなくなったのに、ルールは name を必須のままにしていました。
  //   積めなかったことは画面に出ないので、原因が分かりませんでした。
  //   いま実際に書いている形（name 無し）を、ここで固定します。
  it('name を書かない形でも積める（いまのコードはこの形）', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'foodRequests/さらだちきん'), { key: 'さらだちきん', updatedAt: 1 }),
    );
  });

  it('name 無しで積んだあと、管理者が読める', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'foodRequests/さらだちきん'), { key: 'さらだちきん', updatedAt: 1 }),
    );
    await assertSucceeds(
      setDoc(doc(alice(), 'foodRequests/さらだちきん/from/alice'), entry),
    );
    await assertSucceeds(getDocs(collection(admin(), 'foodRequests')));
  });

  it('name を書くなら、空文字は通さない（移行前のデータの形）', async () => {
    await assertFails(
      setDoc(doc(alice(), 'foodRequests/さらだちきん'), {
        name: '',
        key: 'さらだちきん',
        updatedAt: 1,
      }),
    );
  });

  it('すでにある依頼にも積める（別の人が同じ食材を使ったとき）', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'foodRequests/さらだちきん'), parent));
    await assertSucceeds(setDoc(doc(bob(), 'foodRequests/さらだちきん'), parent));
    await assertSucceeds(setDoc(doc(bob(), 'foodRequests/さらだちきん/from/bob'), entry));
  });

  // ★★ ここが今回いちばん重要なテスト。
  //
  //   依頼を1つのドキュメントにまとめて clientIds の配列を持たせると、
  //   配列に自分を足すために契約者がそれを読める必要が出る。
  //   読めるということは、他の契約者が何を食べたかを推測できるということ。
  //   だから「書けるが読めない」形にしてある。
  it('契約者は依頼を読めない（他人が何を食べたか推測できてはいけない）', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'foodRequests/さらだちきん'), parent);
      await setDoc(doc(ctx.firestore(), 'foodRequests/さらだちきん/from/bob'), entry);
    });

    await assertFails(getDoc(doc(alice(), 'foodRequests/さらだちきん')));
    await assertFails(getDocs(collection(alice(), 'foodRequests')));
  });

  it('契約者は他人が積んだ1件も読めない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'foodRequests/さらだちきん/from/bob'), entry);
    });

    await assertFails(getDoc(doc(alice(), 'foodRequests/さらだちきん/from/bob')));
    await assertFails(getDocs(collection(alice(), 'foodRequests/さらだちきん/from')));
  });

  it('契約者は他人になりすまして積めない', async () => {
    await assertFails(setDoc(doc(alice(), 'foodRequests/さらだちきん/from/bob'), entry));
  });

  it('契約者は自分が積んだ1件だけは読める', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'foodRequests/さらだちきん/from/alice'), entry));
    await assertSucceeds(getDoc(doc(alice(), 'foodRequests/さらだちきん/from/alice')));
  });

  it('契約者は依頼を消せない（管理者の作業を消せてはいけない）', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'foodRequests/さらだちきん'), parent);
    });
    await assertFails(deleteDoc(doc(alice(), 'foodRequests/さらだちきん')));
  });

  it('管理者は依頼を読んで消せる', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'foodRequests/さらだちきん'), parent);
      await setDoc(doc(ctx.firestore(), 'foodRequests/さらだちきん/from/alice'), entry);
    });

    await assertSucceeds(getDocs(collection(admin(), 'foodRequests')));
    await assertSucceeds(getDocs(collection(admin(), 'foodRequests/さらだちきん/from')));
    await assertSucceeds(deleteDoc(doc(admin(), 'foodRequests/さらだちきん/from/alice')));
    await assertSucceeds(deleteDoc(doc(admin(), 'foodRequests/さらだちきん')));
  });

  // ★ ここは契約者が自由に文字を入れられる数少ない場所。
  //   長大な文字列や余計な項目で管理者の画面を壊されないようにしておく。
  it('決められた項目以外は書けない', async () => {
    await assertFails(
      setDoc(doc(alice(), 'foodRequests/さらだちきん'), { ...parent, role: 'admin' }),
    );
    await assertFails(
      setDoc(doc(alice(), 'foodRequests/さらだちきん/from/alice'), { ...entry, clientId: 'bob' }),
    );
  });

  // ---- 成分表示から読み取った候補（追加仕様: 成分表示の読み取り）--------------------------------

  const candidate = {
    ...entry,
    candidatePer100g: { kcal: 461.4, p: 11.6, f: 19.6, c: 59.6 },
    candidateNote: '1回分(57g)当たり',
  };

  it('契約者は成分表示の候補を添えられる', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'foodRequests/さらだちきん/from/alice'), candidate),
    );
  });

  // ★ 数字だけでは、受け取った管理者が確かめられない。
  //   参考値のほうを拾っていても気づけないので、写真も一緒に送る。
  it('成分表示の写真も一緒に送れる', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'foodRequests/さらだちきん/from/alice'), {
        ...candidate,
        candidatePhoto: 'data:image/jpeg;base64,' + 'A'.repeat(1000),
      }),
    );
  });

  it('大きすぎる写真は送れない', async () => {
    await assertFails(
      setDoc(doc(alice(), 'foodRequests/さらだちきん/from/alice'), {
        ...candidate,
        candidatePhoto: 'A'.repeat(400_000),
      }),
    );
  });

  it('契約者は他人の依頼に添えられた写真を読めない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'foodRequests/さらだちきん/from/bob'), {
        ...candidate,
        candidatePhoto: 'data:image/jpeg;base64,AAAA',
      });
    });
    await assertFails(getDoc(doc(alice(), 'foodRequests/さらだちきん/from/bob')));
  });

  it('候補が文字列などおかしな形なら書けない', async () => {
    await assertFails(
      setDoc(doc(alice(), 'foodRequests/さらだちきん/from/alice'), {
        ...entry,
        candidatePer100g: 'たくさん',
      }),
    );
  });

  it('候補の説明が長すぎると書けない', async () => {
    await assertFails(
      setDoc(doc(alice(), 'foodRequests/さらだちきん/from/alice'), {
        ...candidate,
        candidateNote: 'あ'.repeat(201),
      }),
    );
  });

  // ★ 候補はあくまで候補。ここから直接マスタへ入る経路は無い。
  it('候補を書けても、共通マスタには書けないまま', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'foodRequests/さらだちきん/from/alice'), candidate),
    );
    await assertFails(
      setDoc(doc(alice(), 'foods/さらだちきん'), {
        name: 'サラダチキン',
        per100g: candidate.candidatePer100g,
      }),
    );
  });

  it('長すぎる名前は書けない', async () => {
    await assertFails(
      setDoc(doc(alice(), 'foodRequests/さらだちきん'), { ...parent, name: 'あ'.repeat(61) }),
    );
  });

  it('空の名前は書けない', async () => {
    await assertFails(setDoc(doc(alice(), 'foodRequests/さらだちきん'), { ...parent, name: '' }));
  });

  it('IDと合わない key は書けない（別の依頼に化けさせない）', async () => {
    await assertFails(
      setDoc(doc(alice(), 'foodRequests/さらだちきん'), { ...parent, key: 'べつのもの' }),
    );
  });

  it('無効化された契約者は積めない', async () => {
    await assertFails(setDoc(doc(carol(), 'foodRequests/さらだちきん'), parent));
  });

  it('ログインしていなければ積めない', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(anon, 'foodRequests/さらだちきん'), parent));
  });
});

describe('★ 一括置き換えの変更履歴（設計書 §19 / Phase 9）', () => {
  const audit = {
    type: 'food-bulk-replace',
    foodId: 'torimune',
    foodName: '鶏むね肉',
    requestKey: '鶏むね肉',
    dates: [TODAY],
    by: 'admin-uid',
    at: 1,
  };

  it('管理者は変更履歴を残せる', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'clients/alice/audits/a1'), audit));
  });

  // ★ 履歴は追記のみ。書き換えられたら履歴の意味がない。
  it('管理者でも履歴は書き換えられない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'clients/alice/audits/a1'), audit);
    });
    await assertFails(setDoc(doc(admin(), 'clients/alice/audits/a1'), { ...audit, at: 2 }));
    await assertFails(deleteDoc(doc(admin(), 'clients/alice/audits/a1')));
  });

  it('契約者は他人の履歴を読めない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'clients/alice/audits/a1'), audit);
    });
    await assertFails(getDoc(doc(bob(), 'clients/alice/audits/a1')));
  });
});

describe('★ カレンダー（月まとめ取得）の分離（設計書 §6）', () => {
  it('契約者は自分の月ぶんの日データを一覧できる', async () => {
    await assertSucceeds(getDocs(collection(alice(), 'clients/alice/days')));
  });

  it('契約者は他人の日データを一覧できない', async () => {
    await assertFails(getDocs(collection(alice(), 'clients/bob/days')));
  });

  it('契約者は他人の体重を書き込めない', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/bob/days/${TODAY}`), { date: TODAY, weightKg: 99 }),
    );
  });

  it('管理者は全員分の日データを一覧できる', async () => {
    await assertSucceeds(getDocs(collection(admin(), 'clients/alice/days')));
    await assertSucceeds(getDocs(collection(admin(), 'clients/bob/days')));
  });
});

describe('★ 1日確定の解除（設計書 §7 / Q14）', () => {
  // 確定は「トレーナーへの提出」ではなく本人の意思表示なので、
  // 本人がカギを外して書き直せる。ただし外せるのは status だけ。
  it('契約者は自分で確定を解除できる（ウィンドウ内）', async () => {
    await assertSucceeds(
      setDoc(
        doc(alice(), `clients/alice/days/${YESTERDAY}`),
        { status: 'open', finalizedAt: null, updatedAt: 2 },
        { merge: true },
      ),
    );
  });

  // 解除も編集の一種なので、ウィンドウの外までは戻れない。
  it('ウィンドウ外の確定は、本人でも解除できない', async () => {
    await assertFails(
      setDoc(
        doc(alice(), 'clients/alice/days/2026-01-15'),
        { status: 'open', finalizedAt: null, updatedAt: 2 },
        { merge: true },
      ),
    );
  });

  it('確定したまま中身を書き換える経路は無い', async () => {
    await assertFails(
      setDoc(
        doc(alice(), `clients/alice/days/${YESTERDAY}`),
        { status: 'finalized', weightKg: 99, updatedAt: 2 },
        { merge: true },
      ),
    );
  });

  it('解除にみせかけて他の項目も同時に書き換えることはできない', async () => {
    await assertFails(
      setDoc(
        doc(alice(), `clients/alice/days/${YESTERDAY}`),
        { status: 'open', weightKg: 99, updatedAt: 2 },
        { merge: true },
      ),
    );
  });

  it('他人の確定は解除できない', async () => {
    await assertFails(
      setDoc(
        doc(bob(), `clients/alice/days/${YESTERDAY}`),
        { status: 'open', finalizedAt: null, updatedAt: 2 },
        { merge: true },
      ),
    );
  });

  it('管理者は確定を解除できる', async () => {
    await assertSucceeds(
      setDoc(
        doc(admin(), 'clients/alice/days/2026-01-15'),
        { status: 'open', finalizedAt: null, updatedAt: 1 },
        { merge: true },
      ),
    );
  });

  it('契約者は今日を確定できる', async () => {
    await assertSucceeds(
      setDoc(
        doc(alice(), `clients/alice/days/${TODAY}`),
        { date: TODAY, status: 'finalized', finalizedAt: 1, updatedAt: 1 },
        { merge: true },
      ),
    );
  });
});

describe('★ 運動の記録（設計書 §22 / Phase 6B）', () => {
  const ex = { order: 0, name: 'ベンチプレス', minutes: 45, detail: '60kg 10回 3セット' };

  it('契約者は今日の運動を書ける', async () => {
    await assertSucceeds(setDoc(doc(alice(), `clients/alice/days/${TODAY}/exercises/e9`), ex));
  });

  it('契約者は他人の運動を書けない', async () => {
    await assertFails(setDoc(doc(alice(), `clients/bob/days/${TODAY}/exercises/e9`), ex));
  });

  it('契約者は他人の運動を一覧できない', async () => {
    await assertFails(getDocs(collection(alice(), `clients/bob/days/${TODAY}/exercises`)));
  });

  it('10日前の運動は書けない（ウィンドウ外）', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}/exercises/e9`), ex),
    );
  });
});

describe('★ 1日確定（finalized）の保護（設計書 §7）', () => {
  it('確定済みの日は、契約者が食事を書き換えられない', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${YESTERDAY}/meals/m1`), { label: '変更' }),
    );
  });

  // ★ ウィンドウ内かどうかに関わらず、確定済みなら書けないこと。
  //   「昨日は編集できる期間だから」という理由で通ってはいけない。
  it('確定済みなら、ウィンドウ内でも体重を書き換えられない', async () => {
    await assertFails(
      setDoc(
        doc(alice(), `clients/alice/days/${YESTERDAY}`),
        { weightKg: 99, updatedAt: 2 },
        { merge: true },
      ),
    );
  });

  it('確定済みの日でも、管理者は書き換えられる', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), `clients/alice/days/${YESTERDAY}/meals/m1`), { label: '変更' }),
    );
  });

  it('確定済みの日でも、契約者は読める', async () => {
    await assertSucceeds(getDoc(doc(alice(), `clients/alice/days/${YESTERDAY}/meals/m1`)));
  });
});

describe('★ トレーナーの確認と写真の保存期間（設計書 §8.2 / 追加仕様: 写真の保存期間）', () => {
  const small = 'data:image/jpeg;base64,' + 'A'.repeat(1000);

  /** n日前に撮られた写真を、Rules を迂回して置く */
  async function seedPhoto(date: string, id: string, agoDays: number) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clients/alice/days/${date}/photos/${id}`), {
        dataUrl: small,
        createdAt: Date.now() - agoDays * DAY_MS,
      });
    });
  }

  // ---- 確認済み（管理者だけ） ---------------------------------------------

  it('管理者は確認済みにできる', async () => {
    await assertSucceeds(
      setDoc(
        doc(admin(), `clients/alice/days/${TODAY}`),
        { checkedAt: Date.now(), checkedBy: 'admin-uid' },
        { merge: true },
      ),
    );
  });

  // ★ ここが要。契約者が自分で確認済みにできると、
  //   「トレーナーが見たか」の記録にならない。
  it('契約者は確認済みにできない', async () => {
    await assertFails(
      setDoc(
        doc(alice(), `clients/alice/days/${TODAY}`),
        { checkedAt: Date.now(), checkedBy: 'alice-uid' },
        { merge: true },
      ),
    );
  });

  it('契約者は確認済みを取り消せない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clients/alice/days/${TODAY}`), {
        date: TODAY,
        checkedAt: 1,
        checkedBy: 'admin-uid',
      });
    });
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}`), { checkedAt: null }, { merge: true }),
    );
  });

  it('確認済みを触らない書き込みは、契約者も今までどおりできる', async () => {
    await assertSucceeds(
      setDoc(
        doc(alice(), `clients/alice/days/${TODAY}`),
        { date: TODAY, weightKg: 62.5 },
        { merge: true },
      ),
    );
  });

  it('管理者は確認済みを取り消せる', async () => {
    await assertSucceeds(
      setDoc(
        doc(admin(), `clients/alice/days/${TODAY}`),
        { checkedAt: null, checkedBy: null },
        { merge: true },
      ),
    );
  });

  // ---- 写真の削除 -----------------------------------------------------------

  it('管理者はいつの写真でも消せる（確認したとき）', async () => {
    await seedPhoto(FIFTY_DAYS_AGO, 'p1', 50);
    await assertSucceeds(
      deleteDoc(doc(admin(), `clients/alice/days/${FIFTY_DAYS_AGO}/photos/p1`)));
  });

  it('契約者は期間内の自分の写真を消せる', async () => {
    await seedPhoto(TODAY, 'p1', 0);
    await assertSucceeds(deleteDoc(doc(alice(), `clients/alice/days/${TODAY}/photos/p1`)));
  });

  // ★ 掃除は「画面を開いた人」がやる。Cloud Functions が使えないため。
  //   7週間前は編集ウィンドウ（7日）の外なので、期限切れという理由が要る。
  it('契約者は期限切れ（49日超）の写真なら、ウィンドウ外でも消せる', async () => {
    await seedPhoto(FIFTY_DAYS_AGO, 'p2', 50);
    await assertSucceeds(
      deleteDoc(doc(alice(), `clients/alice/days/${FIFTY_DAYS_AGO}/photos/p2`)));
  });

  // ★ 「古いから何でも消せる」にしてはいけない。
  //   期限前の写真は、ウィンドウ外なら本人でも消せない。
  it('契約者は期限前（10日前）の写真を、ウィンドウ外では消せない', async () => {
    await seedPhoto(TEN_DAYS_AGO, 'p3', 10);
    await assertFails(
      deleteDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}/photos/p3`)));
  });

  it('撮影時刻が壊れている写真は、ウィンドウ外では消せない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clients/alice/days/${TEN_DAYS_AGO}/photos/p4`), {
        dataUrl: small,
      });
    });
    await assertFails(
      deleteDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}/photos/p4`)));
  });

  it('契約者は他人の期限切れ写真は消せない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clients/bob/days/${FIFTY_DAYS_AGO}/photos/p5`), {
        dataUrl: small,
        createdAt: Date.now() - 50 * DAY_MS,
      });
    });
    await assertFails(
      deleteDoc(doc(alice(), `clients/bob/days/${FIFTY_DAYS_AGO}/photos/p5`)));
  });

  // ---- 掃除したあとの印 -----------------------------------------------------

  // ★ これが通らないと、写真を消したあとも
  //   「もうすぐ消える写真があります」が出続ける。
  it('契約者はウィンドウ外の日でも photoOldestAt だけは直せる', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clients/alice/days/${FIFTY_DAYS_AGO}`), {
        date: FIFTY_DAYS_AGO,
        photoOldestAt: 1,
      });
    });
    await assertSucceeds(
      setDoc(
        doc(alice(), `clients/alice/days/${FIFTY_DAYS_AGO}`),
        { date: FIFTY_DAYS_AGO, photoOldestAt: null, updatedAt: Date.now() },
        { merge: true },
      ),
    );
  });

  it('その抜け道で、ほかの項目までは書き換えられない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clients/alice/days/${FIFTY_DAYS_AGO}`), {
        date: FIFTY_DAYS_AGO,
        photoOldestAt: 1,
        weightKg: 62,
      });
    });
    await assertFails(
      setDoc(
        doc(alice(), `clients/alice/days/${FIFTY_DAYS_AGO}`),
        { photoOldestAt: null, weightKg: 55 },
        { merge: true },
      ),
    );
    await assertFails(
      setDoc(
        doc(alice(), `clients/alice/days/${FIFTY_DAYS_AGO}`),
        { photoOldestAt: null, checkedAt: 1 },
        { merge: true },
      ),
    );
  });
});

describe('★ 写真のサイズ制限（設計書 §7.4）', () => {
  const small = 'data:image/jpeg;base64,' + 'A'.repeat(100_000);
  const huge = 'data:image/jpeg;base64,' + 'A'.repeat(500_000);

  it('通常サイズの写真は保存できる', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/photos/p1`), {
        dataUrl: small,
        createdAt: 1,
      }),
    );
  });

  // ★ ちょうど境界のあたりを確認する。
  //   アプリ側の縮小は 400,000 バイト以内に収めるので、そこが通ることが要。
  it('上限ぎりぎり（399,999バイト）は通る', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/photos/pEdge`), {
        dataUrl: 'A'.repeat(399_999),
        createdAt: 1,
      }),
    );
  });

  it('上限ちょうど（400,000バイト）は拒否される', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/photos/pEdge2`), {
        dataUrl: 'A'.repeat(400_000),
        createdAt: 1,
      }),
    );
  });

  it('契約者は他人の写真を保存できない', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/bob/days/${TODAY}/photos/p9`), {
        dataUrl: small,
        createdAt: 1,
      }),
    );
  });

  it('契約者は他人の写真を一覧できない', async () => {
    await assertFails(getDocs(collection(alice(), `clients/bob/days/${TODAY}/photos`)));
  });

  it('管理者は契約者の写真を見られる', async () => {
    await assertSucceeds(getDocs(collection(admin(), `clients/alice/days/${TODAY}/photos`)));
  });

  it('確定済みの日には写真を足せない', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${YESTERDAY}/photos/p9`), {
        dataUrl: small,
        createdAt: 1,
      }),
    );
  });

  it('400KBを超える写真は拒否される（無料枠を食い潰されないため）', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/photos/p2`), {
        dataUrl: huge,
        createdAt: 1,
      }),
    );
  });

  it('写真は上書きできない（消して撮り直す）', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clients/alice/days/${TODAY}/photos/p3`), {
        dataUrl: small,
      });
    });
    await assertFails(
      setDoc(
        doc(alice(), `clients/alice/days/${TODAY}/photos/p3`),
        { dataUrl: small, note: 'x' },
        { merge: true },
      ),
    );
  });
});

describe('★ 共通マスタ（設計書 §21）', () => {
  it('契約者は共通食品を読める', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'foods/common-1')));
  });

  it('契約者は共通食品を書き換えられない', async () => {
    await assertFails(setDoc(doc(alice(), 'foods/common-1'), { name: '改ざん' }));
  });

  it('管理者は共通食品を登録できる', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'foods/common-2'), { name: '玄米' }));
  });

  it('契約者はアプリ設定を書き換えられない', async () => {
    await assertFails(setDoc(doc(alice(), 'config/app'), { appName: '改ざん' }));
  });
});

describe('★ 変更履歴は追記のみ（設計書 §19）', () => {
  it('契約者は履歴を追加できる', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'clients/alice/audits/a1'), { action: 'update', at: 1 }),
    );
  });

  it('追加した履歴を書き換えられない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'clients/alice/audits/a2'), { action: 'update' });
    });
    await assertFails(
      setDoc(doc(alice(), 'clients/alice/audits/a2'), { action: '改ざん' }, { merge: true }),
    );
  });

  it('管理者でも履歴を削除できない', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'clients/alice/audits/a3'), { action: 'update' });
    });
    await assertFails(deleteDoc(doc(admin(), 'clients/alice/audits/a3')));
  });

  it('履歴を読めるのは管理者だけ', async () => {
    await assertFails(getDocs(collection(alice(), 'clients/alice/audits')));
    await assertSucceeds(getDocs(collection(admin(), 'clients/alice/audits')));
  });
});

describe('★ 無効化された契約者（設計書 §6.6）', () => {
  it('無効化された契約者は自分のデータも読めない', async () => {
    await assertFails(getDoc(doc(carol(), 'clients/carol')));
  });

  it('無効化された契約者は書き込めない', async () => {
    await assertFails(
      setDoc(doc(carol(), `clients/carol/days/${TODAY}/meals/m1`), { label: '1食目' }),
    );
  });
});

describe('★ 未認証は全拒否', () => {
  it('ログインせずに契約者データを読めない', async () => {
    await assertFails(getDoc(doc(guest(), 'clients/alice')));
  });

  it('ログインせずに共通食品を読めない', async () => {
    await assertFails(getDoc(doc(guest(), 'foods/common-1')));
  });

  it('ログインせずに users を読めない', async () => {
    await assertFails(getDoc(doc(guest(), 'users/alice-uid')));
  });

  it('ログインせずに書き込めない', async () => {
    await assertFails(setDoc(doc(guest(), 'clients/alice'), { displayName: '侵入' }));
  });

  it('users ドキュメントが無いユーザーは何もできない', async () => {
    const stranger = env.authenticatedContext('unknown-uid').firestore();
    await assertFails(getDoc(doc(stranger, 'clients/alice')));
    await assertFails(getDoc(doc(stranger, 'foods/common-1')));
  });
});

describe('★ 管理者は全契約者にアクセスできる（設計書 §2）', () => {
  it('全契約者のプロフィールを読める', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'clients/alice')));
    await assertSucceeds(getDoc(doc(admin(), 'clients/bob')));
  });

  it('契約者一覧を取得できる', async () => {
    await assertSucceeds(getDocs(collection(admin(), 'clients')));
  });

  it('どの契約者の食事も追加・編集できる', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), `clients/bob/days/${TODAY}/meals/m1`), { label: '1食目' }),
    );
  });

  it('契約者を作成・削除できる', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'clients/dave'), { displayName: 'Dave' }));
    await assertSucceeds(deleteDoc(doc(admin(), 'clients/dave')));
  });
});

describe('動作の健全性チェック', () => {
  it('テスト用の日付が正しい形式になっている', () => {
    expect(TODAY).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(TEN_DAYS_AGO < THREE_DAYS_AGO).toBe(true);
    expect(THREE_DAYS_AGO < TODAY).toBe(true);
  });
});

// =============================================================================
// Phase 11B — 分岐の網羅
//
// ★ ここから下は、既存のテストが踏んでいなかった分岐を埋めるものです。
//
//   161件あっても「全部見た」ことにはなりません。
//   ルールを1行ずつ数えたところ、テストが1件も無い match ブロックが
//   5つありました（recipes / favorites / aiSessions の messages /
//   共通レシピ / 既定の全拒否）。
//   そこは、壊しても誰も気づけない状態でした。
// =============================================================================

describe('★ テストが1件も無かった場所 — 契約者間の分離', () => {
  // -------------------------------------------------------------------------
  // お気に入り。日付に紐づかないので、ウィンドウも確定状態も効きません。
  // 守っているのは canRead(cid) の1本だけです。
  // -------------------------------------------------------------------------
  describe('お気に入り（favorites）', () => {
    it('契約者は自分のお気に入りを読み書きできる', async () => {
      await assertSucceeds(getDoc(doc(alice(), 'clients/alice/favorites/f1')));
      await assertSucceeds(setDoc(doc(alice(), 'clients/alice/favorites/f1'), { name: '朝の定番' }));
    });

    it('契約者は他人のお気に入りを読めない', async () => {
      await seed('clients/alice/favorites/f1', { name: '朝の定番' });
      await assertFails(getDoc(doc(bob(), 'clients/alice/favorites/f1')));
      await assertFails(getDocs(collection(bob(), 'clients/alice/favorites')));
    });

    it('契約者は他人のお気に入りを書き換えられない', async () => {
      await assertFails(setDoc(doc(bob(), 'clients/alice/favorites/f1'), { name: '乗っ取り' }));
    });

    it('契約者は他人のお気に入りを消せない', async () => {
      await seed('clients/alice/favorites/f1', { name: '朝の定番' });
      await assertFails(deleteDoc(doc(bob(), 'clients/alice/favorites/f1')));
    });

    it('管理者は読める', async () => {
      await assertSucceeds(getDocs(collection(admin(), 'clients/alice/favorites')));
    });

    it('ログインしていなければ触れない', async () => {
      await assertFails(getDoc(doc(guest(), 'clients/alice/favorites/f1')));
      await assertFails(setDoc(doc(guest(), 'clients/alice/favorites/f1'), { name: 'x' }));
    });

    it('無効化された契約者は、自分のお気に入りも読めない', async () => {
      await assertFails(getDoc(doc(carol(), 'clients/carol/favorites/f1')));
    });
  });

  // -------------------------------------------------------------------------
  // AIとの会話履歴。ここには食事の内容がそのまま入ります。
  // 親（aiSessions）には他人拒否のテストが1件ありましたが、
  // 本文が入る messages のほうは読み書きとも1件もありませんでした。
  // -------------------------------------------------------------------------
  describe('AIの会話履歴（aiSessions / messages）', () => {
    it('契約者は自分の会話を読み書きできる', async () => {
      await assertSucceeds(setDoc(doc(alice(), 'clients/alice/aiSessions/s1'), { startedAt: 1 }));
      await assertSucceeds(
        setDoc(doc(alice(), 'clients/alice/aiSessions/s1/messages/m1'), { text: '白米180g' }),
      );
      await assertSucceeds(getDoc(doc(alice(), 'clients/alice/aiSessions/s1/messages/m1')));
    });

    it('契約者は他人の会話の本文を読めない', async () => {
      // ★ ここがいちばん危ないところです。
      //   会話には、その人が何を食べたかがそのまま入ります。
      await seed('clients/alice/aiSessions/s1/messages/m1', { text: '白米180g' });
      await assertFails(getDoc(doc(bob(), 'clients/alice/aiSessions/s1/messages/m1')));
      await assertFails(getDocs(collection(bob(), 'clients/alice/aiSessions/s1/messages')));
    });

    it('契約者は他人の会話に書き込めない', async () => {
      await assertFails(setDoc(doc(bob(), 'clients/alice/aiSessions/s1'), { startedAt: 1 }));
      await assertFails(
        setDoc(doc(bob(), 'clients/alice/aiSessions/s1/messages/m1'), { text: '偽の記録' }),
      );
    });

    it('契約者は他人の会話を消せない', async () => {
      await seed('clients/alice/aiSessions/s1/messages/m1', { text: '白米180g' });
      await assertFails(deleteDoc(doc(bob(), 'clients/alice/aiSessions/s1/messages/m1')));
    });

    it('管理者は読める', async () => {
      await seed('clients/alice/aiSessions/s1/messages/m1', { text: '白米180g' });
      await assertSucceeds(getDoc(doc(admin(), 'clients/alice/aiSessions/s1/messages/m1')));
    });

    it('ログインしていなければ触れない', async () => {
      await assertFails(getDoc(doc(guest(), 'clients/alice/aiSessions/s1/messages/m1')));
      await assertFails(
        setDoc(doc(guest(), 'clients/alice/aiSessions/s1/messages/m1'), { text: 'x' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 個人のレシピ。ここだけ「契約者も書ける」条件があります。
  // その条件（mayCreateRecipe）は、これまで一度も呼ばれていませんでした。
  // -------------------------------------------------------------------------
  describe('個人のレシピ（recipes）', () => {
    it('契約者は自分のレシピを読める', async () => {
      await assertSucceeds(getDocs(collection(alice(), 'clients/alice/recipes')));
    });

    it('契約者は他人のレシピを読めない', async () => {
      await seed('clients/alice/recipes/r1', { name: '鶏むねの作り置き' });
      await assertFails(getDoc(doc(bob(), 'clients/alice/recipes/r1')));
      await assertFails(getDocs(collection(bob(), 'clients/alice/recipes')));
    });

    it('契約者は他人のレシピを書き換えられない', async () => {
      await assertFails(setDoc(doc(bob(), 'clients/alice/recipes/r1'), { name: '乗っ取り' }));
    });

    it('許可されている契約者は、自分のレシピを作れる（既定は許可）', async () => {
      // alice の permissions には allowRecipeCreate がありません。
      // 既定値 true が効いていることを確かめます（移行前のデータでも動くように）
      await assertSucceeds(setDoc(doc(alice(), 'clients/alice/recipes/r1'), { name: '作り置き' }));
    });

    it('止められている契約者は、自分のレシピでも作れない', async () => {
      // dave は allowRecipeCreate: false
      await assertFails(setDoc(doc(dave(), 'clients/dave/recipes/r1'), { name: '作り置き' }));
    });

    it('止められていても、管理者なら書ける', async () => {
      await assertSucceeds(setDoc(doc(admin(), 'clients/dave/recipes/r1'), { name: '作り置き' }));
    });

    it('ログインしていなければ触れない', async () => {
      await assertFails(getDoc(doc(guest(), 'clients/alice/recipes/r1')));
    });
  });

  // -------------------------------------------------------------------------
  // 共通のレシピ。/foods と同じ形なのに、テストだけが無い状態でした。
  // -------------------------------------------------------------------------
  describe('共通レシピ（/recipes）', () => {
    it('登録済みの契約者は読める', async () => {
      await assertSucceeds(getDoc(doc(alice(), 'recipes/common-1')));
    });

    it('管理者は書ける', async () => {
      await assertSucceeds(setDoc(doc(admin(), 'recipes/common-1'), { name: '鶏むねの作り置き' }));
    });

    it('契約者は書き換えられない', async () => {
      await seed('recipes/common-1', { name: '鶏むねの作り置き' });
      await assertFails(setDoc(doc(alice(), 'recipes/common-1'), { name: '書き換え' }));
      await assertFails(deleteDoc(doc(alice(), 'recipes/common-1')));
    });

    it('ログインしていなければ読めない', async () => {
      await assertFails(getDoc(doc(guest(), 'recipes/common-1')));
    });

    it('無効化された契約者は読めない', async () => {
      await assertFails(getDoc(doc(carol(), 'recipes/common-1')));
    });
  });

  // -------------------------------------------------------------------------
  // ルールに書いていないパス。既定の全拒否が効いているか。
  // -------------------------------------------------------------------------
  describe('ルールに書いていないパス（既定の全拒否）', () => {
    it('管理者でも読み書きできない', async () => {
      await assertFails(getDoc(doc(admin(), 'somethingNew/x')));
      await assertFails(setDoc(doc(admin(), 'somethingNew/x'), { a: 1 }));
    });

    it('契約者も読み書きできない', async () => {
      await assertFails(getDoc(doc(alice(), 'somethingNew/x')));
      await assertFails(setDoc(doc(alice(), 'somethingNew/x'), { a: 1 }));
    });

    it('契約者データの下に、勝手なコレクションを作れない', async () => {
      await assertFails(setDoc(doc(alice(), 'clients/alice/secretStash/x'), { a: 1 }));
    });

    it('ログインしていなくても、もちろんできない', async () => {
      await assertFails(getDoc(doc(guest(), 'somethingNew/x')));
    });
  });
});

describe('★ 他人のデータに手が届かないか（残りの経路）', () => {
  it('契約者は他人の体重記録を書き換えられない', async () => {
    // 読み取り側のテストはありましたが、書き込み側がありませんでした
    await assertFails(
      setDoc(doc(bob(), `clients/alice/measurements/${TODAY}`), { weightKg: 99 }),
    );
  });

  it('契約者は他人の体重記録を一覧できない', async () => {
    await assertFails(getDocs(collection(bob(), 'clients/alice/measurements')));
  });

  it('契約者は自分の体重記録を一覧できる', async () => {
    await assertSucceeds(getDocs(collection(alice(), 'clients/alice/measurements')));
  });

  it('契約者は他人の変更履歴に、偽の記録を差し込めない', async () => {
    await assertFails(
      setDoc(doc(bob(), 'clients/alice/audits/a1'), { type: 'food-bulk-replace', by: 'bob' }),
    );
  });

  it('契約者は他人の食事を消せない', async () => {
    // write のうち delete だけが踏まれていませんでした
    await seed(`clients/alice/days/${TODAY}/meals/m1`, { label: '1食目' });
    await assertFails(deleteDoc(doc(bob(), `clients/alice/days/${TODAY}/meals/m1`)));
  });

  it('契約者は他人の日データを消せない', async () => {
    await seed(`clients/alice/days/${THREE_DAYS_AGO}`, { date: THREE_DAYS_AGO, status: 'open' });
    await assertFails(deleteDoc(doc(bob(), `clients/alice/days/${THREE_DAYS_AGO}`)));
  });

  it('契約者は他人の photoOldestAt を書き換えられない', async () => {
    // ★ この抜け道は inWindow も確定状態も見ません。isClient(cid) の1本だけで守っています。
    //   その1本が効いているかを、ここで確かめます。
    await assertFails(
      setDoc(
        doc(bob(), 'clients/alice/days/2026-01-15'),
        { photoOldestAt: 1, updatedAt: 1 },
        { merge: true },
      ),
    );
  });

  it('契約者は他人が積んだ依頼の記録を消せない', async () => {
    await seed('foodRequests/karaage/from/alice', { variant: 'からあげ', count: 1, dates: [] });
    await assertFails(deleteDoc(doc(bob(), 'foodRequests/karaage/from/alice')));
  });

  it('契約者は自分が積んだ依頼の記録も消せない（消せるのは管理者だけ）', async () => {
    await seed('foodRequests/karaage/from/alice', { variant: 'からあげ', count: 1, dates: [] });
    await assertFails(deleteDoc(doc(alice(), 'foodRequests/karaage/from/alice')));
  });
});

describe('★ 権限を自分で上げられないか', () => {
  it('契約者は users を一覧できない', async () => {
    // 一覧できると、他人の uid と役割がまとめて見えます
    await assertFails(getDocs(collection(alice(), 'users')));
  });

  it('契約者は users のドキュメントを新しく作れない', async () => {
    await assertFails(
      setDoc(doc(alice(), 'users/brand-new-uid'), { role: 'admin', clientId: null, active: true }),
    );
  });

  it('契約者は自分の users ドキュメントを消せない', async () => {
    // 消してから作り直せると、役割を選び直せてしまいます
    await assertFails(deleteDoc(doc(alice(), 'users/alice-uid')));
  });

  it('契約者は他人の users ドキュメントを消せない', async () => {
    await assertFails(deleteDoc(doc(alice(), 'users/bob-uid')));
  });

  it('契約者は自分の契約者データを消せない', async () => {
    await assertFails(deleteDoc(doc(alice(), 'clients/alice')));
  });

  it('契約者は他人の契約者データを消せない', async () => {
    await assertFails(deleteDoc(doc(alice(), 'clients/bob')));
  });

  it('契約者は契約者データを新しく作れない', async () => {
    await assertFails(setDoc(doc(alice(), 'clients/erin'), { displayName: 'erin', active: true }));
  });

  it('管理者は契約者データを新しく作れる', async () => {
    // 既存の「作成・削除できる」は、シード済みの dave が相手なので
    // 実際には update を踏んでいました。作成そのものはここで確かめます
    await assertSucceeds(setDoc(doc(admin(), 'clients/erin'), { displayName: 'erin', active: true }));
  });

  it('管理者は users を読める・一覧できる', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'users/alice-uid')));
    await assertSucceeds(getDocs(collection(admin(), 'users')));
  });

  it('管理者は users を書き換えられる・消せる', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), 'users/dave-uid'), { role: 'client', clientId: 'dave', active: false }),
    );
    await assertSucceeds(deleteDoc(doc(admin(), 'users/dave-uid')));
  });

  it('ログインしていなければ users を一覧できない', async () => {
    await assertFails(getDocs(collection(guest(), 'users')));
  });
});

describe('★ 登録されていない人・無効にされた人', () => {
  it('role が admin でも client でもない人は、共通マスタを読めない', async () => {
    // Firebase Auth には誰でも登録できます。
    // users ドキュメントが管理者にしか作れないことで塞いでいますが、
    // 役割が変な値だったときにどうなるかは、これまで確かめていませんでした
    await assertFails(getDoc(doc(mallory(), 'foods/common-1')));
    await assertFails(getDoc(doc(mallory(), 'config/app')));
  });

  it('role が変な値の人は、依頼も積めない', async () => {
    await assertFails(setDoc(doc(mallory(), 'foodRequests/karaage'), { key: 'karaage' }));
  });

  it('無効にされた管理者は、管理者として扱われない', async () => {
    await assertFails(getDocs(collection(exAdmin(), 'clients')));
    await assertFails(setDoc(doc(exAdmin(), 'foods/common-1'), { name: '書き換え' }));
    await assertFails(getDocs(collection(exAdmin(), 'foodRequests')));
  });

  it('無効にされた契約者は、共通マスタも設定も読めない', async () => {
    await assertFails(getDoc(doc(carol(), 'foods/common-1')));
    await assertFails(getDoc(doc(carol(), 'config/app')));
  });

  it('permissions が無い古いかたちの契約者は、日付に紐づく書き込みが通らない', async () => {
    // ★ 移行前のデータで起こりうる形です。
    //   期間を判定できないので、通してしまうより止めるほうを選んでいます。
    //   直すには、その契約者に permissions を入れ直します。
    await assertFails(
      setDoc(doc(frank(), `clients/frank/days/${TODAY}/meals/m1`), { label: '1食目' }),
    );
  });

  it('permissions が無くても、読むことはできる', async () => {
    await assertSucceeds(getDoc(doc(frank(), 'clients/frank')));
    await assertSucceeds(getDoc(doc(frank(), 'foods/common-1')));
  });
});

describe('★ 未認証で、どこまで届くか', () => {
  // これまで未認証のテストは6件しかなく、日次データ・写真・評価・コメント・
  // 体重・履歴には1件もありませんでした。
  // いまは me() の get() が落ちて塞がっていますが、
  // どのヘルパーからも signedIn() が外れると一斉に開きます。
  it('日次データを読めない', async () => {
    await assertFails(getDoc(doc(guest(), `clients/alice/days/${TODAY}`)));
    await assertFails(getDocs(collection(guest(), 'clients/alice/days')));
  });

  it('食事・運動を読めない', async () => {
    await assertFails(getDocs(collection(guest(), `clients/alice/days/${YESTERDAY}/meals`)));
    await assertFails(getDocs(collection(guest(), `clients/alice/days/${TODAY}/exercises`)));
  });

  it('写真を読めない・足せない', async () => {
    await assertFails(getDocs(collection(guest(), `clients/alice/days/${TODAY}/photos`)));
    await assertFails(
      setDoc(doc(guest(), `clients/alice/days/${TODAY}/photos/p1`), { dataUrl: 'x' }),
    );
  });

  it('AI評価とコメントを読めない・書けない', async () => {
    await assertFails(getDoc(doc(guest(), `clients/alice/days/${TODAY}/review/latest`)));
    await assertFails(getDocs(collection(guest(), `clients/alice/days/${TODAY}/notes`)));
    await assertFails(
      setDoc(doc(guest(), `clients/alice/days/${TODAY}/notes/n1`), { text: 'x', by: 'x' }),
    );
  });

  it('体重記録と変更履歴を読めない', async () => {
    await assertFails(getDocs(collection(guest(), 'clients/alice/measurements')));
    await assertFails(getDocs(collection(guest(), 'clients/alice/audits')));
  });

  it('アプリ設定を読めない', async () => {
    await assertFails(getDoc(doc(guest(), 'config/app')));
  });

  it('依頼の中身を読めない', async () => {
    await assertFails(getDocs(collection(guest(), 'foodRequests')));
    await assertFails(getDoc(doc(guest(), 'foodRequests/karaage/from/alice')));
  });
});

describe('★ 管理者にしかできない操作（成功する側）', () => {
  it('アプリ設定を書ける', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'config/app'), { appName: 'PT Manager' }));
  });

  it('登録済みの契約者はアプリ設定を読める', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'config/app')));
  });

  it('共通マスタを読める', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'foods/common-1')));
  });

  it('依頼そのものを作れる・書き換えられる', async () => {
    // これまで管理者側の依頼の書き込みは、すべて Rules を迂回して作っていました
    await assertSucceeds(setDoc(doc(admin(), 'foodRequests/karaage'), { key: 'karaage' }));
    await assertSucceeds(
      setDoc(doc(admin(), 'foodRequests/karaage'), { key: 'karaage', name: 'からあげ' }),
    );
  });

  it('依頼の中の1件も作れる・読める', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), 'foodRequests/karaage/from/alice'), {
        variant: 'からあげ',
        count: 1,
        dates: [TODAY],
      }),
    );
    await assertSucceeds(getDoc(doc(admin(), 'foodRequests/karaage/from/alice')));
  });

  it('契約者の食事を読める', async () => {
    await assertSucceeds(getDocs(collection(admin(), `clients/alice/days/${YESTERDAY}/meals`)));
  });

  it('契約者のコメントを読める', async () => {
    await assertSucceeds(getDocs(collection(admin(), `clients/alice/days/${TODAY}/notes`)));
  });

  it('ウィンドウの外でも、運動・体重・写真を書ける', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), `clients/alice/days/${TEN_DAYS_AGO}/exercises/e1`), { name: '走る' }),
    );
    await assertSucceeds(
      setDoc(doc(admin(), `clients/alice/measurements/${TEN_DAYS_AGO}`), { weightKg: 55 }),
    );
    await assertSucceeds(
      setDoc(doc(admin(), `clients/alice/days/${TEN_DAYS_AGO}/photos/p1`), { dataUrl: 'x' }),
    );
  });

  it('確定済みの日でも、運動を書ける', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), `clients/alice/days/${YESTERDAY}/exercises/e1`), { name: '走る' }),
    );
  });

  it('日データを消せる（ウィンドウの外でも）', async () => {
    await assertSucceeds(deleteDoc(doc(admin(), 'clients/alice/days/2026-01-15')));
  });

  it('個人マスタを消せる', async () => {
    await assertSucceeds(deleteDoc(doc(admin(), 'clients/alice/foods/f1')));
  });

  it('写真は管理者でも上書きできない（消して撮り直す）', async () => {
    await seed(`clients/alice/days/${TODAY}/photos/p1`, { dataUrl: 'x', createdAt: 1 });
    await assertFails(
      setDoc(doc(admin(), `clients/alice/days/${TODAY}/photos/p1`), { dataUrl: 'y' }),
    );
  });
});

describe('★ 契約者が自分のぶんでできること（成功する側）', () => {
  it('開いている日の記録を、あとから書き足せる', async () => {
    // ★ この経路（既にある日を契約者が更新する）を踏むテストが1件もありませんでした。
    //   誤ってここが常に false になっても、テストは緑のまま
    //   「アプリだけが壊れている」状態になります。
    await seed(`clients/alice/days/${THREE_DAYS_AGO}`, {
      date: THREE_DAYS_AGO,
      status: 'open',
      updatedAt: 1,
    });
    await assertSucceeds(
      setDoc(
        doc(alice(), `clients/alice/days/${THREE_DAYS_AGO}`),
        { weightKg: 53.4, updatedAt: 2 },
        { merge: true },
      ),
    );
  });

  it('開いている日の記録を、自分で消せる', async () => {
    await seed(`clients/alice/days/${THREE_DAYS_AGO}`, { date: THREE_DAYS_AGO, status: 'open' });
    await assertSucceeds(deleteDoc(doc(alice(), `clients/alice/days/${THREE_DAYS_AGO}`)));
  });

  it('確定済みの日は、自分では消せない', async () => {
    await assertFails(deleteDoc(doc(alice(), `clients/alice/days/${YESTERDAY}`)));
  });

  it('ウィンドウの外の日は、自分では消せない', async () => {
    await assertFails(deleteDoc(doc(alice(), 'clients/alice/days/2026-01-15')));
  });

  it('自分の運動・評価・写真を読める', async () => {
    await assertSucceeds(getDocs(collection(alice(), `clients/alice/days/${TODAY}/exercises`)));
    await assertSucceeds(getDoc(doc(alice(), `clients/alice/days/${TODAY}/review/latest`)));
    await assertSucceeds(getDocs(collection(alice(), `clients/alice/days/${TODAY}/review`)));
    await assertSucceeds(getDocs(collection(alice(), `clients/alice/days/${TODAY}/photos`)));
  });

  it('自分の日データを1件だけ読める', async () => {
    await assertSucceeds(getDoc(doc(alice(), `clients/alice/days/${YESTERDAY}`)));
  });

  it('確定済みの日には、運動を書けない', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${YESTERDAY}/exercises/e1`), { name: '走る' }),
    );
  });

  it('ウィンドウの外の日には、写真を足せない', async () => {
    await assertFails(
      setDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}/photos/p1`), { dataUrl: 'x' }),
    );
  });

  it('AI評価は、あとから書き直せる', async () => {
    // これまで踏んでいたのは create だけで、update 側が空白でした
    await seed(`clients/alice/days/${TODAY}/review/latest`, {
      text: '前の評価',
      mode: 'standard',
      by: 'alice-uid',
      createdAt: 1,
    });
    await assertSucceeds(
      setDoc(doc(alice(), `clients/alice/days/${TODAY}/review/latest`), {
        text: '書き直した評価',
        mode: 'standard',
        by: 'alice-uid',
        createdAt: 2,
      }),
    );
  });

  it('表示名やAI同意は自分で変えられる', async () => {
    await assertSucceeds(
      setDoc(
        doc(alice(), 'clients/alice'),
        { aiConsent: { granted: true, updatedAt: 1, version: 1 }, updatedAt: 1 },
        { merge: true },
      ),
    );
    await assertSucceeds(
      setDoc(doc(alice(), 'clients/alice'), { extra: { note: 'x' } }, { merge: true }),
    );
  });
});

describe('★ 値の検査 — 境界のちょうどと、型', () => {
  // これまでは「上限+1で落ちる」側だけを見ていました。
  // ちょうどの値が通ることも確かめないと、
  // うっかり <= を < に変えたときに気づけません。
  describe('ちょうどの値は通る', () => {
    // ★ ここだけ半角文字を使っています。
    //
    //   Rules の size() が「文字の数」なのか「バイトの数」なのかを、
    //   この作業環境では確かめられません（エミュレータを起動できないため）。
    //   半角なら、どちらの数え方でも同じ値になります。
    //   上限を超えて落ちる側（全角）のテストは、これまでどおり別にあります。
    it('AI評価は1200文字ちょうどまで', async () => {
      await assertSucceeds(
        setDoc(doc(alice(), `clients/alice/days/${TODAY}/review/latest`), {
          text: 'a'.repeat(1200),
          mode: 'standard',
          by: 'alice-uid',
          createdAt: 1,
        }),
      );
    });

    it('コメントは2000文字ちょうどまで', async () => {
      await assertSucceeds(
        setDoc(doc(admin(), `clients/alice/days/${TODAY}/notes/n1`), {
          text: 'a'.repeat(2000),
          by: 'admin-uid',
          createdAt: 1,
          updatedAt: 1,
        }),
      );
    });

    it('依頼の名前は60文字ちょうどまで', async () => {
      await assertSucceeds(
        setDoc(doc(alice(), 'foodRequests/karaage'), {
          key: 'karaage',
          name: 'a'.repeat(60),
          updatedAt: 1,
        }),
      );
    });

    it('候補の説明は200文字ちょうどまで', async () => {
      await assertSucceeds(
        setDoc(doc(alice(), 'foodRequests/karaage/from/alice'), {
          variant: 'からあげ',
          count: 1,
          dates: [TODAY],
          candidateNote: 'a'.repeat(200),
        }),
      );
    });

    it('表記は60文字ちょうどまで', async () => {
      await assertSucceeds(
        setDoc(doc(alice(), 'foodRequests/karaage/from/alice'), {
          variant: 'a'.repeat(60),
          count: 1,
          dates: [TODAY],
        }),
      );
    });

    it('使った日は400件ちょうどまで', async () => {
      await assertSucceeds(
        setDoc(doc(alice(), 'foodRequests/karaage/from/alice'), {
          variant: 'からあげ',
          count: 1,
          dates: Array.from({ length: 400 }, (_, i) => `2026-01-${String((i % 28) + 1)}`),
        }),
      );
    });
  });

  describe('依頼の中の1件は、形が合っていないと書けない', () => {
    // ★ ここは契約者が自由に値を入れられる、数少ない場所です。
    //   4つの条件がありましたが、テストは1件もありませんでした。
    const base = { variant: 'からあげ', count: 1, dates: [TODAY] };
    const path = 'foodRequests/karaage/from/alice';

    it('表記が空だと書けない', async () => {
      await assertFails(setDoc(doc(alice(), path), { ...base, variant: '' }));
    });

    it('表記が61文字だと書けない', async () => {
      await assertFails(setDoc(doc(alice(), path), { ...base, variant: 'あ'.repeat(61) }));
    });

    it('表記が文字列でないと書けない', async () => {
      await assertFails(setDoc(doc(alice(), path), { ...base, variant: 123 }));
    });

    it('回数が整数でないと書けない', async () => {
      await assertFails(setDoc(doc(alice(), path), { ...base, count: 1.5 }));
      await assertFails(setDoc(doc(alice(), path), { ...base, count: '1' }));
    });

    it('使った日が配列でないと書けない', async () => {
      await assertFails(setDoc(doc(alice(), path), { ...base, dates: TODAY }));
    });

    it('使った日が401件だと書けない', async () => {
      await assertFails(
        setDoc(doc(alice(), path), {
          ...base,
          dates: Array.from({ length: 401 }, (_, i) => `2026-01-${String((i % 28) + 1)}`),
        }),
      );
    });

    it('候補の説明が文字列でないと書けない', async () => {
      await assertFails(setDoc(doc(alice(), path), { ...base, candidateNote: 123 }));
    });

    it('写真が文字列でないと書けない', async () => {
      await assertFails(setDoc(doc(alice(), path), { ...base, candidatePhoto: 123 }));
    });
  });

  describe('文字列であるべきところに、別の型は入らない', () => {
    it('AI評価の本文', async () => {
      await assertFails(
        setDoc(doc(alice(), `clients/alice/days/${TODAY}/review/latest`), {
          text: 12345,
          mode: 'standard',
          by: 'alice-uid',
          createdAt: 1,
        }),
      );
    });

    it('コメントの本文', async () => {
      await assertFails(
        setDoc(doc(admin(), `clients/alice/days/${TODAY}/notes/n1`), {
          text: ['配列'],
          by: 'admin-uid',
          createdAt: 1,
          updatedAt: 1,
        }),
      );
    });

    it('写真の中身', async () => {
      await assertFails(
        setDoc(doc(alice(), `clients/alice/days/${TODAY}/photos/p1`), { dataUrl: 12345 }),
      );
    });

    it('依頼の名前', async () => {
      await assertFails(
        setDoc(doc(alice(), 'foodRequests/karaage'), { key: 'karaage', name: 123, updatedAt: 1 }),
      );
    });
  });

  describe('写真の期限は、ちょうど49日で切り替わる', () => {
    it('49日ちょうど経っていれば、ウィンドウの外でも消せる', async () => {
      // 少しだけ余裕を持たせる（判定は request.time なので、テスト中に進む）
      const createdAt = Date.now() - 49 * DAY_MS - 60_000;
      await seed(`clients/alice/days/${TEN_DAYS_AGO}/photos/p1`, { dataUrl: 'x', createdAt });
      await assertSucceeds(
        deleteDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}/photos/p1`)),
      );
    });

    it('48日しか経っていなければ、ウィンドウの外では消せない', async () => {
      const createdAt = Date.now() - 48 * DAY_MS;
      await seed(`clients/alice/days/${TEN_DAYS_AGO}/photos/p2`, { dataUrl: 'x', createdAt });
      await assertFails(deleteDoc(doc(alice(), `clients/alice/days/${TEN_DAYS_AGO}/photos/p2`)));
    });
  });
});
