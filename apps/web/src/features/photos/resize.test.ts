import { describe, expect, it } from 'vitest';
import { formatBytes, photoErrorMessage } from './resize';

describe('formatBytes', () => {
  it('小さいものはバイトのまま', () => {
    expect(formatBytes(0)).toBe('0バイト');
    expect(formatBytes(1023)).toBe('1023バイト');
  });

  it('1KB以上はKBで、だいたいの値として出す', () => {
    expect(formatBytes(1024)).toBe('約1KB');
    expect(formatBytes(120 * 1024)).toBe('約120KB');
  });

  it('1MB以上はMBで、小数第1位まで', () => {
    expect(formatBytes(1024 * 1024)).toBe('約1.0MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('約1.5MB');
  });
});

describe('photoErrorMessage', () => {
  it('4つの原因すべてに、次にどうすればよいかが書いてある', () => {
    for (const kind of ['notImage', 'tooLarge', 'decodeFailed', 'unsupported'] as const) {
      expect(photoErrorMessage(kind).length).toBeGreaterThan(0);
    }
    expect(photoErrorMessage('notImage')).toContain('画像ファイル');
    expect(photoErrorMessage('tooLarge')).toContain('別の写真');
    expect(photoErrorMessage('unsupported')).toContain('ブラウザ');
  });
});
