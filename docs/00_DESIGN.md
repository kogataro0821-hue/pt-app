# AIパーソナルトレーナー 食事・運動管理アプリ ─ 設計書 (Phase 0)

- 版: v0.5 (公開先を GitHub Pages に変更)
- 作成日: 2026-08-26 / 更新: 2026-08-26
- ステータス: **未承認 / 実装未着手**

> このドキュメントは指示書 §48 に対する回答です。承認を頂くまで実装は開始しません。

**v0.4 での変更点** — 契約者への配り方が「Safari で開いてホーム画面に追加」だと判明したため、アプリの作りを変更しました。

| 決定 | 内容 | 影響範囲 |
|---|---|---|
| 配布は PWA | App Store には出さない。Safari で開いてホーム画面に追加してもらう | §2, §11, §13 |
| React Native をやめる | React + Vite の Web アプリに変更。動作が軽く、Safari との相性がよい | §2 |
| ローカル開発環境を作らない | GitHub に push すると GitHub Actions が自動でビルドして GitHub Pages に公開する | §4, §13 |
| 公開先は GitHub Pages | 追加のサービスもアカウントも不要。リポジトリは Public にする | §4.5 |

PFC計算エンジン（`packages/core`）と AI スキーマ（`packages/ai-contract`）は**一切変更なし**で流用できました。「純粋ロジックは何にも依存させない」という設計方針（§3.1）が効いています。

**v0.2 での変更点** — 以下のご判断を反映し、バックエンド構成を組み替えました。

| 決定 | 内容 | 影響範囲 |
|---|---|---|
| クレジットカード登録なし | Firebase は **Spark プラン固定**。Storage と Cloud Functions は**使わない** | §4, §6, §8, §9, §13 |
| AI は無料枠 + 契約者への明示同意 | Gemini API 無料枠を使用。契約者から同意を取得する運用とUIを追加 | §9.7 |
| 過去データ修正 | 契約者は**直近N日以内なら自由**（既定 7日）。それ以前は管理者のみ | §7.2 |
| 食品マスタ初期データ | **空から開始**。使いながら登録していく | §12 |

---

## 1. 要件の理解

### 1.1 このアプリの本質

「カロリー計算アプリ」ではなく **トレーナー業務支援システム** である、という点を設計の中心に置きます。

指示書 §47 の思想を、そのままシステムの背骨にします。

```
AI(推定) → 人間の確認 → 手動修正 → 確定 → 決定論的PFC計算 → 保存
```

ここから導かれる、実装上の3つの絶対原則:

| # | 原則 | 実装への落とし込み |
|---|---|---|
| A | **AIは計算しない** | AIは「何を・どれだけ食べたか」の候補を返すだけ。kcal/PFCの合計は必ずアプリ内の純粋関数が計算する |
| B | **推定と確定を型で区別する** | 全ての栄養値に `nutritionSource` / `quantityStatus` / `confidence` を必須で持たせる。型レベルで「推定値のまま確定保存」ができない構造にする |
| C | **合計は必ず内訳の積み上げ** | `食品ごとの値の総和 == 食事合計 == 日合計` を、キャッシュではなく再計算で保証し、テストで厳密一致を検証する |

### 1.2 スコープの理解

| 項目 | 理解 |
|---|---|
| 利用者 | 管理者(トレーナー) 1名 + 契約者 1〜10名 |
| プラットフォーム | iPhone (実機MVP優先、App Store公開は後回しだが将来可能な構造) |
| バックエンド | Firebase (Auth / Firestore / Storage / Functions) |
| AI | プロバイダー非依存の抽象化。無料枠優先 |
| データ分離 | 契約者間は**バックエンドレベルで完全分離**。UI隠蔽は不可 |
| 中心導線 | カレンダー → 日付 → その日の詳細 |
| 「おやすみ」 | 独立機能ではなく「1日確定 (finalize)」として実装 |

### 1.3 特に慎重に扱う要件

- **§12 AIの勝手な補完禁止** — プロンプトだけでは守れません。後処理バリデータ + 確認必須UIの3重で担保します（詳細 §9.6）。
- **§13 情報の優先順位** — 7段階の優先順位を `NutritionResolver` という単一の関数に閉じ込め、他の場所で栄養値を決定しない。
- **§41 スナップショット** — 食事に記録した時点の栄養値をコピー保存。マスタ更新は過去に遡及しない。
- **§17 油** — 「使った量」ではなく「摂取した量」。既定は 0g、明示された場合のみ計上。

---

## 2. 推奨技術スタック

### 2.1 結論

**React + Vite + TypeScript の Web アプリ（PWA）** を推奨します。

契約者は Safari で URL を開き、共有ボタン →「ホーム画面に追加」で、ふつうのアプリと同じように使えます。

### 2.2 なぜネイティブアプリ（App Store）にしないのか

| 観点 | PWA（Safari + ホーム画面に追加） | ネイティブアプリ（App Store） |
|---|---|---|
| 契約者への配り方 | **URL を送るだけ** | App Store で検索してもらう / TestFlight で招待 |
| 費用 | **0円** | Apple Developer Program 年 $99 |
| 審査 | **なし** | あり。健康関連アプリは特に厳しい |
| 修正の反映 | **即座に全員へ** | 審査待ち（数日）。契約者が更新するまで古いまま |
| 開発機 | Windows で完結 | ビルドに Mac が必要（クラウドビルドで回避可能だが手間） |
| カメラ | 使える（写真の撮影・選択） | 使える |
| プッシュ通知 | iOS 16.4 以降、ホーム画面に追加していれば使える | 使える |
| HealthKit（歩数の自動取得） | **使えない** | 使える |
| オフライン | Service Worker で対応可能 | 対応可能 |

**決め手**: 契約者が1〜10人という規模で、App Store の審査と年会費を払う理由がありません。「URL を送るだけ」で配れることのほうが、この業務にはずっと価値があります。

**諦めるもの**: HealthKit 連携（歩数の自動取り込み）はできません。歩数は手入力になります。将来どうしても必要になったら、そのときにネイティブ化を検討します。

### 2.3 なぜ React Native をやめたのか

当初は「App Store にも出せるように」React Native + Expo を選びました。PWA に決まった以上、React Native Web を経由する意味がなくなります。

| | React Native + Expo（旧） | React + Vite（新） |
|---|---|---|
| ビルドサイズ | 1.1 MB | **198 KB（gzip 63 KB）** |
| 依存パッケージ | 717 | **488** |
| 脆弱性警告 | 11件 | **0件** |
| Safari との相性 | Web は「おまけ」の位置づけ | Web が本命 |
| PWA 対応 | 追加設定が必要 | 標準的な手順で済む |

Phase 1 の成果のうち、**PFC計算エンジンと AI スキーマはそのまま流用**できました。作り直したのは画面の枠だけです。

### 2.4 採用ライブラリ

| 領域 | 採用 | 理由 |
|---|---|---|
| 言語 | TypeScript (strict) | 型で推定/確定を区別する設計の前提 |
| フレームワーク | React 19 + Vite 7 | 軽い。ビルドが速い |
| PWA | vite-plugin-pwa（Workbox） | manifest と Service Worker を自動生成 |
| ルーティング | React Router（Phase 5 で導入） | 画面が増えてから入れる |
| 状態管理 | Zustand + Firestore onSnapshot ラッパー | 軽量。Reduxは過剰 |
| フォーム/検証 | react-hook-form + **zod** | zodスキーマを AI出力検証 / Firestore書込検証 / フォーム検証 で共用 |
| カレンダー | 自作（Phase 5） | 日本語の月表示は自作のほうが軽く、思いどおりになる |
| グラフ | 自作の SVG（Phase 6） | PFCリングと推移グラフだけならライブラリ不要 |
| 画像圧縮 | Canvas API（ブラウザ標準） | 追加ライブラリ不要 |
| テスト | Vitest / Firebase Emulator + @firebase/rules-unit-testing | §43 のテストに対応 |
| 品質 | ESLint + Prettier + tsc --noEmit | CIで強制 |

### 2.5 リポジトリ構成（モノレポ）

```
pt-app/
├── apps/
│   └── web/                 PWA（React + Vite）
│       ├── public/          アイコン・ホスティング設定
│       └── src/
│           ├── config/      環境変数の読み取り口
│           ├── hooks/
│           └── styles.css   配色トークン
├── packages/
│   ├── core/                ★純粋ロジック（Firebase/AI非依存）
│   │   ├── nutrition/       栄養値解決・PFC計算エンジン
│   │   ├── schema/          zodスキーマ（Firestore + AI I/O）
│   │   └── units/           単位換算
│   └── ai-contract/         AIProviderインターフェース + 入出力スキーマ
├── worker/                  Cloudflare Worker (AI中継のみ)
├── firebase/
│   ├── firestore.rules
│   └── firestore.indexes.json
├── docs/
├── .env.example
├── .gitignore
└── README.md
```

**`packages/core` は Firebase も AI も import しません。** これが §14/§37「責任分離」の物理的な担保です。ESLint の `no-restricted-imports` で機械的に禁止しています。

---

## 3. アーキテクチャ

### 3.1 レイヤー構成

```
┌─────────────────────────────────────────────────────┐
│ UI層  pages / components （React + Vite / PWA）     │
│   カレンダー・日別詳細・食事編集・AI確認画面        │
├─────────────────────────────────────────────────────┤
│ アプリケーション層  hooks / usecases                │
│   addMealItem / applyEditOperations / finalizeDay   │
├─────────────────────────────────────────────────────┤
│ ドメイン層  packages/core   ★純粋・副作用なし       │
│   NutritionResolver / PFCEngine / UnitConverter     │
│   → Firebase も AI も知らない。100%ユニットテスト   │
├─────────────────────────────────────────────────────┤
│ インフラ層                                          │
│   FirestoreRepository / StorageRepository           │
│   AIClient (Cloudflare Worker 経由)                 │
└─────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │  Cloudflare Worker（無料プラン）  │
        │   IDトークン検証 → レート制限     │
        │   AIProvider抽象 → Gemini/OpenAI  │
        │   APIキーはここだけが保持          │
        └───────────────────────────────────┘
```

### 3.2 データフロー（写真からの食事登録）

```
[写真撮影]
   ↓ 端末で2種類生成: 解析用(長辺1024px) / 保存用(長辺640px 約50KB)
[Cloudflare Worker: POST /ai/meal/photo]
   ↓ AIProvider → Gemini (structured output)
[JSON] { items: [{name, brand, quantity, unit, confidence, evidence, packageLabel?}] }
   ↓ zod検証 → 失敗なら1回リトライ → それでも失敗なら手動入力へフォールバック
[ハルシネーション検査] evidence欠落 / confidence低 → needsReview = true
   ↓
[確認画面]  ← ★ここを通さずに保存する経路は存在しない
   ↓ ユーザーが数量・食品を修正 → quantityStatus = 'confirmed'
[NutritionResolver]  優先順位1〜7で 100gあたり栄養値を決定
   ↓
[PFCEngine]  数量 × 100gあたり値 → 食品ごとの確定 nutrients
   ↓
[sumNutrients]  食品合計 → 食事合計 → 日合計（同一の加算関数）
   ↓
[Firestore保存]  itemsとtotalsを同時保存 + 保存用画像をphotosサブコレクションへ
```

