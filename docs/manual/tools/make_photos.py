"""説明書に出てくるダミーの写真を作る（食事の写真と、栄養成分表示）。

★ 本物の商品パッケージや、契約者の実際の食事は使いません。
  公開リポジトリに入るものなので、すべて描いて作ります。

出力: tools/photos/meal.jpg, label.jpg  と、その base64（seed 用）
"""
from PIL import Image, ImageDraw, ImageFont
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'photos')
os.makedirs(OUT, exist_ok=True)

JP = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
JPB = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"


def f(sz, bold=False):
    return ImageFont.truetype(JPB if bold else JP, sz)


# ---------- 1. 食事の写真（イラスト） ----------
W, H = 900, 675
im = Image.new("RGB", (W, H), (238, 233, 224))
d = ImageDraw.Draw(im)
d.rectangle([0, H * 0.62, W, H], fill=(206, 188, 164))
d.rounded_rectangle([70, 150, 830, 620], 28, fill=(246, 243, 236),
                    outline=(222, 214, 200), width=3)
# 茶碗（ごはん）
d.ellipse([120, 330, 340, 520], fill=(250, 250, 252), outline=(210, 210, 215), width=4)
d.ellipse([140, 335, 320, 470], fill=(252, 252, 250), outline=(226, 226, 226), width=2)
d.ellipse([158, 345, 302, 455], fill=(255, 255, 255))
# 皿（鮭）
d.ellipse([360, 280, 660, 520], fill=(252, 252, 250), outline=(214, 214, 214), width=4)
d.rounded_rectangle([430, 350, 600, 440], 16, fill=(226, 124, 86))
for i in range(4):
    y = 362 + i * 20
    d.line([440, y, 590, y], fill=(240, 168, 138), width=6)
d.ellipse([600, 420, 650, 470], fill=(146, 178, 110))
# 小鉢（ほうれん草）
d.ellipse([660, 320, 830, 470], fill=(226, 232, 222), outline=(200, 208, 196), width=4)
d.ellipse([680, 335, 810, 445], fill=(255, 255, 255))
for x, y in [(710, 370), (745, 360), (775, 380), (720, 400), (760, 405)]:
    d.ellipse([x, y, x + 42, y + 30], fill=(74, 110, 60))
# 箸
d.line([120, 570, 700, 545], fill=(126, 92, 62), width=9)
d.line([124, 592, 704, 567], fill=(126, 92, 62), width=9)
im.save(os.path.join(OUT, "meal.jpg"), quality=82)

# ---------- 2. 成分表示の写真 ----------
# ★ 欄が2つ並んでいる形にしてあります。
#   「1食あたり」と「めん・かやくあたり」で2割ちがう、という
#   説明書でいちばん伝えたい話が、絵だけで分かるようにするためです。
W, H = 780, 980
im = Image.new("RGB", (W, H), (228, 226, 222))
d = ImageDraw.Draw(im)
d.rounded_rectangle([40, 40, 740, 940], 10, fill=(252, 251, 248),
                    outline=(196, 192, 186), width=3)
d.text((70, 80), "栄養成分表示", font=f(38, True), fill=(24, 24, 24))
d.text((70, 136), "1食（77g）当たり", font=f(26), fill=(60, 60, 60))

y = 190
d.line([70, y, 710, y], fill=(150, 150, 150), width=2)
for k, v in [("熱量", "263 kcal"), ("たんぱく質", "5.7 g"), ("脂質", "10.3 g"),
             ("炭水化物", "37.2 g"), ("食塩相当量", "2.4 g")]:
    y += 8
    d.text((90, y + 10), k, font=f(30), fill=(20, 20, 20))
    d.text((700 - d.textlength(v, font=f(30, True)), y + 10), v, font=f(30, True),
           fill=(20, 20, 20))
    y += 54
    d.line([70, y, 710, y], fill=(200, 200, 200), width=1)

y += 40
d.text((70, y), "（めん・かやく 57g 当たり）", font=f(24, True), fill=(40, 40, 40))
y += 44
d.line([70, y, 710, y], fill=(150, 150, 150), width=2)
for k, v in [("熱量", "243 kcal"), ("たんぱく質", "5.0 g"), ("脂質", "9.9 g"),
             ("炭水化物", "33.9 g"), ("食塩相当量", "1.3 g")]:
    y += 6
    d.text((90, y + 8), k, font=f(26), fill=(50, 50, 50))
    d.text((700 - d.textlength(v, font=f(26)), y + 8), v, font=f(26), fill=(50, 50, 50))
    y += 46
    d.line([70, y, 710, y], fill=(210, 210, 210), width=1)

y += 36
d.text((70, y), "この表示値は、目安です。", font=f(22), fill=(110, 110, 110))
im.save(os.path.join(OUT, "label.jpg"), quality=82)

for name in ("meal", "label"):
    path = os.path.join(OUT, f"{name}.jpg")
    b = open(path, "rb").read()
    with open(os.path.join(OUT, f"{name}.b64"), "w") as fh:
        fh.write("data:image/jpeg;base64," + base64.b64encode(b).decode())
    print(name, len(b), "バイト")
