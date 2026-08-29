# AIの設定手順

画面の操作だけで終わります。パソコンに何かを入れる作業はありません。
**全体で20〜30分**を見ておいてください。

途中で分からなくなったら、その画面のまま聞いてください。

---

## 全体像

```
アプリ ──(ログイン証明)──▶ Cloudflare Worker ──(APIキー)──▶ Google Gemini
                                  ▲
                             キーはここだけ
```

APIキーをアプリに入れると、GitHubが公開なので誰でも読めてしまいます。
そこで**キーを預かる場所**を1つ作ります。それがこの作業です。

---

# 手順1 — GoogleのAPIキーを取る

**所要 5分・無料・カード登録なし**

1. 管理者のGoogleアカウントでログインした状態で、こちらを開く
   👉 https://aistudio.google.com/apikey

2. 「**Create API key**」または「**APIキーを作成**」を押す

3. プロジェクトを選ぶ画面が出たら、**`pt-app`** を選ぶ
   （Firebaseで作ったプロジェクトです。一覧に出てくるはずです）

4. `AIza...` で始まる長い文字列が表示されます

5. **コピーして、メモ帳に貼り付けて一時的に保存**してください

> ⚠️ このキーは**パスワードと同じ**です。
> 人に見せない、チャットに貼らない、GitHubに置かない。
> もし誰かに見られたら、同じ画面から削除して作り直せます。

---

# 手順2 — Cloudflareのアカウントを作る

**所要 5分・無料・カード登録なし**

1. 👉 https://dash.cloudflare.com/sign-up

2. メールアドレスとパスワードを決めて登録
   （管理者のアドレスで作ってください）

3. 届いたメールの中のリンクを押して、確認を済ませる

4. 「サイトを追加してください」のような画面が出ても、**何も追加しなくて大丈夫です**。
   左のメニューだけ使います。

---

# 手順3 — Worker を作る

**所要 10分**

1. Cloudflare の管理画面で、左のメニューから
   「**Compute (Workers)**」または「**Workers & Pages**」を開く

2. 「**Create**」→「**Start with Hello World!**」→「**Get started**」

3. 名前を **`pt-ai`** にして「**Deploy**」

4. デプロイが終わったら「**Edit code**」（またはコードのアイコン）を押す

5. エディタが開きます。**中身をすべて消して**、
   `pt-app\worker\worker.js` の中身を全部貼り付けてください

   > ファイルはこの場所にあります
   > `C:\Users\user\Desktop\pt-app\worker\worker.js`
   > メモ帳で開いて `Ctrl + A` → `Ctrl + C` です

6. 右上の「**Deploy**」を押す

---

# 手順4 — キーなどを登録する

**所要 5分**

Worker の画面で「**Settings**」タブ →「**Variables and Secrets**」を開きます。

次の3つを追加します。

| 名前 | 種類 | 値 |
|---|---|---|
| `GEMINI_API_KEY` | **Secret** | 手順1でコピーした `AIza...` |
| `FIREBASE_PROJECT` | Text | `pt-app-54f32` |
| `ALLOWED_ORIGIN` | Text | `https://kogataro0821-hue.github.io` |

> ★ `GEMINI_API_KEY` だけは必ず「**Secret**」を選んでください。
> Secret にすると、登録後は画面にも表示されなくなります。

追加したら「**Deploy**」を押します。

---

# 手順4.5 — 使いすぎを止める場所を作る（KV）

**所要 5分・無料・カード登録なし**

1人が1日にAIを使える回数を数えておく場所です。
アプリの不具合や連打で無料枠が尽きて、**翌日まで全員のAIが止まる**のを防ぎます。

> ★ この手順を飛ばしても、アプリは普通に動きます。
> ただし**回数を数えません**。あとからでも足せます。

1. Cloudflare の管理画面で、左のメニューから
   「**Storage & Databases**」→「**KV**」を開く
   （見当たらなければ「Workers & Pages」→「KV」）

2. 「**Create a namespace**」（または「作成」）を押す

3. 名前を **`pt-ai-rate`** にして作成

4. 左のメニューから「**Compute (Workers)**」→ **`pt-ai`** を開く

5. 「**Settings**」タブ →「**Bindings**」（または「KV Namespace Bindings」）

6. 「**Add**」→「**KV namespace**」を選び、次のように入れる

   | 欄 | 入れる値 |
   |---|---|
   | Variable name（変数名） | **`RATE_LIMIT`** |
   | KV namespace | `pt-ai-rate` |

   > ⚠️ 変数名は **`RATE_LIMIT`** ちょうどにしてください。
   > 大文字・下線までこのとおりでないと、Worker が見つけられません。

7. 「**Deploy**」を押す

**回数を変えたいとき**は、「Variables and Secrets」に
`DAILY_LIMIT`（Text）を足して数字を入れてください。省略時は **1日50回** です。
コードを貼り直す必要はありません。

---

# 手順5 — WorkerのURLを控える

Worker の画面の上のほうに、こういうURLが出ています。

