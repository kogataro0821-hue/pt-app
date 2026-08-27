import { describe, expect, it } from 'vitest';
import {
  SIMILAR_THRESHOLD,
  allNames,
  bigrams,
  findExactFood,
  findSimilarFoods,
  foodKey,
  isSameFoodName,
  orderedVariants,
  preferredVariant,
  shouldAddAlias,
  similarity,
  type NameableFood,
} from './matching';

function food(id: string, name: string, aliases: string[] = []): NameableFood {
  return { id, name, aliases };
}

const MASTER: NameableFood[] = [
  food('f1', '鶏むね肉', ['とりむね肉', '鶏胸肉']),
  food('f2', '鶏もも肉'),
  food('f3', 'サラダチキン'),
  food('f4', '白米'),
  food('f5', '焼きとり'),
  food('f6', 'ブロッコリー'),
  food('f7', 'ラーメン'),
];

describe('★ 表記ゆれの吸収（照合キー）', () => {
  // ★ ここが分裂を防ぐ要。同じ食材が別物として登録されると、
  //   数値を統一するために作った仕組みが逆に分裂を生む。
  it('全角・半角のゆれを吸収する', () => {
    expect(foodKey('ｻﾗﾀﾞﾁｷﾝ')).toBe(foodKey('サラダチキン'));
  });

  it('空白のゆれを吸収する', () => {
    expect(foodKey('サラダ チキン')).toBe(foodKey('サラダチキン'));
    expect(foodKey('サラダ　チキン')).toBe(foodKey('サラダチキン'));
  });

  it('カタカナとひらがなのゆれを吸収する', () => {
    expect(foodKey('鶏ムネ肉')).toBe(foodKey('鶏むね肉'));
    expect(foodKey('サラダチキン')).toBe(foodKey('さらだちきん'));
  });

  it('英字の大小を吸収する', () => {
    expect(foodKey('Chicken')).toBe(foodKey('chicken'));
  });

  it('中黒や読点を除去する', () => {
    expect(foodKey('鶏・むね肉')).toBe(foodKey('鶏むね肉'));
  });

  // ★ 吸収しすぎると別の食材まで巻き込む。ここは意図的に区別を残している。
  it('長音は残す（ラーメンとラメンは別物）', () => {
    expect(foodKey('ラーメン')).not.toBe(foodKey('ラメン'));
  });

  it('小書き文字は残す（ホッケとホケは別物）', () => {
    expect(foodKey('ホッケ')).not.toBe(foodKey('ホケ'));
  });

  it('別の食材を同じ扱いにしない', () => {
    expect(foodKey('鶏むね肉')).not.toBe(foodKey('鶏もも肉'));
    expect(foodKey('白米')).not.toBe(foodKey('玄米'));
  });

  it('isSameFoodName', () => {
    expect(isSameFoodName('鶏ムネ肉', '鶏むね肉')).toBe(true);
    expect(isSameFoodName('鶏むね肉', '鶏もも肉')).toBe(false);
    expect(isSameFoodName('', '鶏むね肉')).toBe(false);
  });
});

describe('名前の近さ', () => {
  it('同じ名前は1', () => {
    expect(similarity('サラダチキン', 'サラダチキン')).toBe(1);
  });

  it('表記がゆれていても1', () => {
    expect(similarity('ｻﾗﾀﾞ ﾁｷﾝ', 'サラダチキン')).toBe(1);
  });

  // ★ 打ち間違い・打ちかけを拾えること。
  it('1文字足りない名前は高く一致する', () => {
    expect(similarity('サラダチキ', 'サラダチキン')).toBeGreaterThan(SIMILAR_THRESHOLD);
  });

  it('無関係な名前は低い', () => {
    expect(similarity('白米', 'ブロッコリー')).toBeLessThan(SIMILAR_THRESHOLD);
  });

  it('空文字は0', () => {
    expect(similarity('', 'サラダチキン')).toBe(0);
  });

  it('1文字どうしでも壊れない', () => {
    expect(similarity('米', '米')).toBe(1);
    expect(similarity('米', '肉')).toBe(0);
  });

  it('同じ2文字が複数回出ても数えすぎない', () => {
    // 「ささみ」と「ささささみ」で1を超えないこと
    expect(similarity('ささみ', 'ささささみ')).toBeLessThanOrEqual(1);
  });

  it('bigrams', () => {
    expect(bigrams('さらだ')).toEqual(['さら', 'らだ']);
    expect(bigrams('米')).toEqual(['米']);
    expect(bigrams('')).toEqual([]);
  });
});

