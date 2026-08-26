# AIパーソナルトレーナー 食事・運動管理アプリ

パーソナルトレーナーが 1〜10名の契約者の食事・運動・体重・メモを管理するための iPhone アプリです。

AIに全部任せるアプリではありません。**AIが入力を楽にし、人間が確認・修正し、確定したデータを正確に管理する**アプリです。

```
AI(推定) → 人間の確認 → 手動修正 → 確定 → 決定論的PFC計算 → 保存
```

設計の全体像は [`docs/00_DESIGN.md`](docs/00_DESIGN.md) を参照してください。

---

## どうやって使うものか

契約者は **Safari で URL を開いて「ホーム画面に追加」** します。App Store には出しません。
ホーム画面から開くと Safari のバーが消え、ふつうのアプリと同じ見た目になります。

- 審査なし・年会費なし
- 直したらすぐ全員に反映される
- 配るときは URL を送るだけ

## 現在の状況

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | 仕様・設計 | ✅ 完了 |
| 1 | プロジェクト作成・GitHub整備 | ✅ 完了 |
| 2 | Firebase + 自動公開（URLで開けるようになる） | ✅ 完了 |
| 3 | 認証・権限 | ✅ 完了 |
| 4 | 契約者管理 | ⬜ 未着手 |
| 5 | カレンダー | ⬜ 未着手 |
| 6 | 食事・食品・PFC計算 | ⬜ 未着手 |
| 7 | 運動・メモ | ⬜ 未着手 |
| 8〜10 | AI（画像解析・自然言語編集・評価） | ⬜ 未着手 |
| 11〜12 | テスト強化・実機での運用開始 | ⬜ 未着手 |

**最後までクレジットカード登録は不要です。** Firebase は Spark プラン固定、公開は GitHub Pages、AI は Gemini の無料枠で完結します。

---

## 開発の進め方

**このリポジトリを手元で動かす必要はありません。**

```
コードを書く → GitHub Desktop で push
   ↓ 自動（GitHub Actions）
型チェック → lint → テスト → ビルド
   ↓ 自動
GitHub Pages に公開
   ↓
Safari で URL を開く
```

公開先:

```
https://<GitHubのユーザー名>.github.io/pt-app/
```

**鍵やトークンを貼り付ける作業はありません。** GitHub Pages への公開は GitHub 自身の権限で行われます。

Firebase の接続情報は `apps/web/src/config/firebase.ts` に直接書いてあります（秘密情報ではないため。理由は下の「秘密情報について」を参照）。

## 手元で動かしたい場合（任意）

自分でもコードをいじりたくなったときだけ、以下を行ってください。

### 必要なもの

- Node.js 20.19 以上（推奨: 22系）

### 手順

```bash
git clone <このリポジトリのURL>
cd pt-app

npm install

npm run dev
#    → http://localhost:5173 が開きます
#    → 同じ Wi-Fi 上の iPhone からも、表示されるネットワークURLで開けます
```

### 動作確認

「セットアップが完了しました」という画面が出ます。
サンプルの食事（白米180g / 鶏ささみ150g / 卵60g）の内訳と合計 513kcal が表示されれば、
モノレポと PFC計算エンジンが正しくつながっています。

---

## リポジトリ構成

```
pt-app/
├── apps/
│   └── web/                 PWA（React + Vite）
│       ├── index.html       iOS 向けのメタタグ（ホーム画面追加時の見え方）
│       ├── vite.config.ts   ★アプリ名（manifest）はここ
│       ├── public/          アイコン・ホスティング設定
│       └── src/
│           ├── App.tsx      画面
│           ├── config/      環境変数の読み取り口
│           ├── hooks/
│           └── styles.css   配色トークン（P/F/C の色もここ）
│
├── packages/
│   ├── core/                ★PFC計算エンジン（純粋ロジック）
│   │   └── src/nutrition/   栄養値の型・換算・合計・表示丸め
│   └── ai-contract/         AIの抽象インターフェースと入出力スキーマ
│
├── worker/                  AI中継サーバー（Cloudflare Worker）— Phase 8
├── firebase/                ★Security Rules と、その自動テスト
│   ├── firestore.rules      唯一の防衛線
│   └── tests/rules.test.ts  権限テスト55件
├── docs/
│   └── 00_DESIGN.md         設計書
└── .env.example             環境変数のひな形
```

### GitHub Pages のサブパスについて

URL がリポジトリ名を含む（`.../pt-app/`）ため、`apps/web/vite.config.ts` の `BASE` を
`'/pt-app/'` にしています。独自ドメインを使うようになったら、そこを `'/'` に変えるだけです。

### `packages/core` は特別です

このパッケージは **Firebase も AI も React も import しません**。
純粋な TypeScript の関数だけを置きます。

これは設計上の要求（設計書 §14 / §37「AIと計算エンジンの責任分離」）であり、
`eslint.config.mjs` の `no-restricted-imports` で機械的に強制しています。
Firebase を import しようとすると lint エラーになります。

---

## コマンド

```bash
npm run dev          # 開発サーバーを起動（http://localhost:5173）
npm run build        # 本番用にビルド（apps/web/dist に出力）
npm test             # 全パッケージのテストを実行
npm run test:rules   # Security Rules のテスト（Java と Emulator が必要）
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

**このリポジトリは Public です。** GitHub Pages を無料で使うための条件です。
そのため「何が入っていて、何が入っていないか」を明確にしておきます。

### 入っているもの（見られても問題ないもの）

- プログラムのコード
- **Firebase の接続情報**（`apps/web/src/config/firebase.ts`）
- Security Rules

### 入っていないもの

- **契約者の氏名・記録・写真・体重 — 一切入りません。** すべて Firestore 側にあります
- AI の APIキー
- Firebase のサービスアカウント鍵
- 証明書・秘密鍵

### なぜ Firebase の apiKey を隠さないのか

隠せないからです。この値はビルドすると JavaScript に埋め込まれ、
アプリを開いた人なら誰でもブラウザの開発者ツールで見られます。
環境変数にしても、GitHub Secrets にしても、結果は同じです。

**データを守っているのは Firestore Security Rules です。**
apiKey を知っていても、Rules が正しければ他人のデータには一切触れません。

Rules がこのアプリの唯一の防衛線なので、Rules のテストを最優先で書きます
（設計書 §7 / §16.7）。リポジトリが Public である以上、
**権限テストが緑でない状態で公開しないこと**を徹底します。

### AI の APIキーだけは別扱い

こちらは本物の秘密情報です。**Cloudflare Worker の Secret** に置きます（Phase 8）。
アプリのコードにも GitHub にも、絶対に入れません。

```bash
npx wrangler secret put GEMINI_API_KEY
```

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

## 公開（GitHub Pages）

`.github/workflows/deploy.yml` が全部やります。

1. `main` に変更が入る
2. GitHub Actions が型チェック・lint・テスト・ビルドを実行
3. 通ったら GitHub Pages に公開

**あなたの作業は GitHub Desktop で更新を送るだけです。**

### 一度だけ必要な設定

リポジトリの Settings → Pages で、Source を「**GitHub Actions**」にします。

### 壊れたものは公開されません

デプロイの前に `npm run verify`（型・lint・テスト）と
**Security Rules のテスト55件**が走ります。
ひとつでも失敗したらそこで止まり、公開中のアプリは前のバージョンのまま残ります。

### Security Rules は手動で反映が必要です

リポジトリの `firebase/firestore.rules` は、**Firebase に登録しないと効きません。**

Firebase コンソール → Firestore → 「ルール」タブに中身を貼り付けて「公開」してください。
Rules を変更したときは毎回必要です。
