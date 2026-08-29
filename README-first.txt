PT-app  番号の整理と報告書
==========================

【Firestore Rules の貼り直し: 不要です】

  firebase/firestore.rules は入っていますが、
  変わったのは「コメントの文言」だけです。
  判定（誰が何をできるか）は1文字も変わっていません。
  Firebase コンソールへの貼り直しは要りません。


やること
--------

1. この ZIP を展開する
2. 中の apps / docs / firebase / packages を
   C:\Users\user\Desktop\pt-app の上に、そのまま上書きコピー
3. GitHub Desktop で Changes を確認する
     → 24ファイルのはずです
     → 「削除された」ファイルが1つも無いことを確認
4. コミットして Push


コミットメッセージ
------------------

  フェーズ番号の整理と、Phase 10 以降の報告書


今回やったこと
--------------

1. フェーズ番号のずれを直しました

   設計書に無いものを途中で追加し、
   コードのコメントで Phase 11〜14 と書いていました。
   設計書の Phase 11（テスト強化）・12（実機運用）とぶつかっていました。

   直した形:
     AI評価              → Phase 10（設計書の Phase 10 そのもの）
     写真の7週間保存      → 追加仕様: 写真の保存期間（番号なし）
     トレーナーの確認     → 同上
     成分表示の読み取り   → 追加仕様: 成分表示の読み取り（番号なし）

   番号は増やしません。増やすと設計書とまたぶつかります。

2. 設計書 §13 の表を更新しました
   - Phase 5〜10 に完了マーク
   - 「追加仕様（番号を持たないもの）」の表を新設

3. 報告書を3本書きました
     docs/PHASE-10-REPORT.md
       トレーナーのコメント と AI評価
     docs/EXTRA-PHOTO-RETENTION-REPORT.md
       写真の保存期間 と トレーナーの確認
     docs/EXTRA-LABEL-READING-REPORT.md
       成分表示の読み取り


確認したこと
------------

  GitHub から新しく clone したものに、この24ファイルを重ねて、

    npm ci         OK
    npm run verify OK
      @pt/core        239 件
      @pt/ai-contract  39 件
      Worker           15 件
    npm run build  OK

  Rules テスト 161 件は、この作業環境ではエミュレータが
  起動できないため、CI でのみ実行されます。
  CI が緑になるのを確認してから使ってください。


入っているファイル（24）
------------------------
  apps/web/src/features/ai/AiTextPanel.tsx
  apps/web/src/features/ai/gemini.ts
  apps/web/src/features/calendar/CalendarScreen.tsx
  apps/web/src/features/days/CheckCard.tsx
  apps/web/src/features/days/dayTypes.ts
  apps/web/src/features/days/daysRepo.ts
  apps/web/src/features/foods/FoodEditor.tsx
  apps/web/src/features/foods/LabelScanner.tsx
  apps/web/src/features/foods/RequestsScreen.tsx
  apps/web/src/features/foods/requestsRepo.ts
  apps/web/src/features/meals/ItemForm.tsx
  apps/web/src/features/meals/LabelItemPanel.tsx
  apps/web/src/features/review/ReviewSection.tsx
  apps/web/src/features/review/reviewRepo.ts
  docs/00_DESIGN.md
  docs/EXTRA-LABEL-READING-REPORT.md
  docs/EXTRA-PHOTO-RETENTION-REPORT.md
  docs/PHASE-10-REPORT.md
  firebase/firestore.rules
  firebase/tests/rules.test.ts
  packages/ai-contract/src/wire.ts
  packages/core/src/food/label.ts
  packages/core/src/photo/retention.ts
  packages/core/src/review/safety.ts
