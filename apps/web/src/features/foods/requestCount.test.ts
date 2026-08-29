import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 未処理の登録依頼の件数（設計書 §21）。
 *
 * ★ ここで守りたいのは2つです。
 *
 *   1. 溜まっていることに気づけること
 *      依頼に気づかないあいだ、その食材は栄養値0のまま集計されます。
 *      数字を根拠にした指導ができない日が、黙って増えます。
 *
 *   2. そのために、読み取りを増やしすぎないこと
 *      バッジは全画面の上に出ます。画面を移るたびに数え直すと、
 *      移動しただけで無料枠が減ります。
 */

const getCountFromServer = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  getCountFromServer: (...args: unknown[]): unknown => getCountFromServer(...args),
}));

vi.mock('@/lib/firebase', () => ({ getDb: vi.fn(() => ({})) }));

import {
  clearRequestCount,
  ensureRequestCount,
  invalidateRequestCount,
  requestCountSnapshot,
  setRequestCount,
  subscribeRequestCount,
} from './requestCount';

/** 件数を1回返す問い合わせ */
function answers(n: number) {
  getCountFromServer.mockResolvedValue({ data: () => ({ count: n }) });
}

beforeEach(() => {
  getCountFromServer.mockReset();
  clearRequestCount();
});

describe('数えるのは、必要なときだけ', () => {
  it('まだ数えていなければ、数えて覚える', async () => {
    answers(3);
    await ensureRequestCount();
    expect(requestCountSnapshot()).toBe(3);
  });

  it('一度数えたら、二度は数えない（画面を移るたびに読み取りが増えない）', async () => {
    answers(3);
    await ensureRequestCount();
    await ensureRequestCount();
    await ensureRequestCount();
    expect(getCountFromServer).toHaveBeenCalledTimes(1);
  });

  it('一覧を読んだあとは、数えにいかない', async () => {
    // ★ 一覧には正しい数が入っています。そこから教えてもらえば、
    //   数えるための読み取りは要りません
    setRequestCount(7);
    await ensureRequestCount();

    expect(requestCountSnapshot()).toBe(7);
    expect(getCountFromServer).not.toHaveBeenCalled();
  });

  it('0件でも「数えた」扱いにする（0を「まだ分からない」と混同しない）', async () => {
    answers(0);
    await ensureRequestCount();
    await ensureRequestCount();

    expect(requestCountSnapshot()).toBe(0);
    expect(getCountFromServer).toHaveBeenCalledTimes(1);
  });

  it('同時に呼ばれても、数えるのは1回だけ', async () => {
    answers(5);
    await Promise.all([ensureRequestCount(), ensureRequestCount(), ensureRequestCount()]);
    expect(getCountFromServer).toHaveBeenCalledTimes(1);
  });
});

describe('数が変わったとき', () => {
  it('依頼を処理したら、次に必要になったときに数え直す', async () => {
    answers(3);
    await ensureRequestCount();

    invalidateRequestCount();
    expect(requestCountSnapshot()).toBeNull();

    answers(2);
    await ensureRequestCount();
    expect(requestCountSnapshot()).toBe(2);
  });

  it('件数が変わったら、見ている側に知らせる', () => {
    const notified = vi.fn();
    const stop = subscribeRequestCount(notified);

    setRequestCount(4);
    expect(notified).toHaveBeenCalledTimes(1);

    // 同じ数なら、知らせない（画面を無駄に描き直さない）
    setRequestCount(4);
    expect(notified).toHaveBeenCalledTimes(1);

    stop();
    setRequestCount(9);
    expect(notified).toHaveBeenCalledTimes(1);
  });
});

describe('★ 数えられなくても、画面は壊さない', () => {
  it('問い合わせが失敗しても、例外を投げない', async () => {
    getCountFromServer.mockRejectedValue(new Error('permission-denied'));
    await expect(ensureRequestCount()).resolves.toBeUndefined();
    expect(requestCountSnapshot()).toBeNull();
  });

  it('失敗したあと、何度も問い合わせ直さない', async () => {
    // ★ ここが無いと、権限が無い人の画面で、移動のたびに失敗の問い合わせが飛びます
    getCountFromServer.mockRejectedValue(new Error('permission-denied'));
    await ensureRequestCount();
    await ensureRequestCount();
    expect(getCountFromServer).toHaveBeenCalledTimes(1);
  });
});