### 3.3 環境分離

| 環境 | Firebaseプロジェクト | 用途 |
|---|---|---|
| dev | `pt-app-dev` | 開発・Emulator接続 |
| prod | `pt-app-prod` | 実運用 |

無料枠が実質2倍になり、開発中の事故が本番データに波及しません。

---

## 4. バックエンド構成（完全無料 / カード登録なし）

### 4.1 決定と、その帰結

**カード登録をしない** というご判断により、Firebase の **Cloud Storage と Cloud Functions は使えません**（2024年9月以降の新規プロジェクトでは、どちらも Blaze プラン必須のため）。

そこで、この2つが担っていた役割を別の手段で置き換えます。

| 役割 | サービス | 無料枠 | カード |
|---|---|---|---|
| 認証 | Firebase Authentication (Spark) | 実質無制限（Email/Password） | 不要 |
| データベース | Cloud Firestore (Spark) | 1GB / 読 50,000・書 20,000 per day | 不要 |
| 写真保存 | **Firestore に圧縮画像を格納** | 上記1GBに含む | 不要 |
| AI中継サーバー | **Cloudflare Workers** 無料プラン | 100,000 リクエスト/日、10ms CPU/呼出 | 不要 |
| レート制限 | Workers KV 無料プラン | 読 100,000/日・書 1,000/日 | 不要 |
| AI本体 | Gemini API 無料枠 | RPM/RPD 制限あり | 不要 |
| アプリの公開 | **GitHub Pages** 無料プラン | 1GB・100GB/月 | 不要 |

> Cloudflare Workers の「10ms CPU」は **CPUを実際に使った時間**であり、Gemini API の応答を待っている時間は含まれません。中継処理（JWT検証 + JSON整形）は数ミリ秒で収まるため、この制限は問題になりません。

### 4.2 Cloud Functions が必要だった処理を、どう置き換えるか

Cloud Functions を使いたかった理由は2つだけでした。どちらもサーバーなしで解決できます。

| 元の用途 | 置き換え | 詳細 |
|---|---|---|
| AI APIキーを端末に置かないため | **Cloudflare Worker が中継** | キーは Worker Secret に格納。アプリのバンドルには一切入らない (§9.2) |
| 契約者アカウント作成 + 権限付与（Custom Claims） | **クライアントだけで完結する方式へ変更** | Custom Claims をやめ、`users/{uid}` ドキュメント + Security Rules の `get()` で権限判定 (§6.4) |

### 4.3 写真の保存方式

Firebase Storage が使えないため、**圧縮した画像を Firestore ドキュメントに base64 で格納**します。

| 用途 | サイズ | 扱い |
|---|---|---|
| AI解析用 | 長辺1024px / JPEG q0.7 / 約150KB | **保存しない**。Worker へ直接送り、解析後に破棄 |
| 記録・確認用 | 長辺640px / JPEG q0.6 / 約40〜60KB | base64（約55〜80KB）で Firestore に保存 |
| 栄養成分表示の撮影 | 長辺1280px / JPEG q0.75 / 約150KB | 文字が読める必要があるため別プリセット。食品マスタに1枚だけ |

- Firestore の1ドキュメント上限は **1MB**。1枚1ドキュメントなら十分に収まります
- `clients/{cid}/days/{date}/photos/{photoId}` に隔離するため、**食事ドキュメントの読み取りは軽いまま**です
- 写真を消しても、食事データと PFC は完全に残ります（§8）

**容量試算**: 10人 × 3枚/日 × 30日 = 900枚/月 × 70KB ≒ **63MB/月 → 年間 約750MB**。
Firestore 無料枠 1GB に対して **1年強で上限**に届きます。そのため **90日保持 + 古い写真の一括削除** を最初から実装します。

**将来の代替案**: 写真をもっと長く残したくなった場合、Supabase Storage の無料枠（1GB / カード不要）を追加する構成へ切り替えられます。ただし別アカウントと認証の橋渡しが必要になるため、まずは Firestore 方式で始め、容量が実際に問題になってから判断することを推奨します。（Supabase の無料プロジェクトは1週間アクセスがないと停止しますが、毎日使うアプリなら該当しません）

### 4.4 コスト試算（10人・1年運用）

| 項目 | 想定量 | 無料枠 | 判定 |
|---|---|---|---|
| Firestore 読取 | 約 4,000/日（Rules内の `get()` 込み） | 50,000/日 | ◎ 余裕 |
| Firestore 書込 | 約 600/日 | 20,000/日 | ◎ 余裕 |
| Firestore 保存（写真以外） | 約 50MB/年 | 1GB | ◎ 余裕 |
| Firestore 保存（写真） | 約 750MB/年 | 上記1GBを共有 | △ **90日保持で維持** |
| Cloudflare Workers | 約 50/日 | 100,000/日 | ◎ 余裕 |
| Workers KV 書込 | 約 50/日 | 1,000/日 | ◎ 余裕 |
| Gemini API | 約 1,500/月 | 無料枠内 | ○ §9.7 の同意運用が前提 |

**この構成の実費は 0円です。** クレジットカードの登録も不要です。

### 4.5 公開の仕組み（ローカル開発環境を作らない）

**PC に開発環境を作らず、追加のサービスも使いません。** 次のように回ります。

```
コードを書く
   ↓
GitHub Desktop で push
   ↓ （自動・GitHub Actions）
型チェック → lint → テスト → ビルド
   ↓ （自動）
GitHub Pages に公開
   ↓
Safari で URL を開く
```

公開先の URL は次の形です。

```
https://<GitHubのユーザー名>.github.io/pt-app/
```

**鍵やトークンを貼り付ける作業はありません。** GitHub Pages への公開は GitHub 自身の権限で行われるため、Secrets の設定が不要です。

> **リポジトリを Public にする必要があります**
> GitHub Pages は、無料プランでは Public リポジトリでしか使えません（Private で使うには GitHub Pro が必要）。
>
> Public にしても問題ありません。リポジトリに入るのはコード・Firebaseの接続情報・Security Rules だけで、**契約者の氏名・記録・写真は一切入りません**。それらは Firestore 側にあり、Rules で守られます。Rules が見えても破れません（設計書 §7.6）。
>
> **Firebase の接続情報（apiKey 等）は `apps/web/src/config/firebase.ts` に直接書いています。** これらはビルド後のJSに必ず埋め込まれ、アプリを開いた人なら誰でも見られる値なので、隠す方法もなければ隠す必要もありません。環境変数にしても同じです。
>
> 一方 AI の APIキーは**絶対にここに書きません**。Cloudflare Worker の Secret に置きます（§9.2）。

> **他の選択肢を採らなかった理由**
> Cloudflare Pages / Firebase Hosting も無料で使えますが、どちらもアカウントや鍵の受け渡しが増えます。GitHub Pages なら GitHub だけで完結し、すでに慣れている運用（ファイルを更新して GitHub Desktop で送る）がそのまま使えます。

### 4.6 有料化が必要になる分岐点

先に明示しておきます。以下に該当したときだけ、改めてご相談します。

| 分岐点 | 目安 | そのときの選択肢 |
|---|---|---|
| Firestore 1GB に到達 | 写真を無制限に貯め続けた場合、約1年3か月 | 保持期間を短縮 / Supabase Storage 追加 / Blaze へ |
| Gemini 無料枠の日次上限 | 1日あたりの解析回数が急増した場合 | 有料枠へ（Worker の環境変数を差し替えるだけ） |
| 契約者が30人を超える | 読み書き回数が無料枠の半分を超える | Blaze へ（この規模なら実費も現実的） |
| プッシュ通知が必要 | FCM 自体は無料。ただし送信の自動化にはサーバーが要る | Cloudflare Worker + Cron Triggers（無料枠内） |
| GitHub Pages の帯域超過 | 月100GB。1人あたり数MBなので実質到達しない | — |
| リポジトリを Private にしたくなった | ソースを隠したくなった場合 | GitHub Pro（月$4）にするか、Cloudflare Pages（無料）へ移す |

---

## 5. Firestoreデータモデル

### 5.1 設計原則

> **契約者に紐づくデータは、例外なく `clients/{clientId}/` 配下に置く。**

これにより「契約者Aが契約者Bを見られない」がパス比較1行で表現でき、Security Rulesのバグ余地が消えます（§34の要求）。

### 5.2 コレクション構成

```
users/{uid}
  role: 'admin' | 'client'
  clientId: string | null
  active: boolean

clients/{clientId}
  displayName, age, sex, heightCm
  startDate, active, memo
  targets: { kcal, p, f, c, weightKg, bodyFatPct, exercise }
  reviewMode: 'gentle' | 'standard' | 'strict' | 'very_strict'
  permissions: { allowPastEdit, pastEditWindowDays, allowFoodCreate, ... }
  authUid, createdAt, updatedAt
  extra: map            ← ★項目を後から足せる拡張フィールド (§4)

  ├── days/{yyyy-MM-dd}          日次サマリ・確定状態・AI評価
  │     └── meals/{mealId}       1食（食品内訳を配列で内包）
  │     └── photos/{photoId}     ★写真本体(base64) を隔離して保持
  │     └── exercises/{exerciseId}
  │     └── notes/{noteId}
  ├── measurements/{yyyy-MM-dd}  体重・体脂肪率
  ├── foods/{foodId}             個人食品マスタ
  ├── recipes/{recipeId}         個人レシピ
  ├── favorites/{favoriteId}     お気に入り
  ├── aiSessions/{sessionId}     AI会話履歴（★食事データと分離）
  │     └── messages/{messageId}
  └── audits/{auditId}           変更履歴

foods/{foodId}                   共通食品マスタ（管理者のみ書込）
recipes/{recipeId}               共通レシピ
config/app                       アプリ名・表示設定・同意文面バージョン
```

### 5.3 主要ドキュメントのスキーマ

#### Nutrients（栄養値・全所で共通の値オブジェクト）

```ts
type Nutrients = {
  kcal: number;   // 内部は丸めない
  p: number;      // g
  f: number;      // g
  c: number;      // g
  fiber?: number; // g
  salt?: number;  // g
};
```

#### MealItem（★このアプリの心臓部）

