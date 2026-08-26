# Phase 1 完了報告 — プロジェクト作成・GitHub整備

- 日付: 2026-08-26
- 対象フェーズ: Phase 1（設計書 §13）
- 結果: **完了**（typecheck / lint / test すべて緑）

---

## 1. 何を実装したか

### 1-1. モノレポの土台

```
pt-app/
├── apps/mobile/          Expo アプリ（iPhone）
├── packages/core/        ★PFC計算エンジン（純粋ロジック）
├── packages/ai-contract/ AIの抽象インターフェースと入出力スキーマ
├── worker/               AI中継サーバー（Phase 8・現在は README のみ）
├── firebase/             Rules と Emulator（Phase 2・現在は README のみ）
└── docs/                 設計書と本報告
```

npm workspaces で1回の `npm install` に統一しました。

### 1-2. Expo アプリ（apps/mobile）

| 項目 | 内容 |
|---|---|
| Expo SDK | 57.0.16（最新） |
| React Native | 0.86.2 / React 19.2.3 |
| ルーティング | expo-router（ファイルベース） |
| TypeScript | 6.0.3 / strict + noUncheckedIndexedAccess |
| モノレポ対応 | `metro.config.js` で watchFolders と nodeModulesPaths を設定 |

**アプリ名は `app.config.ts` の `APP_NAME` 1箇所だけ**で定義しました（設計書 §5）。
画面からは `src/config/env.ts` の `APP_NAME` を参照します。名前が決まったらここを書き換えるだけです。

配色トークン（`src/theme/tokens.ts`）にライト/ダーク両対応の値を置き、
**P / F / C の色を最初から固定**しました。今後どの画面でも同じ色になります。

### 1-3. PFC計算エンジンの土台（packages/core）

Phase 6 で本格実装しますが、**設計書 §15 の絶対ルールを支える部分は先に作りました**。

| ファイル | 内容 |
|---|---|
| `nutrition/types.ts` | 栄養値の型。1/1000単位の整数で保持 |
| `nutrition/convert.ts` | 単位変換・100gあたり値からの換算・倍率変更（半量など） |
| `nutrition/sum.ts` | **`sumNutrients()` — アプリ内で唯一の加算関数**・目標との差分 |
| `nutrition/format.ts` | 表示用の丸め（計算経路では使わない） |
| `units/types.ts` | 単位の定義・栄養値の出所と優先順位（§13） |

### 1-4. AIの契約（packages/ai-contract）

実装は Phase 8 以降ですが、**AIとの「契約」だけ先に確定**させました。

| ファイル | 内容 |
|---|---|
| `schemas.ts` | AI入出力の zod スキーマ。**kcal / PFC を返させない構造**にしてある |
| `provider.ts` | `AIProvider` インターフェース。Gemini / OpenAI / Claude を差し替え可能に |
| `guard.ts` | **§12「勝手な補完禁止」の後処理バリデータ** |

### 1-5. 品質の仕組み

- ESLint 9（flat config）+ Prettier + TypeScript strict
- Vitest（`packages/core` と `packages/ai-contract`）
- GitHub Actions で `typecheck → lint → test` を PR ごとに実行
- **秘密情報スキャンのジョブ**を CI に追加（`.env` や鍵ファイルが混入したら fail）

### 1-6. 秘密情報の扱い（§31）

- `.gitignore` に `.env` / `*.pem` / `*.p8` / `firebase-adminsdk-*.json` などを登録
- `.env.example` を作成。**実際の値は1つも書いていません**
- README に「Firebase の apiKey は秘密ではない。守っているのは Rules である」と明記

---

## 2. 動作確認の結果

### テスト: 37件すべて通過

```
@pt/core         27 件（sum.test.ts 16 / format.test.ts 11）
@pt/ai-contract  10 件（guard.test.ts）
```

**特に重要な検証**

| テスト | 結果 |
|---|---|
| 食材を一度に足した値 == 食事ごとに足してから足した値 | ✅ 厳密一致 |
| どんなグループ分けにしても合計が変わらない（結合則） | ✅ |
| 順序を入れ替えても合計が変わらない（交換則） | ✅ |
| ランダムな食事構成 200 ケースでも常に一致 | ✅ |
| 「白米180g → 150g」で新規追加ではなく値が変わる | ✅ |
| 「おにぎり半量」を2つ足すと元に戻る | ✅ |
| 原文に無い食品をAIが足してきたら破棄する | ✅ |
| 「徒歩出勤」から「徒歩帰宅」を推測したら破棄する | ✅ |
| 確信度が低いものは破棄せず「要確認」に回す | ✅ |

### 型チェック・lint

```
npm run typecheck   → エラーなし（3ワークスペースすべて）
npm run lint        → エラーなし
```

### `packages/core` の純粋性を lint で強制していることの確認

`packages/core` に `import { getAuth } from 'firebase/auth'` を書いて試したところ、
期待どおりエラーになりました。

```
error  'firebase/auth' import is restricted from being used by a pattern.
       packages/core は純粋ロジックです。Firebase / React Native / Expo / AI を
       import できません（設計書 §3.1）。
```

