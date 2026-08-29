import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_CONSENT_VERSION } from '@/features/clients/clientTypes';
import { aClient } from '@/test/factories';
import { firstCall } from '@/test/helpers';
import { AiConsentCard } from './AiConsentCard';
import type * as Firestore from 'firebase/firestore';

/**
 * AIの利用への同意（設計書 §35）。
 *
 * ★ 同意できるのは本人だけです。管理者が代わりに押すことはできません。
 *
 *   送られる内容には、その人が書いた食事の文章そのものが含まれます。
 *   それを外部のサービスへ渡してよいかは、書いた本人以外が決められることではありません。
 *   画面に管理者用のボタンを置かない、という形で守ります。
 */

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<typeof Firestore>('firebase/firestore');
  return { ...actual, doc: vi.fn(() => ({})), setDoc: vi.fn() };
});

const { setDoc } = await import('firebase/firestore');

beforeEach(() => {
  vi.mocked(setDoc).mockResolvedValue(undefined);
});

describe('管理者が見るとき', () => {
  it('同意しているかどうかは分かる', () => {
    render(
      <AiConsentCard
        client={aClient({ aiConsent: { granted: true, updatedAt: 1, version: AI_CONSENT_VERSION } })}
        isSelf={false}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText('この契約者はAIの利用に同意しています。')).toBeInTheDocument();
  });

  it('同意していなければ、AIの機能が出ないことを伝える', () => {
    render(<AiConsentCard client={aClient()} isSelf={false} onChanged={vi.fn()} />);
    expect(
      screen.getByText('この契約者はAIの利用に同意していません。AIの機能は表示されません。'),
    ).toBeInTheDocument();
  });

  it('代わりに同意するボタンが、ひとつも無い', () => {
    render(<AiConsentCard client={aClient()} isSelf={false} onChanged={vi.fn()} />);

    expect(screen.getByText('同意はご本人だけが行えます。')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('本人が見るとき', () => {
  it('同意する前に、必ず説明を読ませる', async () => {
    render(<AiConsentCard client={aClient()} isSelf onChanged={vi.fn()} />);

    // いきなり「同意します」は押せない
    expect(
      screen.queryByRole('button', { name: '読みました。AIの利用に同意します' }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'AIの利用について読む' }));
    expect(
      screen.getByRole('button', { name: '読みました。AIの利用に同意します' }),
    ).toBeInTheDocument();
  });

  it('説明には、何が送られて何が送られないかが書いてある', async () => {
    render(<AiConsentCard client={aClient()} isSelf onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'AIの利用について読む' }));

    expect(screen.getByText('送られないもの')).toBeInTheDocument();
    expect(screen.getByText(/お名前、契約者ID/)).toBeInTheDocument();
    expect(screen.getByText(/体重、体脂肪率、目標値/)).toBeInTheDocument();
  });

  it('無料で使っているため学習に使われうる、と正直に書く', async () => {
    // ★ 都合の悪いことを隠すと、あとで知ったときに信用が失われます
    render(<AiConsentCard client={aClient()} isSelf onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'AIの利用について読む' }));

    expect(screen.getByText(/AIの改善に使われる可能性があります/)).toBeInTheDocument();
  });

  it('使わなくても不利にならないことを書く', async () => {
    render(<AiConsentCard client={aClient()} isSelf onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'AIの利用について読む' }));

    expect(screen.getByText('不利になることはありません。')).toBeInTheDocument();
  });

  it('同意すると、いまの版で記録される', async () => {
    const onChanged = vi.fn();
    render(<AiConsentCard client={aClient()} isSelf onChanged={onChanged} />);

    await userEvent.click(screen.getByRole('button', { name: 'AIの利用について読む' }));
    await userEvent.click(
      screen.getByRole('button', { name: '読みました。AIの利用に同意します' }),
    );

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(firstCall(onChanged)[0]).toMatchObject({
      granted: true,
      version: AI_CONSENT_VERSION,
    });
  });

  it('あとからやめられる', async () => {
    const onChanged = vi.fn();
    render(
      <AiConsentCard
        client={aClient({ aiConsent: { granted: true, updatedAt: 1, version: AI_CONSENT_VERSION } })}
        isSelf
        onChanged={onChanged}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'AIの利用をやめる' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(firstCall(onChanged)[0].granted).toBe(false);
  });

  it('説明を書き換えたら、もう一度確認してもらう', async () => {
    // ★ 版が上がると、古い同意は無効になります。
    //   「読んでいない内容に同意したことになっている」状態を作らないためです。
    render(
      <AiConsentCard
        client={aClient({
          aiConsent: { granted: true, updatedAt: 1, version: AI_CONSENT_VERSION - 1 },
        })}
        isSelf
        onChanged={vi.fn()}
      />,
    );
    expect(
      screen.getByText('説明の内容が変わりました。お手数ですが、もう一度ご確認ください。'),
    ).toBeInTheDocument();
  });

  it('保存に失敗したら、同意したことにしない', async () => {
    const onChanged = vi.fn();
    vi.mocked(setDoc).mockRejectedValue(new Error('offline'));
    render(<AiConsentCard client={aClient()} isSelf onChanged={onChanged} />);

    await userEvent.click(screen.getByRole('button', { name: 'AIの利用について読む' }));
    await userEvent.click(
      screen.getByRole('button', { name: '読みました。AIの利用に同意します' }),
    );

    expect(await screen.findByText(/設定を変更できませんでした/)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
