PT-app  説明書のバックアップ（docs/manual）
==========================================

【Firestore Rules の貼り直し: 不要です】

  今回はルールを1文字も触っていません。


やること
--------

1. この ZIP を展開する
2. 中の docs と eslint.config.mjs を
   C:\\Users\\user\\Desktop\\pt-app の上に、そのまま上書きコピー
3. GitHub Desktop で Changes を確認する
     → 59 ファイルのはずです
     → 「削除された」ファイルが1つも無いことを確認
4. コミットして Push


コミットメッセージ
------------------

  説明書（契約者用・管理者用）と、その作り直し一式


入っているもの
--------------

  docs/manual/pdf/      配布する PDF 2冊（これが本体）
  docs/manual/*.html    本文（次に直すのはここ）
  docs/manual/style.css 体裁（A4・余白・囲み・表）
  docs/manual/img/      画面写真 43枚
  docs/manual/tools/    画面写真を撮り直して PDF を作り直す道具一式
  docs/manual/README.md 直すときの手順

  eslint.config.mjs … docs/manual/tools を検査の対象外にする指定を1つ足しただけ


次に説明書を直すとき
--------------------

  文章だけ直す場合:
      HTML を直して、PDF を作り直すだけ。写真はそのままです。

  画面が変わった場合:
      docs/manual/README.md に、6行のコマンドが書いてあります。
      アプリ本体は1行も書き換えません。
      撮れない画面があると、その場で止まって画面名を教えます。


確認したこと
------------

  GitHub から新しく clone したものに、この一式を重ねて、

    npm ci         OK
    npm run verify OK  （core 239 / ai-contract 39 / worker 15）
    npm run build  OK

  そのうえで、説明書の作り直しも最初から通しました。
  画面写真43枚、PDF 2冊、どちらも作り直せています。


ひとつ気づいたこと
------------------

  前回の ZIP に入れていた README-first.txt が、
  リポジトリの一番上にコミットされています。
  作業用のメモなので、消してしまって構いません。
  （今回の ZIP には入れ直していないので、消しても何も壊れません）

入っているファイル（59）
------------------------
  docs/manual/README.md
  docs/manual/admin.html
  docs/manual/client.html
  docs/manual/img/adm-account.png
  docs/manual/img/adm-basic.png
  docs/manual/img/adm-can.png
  docs/manual/img/adm-check-confirm.png
  docs/manual/img/adm-check.png
  docs/manual/img/adm-client-new.png
  docs/manual/img/adm-clients.png
  docs/manual/img/adm-food-editor.png
  docs/manual/img/adm-foods-2.png
  docs/manual/img/adm-foods.png
  docs/manual/img/adm-note.png
  docs/manual/img/adm-request-open-2.png
  docs/manual/img/adm-request-open.png
  docs/manual/img/adm-requests.png
  docs/manual/img/adm-target.png
  docs/manual/img/adm-tone.png
  docs/manual/img/ai-consent-detail.png
  docs/manual/img/ai-consent.png
  docs/manual/img/cal-warn.png
  docs/manual/img/cal.png
  docs/manual/img/day-body.png
  docs/manual/img/day-exercise.png
  docs/manual/img/day-finalize.png
  docs/manual/img/day-full.png
  docs/manual/img/day-map.png
  docs/manual/img/day-meal.png
  docs/manual/img/day-note.png
  docs/manual/img/day-pending.png
  docs/manual/img/day-photos.png
  docs/manual/img/day-review.png
  docs/manual/img/day-totals.png
  docs/manual/img/entry-buttons.png
  docs/manual/img/first-password.png
  docs/manual/img/item-form.png
  docs/manual/img/login.png
  docs/manual/img/panel-label.png
  docs/manual/img/panel-photo.png
  docs/manual/img/panel-text-result-2.png
  docs/manual/img/panel-text-result.png
  docs/manual/img/panel-text.png
  docs/manual/img/weight.png
  docs/manual/pdf/PT-Manager-使い方ガイド-契約者用.pdf
  docs/manual/pdf/PT-Manager-運用ガイド-管理者用.pdf
  docs/manual/style.css
  docs/manual/tools/.gitignore
  docs/manual/tools/finish_images.py
  docs/manual/tools/make_photos.py
  docs/manual/tools/make_seed.py
  docs/manual/tools/shoot.mjs
  docs/manual/tools/stubs/firebase-app.js
  docs/manual/tools/stubs/firebase-auth.js
  docs/manual/tools/stubs/firebase-firestore.js
  docs/manual/tools/stubs/gemini.js
  docs/manual/tools/topdf.mjs
  docs/manual/tools/vite.harness.config.mjs
  eslint.config.mjs
