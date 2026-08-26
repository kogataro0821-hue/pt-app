# worker — AI中継サーバー（Cloudflare Worker）

**Phase 8 で実装します。Phase 1 時点では空です。**

## なぜ必要か

AI の APIキーをアプリに埋め込むと、誰でも取り出せてしまいます。
かといって Firebase Cloud Functions は Blaze プラン（カード登録）が必須です。

そこで **Cloudflare Workers の無料プラン**（カード不要 / 10万リクエスト per 日）で
AI の呼び出しだけを中継します。

## 担当すること（設計書 §9.2）

1. Firebase ID トークンの検証 — 誰でも叩けるAPIにしない
2. レート制限 — Workers KV に uid ごとの日次カウンタ（既定 1日50回）
3. AI APIキーの秘匿 — Worker Secret に格納
4. プロバイダー抽象 — Gemini / OpenAI / Claude を環境変数で切替
5. 出力の検証と後処理 — zod検証 + ハルシネーション検査

## 予定しているエンドポイント

```
POST /ai/meal/photo     画像 → 食品候補
POST /ai/meal/text      テキスト → 食品候補
POST /ai/meal/edit      編集指示 → 操作リスト
POST /ai/review/daily   数値セット → 評価文
```

すべて `Authorization: Bearer <Firebase ID token>` 必須。

## APIキーの設定方法

```bash
npx wrangler secret put GEMINI_API_KEY
```

`.env` にも `.dev.vars` にも本番のキーを書かず、コミットもしないでください。
