import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshToLatest } from './refresh';

/**
 * 「最新に更新する」（追加仕様: 版の表示）。
 *
 * ★ ホーム画面から開いたアプリは、勝手には新しくなりません。
 *
 *   仕組みの上では自動で入れ替わることになっていますが、
 *   他のアプリに切り替えて戻っただけでは動き直しません。
 *   端末に居座っている古い一式が、そのまま使われ続けます。
 *
 *   食品マスタの更新が届かない件では、これが原因で
 *   「直したものが端末に入っているのか」を確かめられず、
 *   動いているコードを何度も疑うことになりました。
 *
 * ★ ここで見張るのは、**どんな環境でも落ちないこと**です。
 *   version の表示と更新ボタンが、アプリを真っ白にしては本末転倒です。
 */

const unregister = vi.fn(async () => true);
const getRegistrations = vi.fn(async () => [{ unregister }]);
const cacheKeys = vi.fn(async () => ['assets-v1', 'assets-v2']);
const cacheDelete = vi.fn(async () => true);
const fetchMock = vi.fn(async () => new Response(''));
const reload = vi.fn();

function stubBrowser() {
  vi.stubGlobal('navigator', { serviceWorker: { getRegistrations } });
  vi.stubGlobal('caches', { keys: cacheKeys, delete: cacheDelete });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', {
    location: { href: 'https://example.test/pt-app/', reload },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  unregister.mockClear();
  getRegistrations.mockClear();
  cacheKeys.mockClear();
  cacheDelete.mockClear();
  fetchMock.mockClear();
  reload.mockClear();
});

describe('順番どおりに、全部やる', () => {
  it('居座っている一式を外し、保存を捨て、取り直して、開き直す', async () => {
    stubBrowser();
    await refreshToLatest();

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(cacheDelete).toHaveBeenCalledWith('assets-v1');
    expect(cacheDelete).toHaveBeenCalledWith('assets-v2');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('★ 入口のファイルは、保存を無視して取り直す', async () => {
    // ★ ここが無いと、開き直してもブラウザ自身の保存から
    //   古い入口が返ってきて、結局そのままになります。
    stubBrowser();
    await refreshToLatest();

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/pt-app/', { cache: 'reload' });
  });
});

describe('★ どんな環境でも落ちない', () => {
  it('Service Worker が無い環境でも、開き直すところまでは進む', async () => {
    stubBrowser();
    vi.stubGlobal('navigator', {});
    await refreshToLatest();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('保存の仕組みが無い環境でも進む', async () => {
    stubBrowser();
    vi.stubGlobal('caches', undefined);
    await refreshToLatest();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('★ 通信できなくても、開き直す', async () => {
    // ★ 圏外で押したときに、押しても何も起きないのが最悪です
    stubBrowser();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await refreshToLatest();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('一式を外すのに失敗しても、先へ進む', async () => {
    stubBrowser();
    getRegistrations.mockRejectedValueOnce(new Error('だめ'));
    await refreshToLatest();

    expect(cacheDelete).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