describe('★ AIの出力を既存マスタに当てる', () => {
  // ★ ここが一番大きい。大半のゆれは契約者の目に触れる前に消える。
  it('AIが「鶏ムネ肉」と返しても既存の「鶏むね肉」に当たる', () => {
    expect(findExactFood(MASTER, '鶏ムネ肉')?.id).toBe('f1');
  });

  it('別名でも当たる', () => {
    expect(findExactFood(MASTER, '鶏胸肉')?.id).toBe('f1');
    expect(findExactFood(MASTER, 'とりむね肉')?.id).toBe('f1');
  });

  it('半角カナでも当たる', () => {
    expect(findExactFood(MASTER, 'ｻﾗﾀﾞﾁｷﾝ')?.id).toBe('f3');
  });

  it('無いものは null', () => {
    expect(findExactFood(MASTER, 'アボカド')).toBeNull();
    expect(findExactFood(MASTER, '')).toBeNull();
  });

  it('似ているだけでは当たらない（別物を勝手に当てない）', () => {
    expect(findExactFood(MASTER, '鶏むね肉たたき')).toBeNull();
  });
});

describe('★ 似た名前の提案（依頼を出す前に既存へ寄せる）', () => {
  it('打ちかけでも候補に出る', () => {
    const hits = findSimilarFoods(MASTER, 'サラダチキ');
    expect(hits[0]?.food.id).toBe('f3');
  });

  it('完全一致がいちばん上に来る', () => {
    const hits = findSimilarFoods(MASTER, '鶏むね肉');
    expect(hits[0]?.food.id).toBe('f1');
    expect(hits[0]?.score).toBe(1);
  });

  // ★ 「とり」で「焼きとり」が先に出ると探しにくい。前方一致を優先する。
  //   「鶏むね肉」は別名「とりむね肉」が前方一致、「焼きとり」は部分一致。
  it('前方一致が部分一致より上に来る', () => {
    const hits = findSimilarFoods(MASTER, 'とり');
    const ids = hits.map((h) => h.food.id);
    expect(ids).toContain('f1');
    expect(ids).toContain('f5');
    expect(ids.indexOf('f1')).toBeLessThan(ids.indexOf('f5'));
  });

  it('漢字で引くと、その漢字を含むものだけが出る', () => {
    const ids = findSimilarFoods(MASTER, '鶏').map((h) => h.food.id);
    expect(ids).toContain('f1');
    expect(ids).toContain('f2');
    // 「焼きとり」は かな なので、漢字の「鶏」では引っかからない
    expect(ids).not.toContain('f5');
  });

  it('どの名前に当たったかが分かる', () => {
    const hits = findSimilarFoods(MASTER, '鶏胸肉');
    expect(hits[0]?.matchedName).toBe('鶏胸肉');
  });

  it('無関係な名前では何も出ない', () => {
    expect(findSimilarFoods(MASTER, 'アボカド')).toHaveLength(0);
  });

  it('件数を制限できる', () => {
    expect(findSimilarFoods(MASTER, '鶏', 1)).toHaveLength(1);
  });

  it('空文字では何も出ない', () => {
    expect(findSimilarFoods(MASTER, '   ')).toHaveLength(0);
  });
});

