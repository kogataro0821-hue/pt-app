PT-app  Phase 11A  画面のテスト
================================

【Firestore Rules の貼り直し: 不要です】

  今回はルールを1文字も触っていません。


やること
--------

1. この ZIP を展開する
2. 中の apps / docs / package-lock.json を
   C:\\Users\\user\\Desktop\\pt-app の上に、そのまま上書きコピー
3. GitHub Desktop で Changes を確認する
     → 27 ファイルのはずです
     → 「削除された」ファイルが1つも無いことを確認
4. コミットして Push
5. CI（Actions）が緑になるのを確認する


コミットメッセージ
------------------

  Phase 11A: 画面のテストを入れる（172件）


今回やったこと
--------------

  apps/web にテストが1件もありませんでした。そこに172件入れました。

  これまで実際に出たバグは、全部この「テストが無かった側」で起きています。
  同じものが二度と出ないように固定するのが、今回の目的です。


特に守ったこと（4つ）
---------------------

  1. 契約者は栄養値を入力できない
       画面に kcal/P/F/C の欄が出ないこと。
       未登録の食材が「栄養値0・登録待ち」で渡ること。

  2. 契約者はトレーナーのコメントを書けない
       書く欄も、編集・削除のボタンも出ないこと。
       （ここは実装中、一度ほんとうに書き換えられる状態でした）

  3. 管理者は代わりにAI利用へ同意できない
       管理者の画面にボタンが1つも無いこと。

  4. AI評価は、出す前に必ず検査される
       病名や、体に負担のかかるやり方が混ざった文章は表示も保存もしない。
       疲れ・むくみ程度の話は通す。免責は常に出す。
       AIに送るのが数字だけであること（氏名・契約者ID・体重を送らない）。


テストの数
----------

  @pt/web         172 件  ← 今回追加（これまで0件）
  @pt/core        239 件
  @pt/ai-contract  39 件
  Worker           15 件
  ---------------------------
  合計            465 件

  Security Rules  161 件（CIのみ）

  npm run verify に乗っているので、CIが自動で全部走ります。


確認したこと
------------

  GitHub から新しく clone したものに、この一式を重ねて、

    npm ci         OK
    npm run verify OK  （typecheck / lint / test すべて）
    npm run build  OK


書きながら気づいたこと
----------------------

  ItemForm の「食材の名前を入力してください。」などの文言は、
  実際には画面に出ません。条件を満たすまでボタンが押せないためです。
  害はないので直していません（押せない理由がその場で分かるほうが親切です）。
  報告書の 4-1 に書いてあります。


次にやること（Phase 11 の続き）
-------------------------------

  11B  Rules網羅  … 161件を全分岐で洗い直す
  11C  E2E        … ログイン→記録→依頼→登録→反映→確定 を通しで
  11D  Worker     … JWT検証・レート制限

  くわしくは docs/PHASE-11A-REPORT.md を見てください。

入っているファイル（27）
------------------------
  apps/web/package.json
  apps/web/src/config/firebase.test.ts
  apps/web/src/features/ai/AiConsentCard.test.tsx
  apps/web/src/features/ai/gemini.test.ts
  apps/web/src/features/auth/authTypes.test.ts
  apps/web/src/features/clients/clientTypes.test.ts
  apps/web/src/features/days/CheckCard.test.tsx
  apps/web/src/features/days/dayTypes.test.ts
  apps/web/src/features/days/daysRepo.test.ts
  apps/web/src/features/exercises/exercisesRepo.test.ts
  apps/web/src/features/foods/RequestsScreen.test.tsx
  apps/web/src/features/foods/bulkReplace.test.ts
  apps/web/src/features/foods/foodsRepo.test.ts
  apps/web/src/features/foods/requestsRepo.test.ts
  apps/web/src/features/meals/ItemForm.test.tsx
  apps/web/src/features/meals/LabelItemPanel.test.tsx
  apps/web/src/features/notes/NotesSection.test.tsx
  apps/web/src/features/review/ReviewSection.test.tsx
  apps/web/src/lib/firestoreError.test.ts
  apps/web/src/test/factories.ts
  apps/web/src/test/helpers.ts
  apps/web/src/test/setup.ts
  apps/web/src/test/vitest.d.ts
  apps/web/tsconfig.json
  apps/web/vitest.config.ts
  docs/PHASE-11A-REPORT.md
  package-lock.json
