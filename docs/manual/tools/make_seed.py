"""説明書の画面写真に写る、架空の記録を作る。

★ 実在の契約者のデータは1件も使いません。すべてこの中で作った架空のものです。
★ 日付を固定しているので、撮り直しても同じ絵になります。

出力: tools/stubs/seed.js（偽 Firestore が読み込む）
先に make_photos.py を実行しておくこと。
"""
import json, datetime, os

DAY = 86400000
# 画面写真の日付を固定する（説明書が毎回同じ絵になるように）
NOW = int(datetime.datetime(2026, 8, 29, 10, 30).timestamp() * 1000)

FOODS = {
    '白米':            dict(kcal=156, p=2.5,  f=0.3,  c=37.1, fiber=0.3, salt=0),
    '鶏むね肉（皮なし）': dict(kcal=105, p=23.3, f=1.9,  c=0.1,  fiber=0,   salt=0.1),
    'ブロッコリー':      dict(kcal=37,  p=5.4,  f=0.6,  c=6.6,  fiber=5.1, salt=0),
    '鮭':              dict(kcal=124, p=22.3, f=4.1,  c=0.1,  fiber=0,   salt=0.2),
    'ほうれん草':       dict(kcal=18,  p=2.2,  f=0.4,  c=3.1,  fiber=2.8, salt=0),
    'オートミール':      dict(kcal=350, p=13.7, f=5.7,  c=69.1, fiber=9.4, salt=0),
    'ヨーグルト（無糖）': dict(kcal=56,  p=3.6,  f=3.0,  c=4.9,  fiber=0,   salt=0.1),
    'バナナ':           dict(kcal=93,  p=1.1,  f=0.2,  c=22.5, fiber=1.1, salt=0),
    '卵':              dict(kcal=142, p=12.2, f=10.2, c=0.4,  fiber=0,   salt=0.4),
    '納豆':            dict(kcal=190, p=16.5, f=10.0, c=12.1, fiber=6.7, salt=0),
}
ALIASES = {
    '白米': ['ごはん', '米', 'ライス'],
    '鶏むね肉（皮なし）': ['鶏胸肉', 'とりむね', 'ムネ肉', '鶏むね肉'],
    'ヨーグルト（無糖）': ['ヨーグルト', 'プレーンヨーグルト'],
}
NOTES = {'鶏むね肉（皮なし）': '皮なし・生', '白米': '炊いたあとの重さ'}

def key(name):
    import unicodedata
    s = unicodedata.normalize('NFKC', name)
    for ch in ' 　・･,、.．':
        s = s.replace(ch, '')
    for ch in '/\\#$[]?*':
        s = s.replace(ch, '')
    s = s.lower()
    s = ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in s)
    return s[:100]

def internal(d):
    return {k: round(v * 1000) for k, v in d.items()}

def item(iid, name, grams):
    per = FOODS[name]
    n = {k: round(v * grams / 100 * 1000) for k, v in per.items()}
    return dict(id=iid, name=name, grams=grams, per100g=internal(per),
                nutrients=n, foodId=key(name), pending=False)

def pending_item(iid, name, grams):
    z = dict(kcal=0, p=0, f=0, c=0, fiber=0, salt=0)
    return dict(id=iid, name=name, grams=grams, per100g=z, nutrients=z,
                foodId=None, pending=True)

S = {}

# ---- 権限 ----
S['users/uid-admin'] = dict(role='admin', active=True, clientId=None)
S['users/uid-tanaka'] = dict(role='client', active=True, clientId='tanaka01')
S['users/uid-suzuki02'] = dict(role='client', active=True, clientId='suzuki02')

# ---- 契約者 ----
def client(cid, name, **kw):
    base = dict(
        clientId=cid, displayName=name, age=None, sex='unspecified', heightCm=None,
        startDate='2026-06-01', memo='', active=True,
        targets=dict(kcal=1800, p=130, f=50, c=200, weightKg=None, bodyFatPct=None, exercise=''),
        reviewMode='standard',
        permissions=dict(pastEditWindowDays=7, allowFoodCreate=True, allowRecipeCreate=True),
        authUid='uid-' + cid, provisionStatus='ready', passwordChangedAt=NOW - 40 * DAY,
        aiConsent=dict(granted=True, updatedAt=NOW - 40 * DAY, version=1),
        extra={}, createdAt=NOW - 60 * DAY, updatedAt=NOW - DAY,
    )
    base.update(kw)
    return base