describe('別名の追加', () => {
  it('新しい表記なら足す', () => {
    expect(shouldAddAlias(MASTER[0]!, 'チキンブレスト')).toBe(true);
  });

  // 別名が同義語だらけになると、かえって照合が鈍る。
  it('すでに持っている表記なら足さない', () => {
    expect(shouldAddAlias(MASTER[0]!, '鶏胸肉')).toBe(false);
    expect(shouldAddAlias(MASTER[0]!, '鶏ムネ肉')).toBe(false);
    expect(shouldAddAlias(MASTER[0]!, '鶏むね肉')).toBe(false);
  });

  it('空文字は足さない', () => {
    expect(shouldAddAlias(MASTER[0]!, '  ')).toBe(false);
  });

  it('allNames は本名と別名を返す', () => {
    expect(allNames(MASTER[0]!)).toEqual(['鶏むね肉', 'とりむね肉', '鶏胸肉']);
  });
});

describe('★ 照合キーはそのままドキュメントIDに使える', () => {
  // ★ このキーは食品マスタのIDにも登録依頼のIDにもなります。
  //   使う側でそれぞれ文字を落としていた頃は、照合キーと依頼のIDが食い違い、
  //   あとから過去の記録を置き換えるときに黙って取りこぼしていました。
  //   キーの作り方を1か所に統一したので、その食い違いは起きません。

  const FORBIDDEN = ['/', '\\', '#', '$', '[', ']', '?', '*'];

  it.each(FORBIDDEN)('Firestore が受け付けない文字 %s が残らない', (char) => {
    expect(foodKey(`カット${char}野菜`)).not.toContain(char);
  });

  it('スラッシュを含む名前でも、同じ名前なら同じキーになる', () => {
    expect(foodKey('1/2カット')).toBe(foodKey('1／2かっと'));
  });

  it('長い名前でもIDの長さに収まる', () => {
    expect(foodKey('あ'.repeat(400)).length).toBe(100);
  });

  it('記号だけの名前は空になる（依頼を積まない目印になる）', () => {
    expect(foodKey('///')).toBe('');
    expect(foodKey('   ')).toBe('');
  });

  it('ふつうの食材名は今までどおり変わらない', () => {
    expect(foodKey('鶏むね肉')).toBe('鶏むね肉');
    expect(foodKey('サラダチキン')).toBe('さらだちきん');
  });
});

describe('★ 表記のゆれから代表を選ぶ', () => {
  // ★ 実際に起きた不具合の再現。
  //   「サラダチキン」→「サラダ（全角スペース）チキン」の順に使われたとき、
  //   後から来た全角スペース入りのほうが代表になっていた。
  it('同数なら、余計な空白が入っていない短いほうを代表にする', () => {
    expect(
      preferredVariant([
        { text: 'サラダチキン', count: 1 },
        { text: 'サラダ　チキン', count: 1 },
      ]),
    ).toBe('サラダチキン');
  });

  it('順番を入れ替えても結果は変わらない', () => {
    expect(
      preferredVariant([
        { text: 'サラダ　チキン', count: 1 },
        { text: 'サラダチキン', count: 1 },
      ]),
    ).toBe('サラダチキン');
  });

  it('多く使われた表記が優先される（短さより回数）', () => {
    expect(
      preferredVariant([
        { text: 'とりむね', count: 1 },
        { text: '鶏むね肉（皮なし）', count: 9 },
      ]),
    ).toBe('鶏むね肉（皮なし）');
  });

  it('回数も長さも同じなら、いつも同じものを選ぶ', () => {
    const a = preferredVariant([
      { text: 'あいう', count: 2 },
      { text: 'かきく', count: 2 },
    ]);
    const b = preferredVariant([
      { text: 'かきく', count: 2 },
      { text: 'あいう', count: 2 },
    ]);
    expect(a).toBe(b);
  });

  it('空白だけの表記は無視する', () => {
    expect(
      preferredVariant([
        { text: '  ', count: 5 },
        { text: '納豆', count: 1 },
      ]),
    ).toBe('納豆');
  });

  it('何も無ければ空を返す', () => {
    expect(preferredVariant([])).toBe('');
  });

  it('代表が先頭に来て、重複なく並ぶ', () => {
    expect(
      orderedVariants([
        { text: 'サラダ　チキン', count: 1 },
        { text: 'サラダチキン', count: 1 },
        { text: 'サラダチキン', count: 1 },
      ]),
    ).toEqual(['サラダチキン', 'サラダ　チキン']);
  });
});
