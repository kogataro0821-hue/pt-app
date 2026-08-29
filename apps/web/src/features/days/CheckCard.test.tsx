import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CheckCard } from './CheckCard';

/**
 * トレーナーの「確認しました」（追加仕様: 写真の保存期間）。
 *
 * ★ 押すと、その日の写真が消えます。元に戻せません。
 *   だから「押す前に、何が消えるかを必ず見せる」ことを、ここで固定します。
 *   黙って消えると、契約者から見れば写真が勝手に消えたことになります。
 */

function setup(over: Partial<Parameters<typeof CheckCard>[0]> = {}) {
  const onCheck = vi.fn();
  const onUncheck = vi.fn();
  render(
    <CheckCard
      checkedAt={null}
      photoCount={0}
      busy={false}
      onCheck={onCheck}
      onUncheck={onUncheck}
      {...over}
    />,
  );
  return { onCheck, onUncheck };
}

describe('まだ確認していないとき', () => {
  it('写真があれば、何枚消えるかを先に伝える', async () => {
    setup({ photoCount: 3 });
    expect(screen.getByText(/この日の写真3枚は、そのとき削除されます/)).toBeInTheDocument();
  });

  it('押さなかった写真も49日で消えることを伝える', () => {
    setup({ photoCount: 3 });
    expect(screen.getByText(/49日で自動的に消えます/)).toBeInTheDocument();
  });

  it('1回押しただけでは消えない。確認の画面をはさむ', async () => {
    const { onCheck } = setup({ photoCount: 3 });
    await userEvent.click(screen.getByRole('button', { name: '確認しました' }));

    expect(screen.getByText('確認しますか？')).toBeInTheDocument();
    expect(onCheck).not.toHaveBeenCalled();
  });
});

describe('確認の画面', () => {
  it('枚数と「元には戻せません」を出す', async () => {
    setup({ photoCount: 3 });
    await userEvent.click(screen.getByRole('button', { name: '確認しました' }));

    expect(screen.getByText(/3枚/)).toBeInTheDocument();
    expect(screen.getByText('元には戻せません。')).toBeInTheDocument();
  });

  it('記録の数字は消えないことも、同じ場所で伝える', async () => {
    setup({ photoCount: 3 });
    await userEvent.click(screen.getByRole('button', { name: '確認しました' }));
    expect(screen.getByText(/食材・量・kcal・PFCの記録は消えません/)).toBeInTheDocument();
  });

  it('2回目を押して、はじめて実行される', async () => {
    const { onCheck } = setup({ photoCount: 3 });
    await userEvent.click(screen.getByRole('button', { name: '確認しました' }));
    await userEvent.click(screen.getByRole('button', { name: '確認して写真を削除する' }));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('やめれば、何も起きずに元の画面に戻る', async () => {
    const { onCheck } = setup({ photoCount: 3 });
    await userEvent.click(screen.getByRole('button', { name: '確認しました' }));
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }));

    expect(onCheck).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '確認しました' })).toBeInTheDocument();
  });

  it('写真が無い日は、削除の話をしない', async () => {
    setup({ photoCount: 0 });
    await userEvent.click(screen.getByRole('button', { name: '確認しました' }));

    expect(screen.getByText('この日に写真はありません。確認済みとして記録します。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '確認済みにする' })).toBeInTheDocument();
    expect(screen.queryByText('元には戻せません。')).not.toBeInTheDocument();
  });

  it('処理中は、そもそも押せない（二重に消さない）', async () => {
    const { onCheck } = setup({ photoCount: 3, busy: true });
    const button = screen.getByRole('button', { name: '確認しました' });

    expect(button).toBeDisabled();
    await userEvent.click(button);

    // 確認の画面にも進まない
    expect(screen.queryByText('確認しますか？')).not.toBeInTheDocument();
    expect(onCheck).not.toHaveBeenCalled();
  });
});

describe('確認したあと', () => {
  it('いつ確認したかを出す', () => {
    setup({ checkedAt: new Date('2026-08-29T10:05:00').getTime() });
    expect(screen.getByText(/8月29日 10:05に確認しました/)).toBeInTheDocument();
  });

  it('写真が消えたことを伝える', () => {
    setup({ checkedAt: 1, photoCount: 0 });
    expect(screen.getByText(/この日の写真は削除済みです/)).toBeInTheDocument();
  });

  it('押し間違えても取り消せる', async () => {
    // ★ 取り消せないと、「写真は消えたのに確認済みだけ残る」という
    //   いちばん困る状態から抜けられません
    const { onUncheck } = setup({ checkedAt: 1, photoCount: 0 });
    await userEvent.click(screen.getByRole('button', { name: '確認を取り消す' }));
    expect(onUncheck).toHaveBeenCalledTimes(1);
  });
});