これで「AIと計算エンジンの責任分離」（§37）が、口約束ではなく機械的に守られます。

### アプリのビルド

`expo export` で実際にバンドルが通ることを確認しました（833モジュール）。
モノレポの `@pt/core` がアプリ側から正しく解決できています。

---

## 3. 未実装（意図的に次フェーズへ）

| 項目 | 予定フェーズ |
|---|---|
| Firebase 接続・Security Rules・Emulator | Phase 2 |
| ログイン画面・権限判定 | Phase 3 |
| 契約者管理 | Phase 4 |
| カレンダー・日別画面 | Phase 5 |
| 栄養値の優先順位解決（`resolveNutrition`） | Phase 6 |
| 単位換算（個 / 杯 / 大さじ → g） | Phase 6 |
| レシピの材料展開 | Phase 6 |
| 編集操作の適用（`applyEditOperations`） | Phase 6 |
| コピペ出力 | Phase 6 |
| AI中継 Worker の実装 | Phase 8 |

現在の起動画面は Phase 1 の動作確認用です。Phase 5 でカレンダー画面に置き換わります。

---

## 4. 問題点・気づいたこと

### 4-1. 【設計の訂正】浮動小数では合計が厳密一致しなかった

設計書 v0.2 で「加算順序を固定すれば浮動小数でも厳密一致する」と書きましたが、**これは誤りでした。**

浮動小数では `(a+b)+(c+d)` と `((a+b)+c)+d` が一致しないことがあります。
つまり「食事ごとに合計してから足した日合計」と「全食品を一度に足した合計」がズレ得ます。
設計書 §15 は「必ず一致すること」を要求しているので、これでは要件を満たせません。

**対応**: 栄養値を **1/1000 単位の整数**で保持する方式に変更しました。

```
kcal: 123456   →  123.456 kcal
p:     35042   →   35.042 g
```

整数なら結合則が成立するため、どんなグループ分けをしても合計が完全に一致します。
設計書を v0.3 に更新し、この訂正を反映しました（§10.3）。

### 4-2. 内訳の表示を足すと合計と1桁ズレて見えることがある

動作確認画面で実際に出た例です。

```
白米180g      F 0.5
鶏ささみ150g  F 1.2
卵60g         F 6.1
─────────────────
合計          F 7.9   ← 0.5 + 1.2 + 6.1 = 7.8 ではない？
```

内部値は 0.54 + 1.20 + 6.12 = 7.86 で、合計の 7.9 が正しい値です。
**内訳の表示が小数第1位に丸められているだけ**で、計算は合っています。

ただし契約者がこれを見て「計算が合っていない」と思う可能性があります。
コピペ出力（§27）でも同じことが起きます。Phase 6 で以下のどれかを決めたいです。

- (a) このままにする（合計が正しいので問題なし）
- (b) 内訳を小数第2位まで表示する
- (c) コピペ出力に「※内訳は表示上四捨五入しています」と1行添える

### 4-3. GitHub への push は手元で行っていただく必要があります

この環境には GitHub の認証情報がないため、リポジトリの作成と push は行えませんでした。
ローカルで Git の初期化とコミット、`main` / `develop` ブランチの作成までは済んでいます。

手順は README の「GitHub への登録」に書きました。**Private リポジトリを推奨**します
（契約者の健康情報を扱うため）。

### 4-4. Web版ではダークモードの切り替えが効いていません

`expo export` した Web 版で確認したところ、ダークモードの配色が反映されませんでした。
iOS 実機では動作する想定ですが、**Phase 12 の実機確認で必ず検証**します。
Web は本来の対象外なので、Phase 1 では追いかけていません。

### 4-5. npm audit で 11件の moderate 警告

Expo SDK の依存に含まれるもので、アプリの実行時に影響するものではありません。
Phase 11（テスト強化）でまとめて確認します。

---

## 5. 次にやること — Phase 2（Firebase）

1. Firebase プロジェクトを2つ作成（`pt-app-dev` / `pt-app-prod`）— **Spark プランのまま**
2. Firestore を有効化（Storage と Functions は使わないので有効化しない）
3. `firebase/firestore.rules` に初期 Rules を作成（既定は全拒否）
4. Firebase Emulator Suite をセットアップ
5. `@firebase/rules-unit-testing` でテストの土台を作る
6. アプリから Firestore に接続できることを確認
7. `.env` に接続情報を入れる

### Phase 2 に入る前に、お願いしたいこと

Firebase プロジェクトの作成にはあなたのアカウントが必要です。以下のどちらかを選んでください。

- **(a) 手順書を用意します** — スクリーンショット付きの手順を書きますので、それに沿って
  ご自身で作成し、`.env` に入れる値を教えてください（apiKey 等は秘密情報ではないので共有可能です）
- **(b) 画面共有などで一緒に作業する** — 迷ったら声をかけてください

また、設計書 §15.2 の Q1〜Q8 のうち、**Q2（ログイン用のドメイン）は Phase 3 で必要**になります。
それまでにお決めいただければ大丈夫です。