S['clients/tanaka01'] = client(
    'tanaka01', '田中 花子', age=34, sex='female', heightCm=158,
    memo='週2回ジム。膝に不安あり、走るのは避ける。',
    targets=dict(kcal=1800, p=130, f=50, c=200, weightKg=52, bodyFatPct=24, exercise='週3回 / 1回45分'),
)
S['clients/suzuki02'] = client(
    'suzuki02', '鈴木 太郎', age=41, sex='male', heightCm=172,
    passwordChangedAt=None, aiConsent=dict(granted=False, updatedAt=None, version=0),
    targets=dict(kcal=2200, p=150, f=60, c=250, weightKg=70, bodyFatPct=18, exercise=''),
)
S['clients/sato03'] = client('sato03', '佐藤 みどり', active=False)

# ---- 食品マスタ ----
for name, per in FOODS.items():
    S['foods/' + key(name)] = dict(
        name=name, aliases=ALIASES.get(name, []), key=key(name),
        per100g=per, note=NOTES.get(name, ''),
        createdAt=NOW - 50 * DAY, updatedAt=NOW - 50 * DAY,
    )

# ---- 日ごとの記録 ----
D = '2026-08-28'
S[f'clients/tanaka01/days/{D}'] = dict(
    date=D, status='open', weightKg=53.4, bodyFatPct=25.1,
    hasMeals=True, hasExercise=True, reviewedAt=None, finalizedAt=None,
    checkedAt=None, checkedBy=None, photoOldestAt=NOW - 2 * DAY, updatedAt=NOW - DAY,
)
S[f'clients/tanaka01/days/{D}/meals/m1'] = dict(
    order=0, label='朝食', memo='',
    items=[item('i1', 'オートミール', 40), item('i2', 'ヨーグルト（無糖）', 150),
           item('i3', 'バナナ', 100)],
    createdAt=NOW - DAY, updatedAt=NOW - DAY,
)
S[f'clients/tanaka01/days/{D}/meals/m2'] = dict(
    order=1, label='昼食', memo='',
    items=[pending_item('i4', 'カップヌードル', 77)],
    createdAt=NOW - DAY, updatedAt=NOW - DAY,
)
S[f'clients/tanaka01/days/{D}/meals/m3'] = dict(
    order=2, label='夕食', memo='',
    items=[item('i5', '白米', 180), item('i6', '鶏むね肉（皮なし）', 150),
           item('i7', 'ブロッコリー', 80), item('i8', '卵', 55)],
    createdAt=NOW - DAY, updatedAt=NOW - DAY,
)
S[f'clients/tanaka01/days/{D}/exercises/e1'] = dict(
    order=0, name='ランニング', minutes=25, detail='ゆっくり 3km',
    createdAt=NOW - DAY, updatedAt=NOW - DAY,
)
S[f'clients/tanaka01/days/{D}/exercises/e2'] = dict(
    order=1, name='スクワット', minutes=10, detail='自重 20回 3セット',
    createdAt=NOW - DAY, updatedAt=NOW - DAY,
)
meal_b64 = open(os.path.join(os.path.dirname(__file__), 'photos', 'meal.b64')).read()
S[f'clients/tanaka01/days/{D}/photos/ph1'] = dict(
    dataUrl=meal_b64, width=900, height=675, bytes=33100,
    mealId=None, caption='', createdAt=NOW - 2 * DAY,
)
S[f'clients/tanaka01/days/{D}/notes/n1'] = dict(
    text='夕食のたんぱく質、いい形で入っています。昼が空いたぶんを夕方で取り戻そうとすると'
         '寝つきに響くので、明日は朝に卵を1つ足すところから始めてみてください。',
    by='uid-admin', createdAt=NOW - 20 * 3600 * 1000, updatedAt=NOW - 20 * 3600 * 1000,
)
S[f'clients/tanaka01/days/{D}/review/latest'] = dict(
    text='たんぱく質は目標130gに対して118gで、あと12gです。夕食に卵を1つ足すか、'
         '朝の乳製品を増やすと届きます。脂質は58gで目標より8g多めですが、'
         '揚げものが入った日としては収まっているほうです。炭水化物は目標どおりでした。'
         '運動は25分の記録があります。明日はたんぱく質を先に決めてから、'
         '残りで主食の量を決めると組み立てやすくなります。',
    mode='standard', by='uid-tanaka', createdAt=NOW - 18 * 3600 * 1000,
)

