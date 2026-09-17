import { describe, expect, it } from 'vitest';
import { greetingFor, greetingWithName } from './greeting';

/** JST の時刻から実時刻(ms)を作る小道具。 */
function jst(h: number, min = 0): number {
  return Date.UTC(2026, 8, 6, h - 9, min, 0, 0);
}

describe('時間帯のあいさつ', () => {
  it('朝', () => {
    expect(greetingFor(jst(4))).toBe('おはようございます');
    expect(greetingFor(jst(7))).toBe('おはようございます');
    expect(greetingFor(jst(10, 59))).toBe('おはようございます');
  });

  it('昼', () => {
    expect(greetingFor(jst(11))).toBe('こんにちは');
    expect(greetingFor(jst(17, 59))).toBe('こんにちは');
  });

  it('夜', () => {
    expect(greetingFor(jst(18))).toBe('こんばんは');
    expect(greetingFor(jst(23))).toBe('こんばんは');
  });

  it('★ 深夜は「こんばんは」', () => {
    // ★ 午前2時に「おはよう」と言われると気味が悪いだけです。
    //   かけらの1日は朝4時区切りですが、あいさつは時計どおりにします
    expect(greetingFor(jst(0))).toBe('こんばんは');
    expect(greetingFor(jst(2))).toBe('こんばんは');
    expect(greetingFor(jst(3, 59))).toBe('こんばんは');
  });

  it('境目ちょうど', () => {
    expect(greetingFor(jst(3, 59))).toBe('こんばんは');
    expect(greetingFor(jst(4, 0))).toBe('おはようございます');
    expect(greetingFor(jst(10, 59))).toBe('おはようございます');
    expect(greetingFor(jst(11, 0))).toBe('こんにちは');
    expect(greetingFor(jst(17, 59))).toBe('こんにちは');
    expect(greetingFor(jst(18, 0))).toBe('こんばんは');
  });
});

describe('名前を添える', () => {
  it('名前が入る', () => {
    expect(greetingWithName('田中 花子', jst(19))).toBe('こんばんは、田中 花子さん');
  });

  it('★ 名前が空なら、あいさつだけ', () => {
    // ★ 「こんばんは、さん」になるほうが、よほど失礼です
    expect(greetingWithName('', jst(19))).toBe('こんばんは');
    expect(greetingWithName('   ', jst(19))).toBe('こんばんは');
  });

  it('前後の空白は落とす', () => {
    expect(greetingWithName('  田中  ', jst(12))).toBe('こんにちは、田中さん');
  });
});
