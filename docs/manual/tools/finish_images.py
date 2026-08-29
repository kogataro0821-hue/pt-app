"""撮った画面写真を、誌面に載る形に整える。

やること2つ:
  1. 縦に長すぎる画面を、列に切って横に並べる（そのままでは誌面で読めない）
  2. 色数を落として軽くする（リポジトリを太らせないため）

出力はどちらも docs/manual/img/ の中で完結します。
"""
from PIL import Image, ImageDraw
import glob
import os

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, '..', 'img')


def columns(src, dst, n, gap=26):
    """1枚の縦長画像を n 列に切って横に並べる。境目に細い線を入れる。"""
    im = Image.open(os.path.join(IMG, src)).convert('RGB')
    w, h = im.size
    ch = -(-h // n)
    out = Image.new('RGB', (w * n + gap * (n - 1), ch), (255, 255, 255))
    for i in range(n):
        out.paste(im.crop((0, i * ch, w, min((i + 1) * ch, h))), (i * (w + gap), 0))
    d = ImageDraw.Draw(out)
    for i in range(1, n):
        x = i * (w + gap) - gap // 2
        d.line([x, 0, x, ch], fill=(214, 218, 206), width=3)
    out.save(os.path.join(IMG, dst))
    print('  組んだ:', dst, out.size)


# ★ 何列にするかは、縦横比から決めています。
#   day-full は1画面が10倍の高さなので3列。ほかは2列で足ります。
columns('day-full.png', 'day-map.png', 3)
columns('adm-foods.png', 'adm-foods-2.png', 2)
columns('adm-request-open.png', 'adm-request-open-2.png', 2)
columns('panel-text-result.png', 'panel-text-result-2.png', 2)

# ---- 軽くする ----
# 画面写真は色数が少ないので、256色に落としても見た目は変わりません。
# 実測でおよそ3分の1になります（5.8MB → 1.9MB）。
before = after = 0
for f in sorted(glob.glob(os.path.join(IMG, '*.png'))):
    before += os.path.getsize(f)
    im = Image.open(f).convert('RGB')
    im.quantize(colors=256, method=Image.Quantize.FASTOCTREE,
                dither=Image.Dither.NONE).save(f, optimize=True)
    after += os.path.getsize(f)

print(f'  軽くした: {before / 1e6:.2f}MB → {after / 1e6:.2f}MB')
print('\n次: node docs/manual/tools/topdf.mjs')