```ts
type MealItem = {
  itemId: string;
  name: string;                 // '白米'
  brand?: string;               // メーカー
  productName?: string;         // 商品名
  packageSize?: string;         // 内容量表記

  ref: { type: 'food' | 'recipe' | 'adhoc';
         id?: string; version?: number };   // マスタ参照（バージョン付き）
  groupRef?: { recipeId: string; recipeName: string }; // レシピ展開元

  quantity: { value: number; unit: Unit };
  quantityStatus: 'confirmed' | 'estimated' | 'unknown';
  quantityRange?: { min: number; max: number };  // 「150〜180g」

  // ★ スナップショット（§41）: 記録時点の値をコピー保存。マスタ更新は遡及しない
  nutrientsPer100g: Nutrients;
  nutrients: Nutrients;         // = per100g × 実摂取量。合計はこれだけを足す

  nutritionSource:
    | 'user_input'      // 優先度1
    | 'package_label'   // 優先度2
    | 'food_master'     // 優先度3
    | 'recipe'          // 優先度4
    | 'reference_db'    // 優先度5
    | 'generic'         // 優先度6
    | 'ai_estimate';    // 優先度7
  sourcePriority: 1|2|3|4|5|6|7;

  confidence?: number;          // 0..1（AI由来のときのみ）
  aiEstimate?: {                // 監査用。★合計計算には絶対に使わない
    quantity, nutrients, confidence, evidence, model, promptVersion
  };
  needsReview: boolean;         // 要確認フラグ
  note?: string;
};
```

#### Meal

```ts
type Meal = {
  mealId: string;
  date: string;            // 'yyyy-MM-dd'
  order: number;           // 1,2,3...
  label: string;           // '1食目' / '間食' — ユーザーが自由に変更可 (§8)
  eatenAt?: Timestamp | null;
  items: MealItem[];       // 埋め込み配列（1食あたり最大30件想定）
  totals: Nutrients;       // items から算出した表示キャッシュ
  engineVersion: string;   // 'pfc-engine@1.0.0'
  status: 'draft' | 'confirmed';
  inputMethod: 'photo'|'text'|'food'|'recipe'|'manual';
  photoIds: string[];      // photos サブコレクションのID（写真を消しても本レコードは残る §28）
  aiSessionId?: string;    // 参照は片方向のみ（会話を消してもMealは無傷 §40）
  createdBy, createdAt, updatedBy, updatedAt
};
```

> **items を配列で内包する理由**: 1食の栄養は原子的に整合していなければなりません（§15）。サブコレクションだと一部だけ書き込み成功する状態が生まれ得ます。配列なら1回の書込で必ず整合します。

#### Day

```ts
type Day = {
  date: string;
  status: 'open' | 'finalized';        // §7「1日確定」
  finalizedAt?, finalizedBy?
  totals: Nutrients;                   // meals合計（表示キャッシュ）
  mealTotals: Record<mealId, Nutrients>;
  targetSnapshot: { kcal, p, f, c };   // ★その日時点の目標を凍結
  diffFromTarget: Nutrients;
  exerciseSummary?: { count, totalMinutes, steps? };
  weightKg?, bodyFatPct?
  aiReview?: { text, mode, model, promptVersion, generatedAt, editedByTrainer? };
  hasMeal: boolean; hasExercise: boolean; hasNote: boolean;  // カレンダーマーカー用
  updatedAt
};
```

`hasMeal/hasExercise/hasNote/status` を Day に持つことで、**カレンダー1か月分の表示がドキュメント読取31件で済みます**（食事を全部読まない = 無料枠節約）。

#### Food（食品マスタ）

```ts
type Food = {
  foodId, name, kana?, brand?, productName?
  servingSize?: { value, unit }        // 「1個 = 50g」
  unitConversions: { unit: Unit; grams: number }[];
  densityGPerMl?: number;              // ml→g
  nutrientsPer100g: Nutrients;
  labelBasis?: 'per100g' | 'perServing'; // パッケージ表示の基準
  imageRef?, labelImageRef?            // 商品画像 / 栄養成分表示画像
  scope: 'common' | 'personal';
  ownerClientId?: string;              // personal のとき必須
  version: number;                     // 更新のたびに+1
  createdBy, createdAt, updatedAt
  isActive: boolean                    // 論理削除（過去参照を壊さない）
};
```

#### Recipe

```ts
type Recipe = {
  recipeId, name, description?
  ingredients: { ref, name, quantity: {value, unit} }[];
  yieldGrams: number;      // 完成量
  servings: number;        // 分割数
  version: number;
  scope, ownerClientId?
};
```

**レシピを食事に追加したときの挙動**: 1つのitemにまとめず、**材料に展開して MealItem を複数生成し、`groupRef` で束ねます。** これにより §16「脂質が高い理由は？」に材料単位で答えられます。UI上は「減量無水カレー（3品）」と折りたたみ表示します。

**レシピ更新時**: 過去の食事は一切変更しません（スナップショット済み）。「過去の食事に適用」ボタンを押した場合のみ、対象を指定して再展開します（§22）。

#### Photo（写真 §4.3）

```ts
type Photo = {
  photoId: string;
  mealId?: string;             // どの食事の写真か
  dataUrl: string;             // 'data:image/jpeg;base64,...' 約55〜80KB
  width: number; height: number;
  takenAt?: Timestamp;
  createdBy: string; createdAt: Timestamp;
  expiresAfter: string;        // 'yyyy-MM-dd' 削除候補の判定に使う（既定: 撮影から90日）
};
```

写真本体を独立したサブコレクションに置くことで、カレンダーや日別画面が**写真を読まずに**表示できます（無料枠の読み取り量とアプリの体感速度の両方に効きます）。

#### Audit（変更履歴 §19）

```ts
type Audit = {
  auditId, targetPath, action: 'create'|'update'|'delete'|'finalize'|'ai_apply',
  actorUid, actorRole, at,
  before?: object, after?: object,   // 差分のみ（サイズ抑制）
  reason?: string
};
```

### 5.4 インデックス

| コレクション | フィールド | 用途 |
|---|---|---|
| `clients/{cid}/days` | `date` desc | カレンダー・履歴 |
| `clients/{cid}/foods` | `name` asc, `isActive` | 食品検索 |
| `foods` | `name` asc, `isActive` | 共通食品検索 |
| `clients/{cid}/favorites` | `order` asc | お気に入り |

> 食品名検索は Firestore の前方一致（`>=` / `<=` + ``）で実装します。件数が数千件を超えて不足するようなら Algolia等ではなく、**端末側に食品マスタをキャッシュして全文検索**する方式に切り替えます（無料枠維持のため）。

---

## 6. Authentication設計

### 6.1 方式

Firebase Authentication の **Email/Password** プロバイダーを使用します。

### 6.2 「契約者ID + パスワード」の実現方法

Firebase Auth はメールアドレス形式を要求するため、**契約者IDを決定論的に合成メールへ変換**します。

```
契約者ID: "tanaka01"
   ↓ アプリ内で機械的に変換（サーバー問い合わせ不要 = ID一覧が漏れない）
"tanaka01@members.<your-domain>"
   ↓ signInWithEmailAndPassword
Firebase Auth ユーザー
```

- 事前に「そのIDが存在するか」を問い合わせる処理を作らないため、**契約者ID一覧が外部から列挙できません**。
- ログイン失敗時は「IDまたはパスワードが違います」の一択（存在有無を漏らさない）。
- **パスワードはFirestoreに一切保存しません**（§3）。Firebase Auth 内でのみハッシュ管理されます。

**代替案**: `<clientId>@<projectId>.local` のようなドメイン非依存形式でも動作します。ドメインをお持ちなら前者を推奨（将来メール招待に移行しやすい）。

### 6.3 管理者ログイン

- 実在メールアドレス + パスワード
- **多要素認証(MFA)を有効化**（Firebase Auth の SMS/TOTP 第2要素）を推奨
- 管理者アカウントは手動で1つだけ作成し、`users/{uid}` を Firebase コンソールから直接作成する（ブートストラップ・§6.4）

### 6.4 権限の持ち方（Custom Claims を使わない方式）

Custom Claims の付与には Admin SDK（＝サーバー）が必要ですが、**サーバーを持たない構成にしたため使えません。** 代わりに `users/{uid}` ドキュメント + Security Rules の `get()` で判定します。

```
users/{uid}
  role: 'admin' | 'client'
  clientId: string | null      // client のときのみ
  active: boolean
```

Rules 側:

```javascript
function me()      { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data; }
function isAdmin() { return request.auth != null && me().role == 'admin' && me().active == true; }
function isClient(cid) { return request.auth != null && me().role == 'client'
                              && me().clientId == cid && me().active == true; }
```

**安全性のポイント** — Custom Claims と同等の強度を保つための条件は1つだけです。

> `users/{uid}` は **管理者しか書き込めない**（契約者は自分の分を読めるが書けない）。

これにより、契約者が自分を管理者に昇格させる経路は存在しません。最初の管理者ドキュメントだけは、**Firebase コンソールから手動で1件作成**します（ブートストラップ）。

**トレードオフ**:

| 項目 | Custom Claims | `users` + `get()`（本構成） |
|---|---|---|
| サーバー | 必要 | **不要** |
| 判定コスト | 0（トークンに入っている） | Rules評価ごとに1読み取り |
| 権限変更の反映 | トークン更新が必要 | 即時 |
| 10人規模での実費 | — | **無料枠の1割未満。問題なし** |

将来 Blaze へ移行する場合は、Custom Claims へ差し替えられるよう `isAdmin()` / `isClient()` の実装をRules内の関数に閉じ込めておきます。

### 6.5 契約者アカウント作成フロー（サーバーなし）

`createUserWithEmailAndPassword` は「作成したユーザーで自動的にサインインする」仕様のため、素朴に呼ぶと**管理者のセッションが切れて追い出されます**。これを避けるため、**セカンダリの Firebase アプリインスタンス**を使います。

```ts
// 管理者のセッションを一切触らずに、別インスタンスでユーザーを作る
const secondary     = initializeApp(firebaseConfig, 'provisioning');
const secondaryAuth = getAuth(secondary);
await createUserWithEmailAndPassword(secondaryAuth, syntheticEmail, tempPassword);
await signOut(secondaryAuth);          // 管理者のセッションは無傷のまま
// → その後、管理者権限で users/{newUid} と clients/{clientId} を作成
```

手順と失敗時の扱い:

```
1. Auth ユーザー作成（セカンダリインスタンス）
2. users/{newUid} 作成   { role:'client', clientId, active:true }
3. clients/{clientId} 作成
4. 管理者が ID と初期パスワードを口頭/対面で伝達
5. 契約者は初回ログイン時にパスワード変更を要求される
```

サーバーがないためトランザクションを張れません。そこで **2 が完了するまでを「未完了の契約者」として管理者画面に表示**し、途中で失敗しても再開できるようにします。3 まで終わって初めて通常表示に変わります。

### 6.6 退会・無効化### 6.6 退会・無効化

- **アカウント削除ではなく無効化**（`users/{uid}.active = false` + `clients.active = false`）
- Auth 側の `disableUser` は Admin SDK が必要なため使いません。代わりに **Rules が `active == true` を必ず確認**するので、無効化された契約者はログインできても**一切のデータにアクセスできません**（読み取りも拒否）
- データは残す。削除は管理者が明示的に「完全削除」を選んだときのみ、二段階確認 + 事前エクスポートを経て実行（§46「データを消す処理は慎重に」）

---

## 7. Security Rules方針

### 7.1 基本方針

