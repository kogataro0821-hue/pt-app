import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';

/**
 * すべてのテストの前に1回だけ走る用意。
 *
 * ★ 1つのテストの後片付けを、次のテストに持ち越さないようにします。
 *   描いた画面が残っていると、getByText が前のテストの要素を拾い、
 *   「1つずつなら通るのに、まとめて走らせると落ちる」という
 *   いちばん時間を取られる壊れ方をします。
 */
expect.extend(matchers);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * jsdom に無いブラウザの機能を足す。
 *
 * ★ 足りないものは「動かない」ではなく「例外で落ちる」形で現れます。
 *   ここで先に埋めておかないと、テストしたい中身ではなく
 *   環境の穴でこけて、原因を探す時間だけがかかります。
 */
if (typeof window !== 'undefined') {
  // 画面の確認ダイアログ。既定では「はい」を押したことにします。
  // 押さない場合を試したいテストは、そのテストの中で上書きします。
  window.confirm = vi.fn(() => true);

  if (window.matchMedia === undefined) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  if (window.scrollTo === undefined) {
    window.scrollTo = (() => undefined) as unknown as typeof window.scrollTo;
  }
}
