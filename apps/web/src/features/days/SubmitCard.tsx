import { useState } from 'react';
import { MAX_SUBMIT_REASON, type SubmitMark } from './dayTypes';

/**
 * 提出扱いにする（追加仕様: 提出扱い）。管理者だけが見ます。
 *
 * ★ 何のためにあるか。
 *
 *   やむを得ない事情で、いつもの記録ができない日があります。
 *   相談のうえ写真だけ出してもらった、というような日です。
 *   そのままだと連続記録が途切れますが、**本人は約束を守っています**。
 *   続けるための仕掛けが、続けている人を罰する形になってはいけません。
 *
 * ★ 食事と運動を分けています。
 *
 *   連続記録は食事と運動で別に数えています。まとめて立てると、
 *   運動していない日まで「運動した」ことになります。
 *   足りないほうだけ立てられるようにします。
 *
 * ★ 理由を書いてもらいます。
 *
 *   月が変わってから見返したときに、何があったのか分からないと、
 *   この印はただの「数字合わせ」になります。
 *   一言あれば、あとから本人とも話せます。
 */
export function SubmitCard({
  kind,
  mark,
  busy,
  onMark,
  onUnmark,
}: {
  kind: 'meals' | 'exercise';
  mark: SubmitMark | null;
  busy: boolean;
  onMark: (reason: string) => void;
  onUnmark: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const what = kind === 'meals' ? '食事' : '運動';

  if (mark !== null) {
    return (
      <section className="card">
        <h3 className="card-title">{what}は提出扱いです</h3>
        <p className="note">
          トレーナーが提出扱いにしました。連続記録はつながっています。
          {mark.reason.length > 0 && (
            <>
              <br />
              理由: {mark.reason}
            </>
          )}
        </p>
        {/* ★ 取り消すと、印を付ける**前**の状態に戻ります。
               本人が記録した日に押してしまっても、その記録は消えません。 */}
        <div className="form-actions">
          <button
            className="button-quiet"
            type="button"
            onClick={onUnmark}
            disabled={busy}
          >
            提出扱いをやめる
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <h3 className="card-title">{what}を提出扱いにする</h3>

      {!open ? (
        <>
          <p className="note">
            事情があって{what}を記録できなかった日を、提出扱いにできます。
            連続記録が途切れません。
          </p>
          <div className="form-actions">
            <button
              className="button-secondary"
              type="button"
              onClick={() => setOpen(true)}
              disabled={busy}
            >
              提出扱いにする
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="field">
            <span className="field-label">理由</span>
            <input
              className="input"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="写真のみ提出。相談のうえ提出扱い"
              maxLength={MAX_SUBMIT_REASON}
              aria-label="理由"
              autoFocus
            />
            {/* ★ あとから見返す人のために書いてもらいます。
                   空でも押せますが、空のままだと数字合わせに見えます。 */}
            <span className="field-hint">
              月が変わってから見返したときに、何があったか分かるように。
              {MAX_SUBMIT_REASON}文字まで
            </span>
          </label>

          <div className="form-actions">
            <button
              className="button-primary"
              type="button"
              onClick={() => {
                onMark(reason);
                setOpen(false);
                setReason('');
              }}
              disabled={busy}
            >
              提出扱いにする
            </button>
            <button
              className="button-quiet"
              type="button"
              onClick={() => {
                setOpen(false);
                setReason('');
              }}
            >
              やめる
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * 契約者にも見せる1行（追加仕様: 提出扱い）。
 *
 * ★ 隠しません。
 *
 *   連続が続いている理由が本人に分からないままだと、
 *   「数えられていないのでは」と不安になります。
 *   トレーナーが認めた、と見えるほうが安心できます。
 *
 * ★ 理由は出しません。
 *   理由はトレーナーの覚え書きです。本人が読んで気持ちのいい
 *   書き方とは限りません。
 */
export function SubmitNotice({ meals, exercise }: { meals: boolean; exercise: boolean }) {
  if (!meals && !exercise) return null;

  const what = meals && exercise ? '食事と運動' : meals ? '食事' : '運動';

  return (
    <p className="note" role="status">
      この日の{what}は、トレーナーが<b>提出扱い</b>にしています。連続記録はつながっています。
    </p>
  );
}
