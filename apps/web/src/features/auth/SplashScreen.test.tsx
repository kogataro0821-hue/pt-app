import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUOTES, quoteToText } from '@pt/core';
import { SplashScreen } from './SplashScreen';

/**
 * ログイン前に出る1枚（追加仕様: 導入の演出）。
 *
 * ★ 守りたいのは3つです。
 *
 *   1. **出来上がるのを待たせないこと**（途中で触っても進む）
 *   2. 進み方が分からない人を閉じ込めないこと
 *   3. 2回進んでも、1回しか伝わらないこと
 */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('出るもの', () => {
  it('その日の言葉が出る', () => {
    render(<SplashScreen onDone={() => {}} />);
    const box = screen.getByRole('button');
    const shown = QUOTES.some((q) => q.every((line) => box.textContent?.includes(line)));
    expect(shown).toBe(true);
  });

  it('★ 3行が、そのままの切れ目で出る', () => {
    // ★ 画面に折り返させると、決めた切れ目が崩れます。
    //   どこで切るかは言葉の側で決めてあります
    render(<SplashScreen onDone={() => {}} />);
    const lines = document.querySelectorAll('.splash-line');
    expect(lines).toHaveLength(3);
  });

  it('★ 読み上げには、3行がつながって伝わる', () => {
    render(<SplashScreen onDone={() => {}} />);
    const label = screen.getByRole('button').getAttribute('aria-label') ?? '';
    const shown = QUOTES.some((q) => label.includes(quoteToText(q)));
    expect(shown).toBe(true);
  });

  it('アプリ名も出る', () => {
    render(<SplashScreen onDone={() => {}} />);
    expect(screen.getByText('たろZAP')).toBeInTheDocument();
  });

  it('★ 読み上げにも、言葉と進み方が伝わる', () => {
    render(<SplashScreen onDone={() => {}} />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('次へ進む');
  });
});

describe('★ 進む', () => {
  it('★ 出来上がるのを待たずに、触れば進む', async () => {
    // ★ 「見終わるまで進めない」は、急いでログインしたい人の邪魔しかしません
    const onDone = vi.fn();
    render(<SplashScreen onDone={onDone} />);

    await userEvent.click(screen.getByRole('button'));
    expect(onDone).toHaveBeenCalled();
  });

  it('キーボードでも進む', async () => {
    const onDone = vi.fn();
    render(<SplashScreen onDone={onDone} />);

    await userEvent.keyboard('{Enter}');
    expect(onDone).toHaveBeenCalled();
  });

  it('★ 放っておいても進む（行き止まりにしない）', async () => {
    // ★ 触り方が1つしかない全画面は、それが効かない人には行き止まりです
    const onDone = vi.fn();
    render(<SplashScreen onDone={onDone} />);
    expect(onDone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(11500);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('★ 連打しても、進むのは1回だけ', async () => {
    const onDone = vi.fn();
    render(<SplashScreen onDone={onDone} />);
    const box = screen.getByRole('button');

    await userEvent.click(box);
    await userEvent.click(box);
    await userEvent.click(box);

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('★ 触って進んだあと、時間切れで2回目が来ない', async () => {
    const onDone = vi.fn();
    render(<SplashScreen onDone={onDone} />);
    await userEvent.click(screen.getByRole('button'));

    vi.advanceTimersByTime(14000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('★ 進み方の案内', () => {
  it('★ 最初から見えている', () => {
    // ★ 出そろうまで隠す形も試しましたが、急いでいる人には
    //   「まだ押せない」ように見えるほうが不親切でした。
    //   ゆっくり読ませる演出なので、逃げ道は最初から見えているべきです
    render(<SplashScreen onDone={() => {}} />);
    expect(screen.getByText('次へ進む')).toBeInTheDocument();
  });

  it('アプリの顔も、最初から見えている', () => {
    // ★ 言葉と一緒に出すと、何のアプリを開いたのか分からない間ができます
    render(<SplashScreen onDone={() => {}} />);
    expect(screen.getByText('たろZAP')).toBeInTheDocument();
  });
});

describe('★ 動きを減らす設定のとき', () => {
  it('最初から出そろっている', () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) =>
      ({
        matches: q.includes('prefers-reduced-motion'),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    try {
      render(<SplashScreen onDone={() => {}} />);
      expect(screen.getByRole('button').className).toContain('calm');
      expect(screen.getByText('次へ進む')).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
