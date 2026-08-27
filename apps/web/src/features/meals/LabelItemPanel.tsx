import { useState } from 'react';
import { ZERO, type MealItem } from '@pt/core';
import { LabelScanner } from '@/features/foods/LabelScanner';
import type { LabelCandidate } from '@/features/foods/requestsRepo';
import { newItemId } from './mealsRepo';

/**
 * 成分表示から食材を1つ起こす（設計書 §47 / Phase 13）。
 *
 * 「文章から」「写真から」と並ぶ、3つ目の入口です。
 *
 * ★ なぜ入口を分けたのか
 *
 *   はじめは「＋食材」で名前を打ったあとに撮る形にしていました。
 *   でも既製品を食べたとき、利用者が最初に手にしているのはパッケージです。
 *   名前を打たせてから撮らせるのは、順番が逆でした。
 *
 *   撮れば、商品名も1食分のグラム数も表示に書いてあります。
 *   打つ前に読める情報を、打たせる理由がありません。
 *
 * ★ 数値はここでは記録に入りません。
 *
 *   読み取った100gあたりの値は「登録依頼」として管理者へ送られます。
 *   その食材は「登録待ち」として残り、合計には入りません。
 *   管理者が承認した時点で、食べたグラム数に換算されて記録に入ります。
 *
 *   袋に書いてある数字なら信用してよさそうに見えますが、
 *   桁の読み違いも、参考値の取り違えも起こります。
 *   全員のマスタに入る数値を決めるのは管理者、という線は動かしません。
 */
export function LabelItemPanel({
  onAdd,
  onClose,
}: {
  onAdd: (item: MealItem, requestName: string, candidate: LabelCandidate) => void;
  onClose: () => void;
}) {
  const [read, setRead] = useState<{
    candidate: LabelCandidate;
    productName: string;
    servingGrams: number | null;
  } | null>(null);
  const [name, setName] = useState('');
  const [grams, setGrams] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (read === null) {
    return (
      <div className="ai-panel">
        <div className="ai-head">
          <h4 className="ai-title">成分表示から入力</h4>
          <button className="button-quiet" type="button" onClick={onClose}>
            閉じる
          </button>
        </div>

        <LabelScanner
          onCancel={onClose}
          onDone={(r) => {
            setRead({
              candidate: { per100g: r.per100g, note: r.note, photo: r.photo },
              productName: r.productName,
              servingGrams: r.servingGrams,
            });
            setName(r.productName);
            // ★ 1回分のグラム数が書いてあれば入れます。
            //   書いていない（100g当たり表示の）商品では空のままにします。
            //   100gを勝手に入れると、直し忘れがそのまま記録に残ります。
            setGrams(r.servingGrams === null ? '' : String(r.servingGrams));
          }}
        />
      </div>
    );
  }

  const gramsNum = Number(grams);
  const nameOk = name.trim().length > 0;
  const gramsOk = grams.trim().length > 0 && Number.isFinite(gramsNum) && gramsNum > 0 && gramsNum <= 5000;

  function submit() {
    if (!nameOk) {
      setError('食材の名前を入力してください。');
      return;
    }
    if (!gramsOk) {
      setError('食べた量を入力してください（0より大きく5000g以内）。');
      return;
    }
    if (read === null) return;

    const trimmed = name.trim();
    onAdd(
      {
        id: newItemId(),
        name: trimmed,
        grams: gramsNum,
        // 栄養値は入れません。管理者が承認した時点で入ります。
        per100g: ZERO,
        nutrients: ZERO,
        foodId: null,
        pending: true,
      },
      trimmed,
      read.candidate,
    );
  }

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <h4 className="ai-title">成分表示から入力</h4>
        <button className="button-quiet" type="button" onClick={onClose}>
          閉じる
        </button>
      </div>

      <div className="ai-draft">
        <label className="field">
          <span className="field-label">食材の名前</span>
          <input
            className="input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="カップヌードル"
          />
          <span className="field-hint">パッケージから読み取った名前です。直せます。</span>
        </label>

        <label className="field">
          <span className="field-label">食べた量（g）</span>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            placeholder={read.servingGrams === null ? '食べた量' : String(read.servingGrams)}
            autoFocus={read.servingGrams === null}
          />
          <span className="field-hint">
            {read.servingGrams === null
              ? '100g当たりの表示だったため、量は書かれていませんでした。食べた量を入れてください。'
              : `表示の「1回分 ${read.servingGrams}g」を入れてあります。半分だけ食べたなら直してください。`}
          </span>
        </label>

        <p className="notice">
          <b>読み取った値: </b>
          {read.candidate.per100g.kcal}kcal · P{read.candidate.per100g.p} F
          {read.candidate.per100g.f} C{read.candidate.per100g.c}（100gあたり）
          <br />
          この値はトレーナーへ送られます。<b>承認されると、この記録に反映されます。</b>
          <br />
          それまでは「登録待ち」として残り、合計には入りません。
        </p>

        {error !== null && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="item-form-actions">
          <button
            className="button-primary compact"
            type="button"
            onClick={submit}
            disabled={!nameOk || !gramsOk}
          >
            この食材を追加する
          </button>
          <button className="button-quiet" type="button" onClick={onClose}>
            やめる
          </button>
        </div>
      </div>
    </div>
  );
}
