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

  // ---- 成分表示から読み取った候補（Phase 12）--------------------------------

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

describe('★ トレーナーの確認と写真の保存期間（設計書 §8.2 / Phase 11）', () => {
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
