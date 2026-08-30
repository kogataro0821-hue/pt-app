import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { findSimilarFoods, foodKey, type Per100g } from '@pt/core';
import { useAuth } from '@/features/auth/AuthProvider';
import { readErrorMessage, writeErrorMessage } from '@/lib/firestoreError';
import { addAlias, clearFoodCache, emptyFood, loadFoods, type Food } from './foodsRepo';
import { firstCandidate, listRequests, resolveRequest, type FoodRequest } from './requestsRepo';
import { replacePastRecords, type ReplaceResult } from './bulkReplace';
import { FoodEditor } from './FoodEditor';
import { FoodAiPanel } from './FoodAiPanel';

/**
 * 登録依頼の一覧（設計書 §21 / Phase 9）。
 *
 * 契約者がマスタに無い食材を記録すると、ここに積まれます。
 * 管理者のやることは2つのどちらかです。
 *
 *   1. 新しく登録する    …… 本当に新しい食材だったとき
 *   2. 既存にまとめる    …… 書き方が違うだけで、すでにある食材だったとき
 *
 * ★ 2 を用意しているのが今回の肝です。
 *   「鶏ムネ肉」と「鶏むね肉」を別々に登録してしまうと、
 *   同じ食材が2件になり、あとから統合するのは非常に面倒です。
 *   別名として吸収すれば、以後その書き方でも同じ食材に当たります。
 *
 * ★ 処理したあとに「過去の記録も置き換えますか」を出します。
 *   押さなければ過去はそのままです。勝手には書き換えません。
 */
export function RequestsScreen() {
  const { state } = useAuth();
  const adminUid = state.status === 'signedIn' ? state.user.uid : '';

  const [requests, setRequests] = useState<FoodRequest[] | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [reqs, all] = await Promise.all([listRequests(), loadFoods(true)]);
      setRequests(reqs);
      setFoods(all);
    } catch (e) {
      setError(readErrorMessage(e, '登録依頼'));
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="section-head">
        <h2 className="title">登録依頼</h2>
      </div>

      <p className="lede">
        契約者が記録した、まだマスタに無い食材です。数値を入れるまで、その食材は合計に含まれません。
      </p>

      <p className="calendar-links">
        <Link to="/foods">食品マスタへ</Link>
      </p>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {requests === null && <p className="lede">読み込んでいます…</p>}

      {requests !== null && requests.length === 0 && error === null && (
        <section className="card">
          <p className="lede">未処理の依頼はありません。</p>
        </section>
      )}

      {(requests ?? []).map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          foods={foods}
          adminUid={adminUid}
          open={openId === request.id}
          onToggle={() => setOpenId(openId === request.id ? null : request.id)}
          onDone={() => {
            setOpenId(null);
            clearFoodCache();
            void load();
          }}
        />
      ))}
    </>
  );
}

// -----------------------------------------------------------------------------

type Step =
  | { kind: 'idle' }
  | { kind: 'create' }
  | { kind: 'absorb' }
  /** 登録が済み、記録へ反映している最中 */
  | { kind: 'applying' }
  | { kind: 'done'; food: Food; how: 'created' | 'absorbed'; result: ReplaceResult };