# ほかの日にも印を付けて、カレンダーが寂しくならないようにする
import calendar
for d in range(1, 29):
    date = f'2026-08-{d:02d}'
    if date == D:
        continue
    if d % 7 == 0:
        continue
    S[f'clients/tanaka01/days/{date}'] = dict(
        date=date, status='finalized' if d % 3 == 0 else 'open',
        weightKg=54.6 - d * 0.04 if d % 2 == 0 else None,
        bodyFatPct=None, hasMeals=True, hasExercise=(d % 3 == 1),
        reviewedAt=None, finalizedAt=NOW if d % 3 == 0 else None,
        checkedAt=None, checkedBy=None, photoOldestAt=None,
        updatedAt=NOW - (29 - d) * DAY,
    )

# 写真の期限が近い日（残り2日）
OLD = '2026-07-12'
S[f'clients/tanaka01/days/{OLD}'] = dict(
    date=OLD, status='finalized', weightKg=55.1, bodyFatPct=None,
    hasMeals=True, hasExercise=False, reviewedAt=None, finalizedAt=NOW - 48 * DAY,
    checkedAt=None, checkedBy=None, photoOldestAt=NOW - 48 * DAY, updatedAt=NOW - 48 * DAY,
)
S[f'clients/tanaka01/days/{OLD}/photos/ph9'] = dict(
    dataUrl=meal_b64, width=900, height=675, bytes=33100,
    mealId=None, caption='', createdAt=NOW - 48 * DAY,
)

# 体重の推移用に、前月ぶんも入れておく
for d in range(1, 32):
    date = f'2026-07-{d:02d}'
    if date in (OLD,) or f'clients/tanaka01/days/{date}' in S:
        continue
    if d % 2 == 1:
        continue
    S[f'clients/tanaka01/days/{date}'] = dict(
        date=date, status='open', weightKg=55.8 - d * 0.03, bodyFatPct=None,
        hasMeals=True, hasExercise=False, reviewedAt=None, finalizedAt=None,
        checkedAt=None, checkedBy=None, photoOldestAt=None, updatedAt=NOW - 60 * DAY,
    )

# ---- 登録依頼 ----
label_b64 = open(os.path.join(os.path.dirname(__file__), 'photos', 'label.b64')).read()
k1 = key('カップヌードル')
S['foodRequests/' + k1] = dict(key=k1, updatedAt=NOW - DAY)
S[f'foodRequests/{k1}/from/tanaka01'] = dict(
    variant='カップヌードル', count=2, dates=['2026-08-26', D],
    candidatePer100g=dict(kcal=461.4, p=10.0, f=18.1, c=65.3, fiber=0, salt=4.2),
    candidateNote='1食57gあたりの表示から換算しました（めん・かやくの欄）。',
    candidatePhoto=label_b64, updatedAt=NOW - DAY,
)
k2 = key('サラダチキン')
S['foodRequests/' + k2] = dict(key=k2, updatedAt=NOW - 2 * DAY)
S[f'foodRequests/{k2}/from/tanaka01'] = dict(
    variant='サラダチキン', count=3, dates=['2026-08-20', '2026-08-24', '2026-08-27'],
    updatedAt=NOW - 2 * DAY,
)
S[f'foodRequests/{k2}/from/suzuki02'] = dict(
    variant='サラダ チキン', count=1, dates=['2026-08-25'], updatedAt=NOW - 3 * DAY,
)

out = os.path.join(os.path.dirname(__file__), 'stubs', 'seed.js')
with open(out, 'w', encoding='utf-8') as fh:
    fh.write('// 説明書の画面写真を撮るためだけのダミーデータ。製品には入りません。\n')
    fh.write('export const SEED = ')
    fh.write(json.dumps(S, ensure_ascii=False))
    fh.write(';\n')
print('wrote', out, len(S), 'docs')