- **拒否がデフォルト**。許可を明示的に書いたパスだけ通す
- **パスによる分離**を第一防御線に（`clients/{cid}/**`）
- UIの制御は一切あてにしない
- サーバーを持たない構成のため、**Rules がセキュリティのほぼ全てを担います**。ここが唯一の防衛線であることを常に意識する
- **Rules は実装物ではなくテスト対象**。§16.6 の権限テストを Emulator で自動化

### 7.2 Firestore Rules（骨子）

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ---- 権限 ----------------------------------------------------------
    function me() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }
    function signedIn()    { return request.auth != null; }
    function isAdmin()     { return signedIn() && me().role == 'admin'  && me().active == true; }
    function isClient(cid) { return signedIn() && me().role == 'client'
                                  && me().clientId == cid && me().active == true; }
    function canAccess(cid){ return isAdmin() || isClient(cid); }

    // ---- 過去編集ウィンドウ --------------------------------------------
    // JST基準の「今日 - N日」を yyyy-MM-dd 文字列で作り、ドキュメントID と比較する
    function pad(n) { return n < 10 ? '0' + string(n) : string(n); }
    function jstNow() { return request.time + duration.value(9, 'h'); }
    function floorDate(n) {
      return string((jstNow() - duration.value(n, 'd')).year()) + '-'
           + pad((jstNow() - duration.value(n, 'd')).month()) + '-'
           + pad((jstNow() - duration.value(n, 'd')).day());
    }
    function windowDays(cid) {
      return get(/databases/$(database)/documents/clients/$(cid))
               .data.permissions.pastEditWindowDays;
    }
    function inWindow(cid, date) { return date >= floorDate(windowDays(cid)); }
    function dayOpen(cid, date) {
      return !exists(/databases/$(database)/documents/clients/$(cid)/days/$(date))
          || get(/databases/$(database)/documents/clients/$(cid)/days/$(date))
               .data.status != 'finalized';
    }
    function clientMayEdit(cid, date) {
      return isClient(cid) && inWindow(cid, date) && dayOpen(cid, date);
    }

    // ---- 既定：全拒否 --------------------------------------------------
    match /{document=**} { allow read, write: if false; }

    match /users/{uid} {
      allow read:  if isAdmin() || request.auth.uid == uid;
      allow write: if isAdmin();            // ★契約者は絶対に書けない
    }

    match /clients/{cid} {
      allow read:   if canAccess(cid);
      allow create, delete: if isAdmin();
      allow update: if isAdmin()
        || (isClient(cid) &&
            request.resource.data.diff(resource.data).affectedKeys()
              .hasOnly(['displayName','memo','extra','aiConsent','updatedAt']));
      // ★ targets / permissions / reviewMode / active は契約者から触れない

      match /days/{date} {
        allow read:  if canAccess(cid);
        allow write: if isAdmin() || clientMayEdit(cid, date);
      }
      match /days/{date}/meals/{mealId} {
        allow read:  if canAccess(cid);
        allow write: if isAdmin() || clientMayEdit(cid, date);
      }
      match /days/{date}/exercises/{id} {
        allow read:  if canAccess(cid);
        allow write: if isAdmin() || clientMayEdit(cid, date);
      }
      match /days/{date}/notes/{id} {
        allow read:  if canAccess(cid);
        allow write: if isAdmin() || clientMayEdit(cid, date);
      }
      match /days/{date}/photos/{photoId} {
        allow read:   if canAccess(cid);
        allow create: if (isAdmin() || clientMayEdit(cid, date))
                      && request.resource.data.dataUrl.size() < 400000;
        allow delete: if canAccess(cid);
        allow update: if false;             // 写真は差し替えず、消して撮り直す
      }

      match /foods/{foodId}   { allow read, write: if canAccess(cid); }
      match /recipes/{id}     { allow read, write: if canAccess(cid); }
      match /favorites/{id}   { allow read, write: if canAccess(cid); }
      match /measurements/{d} { allow read, write: if canAccess(cid); }
      match /aiSessions/{sid} { allow read, write: if canAccess(cid); }
      match /audits/{aid}     { allow read:   if isAdmin();
                                allow create: if canAccess(cid);
                                allow update, delete: if false; }  // 追記のみ
    }

    match /foods/{foodId} { allow read: if signedIn(); allow write: if isAdmin(); }
    match /recipes/{id}   { allow read: if signedIn(); allow write: if isAdmin(); }
    match /config/{doc}   { allow read: if signedIn(); allow write: if isAdmin(); }
  }
}
```

### 7.3 過去編集ウィンドウ（ご判断: 直近N日 / 既定7日）

```
clients/{cid}.permissions = {
  pastEditWindowDays: 7,     // 管理者が契約者ごとに設定
  allowFoodCreate:   true,
  allowRecipeCreate: true,
}
```

- 日付は `yyyy-MM-dd` というゼロ埋め形式なので、**文字列の大小比較がそのまま日付の前後比較になります**。Rules 側は `date >= floorDate(7)` の1行で済みます
- 基準時刻は `request.time`（UTC）に 9時間足して **JST の今日**を求めます。サーバー時刻を使うため、端末の時計をずらしても迂回できません
- **管理者は `pastEditWindowDays` に関係なく全期間を編集可能**です
- `0` にすると「今日だけ編集可」、`36500` にすると「無制限」として運用できます
- 「1日確定 (`finalized`)」された日は、**ウィンドウ内であっても契約者は編集できません**

### 7.4 写真データのサイズ制限

Storage Rules が使えないぶん、Firestore Rules 側で画像サイズを制限します。

```javascript
allow create: if request.resource.data.dataUrl.size() < 400000;  // base64で約400KB上限
```

アプリ側は約70KBに圧縮しますが、Rules 側にも上限を置くことで**改造アプリからの大量書き込みで無料枠を食い潰される事故**を防ぎます。

### 7.5 AI中継Worker側の防御

| 対象 | 対策 |
|---|---|
| AI APIキー | Worker Secret に格納。アプリのバンドルには入らない |
| 誰でも叩ける問題 | **Firebase ID トークンの検証を必須化**。Google の公開鍵で JWT を検証し、`aud` がこのプロジェクトIDであることを確認 |
| 濫用 | Workers KV に uid ごとの日次カウンタ。既定 1日50回まで |
| 画像サイズ | リクエストボディ 2MB 上限。超過は 413 で拒否 |
| CORS | アプリのオリジンのみ許可 |

### 7.6 その他の防御

| 対象 | 対策 |
|---|---|
| Firebase設定値（apiKey等） | これは公開情報であり秘密ではありません。**Rules が唯一の防衛線**である旨をREADMEに明記 |
| 管理者権限 | `users/{uid}` は管理者しか書けない。最初の1件だけコンソールで手動作成 |
| 監査 | 管理者が契約者データを編集した場合も `audits` に記録（追記のみ・更新削除不可） |
| App Check | Spark プランでも Firestore に対して利用可能。Phase 11 で導入を検討 |

### 7.7 権限テスト（必須・§43）

Emulator上で以下を自動テストします。

- 契約者A のトークンで `clients/A/**` を read/write → **許可**
- 契約者A のトークンで `clients/B/**` を read/write → **拒否**
- 契約者A のトークンで `users/{自分}` を write（role を admin に変更）→ **拒否**
- 契約者A のトークンで `clients/A.targets` を更新 → **拒否**
- 契約者A のトークンで `editFloorDate` より古い日付の meals を write → **拒否**
- 契約者A のトークンで 確定済み(`finalized`)の日の meals を write → **拒否**
- 契約者A のトークンで `foods/{共通}` を write → **拒否**、read → 許可
- `active: false` の契約者トークンで自分のデータを read → **拒否**
- 未認証で任意のパス → **全拒否**
- 管理者トークンで全契約者 read/write → **許可**
- 400KB超の `dataUrl` を write → **拒否**

---

## 8. 写真保存設計

### 8.1 保存場所（Firebase Storage は使わない）

```
clients/{cid}/days/{yyyy-MM-dd}/photos/{photoId}   食事写真（base64）
clients/{cid}/foods/{foodId}.imageDataUrl          個人食品の商品画像
clients/{cid}/foods/{foodId}.labelDataUrl          栄養成分表示画像
foods/{foodId}.imageDataUrl                        共通食品
```

日付がパスに含まれるため、**古い写真の一括削除がコレクションクエリ1本で書けます**。

### 8.2 無料枠（Firestore 1GB）を守る施策

| 施策 | 内容 |
|---|---|
| アップロード前圧縮 | 保存用は長辺640px / JPEG q0.6 → 1枚 約40〜60KB（base64で約55〜80KB） |
| 解析用は保存しない | AI に渡す長辺1024px版は Worker へ送るだけで、Firestore には残さない |
| 一覧では読まない | 写真は独立サブコレクション。カレンダー・日別画面は写真を読み込まずに描画し、タップしたときだけ取得 |
| 端末キャッシュ | 一度取得した写真は `expo-file-system` にキャッシュし、再取得しない |
| 保持期間 | 既定90日。`expiresAfter` を各写真に記録 |
| 一括削除 | 「〇〇年〇月より前の写真を削除」機能。**MealItem / PFCデータには一切触れない** |
| 使用量表示 | 管理者画面に「写真枚数 × 平均サイズ」の概算と、無料枠に対する残量バーを表示 |
| 上限警告 | 概算 800MB を超えたら管理者画面に警告を出す |

### 8.3 写真とデータの分離（§28）

- `Meal.photoIds` は **参照のみ**。写真ドキュメントを消しても Meal と totals は完全に残ります
- 写真削除時は `photoIds` から該当IDを外し、`photoDeletedAt` を記録
- UI上は「写真は削除済み」と表示し、栄養データはそのまま表示します

### 8.4 削除の安全策（§46）

- 一括削除は **削除対象の枚数と期間を表示 → 二段階確認** を経てから実行
- 削除は**写真ドキュメントのみ**を対象とし、meals / days / foods には触れないことをコードとテストの両方で保証します

---

## 9. AI構成

### 9.1 プロバイダー抽象化（§30）

`packages/ai-contract` にインターフェースと入出力スキーマだけを置き、実装は `worker/src/ai/providers/` に置きます。

```ts
export interface AIProvider {
  readonly id: string;              // 'gemini' | 'openai' | 'claude'
  analyzeMealPhoto(input: PhotoInput): Promise<MealRecognition>;
  parseMealText(input: TextInput): Promise<MealRecognition>;
  interpretEditCommand(input: EditInput): Promise<EditOperation[]>;
  generateDailyReview(input: ReviewInput): Promise<DailyReview>;
}
```

- 戻り値は **すべて zod スキーマで検証**してから返す
- プロバイダー切替は Worker の環境変数1つで完結（アプリの再ビルド不要）。無料枠→有料枠の切替もここだけ
- プロンプトは `worker/src/ai/prompts/{task}/{version}.ts` にバージョン管理。生成結果に `promptVersion` を必ず記録（再現性のため）

### 9.2 AI中継サーバー（Cloudflare Worker）

Cloud Functions の代わりに、Cloudflare Workers の無料プランで**AIの中継だけ**を行う小さなサーバーを置きます。

**Worker が担うこと**

| # | 処理 | 目的 |
|---|---|---|
| 1 | Firebase ID トークンの検証 | 誰でも叩けるAPIにしない。Googleの公開鍵でJWTを検証し `aud` がこのプロジェクトIDか確認 |
| 2 | レート制限 | Workers KV に uid ごとの日次カウンタ。既定 1日50回 |
| 3 | AI APIキーの秘匿 | Worker Secret に格納。**アプリのバンドルには一切入らない** |
| 4 | プロバイダー抽象 | Gemini / OpenAI / Claude を環境変数で切替 |
| 5 | 出力の検証と後処理 | zod検証 + ハルシネーション検査（§9.5） |

**エンドポイント**

```
POST /ai/meal/photo     画像 → 食品候補
POST /ai/meal/text      テキスト → 食品候補
POST /ai/meal/edit      編集指示 → 操作リスト
POST /ai/review/daily   数値セット → 評価文
```

すべて `Authorization: Bearer <Firebase ID token>` 必須。リクエストボディ上限 2MB。

**Worker を持たない場合との比較**

APIキーをアプリに埋め込む方式（キーは端末から抽出できてしまう）と比べ、Worker 方式は**キーが外部に出ず、レート制限も効く**うえ、無料枠内で完結します。実装量は 200行程度です。

### 9.3 プロバイダー候補

| プロバイダー | モデル | 無料枠 | 画像認識 | 構造化出力 | 判定 |
|---|---|---|---|---|---|
| **Google Gemini** | 2.5 Flash / Flash-Lite | あり（RPM/RPD制限付き） | ◎ | ◎ (response_schema) | **第一候補** |
| OpenAI | GPT系 mini | 実質なし | ◎ | ◎ | 第二候補 |
| Anthropic Claude | Haiku系 | なし | ◎ | ○ (tool use) | 第三候補 |

第一候補は Gemini。無料枠のデータ利用については §9.7 の同意運用で対応します。

### 9.4 AIに渡すデータ（§35 最小化）

| 送るもの | 送らないもの |
|---|---|
| 食事写真 / ユーザー入力テキスト | 契約者ID・氏名・メールアドレス |
| 数値（kcal/PFC/目標値/運動時間） | 生年月日・連絡先 |
| 評価モード（トーン指定） | 他契約者のデータ |
| 出力スキーマ | 過去の無関係な会話 |

AI評価生成時も、渡すのは「匿名の数値セット + 目標値 + 評価モード」だけです。

### 9.5 AI出力スキーマ（§36）

**画像/テキスト解析**

```json
{
  "mealLabelSuggestion": "1食目",
  "items": [
    {
      "name": "白米",
      "brand": null,
      "productName": null,
      "quantity": { "value": 180, "unit": "g" },
      "quantityStatus": "estimated",
      "quantityRange": { "min": 150, "max": 200 },
      "cookingMethod": "炊飯",
      "packageLabel": null,
      "confidence": 0.62,
      "evidence": "画像中央の白い茶碗",
      "needsUserInput": true,
      "question": "白米は何gでしたか？"
    }
  ],
  "unidentified": [
    { "description": "右奥の小鉢の中身が判別できません", "confidence": 0.0 }
  ],
  "notes": []
}
```

**重要**: このスキーマには **kcal / P / F / C を含めません**。AIに栄養値を返させると、それを信用してしまう経路が生まれるためです。例外は `packageLabel`（パッケージの栄養成分表示を読み取った場合）のみで、これは §13 の優先度2として明示的に扱います。

**編集指示の解釈（§18）**

```json
{
  "operations": [
    { "op": "update_quantity", "targetItemId": "it_01",
      "quantity": {"value":150,"unit":"g"}, "evidence": "白米180gを150gに変更" },
    { "op": "add_item", "name": "プロテイン", "quantity": {"value":1,"unit":"杯"},
      "evidence": "プロテイン1杯追加" },
    { "op": "remove_item", "targetItemId": "it_04", "evidence": "赤魚150g抜いて" },
    { "op": "scale_item", "targetItemId": "it_02", "factor": 0.5,
      "evidence": "おにぎり半量" }
  ],
  "unresolved": []
}
```

AIは**操作(op)を返すだけ**で、数値計算はしません。適用は `applyEditOperations()` という純粋関数が行い、その後 PFCエンジンが全再計算します。**「新規食事として追加されてしまう」事故は、opの型が `update_quantity` である限り構造的に起きません。**

### 9.6 「勝手な補完」の防止（§12 最重要）

プロンプトの指示だけでは守れないため、**4層で担保**します。

| 層 | 対策 |
|---|---|
| 1. プロンプト | 「報告されていない事項を推測しない」「不明は unknown」「evidence を必ず原文/画像から引用」を明記 |
| 2. スキーマ強制 | `evidence` と `confidence` を **必須フィールド**に。埋められないものは返せない |
| 3. **後処理バリデータ** | テキスト解析では `evidence` 文字列が原文に含まれるか機械的に照合。含まれない item は破棄 or `needsReview=true`。運動記録も同様（「徒歩帰宅」が原文になければ破棄） |
| 4. 確認必須UI | AI結果は必ず確認画面を経由。`needsReview=true` の項目は**赤枠 + 保存ボタン無効**。ユーザーが確認するまで確定できない |

さらに、AI由来の値は `quantityStatus: 'estimated'` のまま保存されることを許可しますが、**日次確定（finalize）時に `estimated` / `unknown` が残っていると警告**を出します。

### 9.7 無料枠の利用と、契約者への同意（ご判断を反映）

**ご判断: 無料枠のまま運用し、契約者から明示同意を取得する。**

前提として押さえておくべき事実:

> Gemini API の**無料枠（Unpaid Services）では、送信内容と生成結果が Google の製品改善に利用され、人間のレビュアーが閲覧する可能性がある**とAPI利用規約に明記されています。有料枠では学習利用されません。

#### 同意の実装

| 項目 | 内容 |
|---|---|
| 取得タイミング | 契約者の初回ログイン時、および同意文面のバージョンが上がったとき |
| 保存先 | `clients/{cid}.aiConsent = { granted, grantedAt, textVersion }` |
| 未同意の場合 | AI機能（写真解析・テキスト解析・AI評価）のボタンを非表示にし、手動入力のみ利用可能にする |
| 同意の撤回 | 設定画面からいつでも撤回できる。撤回後は手動入力のみ |
| 文面のバージョン管理 | `config/app.aiConsentTextVersion`。文面を変えたら再同意を求める |

> Worker 側では同意状態を検証しません。契約者が迂回して送れるのは**自分自身の写真だけ**であり、第三者に被害が及ばないためです。検証のために Firestore へ往復すると、無料枠の読み取りを毎回消費してしまいます。

#### 同意文面に必ず入れる要素（Phase 8 で雛形を用意します）

- 食事の写真とテキストが AI 事業者（Google）のサーバーへ送信されること
- **無料枠のため、送信内容が事業者の製品改善に利用され、担当者が閲覧する可能性があること**
- 氏名・契約者ID・年齢・連絡先などの個人情報は送信しないこと
- 写真に顔・手・部屋の様子などが写り込む可能性があるため、写したくないものは避けてほしいこと
- いつでも同意を撤回でき、その場合も手動入力でアプリを使い続けられること

#### 有料枠へ切り替えたくなったら

Worker の環境変数を差し替えるだけで移行できます（**アプリの改修は不要**）。その時点で同意文面から「学習に利用される」旨を外し、再同意を求めます。

### 9.8 AI障害時のフォールバック

- タイムアウト15秒 → 1回リトライ → 失敗なら「AI解析に失敗しました。手動で入力してください」と表示し、手動入力画面へ遷移
- **AIが使えなくてもアプリの全機能（手動入力・PFC計算・記録・コピペ出力）は動作します**（§46「AI依存を最小化」）
- Cloudflare Worker が落ちている場合も同じ扱い。Firestore への読み書きは Worker を経由しないため、記録機能には一切影響しません

---

## 10. PFC計算エンジン構成

### 10.1 責務（§14/§37）

`packages/core/nutrition` に置く**純粋関数の集合**。Firebase も AI も日付ライブラリも import しません。

```ts
// ① 栄養値の決定（§13 優先順位）
resolveNutrition(input: ResolveInput): ResolvedNutrition
// → { nutrientsPer100g, source, priority }

// ② 単位換算 → 実摂取グラム数
toGrams(quantity: Quantity, food: FoodConversion): number | 'unknown'

// ③ 食品1件の栄養値
computeItemNutrients(per100g: Nutrients, grams: number): Nutrients

// ④ 合計（★アプリ内で唯一の加算関数）
sumNutrients(list: Nutrients[]): Nutrients

// ⑤ 集計
computeMealTotals(items: MealItem[]): Nutrients      // = sumNutrients(items.map(i => i.nutrients))
computeDayTotals(meals: Meal[]): Nutrients           // = sumNutrients(meals.map(computeMealTotals))

// ⑥ 目標差分
diffFromTarget(totals: Nutrients, target: Nutrients): Nutrients

// ⑦ 編集操作の適用（§18）
applyEditOperations(meal: Meal, ops: EditOperation[]): Meal
```

### 10.2 優先順位の実装（§13）

```ts
const PRIORITY = [
  'user_input',     // 1: ユーザーが直接入力した栄養成分
  'package_label',  // 2: 商品パッケージの栄養表示
  'food_master',    // 3: 登録済み食品マスタ
  'recipe',         // 4: 登録済みレシピ
  'reference_db',   // 5: 信頼できる食品成分データ（日本食品標準成分表）
  'generic',        // 6: 一般的な食品データ
  'ai_estimate',    // 7: AI推定
] as const;
```

`resolveNutrition` は候補を全て集め、**最も優先度の高い1つだけを採用**します。下位の値で上位を上書きする経路は関数内に存在しません。採用しなかった候補は `alternatives` として保持し、UIで「別の候補を使う」選択肢として提示します（採用は常にユーザーの明示操作）。

### 10.3 合計一致の保証（§15 絶対ルール）

> **v0.3 での訂正（Phase 1 実装時に判明）**
> v0.2 では「加算順序を固定すれば浮動小数でも厳密一致する」と書きましたが、これは誤りでした。
> 浮動小数では `(a+b)+(c+d)` と `((a+b)+c)+d` が一致しない場合があります。つまり
> 「食事ごとに合計してから足した日合計」と「全食品を一度に足した合計」がズレ得ます。
> そこで **栄養値を「1/1000 単位の整数」で保持する方式**に変更しました。整数なら結合則が成立し、
> どんなグループ分けをしても合計が完全に一致します。

**内部表現**

```ts
interface Nutrients {
  kcal: number;   // ミリキロカロリー  123456 = 123.456 kcal
  p: number;      // ミリグラム        35042 = 35.042 g
  f: number;
  c: number;
  fiber: number;
  salt: number;
}
```

1日分（〜5000kcal = 5,000,000）でも `Number.MAX_SAFE_INTEGER` に対して十分小さく、桁あふれの心配はありません。

**唯一の加算関数**

```ts
export function sumNutrients(list: readonly Nutrients[]): Nutrients {
  const acc = { kcal: 0, p: 0, f: 0, c: 0, fiber: 0, salt: 0 };
  for (const item of list) {
    for (const key of NUTRIENT_KEYS) acc[key] += item[key];
  }
  return acc;
}
```

**保証の仕組み**

1. 合計を求める経路は `sumNutrients` **1つだけ**。別計算の入口を作らない
2. 値が整数なので加算は結合則・交換則を満たす
3. `日合計 = sum(食事合計) = sum(sum(食品))` が**同一関数の入れ子**なので、定義上必ず一致
4. 丸めが起きるのは2箇所だけ ─ 食品1件の栄養値を求める `scaleByGrams()` と、表示用の `formatNutrients()`
5. 保存された `totals` は表示キャッシュにすぎず、**画面表示時は必ず items から再計算**して照合。差異があれば警告 + 自動修復

**実装済み**（Phase 1）: `packages/core/src/nutrition/`。テスト27件が通っており、ランダムな食事構成200ケースでの検証も含みます。

### 10.4 丸め（§38）

```
内部:  123457 / 35042   （1/1000 単位の整数）
表示:  約123kcal / P 約35.0g
```

| 値 | 表示丸め |
|---|---|
| kcal | 整数（四捨五入）、「約」を付ける |
| P/F/C | 小数第1位 |
| 食物繊維・塩分 | 小数第1位 |

丸めは `formatNutrients()` という**表示専用関数**でのみ行い、計算経路には一切入れません。

> **注意（表示上の見え方）**
> 内訳を丸めた値を足すと、合計の丸めた値と1桁ズレて見えることがあります。
> 例: 脂質 0.54 + 1.20 + 6.12 = 7.86 → 合計表示は「7.9」ですが、
> 表示された内訳「0.5 / 1.2 / 6.1」を足すと「7.8」になります。
> **合計が正しく、内訳の表示が丸められているだけ**です。
> コピペ出力（§27）でも同じことが起きるため、必要なら内訳を小数第2位まで出す、
> あるいは注記を添えるかを Phase 6 で決めます。

### 10.5 単位換算

| 単位 | 換算 |
|---|---|
| g | そのまま |
| ml | `densityGPerMl`（既定1.0、食品ごとに設定可） |
| 個 / 枚 / 本 / 杯 / 食 / パック | `Food.unitConversions` から取得 |
| 大さじ | 15ml → 密度換算 |
| 小さじ | 5ml → 密度換算 |
| 換算不能 | `'unknown'` を返し、`needsReview=true`。**0として計算しつつUIで要確認表示** |

### 10.6 油の扱い（§17）

- 調理油は **独立した MealItem** として扱う（レシピの材料としても同様）
- **既定値は 0g**。「フライパンに引いたが拭き取った」→ 0g のまま
- 「オリーブオイル大さじ1/2」と明示された場合のみ 7.5ml → 密度0.92 → 6.9g として計上
- AIが油を検出した場合は必ず `quantityStatus: 'unknown'` + `needsReview: true` とし、ユーザーが数値を入れるまで 0g として扱う

### 10.7 レシピ計算（§22）

```
1食分の栄養 = Σ(材料の栄養) × (食べた量 / 完成量)
または      = Σ(材料の栄養) / 分割数
```

食事へ追加する際は材料に展開し、上記の係数を各材料に掛けた `MealItem` を生成します。よって §16 の内訳表示がレシピ経由でも成立します。

### 10.8 バージョニング

`engineVersion: 'pfc-engine@1.0.0'` を Meal に記録します。将来エンジンを修正しても、過去データがどのバージョンで計算されたか追跡でき、必要なら再計算バッチを流せます。

---

## 11. 画面一覧

### 11.1 共通

| # | 画面 | 内容 |
|---|---|---|
| C-1 | スプラッシュ / 起動 | 認証状態判定 → 振り分け |
| C-2 | ログイン | 契約者ID or メール + パスワード |
| C-3 | 初回パスワード変更 | 初期パスワードのままなら強制 |
| C-4 | パスワード変更 | 設定から |
| C-5 | 設定 | 表示設定・ログアウト・アプリ情報 |

### 11.2 契約者

| # | 画面 | 内容 |
|---|---|---|
| U-1 | ホーム（今日） | 今日のPFCリング / 目標差 / 食事カード / クイック追加 |
| U-2 | カレンダー | 月表示。記録あり・運動あり・評価済み・確定済みをマーカー表示 |
| U-3 | 日別詳細 | 1食目〜間食 / 総kcal・総PFC / 運動 / メモ / AI評価 / 1日確定 / コピー |
| U-4 | 食事編集 | 食品リスト（内訳PFC表示）/ 追加・削除・数量変更 / 食事名変更 |
| U-5 | 食品追加（入力方式選択） | 写真 / テキスト / 食品検索 / レシピ / お気に入り / 手動 |
| U-6 | 写真解析フロー | 撮影 → 解析中 → **AI結果確認画面** → 修正 → 確定 |
| U-7 | AI結果確認 | 推定値は黄色バッジ、要確認は赤枠。全確認まで保存不可 |
| U-8 | 食品検索 | 共通 + 個人。前方一致 + お気に入り + 最近使った |
| U-9 | 食品登録・編集 | 栄養成分入力 / 単位換算設定 / 商品画像・成分表示画像 |
| U-10 | レシピ一覧・登録 | 材料 / 完成量 / 分割数 / 1食分PFCプレビュー |
| U-11 | お気に入り管理 | 並べ替え / ワンタップ追加 |
| U-12 | 運動記録 | 種目・時間・セット・回数・重量・距離・歩数・メモ / 自然言語入力 |
| U-13 | メモ | 睡眠・体調・食欲・疲労などの自由入力 |
| U-14 | 体重・体脂肪記録 | 数値入力 + 推移グラフ |
| U-15 | AI評価表示 | 生成された評価文。トレーナーのフィードバックも表示 |
| U-16 | コピペ出力 | §27の形式でプレビュー + 1タップコピー |
| U-17 | 分析 | 週次・月次のPFC推移、目標達成率 |
| U-18 | AI利用の同意 | 初回ログイン時に表示。同意文面 + 同意/あとで。設定からいつでも撤回可（§9.7） |

### 11.3 管理者

| # | 画面 | 内容 |
|---|---|---|
| A-1 | 契約者一覧 | 各契約者の今日の記録状況・未評価件数を一覧 |
| A-2 | 契約者作成 | ID / 表示名 / 初期パスワード / 基本情報 / 過去編集ウィンドウ日数。作成途中で失敗した「未完了の契約者」の再開もここ（§6.5） |
| A-3 | 契約者詳細・編集 | プロフィール / 目標 / 評価モード / 権限 / 有効無効 |
| A-4 | 契約者データ閲覧 | 契約者の U-2 〜 U-17 を管理者権限で閲覧・編集 |
| A-5 | 共通食品マスタ管理 | 一覧 / 追加 / 編集 / 論理削除 |
| A-6 | 共通レシピ管理 | 同上 |
| A-7 | AI評価設定 | 評価モード既定値 / プロンプト調整 / プロバイダー切替 |
| A-8 | フィードバック送信 | 契約者へのコメント入力（AI評価とは別枠） |
| A-9 | 写真の使用量 | 枚数・概算容量・無料枠1GBに対する残量バー / 古い写真の一括削除（§8.2） |
| A-10 | 監査ログ | 誰がいつ何を変更したか |

### 11.4 UI設計方針（§5）

| 要素 | 方針 |
|---|---|
| トーン | 清潔・現代的・余白広め。彩度を抑えたベース + PFCのアクセントカラー |
| PFCの可視化 | **P/F/C を固定色で統一**（例: P=ブルー、F=アンバー、C=グリーン）。リング・積み上げバー・凡例すべて同色 |
| 目標との差 | 「あと◯g」を色ではなく**数値+バー**で表現。過剰を赤で煽らない |
| 入力 | 最小タップ数優先。ホームから2タップで食品追加まで到達 |
| 文字 | 動的フォントサイズ対応。数値は等幅で桁ズレを防ぐ |
| ダークモード | 対応（トークン化した配色で両対応） |
| アプリ名 | `src/config/env.ts` と `vite.config.ts` の manifest の2箇所のみ。コードにハードコードしない（§5） |
| ホーム画面追加 | 初回訪問時に「共有ボタン →ホーム画面に追加」の案内を出す。追加後は案内を隠す |
| セーフエリア | ノッチ／ホームバーに文字が隠れないよう `env(safe-area-inset-*)` で余白を確保 |
| 入力欄 | フォントサイズを16px未満にしない（iOS が自動でズームしてしまうため） |
| 更新 | Service Worker が新しい版を検知したら、静かに次回起動から差し替える |

---

## 12. MVP範囲

### 12.1 MVP に含める（§44 の 1〜13）

| # | 機能 | 補足 |
|---|---|---|
| 1 | ログイン | 契約者ID + パスワード / 管理者 |
| 2 | 権限制御 | `users` ロール方式 + Security Rules + **権限テスト** |
| 3 | 契約者管理 | 作成・編集・目標設定・有効無効 |
| 4 | カレンダー | マーカー付き月表示 |
| 5 | 日別画面 | 食事・運動・メモ・合計・1日確定 |
| 6 | 食事登録 | 食品検索 / お気に入り / 手動入力 |
| 7 | 手動PFC登録 | 栄養値の直接入力（優先度1） |
| 8 | 食品マスタ | 共通 / 個人、単位換算、論理削除。**初期データは空**。よく使う食品から登録していく |
| 9 | **PFC計算エンジン** | 純粋関数 + 完全テスト |
| 10 | 食事修正 | 数量変更・追加・削除・半量（手動UI） |
| 11 | 日合計 | 内訳一致保証 + 目標差分 |
| 12 | 運動 | 手入力 |
| 13 | メモ | 自由入力 |
| + | **コピペ出力** | §27。トレーナー業務の即戦力になるためMVPに前倒しを提案 |
| + | レシピ | 材料展開ロジックはPFCエンジンと不可分なためMVPに含めることを提案 |

### 12.2 MVP に含めない（Phase 8以降）

写真AI解析 / AI自然言語編集 / AI評価 / 写真保存 / 高度なグラフ・レポート / App Store公開

### 12.3 MVPの完了条件（Definition of Done）

- [ ] 実機のiPhoneで管理者・契約者の両方がログインできる
- [ ] 1か月分の記録をカレンダーから閲覧・編集できる
- [ ] `食品合計 == 食事合計 == 日合計` のテストが全て通る
- [ ] 契約者A→Bのアクセスが Emulator テストで拒否される
- [ ] コピペ出力が §27 の形式で正しく生成される
- [ ] AI無しで一連の業務が完結する

---

## 13. 開発フェーズ

各フェーズ終了時に **「実装したこと / 未実装 / テスト結果 / 問題点 / 次にやること」** を報告します（§45）。

| Phase | 内容 | 主な成果物 |
|---|---|---|
| **0** | 仕様・設計 | 本ドキュメント + ご承認 ✅ |
| **1** | プロジェクト作成 / GitHub | モノレポ、PWA初期化、ESLint/TS/Vitest、README、.env.example、.gitignore、main/develop ブランチ ✅ |
| **2** | Firebase + 自動公開 | Firebaseプロジェクト(Spark)、Firestore、GitHub Pages連携、**URLで開けるようになる** ✅ |
| **3** | 認証・権限 | ログイン画面、`users` ロール方式、Rules v1、**権限テスト55件を CI の必須項目に** ✅ |
| **4** | 契約者管理 | 管理者画面、契約者CRUD、目標設定、過去編集ウィンドウ設定 ✅ |
| **5** | カレンダー | 月表示・マーカー・日別画面の枠 ✅ |
| **6** | 食事・食品・PFC計算 | **PFCエンジン + 全テスト**、食品マスタ、食事CRUD、レシピ、お気に入り、コピペ出力 ✅ |
| **7** | 運動・メモ | 運動記録、メモ、体重、1日確定 ✅ |
| — | **ここまでで MVP 完成 / 契約者に URL を配れる状態** | ✅ |
| **8** | AI基盤 + 画像解析 | **Cloudflare Worker**（IDトークン検証・レート制限・Gemini実装）、同意フロー、写真保存、画像圧縮、確認画面 ✅ |
| **9** | AI自然言語編集 | 編集指示の解釈、evidence検証、操作適用、**栄養値の一本化（共通マスタのみ）**、登録依頼、表記ゆれの吸収 ✅ |
| **10** | AI評価 | 評価モード、日次評価生成、トレーナーのコメント、**決定論的な安全検査** ✅ |
| **11** | テスト強化 | E2E、Rules網羅、Worker のテスト |
| **12** | 実機での運用開始 | iPhone実機で全機能を確認、契約者へ配布、オフライン挙動の確認 |

#### 追加仕様（番号を持たないもの）

設計時に想定していなかったもので、**Phase 9〜10 の作業中に決めて入れた**ものです。

★ あとから番号を振り直すと、Phase 11・12 とぶつかります。
　番号は増やさず、名前で呼びます。報告書も名前で残してあります。

| 名前 | 内容 | 決めた経緯 |
|---|---|---|
| **追加仕様: 写真の保存期間** | 写真は7週間（49日）で自動的に消える。トレーナーの「確認しました」を押すとその日の写真を即削除。消える2日前に契約者へ警告 | 無料枠1GBを守るため。1日確定（契約者の意思表示）とは別の操作として分けた |
| **追加仕様: 成分表示の読み取り** | 既製品の成分表示を撮ると100gあたりに換算し、**登録依頼の候補**として写真ごと管理者へ送る。「＋食材 / 文章から / 写真から」に並ぶ4つ目の入口 | 管理者は契約者と別の場所にいるため、撮り直せない。数字だけでは確かめられないので写真も添える |


> **クレジットカード登録も年会費も一切不要です。** App Store に出す予定がないため、Apple Developer Program も必要ありません。

> **あなたの PC への作業は発生しません。** すべてブラウザ上の操作（GitHub と Firebase と Cloudflare の管理画面）だけで進みます。

### 13.1 ブランチ運用（§32）

```
main      安定版（実機に配るもの）
develop   統合先
feature/phase-06-pfc-engine    機能単位
fix/xxxx
```

- `develop` へは PR経由。CI（typecheck / lint / test / rules-test）が緑でないとマージ不可
- 各Phase完了時に `develop` → `main` へマージし、タグを打つ（`v0.6.0` 等）

### 13.2 秘密情報の扱い（§31）

- `.env` は `.gitignore` に登録。`.env.example` のみコミット
- Firebase の接続情報は `apps/web/src/config/firebase.ts` に直接記載（秘密情報ではないため）
- AI APIキーは Cloudflare Worker の Secret（`wrangler secret put GEMINI_API_KEY`）。リポジトリにも環境変数にも置かない
- Firebase サービスアカウントJSON は絶対にコミットしない
- コミット前フックで秘密情報パターンを検査（gitleaks 相当）

---

## 14. 想定される問題点

| # | 問題 | 影響 | 対策 |
|---|---|---|---|
| 1 | **Firestore 1GB に写真が収まりきらない** | 約1年強で上限に到達する試算 | 保存用は長辺640px/約50KBに圧縮。90日保持 + 一括削除。使用量バーを管理者画面に常設。上限が近づいたら Supabase Storage 無料枠の追加を検討 (§4.3) |
| 2 | **Gemini無料枠は送信内容が学習・人間レビューに使われる** | 契約者の食事写真が対象になる | 明示同意フロー + 送信データの最小化 + 写り込みへの注意喚起 (§9.7)。有料枠への切替は Worker の環境変数1つ |
| 3 | **Custom Claims を使えない** | 権限判定に Rules の `get()` が要る | 10人規模では無料枠の1割未満。`isAdmin()`/`isClient()` をRules内の関数に閉じ込め、将来 Claims へ差し替え可能にする (§6.4) |
| 4 | **契約者作成でトランザクションが張れない** | 途中で失敗すると中途半端なアカウントが残る | 作成順序を固定し、未完了状態を管理者画面に表示して再開できるようにする (§6.5) |
| 5 | **AIの重量推定精度は本質的に低い** | 誤ったPFCが確定されるリスク | 確認必須UI + `needsReview` + 確定時の警告。「AIは推定するだけ」をUIで明示 |
| 6 | **食品成分データのライセンス** | 他社アプリのDBは流用不可 | 初期データは空から開始（ご判断済み）。将来 日本食品標準成分表（文部科学省 食品成分データベース）を使う場合は、出典明記と商用利用条件の確認を先に行う |
| 7 | **iOS の PWA 固有の制約** | ホーム画面に追加しないと全画面にならない／通知が使えない | 初回に追加の案内を出す。追加したかどうかを検知して案内を出し分ける |
| 7b | **Safari のデータ退避** | 長期間使わないとブラウザ側の保存データが消える場合がある | ログイン状態が切れても、データは Firestore にあるので失われない。再ログインで復帰できる旨を案内する |
| 8 | オフライン時の記録 | 電波の悪いジムで入力できない | Service Worker で画面は開ける。Firestore のローカルキャッシュ + 送信キュー。MVPでは「オンライン前提 + 失敗時の下書き保持」 |
| 9 | 同時編集の競合 | 管理者と契約者が同じ食事を同時編集 | `updatedAt` によるオプティミスティックロック。競合時は差分表示して選択させる |
| 10 | 日合計キャッシュの陳腐化 | 表示値と実データがズレる | 表示時に必ず items から再計算・照合。ズレたら自動修復 + ログ |
| 11 | **健康情報の法的な取り扱い** | 個人情報保護法上、健康関連情報は慎重な扱いが必要。AI APIへの送信は第三者提供/越境移転の論点 | 利用目的の明示と同意取得を §9.7 の同意フローに組み込む。プライバシーポリシー雛形をPhase 13で用意 |
| 12 | **医療行為との線引き** | AI評価が診断・治療助言と受け取られる | システムプロンプトで診断・病名・薬剤への言及を禁止 + 生成後の禁止語チェック + 画面に免責表示 |
| 13 | 単位「1食」「1杯」の曖昧さ | 換算不能で計算が破綻 | `unitConversions` 未設定なら `unknown` として要確認。0扱いだが必ずUIに出す |
| 14 | 契約者が食品マスタを汚す | 個人食品が乱立して検索性が落ちる | 個人食品は個人スコープに隔離。管理者が「共通へ昇格」できる導線を用意 |
| 15 | 写真削除後の再解析不能 | 過去の確認ができなくなる | 削除前に管理者へ警告。栄養データは残る旨を明示 |
| 16 | Cloudflare の依存（Phase 8 のAI中継のみ） | 障害時にAI機能が止まる | AI が落ちても記録機能は全て動く設計 (§9.8)。Worker は200行程度で、他所へ移すのも容易 |
| 17 | **リポジトリが Public である** | アプリの作り方が第三者に見える | 契約者のデータは一切含まれない。Security Rules は見られても破れない。ただし Rules の穴は見つけられやすくなるため、§16.7 の権限テストを必ず緑に保つ |

---

## 15. 確認が必要な事項

### 15.1 決定済み（第1回のご判断）

| # | 論点 | ご判断 | 反映先 |
|---|---|---|---|
| 1 | Firebase の課金プラン | **カード登録なし。Spark 固定** | §4 全面改訂 |
| 2 | AI無料枠のデータ利用 | **無料枠のまま + 契約者へ明示同意** | §9.7 |
| 3 | 契約者の過去データ修正 | **直近N日以内なら自由（既定7日）** | §7.3 |
| 4 | 食品マスタの初期データ | **空から開始** | §12.1 |

### 15.2 まだご判断が必要な事項

以下は Phase 4〜7 の実装に入る前に決めておきたい項目です。**すべて後から変更できます**ので、迷ったら「おまかせ」で構いません。

#### Q1. 「1日確定」を誰が行うか（§7）  ✅ **決定（2026-08-27）**

**(a) 契約者が自分で確定する。** 確定後は管理者のみ編集でき、管理者は解除もできる。

理由: 「今日はもう食べません」という本人の意思表示が確定の実体だから。
トレーナーが毎日全員分を締めて回る運用にはしない。

#### Q2. ログイン用のドメイン（§6.2）
契約者IDを合成メールへ変換します。
- (a) ドメイン非依存の内部形式: `tanaka01@pt-app.local` ← **推奨**（設定不要・外部に漏れない）
- (b) お持ちのドメイン（silce.jp 等）のサブドメイン: `tanaka01@members.silce.jp`

#### Q3. アプリの名前
いまは仮に <b>PT Manager</b> としています。決まりしだい2箇所を書き換えるだけです（ホーム画面のアイコン下に出る名前になります）。

#### Q4. アプリを開く URL
GitHub Pages の既定では `https://<ユーザー名>.github.io/pt-app/` になります。
- (a) この既定の URL のままでよい ← **推奨**（無料・設定不要）
- (b) お持ちのドメインのサブドメイン（例: `app.silce.jp`）を使いたい ← 無料でできますが、DNS の設定が1つ必要です（その場合 `vite.config.ts` の `BASE` を `'/'` に変えます）

#### Q5. コピペ出力の絵文字（§27）
- 絵文字は指示書の例で固定でよいか / 管理者がテンプレートを編集できるようにするか
- 丸めは「kcalは整数・PFCは小数第1位」でよいか

#### Q6. 体重・体脂肪率の記録場所（§4）  ✅ **決定（2026-08-27）**

**その日の画面（日別画面）の中に入力欄を置く。** 1画面で1日が完結する形にする。
体重専用のグラフ画面は Phase 7 以降で「閲覧用」として別途検討する（入力の入口は増やさない）。

#### Q7. トレーナーからのフィードバック（§1）
- AI評価とは別枠でトレーナーのコメント欄を設ける想定でよいか
- 契約者への通知（プッシュ）は必要か（FCM自体は無料。送信の自動化は Phase 10 以降）

#### Q8. 契約者の食品・レシピ登録権限（§21）
- 管理者が個人食品を「共通へ昇格」できる導線は必要か
- 契約者の食品登録自体をオフにする設定は必要か

#### Q9. 管理者機能をPCの大きい画面でも使いたいか
Web アプリになったので、**PCのブラウザで同じ URL を開けば管理者機能はそのまま使えます**。追加開発は不要です。
- ただし「PCでは一覧を横に広く並べたい」など、画面幅に応じた作り込みが必要かどうかだけ教えてください
- (a) スマホの見た目のままでよい ← **推奨**（作り込みは後からでもできます）
- (b) PC用に横並びのレイアウトを用意したい

#### Q5. コピペ出力（§27）  ✅ **決定（2026-08-27）— 作らない**

**LINE へ貼るためのコピペ出力は実装しません。** 利用者から不要との判断。
§27 の絵文字テンプレート・丸め規則の議論も、あわせて保留します。
必要になった時点で改めて検討します（画面に出ている数字はすべて揃っているので、
出力形式を1つ足すだけで実現できます）。

#### Q7'. Phase 7 の内容  ✅ **決定（2026-08-27）**

写真の添付 → 体重グラフ → AI推定 の順で進める。

#### Q12. 食事の区切り方（§6）  ✅ **決定（2026-08-27）**

**「1食目・2食目…」と自由に追加していく。** 朝昼夕の固定枠にはしない。
トレーニング中の食事回数は人によって違い、抜いた食事を表現する必要も無いため。

#### Q13. 食材の入力（§21）  ✅ **決定（2026-08-27）**

**その場で入力し、自動で個人マスタに残る。**
先に食品登録を済ませないと使えない作りにはしない（使い始めが重くなるため）。
2回目以降は名前を打つと候補に出る。

#### Q14. 1日確定の解除（§7）  ✅ **決定（2026-08-27）**

**契約者本人が、編集ウィンドウ内であればいつでも解除できる。**

確定は「トレーナーへの提出」ではなく「今日はもう食べません」という意思表示。
そのため、書き直したくなったら本人が解除してよい。
ただし解除という操作を一度挟ませることで、確定済みの日をうっかり上書きする事故は防ぐ。

Rules 上の扱い:
- 確定済みの日は、食事・運動・体重の書き込みを拒否する（従来どおり）
- ただし `days/{date}` の `status` を `finalized → open` に戻す更新だけは、
  ウィンドウ内の本人に許可する
- 管理者はウィンドウも確定状態も無視して編集・解除できる

#### Q11. カレンダーのマーカー（§6）  ✅ **決定（2026-08-27）**

日ごとに4種類の印を出す。

| 印 | 意味 |
|---|---|
| 食事 | 1食でも記録があれば付く |
| 運動 | 運動の記録があれば付く |
| 体重 | 体重が入っていれば付く |
| 確定／評価 | その日が確定済み、またはAI評価済み |

★ 印は「あるか無いか」だけを表し、**中身（カロリー等）はカレンダー上に出さない**。
月表示に数字を詰めると読めなくなるため。数字は日別画面で見る。

#### Q10. 開発の進め方（§45）
- 各Phase完了ごとにご確認いただき、承認後に次へ進む形でよいか
- 1Phaseあたりの粒度（もっと細かく区切る / このままでよい）

---

## 16. テスト方針

### 16.1 テストの階層

| 階層 | ツール | 対象 | 目標カバレッジ |
|---|---|---|---|
| ユニット（最重要） | Vitest | `packages/core`（PFCエンジン・単位換算・優先順位解決） | **100%** |
| スキーマ | Vitest + zod | AI入出力・Firestore書込データ | 主要パス |
| Rules | Firebase Emulator + `@firebase/rules-unit-testing` | Firestore Rules | **全ルール分岐** |
| 結合 | Vitest + Emulator | Repository層 | 主要パス |
| UI | Vitest + React Testing Library | 確認画面・編集フロー | 重要画面 |
| Worker | Vitest + Miniflare | IDトークン検証・レート制限・AI出力の後処理 | 主要パス |
| E2E | Maestro（Phase 11） | ログイン→記録→確定→コピー | 主要シナリオ |

### 16.2 計算テスト（§43）

```
□ 白米150g / 180g          → per100gからの換算が正確か
□ 卵1個（個→g換算）        → unitConversions 経由
□ 複数食品の合計           → Σ(item.nutrients) == meal.totals
□ レシピ（材料展開）       → 材料合計 × 係数 == レシピ1食分
□ 半量 (scale 0.5)         → 全栄養素が正確に半分
□ 数量変更 180g→150g       → 既存itemが更新される（新規追加されない）
□ 削除（赤魚150g）         → 対象itemのみ消え、合計が再計算される
□ 追加（プロテイン1杯）    → 既存食事に追加される
□ 単位不明                 → 'unknown' + needsReview、0として合計
□ 油0g                     → 明示なしなら計上されない
```

### 16.3 合計一致テスト（§15 絶対ルール）

```ts
test('食品合計 == 食事合計 == 日合計', () => {
  const day = buildDayFixture();               // 3食 + 間食、計12品
  const itemSum  = sumNutrients(day.meals.flatMap(m => m.items).map(i => i.nutrients));
  const mealSum  = sumNutrients(day.meals.map(computeMealTotals));
  const daySum   = computeDayTotals(day.meals);

  expect(mealSum).toEqual(itemSum);   // ★ 厳密一致（epsilon不要）
  expect(daySum).toEqual(itemSum);
});
```

加算順序を固定しているため、浮動小数でも**厳密一致**します。これをプロパティテスト（ランダムな食品構成100ケース）でも検証します。

### 16.4 優先順位テスト（§13）

```
□ user_input と package_label が両方ある → user_input が採用される
□ food_master と ai_estimate が両方ある → food_master が採用される
□ 上位が存在するとき、下位の値で上書きされない
□ 採用されなかった候補は alternatives に残る
```

### 16.5 スナップショットテスト（§41）

```
□ 食品マスタを更新しても、過去の MealItem.nutrients は変化しない
□ レシピを更新しても、過去の食事は変化しない
□ 「過去に適用」を明示実行したときのみ変化する
```

### 16.6 過去編集ウィンドウのテスト（§7.3）

```
□ 今日の食事を契約者が書き込める
□ 7日前の食事を契約者が書き込める（境界）
□ 8日前の食事を契約者が書き込めない（境界）
□ 確定済みの日は、ウィンドウ内でも契約者が書き込めない
□ 管理者は8日前でも確定済みでも書き込める
□ 端末時刻を変えても迂回できない（Rulesは request.time を使う）
```

Emulator のテストでは時刻を固定できるため、境界値を厳密に検証できます。

### 16.7 権限テスト（§43 / §7.7）

Emulator上で、契約者A・契約者B・管理者・未認証の4トークンを用意し、全コレクションに対する read/write のマトリクスを網羅テストします。**このテストが緑でない限り Phase 3 は完了としません。**

サーバーを持たない構成では **Rules がセキュリティのほぼ全て**です。ここへのテスト投資は最優先で行います。

### 16.8 AI補完禁止テスト（§12）

```
□ 「徒歩出勤した」→ 徒歩帰宅が追加されない
□ 「今日は疲れた」→ 食事も運動も追加されない
□ evidence が原文に存在しない item は破棄される
□ confidence < 閾値 の item は needsReview = true になる
□ needsReview が残っている状態で保存ボタンが押せない
```

AIプロバイダーはモック化し、「もしAIが余計なものを返してきたら、後処理で確実に落とせるか」を検証します（AI自体の挙動ではなく、こちらの防御機構をテストします）。

### 16.9 CI

GitHub Actions で PR ごとに実行:

```
typecheck → lint → vitest (core) → rules-test (emulator) → vitest (worker) → jest (ui)
```

すべて緑でなければ `develop` へマージできません。

---

## 付録: 指示書との対応表

| 指示書 | 本設計書での対応箇所 |
|---|---|
| §1 目的 | §1.1 |
| §2 権限 | §6.4, §7.2 |
| §3 ログイン | §6.2 |
| §4 契約者管理 | §5.2 (`clients` + `extra`) |
| §5 UI | §11.4 |
| §6 カレンダー | §5.3 (Day), §11.2 U-2 |
| §7 1日確定 | §5.3 (Day.status), Q4 |
| §8 食事名の自由化 | §5.3 (Meal.label) |
| §9 入力方式 | §11.2 U-5 |
| §10 画像解析 | §9.4 |
| §11 推定/確定の分離 | §5.3 (MealItem), §10 |
| §12 補完禁止 | §9.5 |
| §13 優先順位 | §10.2 |
| §14 計算エンジン | §10 |
| §15 合計一致 | §10.3 |
| §16 内訳 | §5.3, §10.7 |
| §17 油 | §10.6 |
| §18 自然言語編集 | §9.4 |
| §19 過去修正 | §7.2, Q3 |
| §20-21 食品マスタ | §5.3 (Food) |
| §22 レシピ | §10.7 |
| §23 お気に入り | §5.2 |
| §24 運動 | §11.2 U-12 |
| §25 メモ | §11.2 U-13 |
| §26 AI評価 | §9.3, §14-10 |
| §27 コピペ | §11.2 U-16, Q6 |
| §28 写真保存 | §4.3, §8 |
| §29 Firebase | §4（Spark固定・カード登録なし） |
| §30 AI API | §9.1, §9.2 |
| §31-32 GitHub | §13.1, §13.2 |
| §33 iPhone | §2.1, §2.2（PWAとして配布） |
| §34 セキュリティ | §7, §9.2 |
| §35 AIへ渡すデータ | §9.3 |
| §36 出力形式 | §9.4 |
| §37 責任分離 | §3.1 |
| §38 計算精度 | §10.4 |
| §39 不明・推定 | §9.4, §10.5 |
| §40 会話履歴分離 | §5.2 (aiSessions) |
| §41 スナップショット | §5.3 (MealItem) |
| §42 商品バージョン | §5.3 (Food.version) |
| §43 テスト | §16 |
| §44 MVP | §12 |
| §45 フェーズ | §13 |
| §46-47 開発ルール・思想 | §1.1 |

---

## 承認のお願い

第1回（カード登録なし / AI無料枠+同意 / 過去編集7日 / 食品マスタ空）と、第2回（Safariで開くPWA / ローカル開発環境なし）のご判断を反映して、v0.4 としました。

**最後までクレジットカード登録は不要です。** App Store に出さないため Apple の年会費もかかりません。AI機能を載せる Phase 8 でも、Cloudflare と Gemini の無料枠だけで完結します。

**あなたの PC には何もインストールしません。** GitHub・Firebase・Cloudflare の管理画面をブラウザで操作するだけで進みます。

本設計書の内容にご承認をいただけましたら、**Phase 1（プロジェクト作成・GitHub整備）**から着手します。§15.2 の Q1〜Q10 は Phase 4 に入るまでに決まっていれば十分ですので、承認と同時でなくても構いません。

修正・追加のご要望があれば、この設計書を更新したうえで再度ご確認いただきます。
