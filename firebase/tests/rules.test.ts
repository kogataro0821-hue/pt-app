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
const THREE_DAYS_AGO = jstDate(3);
const TEN_DAYS_AGO = jstDate(10);

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

    for (const cid of ['alice', 'bob', 'carol']) {
      await setDoc(doc(db, `clients/${cid}`), {
        displayName: cid,
        active: true,
        targets: { kcal: 1800, p: 130, f: 50, c: 200 },
        permissions: { pastEditWindowDays: 7 },
        reviewMode: 'standard',
      });
    }

    // 確定済みの日（設計書 §7）
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
});

describe('★ 1日確定（finalized）の保護（設計書 §7）', () => {
  it('確定済みの日は、契約者が食事を書き換えられない', async () => {
    await assertFails(
      setDoc(doc(alice(), 'clients/alice/days/2026-01-15/meals/m1'), { label: '変更' }),
    );
  });

  it('確定済みの日でも、管理者は書き換えられる', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), 'clients/alice/days/2026-01-15/meals/m1'), { label: '変更' }),
    );
  });

  it('確定済みの日でも、契約者は読める', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'clients/alice/days/2026-01-15/meals/m1')));
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
