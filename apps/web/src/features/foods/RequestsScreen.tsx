import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { findSimilarFoods, foodKey } from '@pt/core';
import { useAuth } from '@/features/auth/AuthProvider';
import { readErrorMessage, writeErrorMessage } from '@/lib/firestoreError';
import { addAlias, clearFoodCache, emptyFood, loadFoods, type Food } from './foodsRepo';
import { firstCandidate, listRequests, resolveRequest, type FoodRequest } from './requestsRepo';
import { replacePastRecords, replaceTargets, type ReplaceResult } from './bulkReplace';
import { FoodEditor } from './FoodEditor';

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
  /** 登録が済み、過去の置き換えを聞いている段階 */
  | { kind: 'ask'; food: Food; how: 'created' | 'absorbed' }
  | { kind: 'replaced'; result: ReplaceResult };

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

  const candidates = findSimilarFoods(foods, request.name, 5);
  const targets = replaceTargets(request);
  /** 契約者が成分表示を撮っていれば、その値を初期値に使う（Phase 12） */
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
      setStep({ kind: 'ask', food: updated, how: 'absorbed' });
    } catch (e) {
      setError(writeErrorMessage(e, '別名'));
    } finally {
      setBusy(false);
    }
  }

  async function replace(food: Food) {
    setBusy(true);
    setError(null);
    try {
      const result = await replacePastRecords(request, food, adminUid);
      setStep({ kind: 'replaced', result });
    } catch (e) {
      setError(writeErrorMessage(e, '置き換えた記録'));
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

          {step.kind === 'idle' && (
            <>
              {label !== null && (
                <div className="notice">
                  <p>
                    <b>契約者が成分表示を撮っています。</b>
                    <br />
                    {label.per100g.kcal}kcal · P{label.per100g.p} F{label.per100g.f} C
                    {label.per100g.c}（100gあたり）
                  </p>
                  {label.note.length > 0 && <p className="field-hint">{label.note}</p>}

                  {/* ★ 写真そのものを見せます。
                      数字だけでは、参考値のほうを拾っていても気づけません。
                      判断できるのは表示を見たときだけで、
                      そのころ契約者はパッケージを捨てています。 */}
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
                        タップで拡大できます。数字が表示と合っているか確かめてください。
                      </p>
                    </>
                  )}

                  <p className="field-hint">
                    「新しく登録する」を押すと、この値が最初から入っています。
                    確認して、必要なら直してください。
                  </p>
                </div>
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
                // ★ 照合キーが同じ表記は、別名に入れません。
                //   「サラダチキン」と全角スペース入りは、別名が無くても
                //   すでに同じものとして当たります。入れても増えるものがなく、
                //   一覧が読みにくくなるだけです。
                //   キーが違う表記（あれば）だけを別名の候補にします。
                aliases: request.variants.filter(
                  (v) => foodKey(v) !== foodKey(request.name),
                ),
              }}
              all={foods}
              nameOptions={request.variants}
              onSaved={(food) => setStep({ kind: 'ask', food, how: 'created' })}
              onCancel={() => setStep({ kind: 'idle' })}
            />
          )}

          {step.kind === 'ask' && (
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
              {targets.length === 0 ? (
                <p>置き換える過去の記録はありません。</p>
              ) : (
                <p>
                  この食材を使っている記録が<b>{request.count}件</b>あります（
                  {targets.length}日分）。新しい値を入れますか？
                  <br />
                  押さなければ過去はそのままです。押した場合は変更履歴に残ります。
                </p>
              )}
              <div className="item-form-actions">
                {targets.length > 0 && (
                  <button
                    className="button-primary compact"
                    type="button"
                    disabled={busy}
                    onClick={() => void replace(step.food)}
                  >
                    {busy ? '置き換えています…' : '過去も置き換える'}
                  </button>
                )}
                <button
                  className="button-quiet"
                  type="button"
                  disabled={busy}
                  onClick={() => void finish()}
                >
                  {targets.length > 0 ? '置き換えない' : '閉じる'}
                </button>
              </div>
            </div>
          )}

          {step.kind === 'replaced' && (
            <div className="notice">
              {step.result.items === 0 ? (
                // 依頼には残っていても、その後に本人が直していれば置き換える対象はありません。
                // 「0件を置き換えました」だと何が起きたのか分からないので、そう書きます。
                <p>
                  置き換える記録はありませんでした。
                  <br />
                  すでに本人が直したか、記録が消されたものと思われます。
                </p>
              ) : (
                <p>
                  <b>{step.result.items}件</b>の食材を置き換えました（{step.result.days}日分）。
                  <br />
                  変更履歴に残しました。
                </p>
              )}
              <div className="item-form-actions">
                <button
                  className="button-primary compact"
                  type="button"
                  disabled={busy}
                  onClick={() => void finish()}
                >
                  完了
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