function RequestCard({
  request,
  foods,
  adminUid,
  open,
  onToggle,
  onDone,
}: {
  request: FoodRequest;
  foods: Food[];
  adminUid: string;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 拡大表示している成分表示の写真 */
  const [zoom, setZoom] = useState<string | null>(null);
  /**
   * AI の下書きから持ってきた値（追加仕様: 登録依頼のAI）。
   *
   * ★ ここに入れるだけでは、まだ何も保存されていません。
   *   登録の画面の初期値になるだけで、確定するのは人が保存したときです。
   */
  const [aiSeed, setAiSeed] = useState<{
    per100g?: Per100g;
    note?: string;
    aliases: string[];
  }>({ aliases: [] });

  const candidates = findSimilarFoods(foods, request.name, 5);
  /** 契約者が成分表示を撮っていれば、その値を初期値に使う（追加仕様: 成分表示の読み取り） */
  const label = firstCandidate(request);

  async function absorbInto(food: Food) {
    setBusy(true);
    setError(null);
    try {
      // 依頼に出てきた書き方をすべて別名として足します。
      // 次から同じ書き方をしても、依頼は積まれません。
      let updated = food;
      for (const variant of request.variants) {
        updated = await addAlias(updated, variant);
      }
      await applyToRecords(updated, 'absorbed');
    } catch (e) {
      setError(writeErrorMessage(e, '別名'));
      setBusy(false);
    }
  }

  /**
   * 承認した値を、待っている記録に入れる（追加仕様: 成分表示の読み取り）。
   *
   * ★ 以前は「過去も置き換えますか？」と聞いていました。やめました。
   *
   *   置き換わるのは pending（栄養値が 0 のまま）の記録だけです。
   *   つまり、消えて困る数字が最初から存在しません。
   *   聞く意味があるのは「入っている数字を上書きするとき」だけで、
   *   ここはそれに当たりません。
   *
   *   むしろ聞くほうが害があります。押し忘れると、
   *   契約者の合計は 0 のまま残り、本人には理由が分かりません。
   */
  async function applyToRecords(food: Food, how: 'created' | 'absorbed') {
    setStep({ kind: 'applying' });
    setBusy(true);
    try {
      const result = await replacePastRecords(request, food, adminUid);

      // ★ 依頼もここで閉じます。
      //
      //   以前は「保存する」のあとに「完了」を押さないと依頼が残りました。
      //   登録し終えたのに一覧に残っているのは、やり残しがあるようにしか見えません。
      //   押し忘れれば、同じ食材の依頼をもう一度開くことになります。
      //   登録が済んだ時点で、その依頼の役目は終わりです。
      await resolveRequest(request);

      setStep({ kind: 'done', food, how, result });
    } catch (e) {
      setError(writeErrorMessage(e, '記録への反映'));
      setStep({ kind: 'done', food, how, result: { items: 0, meals: 0, days: 0 } });
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await resolveRequest(request);
      onDone();
    } catch (e) {
      setError(writeErrorMessage(e, '依頼の削除'));
      setBusy(false);
    }
  }

  return (
    <section className="card client-row-wrap">
      {zoom !== null && (
        <div className="photo-zoom" role="dialog" aria-modal="true" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" />
          <div className="photo-zoom-bar">
            <span>成分表示</span>
            <button className="button-quiet" type="button" onClick={() => setZoom(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      <div className="client-row">
        <div className="client-main">
          <span className="client-name">{request.name}</span>
          <span className="client-meta">
            {request.from.length}人が使用 · 記録{request.count}件
          </span>
          {request.variants.length > 1 && (
            <span className="client-meta">表記: {request.variants.join('、')}</span>
          )}
        </div>
        <button className="button-quiet" type="button" onClick={onToggle}>
          {open ? '閉じる' : '対応する'}
        </button>
      </div>

      {open && (
        <div className="stack">
          {error !== null && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {/* ★ 成分表示は、依頼を開いている間ずっと出します。
              以前は最初の画面にしか出していませんでした。
              「新しく登録する」を押した瞬間に消えるので、
              **数字を直しているあいだ、見比べる相手がいない**という
              いちばん必要な場面で消えていました。
              依頼を閉じれば写真も消えます。それまでは残します。 */}
          {label !== null && (
            <div className="notice">
              <p>
                {/* ★ どこから来た数字かを、必ず区別して出します。
                       写真つきなら表示と見比べられますが、手入力はそれができません。
                       同じ顔で並べると、確かめずに採用してしまいます。 */}
                <b>
                  {label.source === 'manual'
                    ? '契約者が手で入れた仮の値'
                    : '契約者が撮った成分表示'}
                </b>
                <br />
                {label.source === 'manual' ? '入れた値: ' : '読み取った値: '}
                {label.per100g.kcal}kcal · P{label.per100g.p} F{label.per100g.f} C
                {label.per100g.c}（100gあたり）
              </p>

              {label.source === 'manual' && (
                <p className="field-hint">
                  <b>裏付けはありません。</b>
                  契約者が分かる範囲で入れた数字です。この値はすでに
                  その契約者の合計に「仮」として入っているので、
                  <b>登録するとその日の数字が変わります。</b>
                </p>
              )}
              {label.note.length > 0 && <p className="field-hint">{label.note}</p>}

              {label.photo.length > 0 && (
                <>
                  <button
                    type="button"
                    className="label-photo"
                    onClick={() => setZoom(label.photo)}
                    aria-label="成分表示を拡大"
                  >
                    <img src={label.photo} alt="" loading="lazy" />
                  </button>
                  <p className="field-hint">
                    タップで拡大できます。数字が表示と合っているか、下の欄と見比べてください。
                  </p>
                </>
              )}
            </div>
          )}

          {step.kind === 'idle' && (
            <>
              {label !== null && (
                <p className="field-hint">
                  「新しく登録する」を押すと、この値が最初から入っています。
                  上の写真と見比べて、必要なら直してください。
                </p>
              )}

              {candidates.length > 0 && (
                <>
                  <p className="field-hint">
                    書き方が違うだけかもしれません。同じ食材ならこちらにまとめてください。
                  </p>
                  <ul className="suggestions">
                    {candidates.map((m) => (
                      <li key={m.food.id}>
                        <button
                          type="button"
                          className="suggestion"
                          disabled={busy}
                          onClick={() => void absorbInto(m.food)}
                        >
                          <span className="suggestion-name">{m.food.name} にまとめる</span>
                          <span className="suggestion-meta">
                            {m.food.per100g.kcal}kcal · P{m.food.per100g.p} F{m.food.per100g.f} C
                            {m.food.per100g.c}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/* ★ AI は下書きを作るだけです。マスタには書きません（設計書 §47）。
                     押したときだけ聞きます（開いただけでは聞きません）。 */}
              <FoodAiPanel
                name={request.name}
                foods={foods}
                busy={busy}
                onUsePer100g={(per100g, note) => {
                  setAiSeed((prev) => ({ ...prev, per100g, note }));
                  setStep({ kind: 'create' });
                }}
                onUseAliases={(aliases) => {
                  setAiSeed((prev) => ({ ...prev, aliases }));
                  setStep({ kind: 'create' });
                }}
                onAbsorbInto={(food) => void absorbInto(food)}
              />

              <div className="item-form-actions">
                <button
                  className="button-primary compact"
                  type="button"
                  disabled={busy}
                  onClick={() => setStep({ kind: 'create' })}
                >
                  新しく登録する
                </button>
                <button
                  className="button-quiet"
                  type="button"
                  disabled={busy}
                  onClick={() => void finish()}
                >
                  この依頼を消す
                </button>
              </div>
            </>
          )}

          {step.kind === 'create' && (
            <FoodEditor
              initial={{
                ...emptyFood(request.name),
                // 契約者が撮った成分表示の値を初期値に。決めるのは管理者のまま。
                ...(label === null ? {} : { per100g: label.per100g, note: label.note }),
                // ★ AI の下書きは、契約者が撮った成分表示より後に置きます。
                //   写真は実物の裏付けがあり、AIの推定は無いためです。
                //   ただし人が「この値を入れる」を押したときだけここに入ります。
                ...(aiSeed.per100g === undefined
                  ? {}
                  : { per100g: aiSeed.per100g, note: aiSeed.note ?? '' }),
                // ★ 照合キーが同じ表記は、別名に入れません。
                //   「サラダチキン」と全角スペース入りは、別名が無くても
                //   すでに同じものとして当たります。入れても増えるものがなく、
                //   一覧が読みにくくなるだけです。
                //   キーが違う表記（あれば）だけを別名の候補にします。
                aliases: [
                  ...request.variants.filter((v) => foodKey(v) !== foodKey(request.name)),
                  ...aiSeed.aliases,
                ],
              }}
              all={foods}
              nameOptions={request.variants}
              onSaved={(food) => void applyToRecords(food, 'created')}
              onCancel={() => setStep({ kind: 'idle' })}
            />
          )}

          {step.kind === 'applying' && (
            <p className="lede">記録に反映しています…</p>
          )}

          {step.kind === 'done' && (
            <div className="notice">
              <p>
                <b>
                  {step.how === 'created'
                    ? `「${step.food.name}」を登録しました。`
                    : `「${step.food.name}」にまとめました。`}
                </b>
                {step.how === 'absorbed' && (
                  <>
                    <br />
                    以後は「{request.name}」と入力しても、この食材に当たります。
                  </>
                )}
              </p>

              {step.result.items > 0 ? (
                <p>
                  待っていた記録<b>{step.result.items}件</b>に、この値を入れました（
                  {step.result.days}日分）。契約者の合計に反映されています。
                  <br />
                  変更履歴に残しました。
                  <br />
                  この依頼は処理済みとして閉じました。
                </p>
              ) : (
                <p>
                  この値を待っている記録はありませんでした。
                  <br />
                  これから同じ食材を入れると、最初からこの値が使われます。
                  <br />
                  この依頼は処理済みとして閉じました。
                </p>
              )}

              <div className="item-form-actions">
                <button
                  className="button-primary compact"
                  type="button"
                  disabled={busy}
                  onClick={onDone}
                >
                  閉じる
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
