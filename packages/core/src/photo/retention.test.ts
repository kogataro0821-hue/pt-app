import { describe, expect, it } from 'vitest';
import {
  PHOTO_RETENTION_DAYS,
  PHOTO_WARN_DAYS,
  isPhotoExpired,
  isPhotoExpiringSoon,
  photoDaysLeft,
  photoExpiresAt,
  photoExpiryLabel,
  photoExpiryThreshold,
  photoWarnThreshold,
} from './retention';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-27T12:00:00+09:00');

/** n日前に撮った写真の createdAt */
function daysAgo(n: number): number {
  return NOW - n * DAY;
}

describe('写真の保存期間', () => {
  it('7週間（49日）で消える', () => {
    expect(PHOTO_RETENTION_DAYS).toBe(49);
    expect(photoExpiresAt(NOW)).toBe(NOW + 49 * DAY);
  });

  it('撮ったばかりなら残り49日', () => {
    expect(photoDaysLeft(NOW, NOW)).toBe(49);
  });

  it('47日前の写真は残り2日', () => {
    expect(photoDaysLeft(daysAgo(47), NOW)).toBe(2);
  });

  // ★ 切り上げているのは「残り0日」と出したあとに半日残る状態を作らないため。
  it('残りが半日でも「残り1日」と数える', () => {
    expect(photoDaysLeft(daysAgo(48.5), NOW)).toBe(1);
  });

  it('期限が来たら残り0日', () => {
    expect(photoDaysLeft(daysAgo(49), NOW)).toBe(0);
    expect(photoDaysLeft(daysAgo(100), NOW)).toBe(0);
  });
});

describe('期限切れの判定', () => {
  it('48日前はまだ消さない', () => {
    expect(isPhotoExpired(daysAgo(48), NOW)).toBe(false);
  });

  it('ちょうど49日で消す', () => {
    expect(isPhotoExpired(daysAgo(49), NOW)).toBe(true);
  });

  it('50日前は消す', () => {
    expect(isPhotoExpired(daysAgo(50), NOW)).toBe(true);
  });
});

describe('もうすぐ消える写真の知らせ', () => {
  it('残り2日から知らせる', () => {
    expect(PHOTO_WARN_DAYS).toBe(2);
    expect(isPhotoExpiringSoon(daysAgo(47), NOW)).toBe(true);
  });

  it('残り3日ならまだ知らせない', () => {
    expect(isPhotoExpiringSoon(daysAgo(46), NOW)).toBe(false);
  });

  it('期限切れも知らせる対象に含む', () => {
    expect(isPhotoExpiringSoon(daysAgo(60), NOW)).toBe(true);
  });

  it('文言は残り日数で変わる', () => {
    expect(photoExpiryLabel(daysAgo(47), NOW)).toBe('あと2日で消えます');
    expect(photoExpiryLabel(daysAgo(48), NOW)).toBe('あと1日で消えます');
    expect(photoExpiryLabel(daysAgo(49), NOW)).toBe('まもなく消えます');
  });
});

// ★ 全部読んでから絞り込むと、それだけで無料枠を使い切る。
//   絞り込んでから読むための境界値が正しいことを、判定関数と突き合わせて確かめる。
describe('探すための境界値', () => {
  it('知らせる境界より前の写真は、必ず「もうすぐ消える」', () => {
    const threshold = photoWarnThreshold(NOW);
    expect(isPhotoExpiringSoon(threshold, NOW)).toBe(true);
    expect(isPhotoExpiringSoon(threshold - DAY, NOW)).toBe(true);
  });

  it('知らせる境界より後の写真は、まだ知らせない', () => {
    expect(isPhotoExpiringSoon(photoWarnThreshold(NOW) + DAY, NOW)).toBe(false);
  });

  it('期限の境界より前の写真は、必ず期限切れ', () => {
    const threshold = photoExpiryThreshold(NOW);
    expect(isPhotoExpired(threshold, NOW)).toBe(true);
    expect(isPhotoExpired(threshold - DAY, NOW)).toBe(true);
  });

  it('期限の境界より後の写真は、まだ消さない', () => {
    expect(isPhotoExpired(photoExpiryThreshold(NOW) + DAY, NOW)).toBe(false);
  });

  // ★ 知らせる境界のほうが必ず「あと」に来る。
  //   逆になっていると、知らせる前に消えます。
  it('知らせる境界は、期限の境界より新しい', () => {
    expect(photoWarnThreshold(NOW)).toBeGreaterThan(photoExpiryThreshold(NOW));
  });
});
