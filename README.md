# AIパーソナルトレーナー 食事・運動管理アプリ

パーソナルトレーナーが 1〜10名の契約者の食事・運動・体重・メモを管理するための iPhone アプリです。

AIに全部任せるアプリではありません。**AIが入力を楽にし、人間が確認・修正し、確定したデータを正確に管理する**アプリです。

```
AI(推定) → 人間の確認 → 手動修正 → 確定 → 決定論的PFC計算 → 保存
```

設計の全体像は [`docs/00_DESIGN.md`](docs/00_DESIGN.md) を参照してください。

---

## 現在の状況

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | 仕様・設計 | ✅ 完了 |
| 1 | プロジェクト作成・GitHub整備 | ✅ 完了 |
| 2 | Firebase (Spark) | ⬜ 未着手 |
| 3 | 認証・権限 | ⬜ 未着手 |
| 4 | 契約者管理 | ⬜ 未着手 |
| 5 | カレンダー | ⬜ 未着手 |
| 6 | 食事・食品・PFC計算 | ⬜ 未着手 |
| 7 | 運動・メモ | ⬜ 未着手 |
| 8〜10 | AI（画像解析・自然言語編集・評価） | ⬜ 未着手 |
| 11〜13 | テスト強化・実機・公開準備 | ⬜ 未着手 |

**Phase 7 まではクレジットカード登録なしで進みます**（Firebase は Spark プラン固定）。

---

## セットアップ

### 必要なもの

- Node.js 20.19 以上（推奨: 22系）
- iPhone に **Expo Go** アプリをインストール
- PC と iPhone が同じ Wi-Fi につながっていること

### 手順

```bash
# 1) 取得
git clone <このリポジトリのURL>
cd pt-app

# 2) 依存関係をインストール（モノレポ全体が一度に入ります）
npm install

# 3) 環境変数を用意
cp .env.example .env
#    → Phase 2 で Firebase の値を入れます。Phase 1 の動作確認だけなら空のままでOK

# 4) 起動
npm start
#    → ターミナルにQRコードが出ます。iPhone のカメラで読み取ると Expo Go で開きます
```

### 動作確認

起動すると「セットアップが完了しました」という画面が出ます。
サンプルの食事（白米180g / 鶏ささみ150g / 卵60g）の内訳と合計が表示されれば、
モノレポと PFC計算エンジンが正しくつながっています。

---

## リポジトリ構成

```
pt-app/
├── apps/
│   └── mobile/              Expo アプリ（iPhone）
│       ├── app.config.ts    ★アプリ名はここ1箇所だけで定義
│       └── src/
│           ├── app/         画面（expo-router のファイルベースルーティング）
│           ├── config/      環境変数の読み取り口
│           └── theme/       配色トークン（P/F/C の色もここ）
│
├── packages/
│   ├── core/                ★PFC計算エンジン（純粋ロジック）
│   │   └── src/nutrition/   栄養値の型・換算・合計・表示丸め
│   └── ai-contract/         AIの抽象インターフェースと入出力スキーマ
│
├── worker/                  AI中継サーバー（Cloudflare Worker）— Phase 8
├── firebase/                Rules と Emulator 設定 — Phase 2
├── docs/
│   └── 00_DESIGN.md         設計書
└── .env.example             環境変数のひな形
```

### `packages/core` は特別です

このパッケージは **Firebase も AI も React Native も import しません**。
純粋な TypeScript の関数だけを置きます。

これは設計上の要求（設計書 §14 / §37「AIと計算エンジンの責任分離」）であり、
`eslint.config.mjs` の `no-restricted-imports` で機械的に強制しています。
Firebase を import しようとすると lint エラーになります。

---

## コマンド

```bash
npm start            # Expo 開発サーバーを起動
npm test             # 全パッケージのテストを実行
npm run typecheck    # 型チェック
npm run lint         # ESLint
npm run format       # Prettier で整形
npm run verify       # typecheck + lint + test をまとめて実行
```

---

## いちばん大事なルール

### 合計は必ず内訳の積み上げから出す（設計書 §15）

```
食材ごとの合計 === 食事合計 === 日合計
```

これを「ほぼ一致」ではなく「**厳密に一致**」で保証するため、
栄養値は内部的に **1/1000 単位の整数**で保持しています。

```ts
kcal: 123456  // = 123.456 kcal
p:     35042  // = 35.042 g
```

浮動小数だと `(a+b)+(c+d)` と `((a+b)+c)+d` がズレることがあり、
「食事ごとに合計してから足した日合計」と「全食品を一度に足した合計」が
微妙に食い違います。整数で持てばこの問題は原理的に起きません。

丸めは **表示のときだけ** `formatNutrients()` で行います。
計算経路で丸めないでください。

### 加算の入口は1つだけ

栄養値を足すのは `sumNutrients()` だけです。
「合計だけ別に計算する」経路を作らないでください。

### AIは計算しない

AIが返すのは「何を・どれだけ食べたか」の候補だけです。
kcal / PFC の計算は必ず `packages/core` の関数が行います。

例外はパッケージの栄養成分表示を読み取った値（`packageLabel`）のみで、
これは設計書 §13 の優先度2の情報として扱います。

### AIが報告されていないことを足していないか、必ず検査する

`packages/ai-contract` の `guardRecognition()` が、AIの返した根拠（`evidence`）が
実際の入力に存在するかを照合します。「徒歩出勤した」から「徒歩帰宅した」を
推測するようなことが起きても、ここで破棄されます（設計書 §12）。

---

## 秘密情報について

### GitHub に入れてはいけないもの

- `.env`（`.gitignore` 済み）
- AI の APIキー
- Firebase のサービスアカウント鍵（`*-firebase-adminsdk-*.json`）
- 証明書・秘密鍵（`*.pem` `*.key` `*.p8` `*.p12`）

AI の APIキーは **Cloudflare Worker の Secret** に置きます（Phase 8）。
アプリのバンドルには絶対に入れません。

```bash
cd worker
npx wrangler secret put GEMINI_API_KEY
```

### Firebase の apiKey は秘密ではありません

`EXPO_PUBLIC_FIREBASE_API_KEY` はアプリに埋め込まれ、誰でも取り出せます。
これは仕様どおりで、問題ではありません。

**データを守っているのは Firestore Security Rules です。**
Rules がこのアプリの唯一の防衛線なので、Rules のテストを最優先で書きます
（設計書 §7 / §16.7）。

---

## ブランチ運用

```
main       安定版（実機に配るもの）
develop    統合先
feature/*  機能単位
fix/*      修正
```

`develop` へは PR 経由。CI（typecheck / lint / test）が緑でないとマージしません。

---

## GitHub への登録

このリポジトリはまだリモートに紐づいていません。GitHub で空のリポジトリを作ってから:

```bash
git remote add origin git@github.com:<あなたのアカウント>/pt-app.git
git push -u origin main
git push -u origin develop
```

**リポジトリは Private を推奨します。** 契約者の健康情報を扱うアプリのため、
将来的にテストデータなどが混ざるリスクを避けます。
