import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SubmitCard, SubmitNotice } from './SubmitCard';

/**
 * 提出扱い（追加仕様: 提出扱い）。
 *
 * ★ やむを得ない事情で、いつもの記録ができない日があります。
 *   相談のうえ写真だけ出してもらった、というような日です。
 *   そのままだと連続記録が途切れますが、**本人は約束を守っています**。
 *   続けるための仕掛けが、続けている人を罰する形になってはいけません。
 */

function show(over: Partial<Parameters<typeof SubmitCard>[0]> = {}) {
  const onMark = vi.fn();
  const onUnmark = vi.fn();
  render(
    <SubmitCard
      kind="meals"
      mark={null}
      busy={false}
      onMark={onMark}
      onUnmark={onUnmark}
      {...over}
    />,
  );
  return { onMark, onUnmark };
}

describe('提出扱いにする', () => {
  it('いきなり理由の欄は出ていない', async () => {
    // ★ ふだんは使わない操作なので、畳んでおきます
    show();
    expect(screen.queryByLabelText('理由')).not.toBeInTheDocument();
  });

  it('押すと理由を書ける', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: '提出扱いにする' }));

    expect(screen.getByLabelText('理由')).toBeInTheDocument();
  });

  it('理由を書いて押すと、そのまま渡る', async () => {
    const { onMark } = show();
    await userEvent.click(screen.getByRole('button', { name: '提出扱いにする' }));
    await userEvent.type(screen.getByLabelText('理由'), '写真のみ提出');
    await userEvent.click(screen.getByRole('button', { name: '提出扱いにする' }));

    expect(onMark).toHaveBeenCalledWith('写真のみ提出');
  });

  it('やめれば、何も起きない', async () => {
    const { onMark } = show();
    await userEvent.click(screen.getByRole('button', { name: '提出扱いにする' }));
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }));

    expect(onMark).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('理由')).not.toBeInTheDocument();
  });

  it('★ 食事と運動で、言い方が変わる', () => {
    // ★ まとめて立てると、運動していない日まで「運動した」ことになります
    show({ kind: 'exercise' });
    expect(screen.getByText('運動を提出扱いにする')).toBeInTheDocument();
  });
});

describe('提出扱いを取り消す', () => {
  const mark = { at: 1_700_000_000_000, by: 'admin1', reason: '写真のみ提出', prev: false };

  it('印が付いていると、理由も出る', () => {
    // ★ 月が変わってから見返したときに、何があったか分かるように
    show({ mark });
    expect(screen.getByText('食事は提出扱いです')).toBeInTheDocument();
    expect(screen.getByText(/写真のみ提出/)).toBeInTheDocument();
  });

  it('★ 取り消せる', () => {
    // ★ 押し間違いを直せない操作にはしません
    const { onUnmark } = show({ mark });
    expect(screen.getByRole('button', { name: '提出扱いをやめる' })).toBeInTheDocument();
    expect(onUnmark).not.toHaveBeenCalled();
  });

  it('印が付いているときは、足すボタンを出さない', () => {
    show({ mark });
    expect(screen.queryByRole('button', { name: '提出扱いにする' })).not.toBeInTheDocument();
  });

  it('理由が空でも、画面は壊れない', () => {
    show({ mark: { ...mark, reason: '' } });
    expect(screen.getByText('食事は提出扱いです')).toBeInTheDocument();
    expect(screen.queryByText(/理由:/)).not.toBeInTheDocument();
  });
});

/**
 * 契約者に見せる1行。
 *
 * ★ 隠しません。連続が続いている理由が本人に分からないままだと、
 *   「数えられていないのでは」と不安になります。
 *
 * ★ 理由は出しません。あれはトレーナーの覚え書きで、
 *   本人が読んで気持ちのいい書き方とは限りません。
 */
describe('★ 契約者に見せる1行', () => {
  it('印が無ければ、何も出さない', () => {
    const { container } = render(<SubmitNotice meals={false} exercise={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('食事だけなら、食事とだけ書く', () => {
    render(<SubmitNotice meals exercise={false} />);
    expect(screen.getByText(/この日の食事は/)).toBeInTheDocument();
  });

  it('両方なら、両方書く', () => {
    render(<SubmitNotice meals exercise />);
    expect(screen.getByText(/この日の食事と運動は/)).toBeInTheDocument();
  });

  it('★ つながっている、と伝える', () => {
    // ★ 本人がいちばん気にしているのはそこです
    render(<SubmitNotice meals exercise={false} />);
    expect(screen.getByText(/連続記録はつながっています/)).toBeInTheDocument();
  });
});