```
https://pt-ai.〇〇〇.workers.dev
```

`〇〇〇` はあなたのアカウント名です。**これをコピー**してください。

---

# 手順6 — アプリにURLを教える

このURLは秘密ではありませんが、GitHubの仕組みを使って登録します。

1. 👉 https://github.com/kogataro0821-hue/pt-app/settings/variables/actions

2. 「**New repository variable**」を押す

3. Name: `VITE_AI_RELAY_URL`
   Value: 手順5のURL（例 `https://pt-ai.xxx.workers.dev`）

4. 「**Add variable**」

5. 👉 https://github.com/kogataro0821-hue/pt-app/actions/workflows/deploy.yml
   →「**Run workflow**」→ `main` → 実行

   （新しい設定を反映するために、もう一度ビルドする必要があります）

---

# 手順6.5 — 設定が揃ったか確かめる

ブラウザで、手順5のWorkerのURLを**そのまま開いて**ください。
（アプリではなく、`https://pt-ai.〇〇〇.workers.dev` のほうです）

こういう文字が出れば、設定は揃っています。

```
"ok": true
"configuredModel": "gemini-2.5-flash"
"firebaseProject": "pt-app-54f32"
"dailyLimit": "有効（1人あたり1日 50 回まで）"
```

| 出たもの | 意味 |
|---|---|
| `"dailyLimit": "有効（…）"` | 手順4.5 ができています |
| `"dailyLimit": "⚠ 数えていません…"` | 手順4.5 の**変数名が違う**か、Deploy を押していません |
| `"ok": false` | `GEMINI_API_KEY` が未登録か、間違っています |

> ★ ここはAPIキーを一切表示しません。画面を撮って送っても大丈夫です。

---

# 手順7 — 動くか確かめる

1. アプリを開いて `Ctrl + Shift + R`
2. **契約者**でログイン
3. カレンダー →「**設定**」→「AIの利用について読む」→「**同意します**」
4. 今日を開く → 食事を追加 → 「**文章から入力**」が出ていればOK
5. `白米180gと鶏むね肉、サラダ` と入れて「AIに分解してもらう」

**期待する結果**

- 白米 180g … そのまま追加できる状態
- 鶏むね肉 … 「何グラムでしたか？」と聞かれる
- サラダの中身 … 勝手に分解されない（されていたら破棄されて理由が出る）

---

# うまくいかないとき

| 症状 | 原因 | 対処 |
|---|---|---|
| 「文章から入力」が出ない | 手順6のURL登録か、再ビルドが未了 | 手順6をやり直す |
| 「文章から入力」が出ない（同意済み） | 同意していない契約者で見ている | 設定画面で同意する |
| 「ログインし直してください」 | ログイン証明の検証に失敗 | `FIREBASE_PROJECT` が `pt-app-54f32` か確認 |
| 「AIに接続できませんでした」 | キーが違うか未登録 | `GEMINI_API_KEY` を確認。Secret になっているか |
| 「混み合っています」 | Gemini 側が混雑（1日1,500回の上限など） | 数分待ってからやり直す |
| 「今日のAIの利用回数が上限に達しました」 | **その人が**1日50回を使い切った | 日付が変われば戻ります。足りなければ `DAILY_LIMIT` を上げる（手順4.5） |

Cloudflare の Worker 画面の「**Logs**」を開くと、
実際に呼ばれているかどうかが見られます。原因の切り分けに使えます。

---

# 費用について

| | 無料枠 | このアプリの想定 |
|---|---|---|
| Gemini | 1日1,500回 | 契約者10人 × 1日5回 = 50回 |
| Cloudflare Workers | 1日100,000回 | 同上 |

**どちらも桁が2つ違います。** カード登録をしていないので、
万一上限を超えても課金されることはなく、その日は使えなくなるだけです。


---

# worker.js を新しくするとき

`worker/worker.js` を直したときは、**Cloudflare に貼り直す必要があります。**
GitHub に push しただけでは、Cloudflare の中身は変わりません。

> なぜ自動にならないのか：自動で配るには Cloudflare の接続情報を
> GitHub に預ける必要があり、キーを外に置かない方針と合いません。
> 貼り直しは年に数回あるかどうかなので、手作業のままにしています。

1. `C:\Users\user\Desktop\pt-app\worker\worker.js` をメモ帳で開く
2. `Ctrl + A` →`Ctrl + C`（全部選んでコピー）
3. Cloudflare →「Compute (Workers)」→ **`pt-ai`** →「**Edit code**」
4. エディタの中で `Ctrl + A` → `Delete`
   > ⚠️ **継ぎ足さないでください。** 古い中身が残ると動きません
5. `Ctrl + V` で貼り付け
6. 右上の「**Deploy**」

**設定した値（`GEMINI_API_KEY` など）は消えません。**
それらは「Settings」に別で保存されていて、コードとは別の場所にあります。

貼り直したら、**手順6.5** で確認してください。
「Deployments」タブに今日の日付が出ていれば、入れ替わっています。
