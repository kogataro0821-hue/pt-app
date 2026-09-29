import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScanScreen } from './ScanScreen';

/**
 * アプリの中でQRを読む画面（追加仕様: 交換QR）。
 *
 * ★ ここは一度、人を閉じ込めました。
 *
 *   カメラの許可を断った人が、そのあと何もできなくなりました。
 *   「やめる」が「ひとつ前に戻る」だったので、戻り先が無いと
 *   押しても何も起きません。案内も「設定で許可してください」だけで、
 *   **いま使う方法**も**元に戻す方法**も書いていませんでした。
 *
 * ★ だから、この3つを固定します。
 *
 *   1. カメラを開く**前に**断ってよいか聞く（断らせないのが一番効く）
 *   2. どの状態でも、必ず出口がある
 *   3. 断られたら、**今日の逃げ道**を最初に書く
 */

vi.mock('jsqr', () => ({ default: () => null }));

const getUserMedia = vi.fn();

function stubCamera(impl: () => Promise<MediaStream>) {
  getUserMedia.mockImplementation(impl);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
}

/** 中身は使いません。止められることだけ確かめられれば充分です */
function fakeStream(): MediaStream {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track] } as unknown as MediaStream;
}

function denied(): Promise<MediaStream> {
  return Promise.reject(new DOMException('no', 'NotAllowedError'));
}

beforeEach(() => {
  window.localStorage.clear();
  getUserMedia.mockReset();
  // ★ https でないとカメラは開けません。jsdom は http 扱いなので、そう見せます
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  stubCamera(() => Promise.resolve(fakeStream()));
  // jsdom には無いので、置いておきます
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
});

afterEach(() => {
  window.localStorage.clear();
});

function show() {
  const onFound = vi.fn();
  const onCancel = vi.fn();
  render(<ScanScreen onFound={onFound} onCancel={onCancel} />);
  return { onFound, onCancel };
}

describe('★ カメラを開く前', () => {
  it('いきなりカメラを触らない', () => {
    // ★ 触った時点で許可を聞かれます。聞かれる前に説明したいので、待ちます
    show();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('★ 断ると面倒になることを、先に伝える', () => {
    // ★ 断ったあとに直し方を書くより、断らせないほうが早いです
    show();
    expect(screen.getByText(/「許可」を押してください/)).toBeInTheDocument();
    expect(screen.getByText(/あとから戻すのがとても面倒/)).toBeInTheDocument();
  });

  it('押したらカメラを開く', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'カメラを使う' }));

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalled();
    });
  });

  it('★ この画面からも出られる', async () => {
    // ★ 説明だけ出して閉じられない画面は、それ自体が行き止まりです
    const { onCancel } = show();
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }));

    expect(onCancel).toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('★ 一度使えたら、次からは挟まない', async () => {
    // ★ レジの前で毎回1タップ増えるのは、それはそれで邪魔です
    const first = show();
    await userEvent.click(screen.getByRole('button', { name: 'カメラを使う' }));
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalled();
    });
    expect(first.onCancel).not.toHaveBeenCalled();

    getUserMedia.mockClear();
    show();
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalled();
    });
  });

  it('断られた端末では、覚えない', async () => {
    stubCamera(denied);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'カメラを使う' }));
    await screen.findByText(/カメラを使う許可がありません/);

    getUserMedia.mockClear();
    show();
    // もう一度開いても、説明から始まります
    expect(screen.getByRole('button', { name: 'カメラを使う' })).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe('★ 断られたとき', () => {
  async function refuse() {
    stubCamera(denied);
    const r = show();
    await userEvent.click(screen.getByRole('button', { name: 'カメラを使う' }));
    await screen.findByText(/カメラを使う許可がありません/);
    return r;
  }

  it('★ まず、いま使う方法を書く', async () => {
    // ★ ここに「設定で許可してください」しか書いていませんでした。
    //   いちばん知りたいことが書いていない画面です
    await refuse();
    expect(screen.getByText(/標準のカメラアプリでQRに向けて/)).toBeInTheDocument();
  });

  it('元に戻す方法も書く（アイコンの作り直し）', async () => {
    // ★ ホーム画面に追加したアプリは、設定の一覧に出てこないことがあります。
    //   スイッチで戻せないので、ここを書かないと詰みます
    await refuse();
    expect(screen.getByText(/ホーム画面のアイコンを作り直します/)).toBeInTheDocument();
  });

  it('★ ログインし直しになることを、先に言う', async () => {
    // ★ 消してからパスワードが分からないと、入れなくなります
    await refuse();
    expect(screen.getByText(/ログインし直しになります/)).toBeInTheDocument();
  });

  it('★ ここからも出られる', async () => {
    // ★ これが無くて、アプリを閉じるしかない状態になっていました
    const { onCancel } = await refuse();
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }));

    expect(onCancel).toHaveBeenCalled();
  });
});
