import { useCallback, useEffect, useState } from 'react';
import { COUNTABLE_UNITS, isCountableUnit, MAX_CUSTOM_UNITS, MAX_UNIT_LABEL } from '@pt/core';
import { readErrorMessage, writeErrorMessage } from '@/lib/firestoreError';
import { loadCustomUnits, saveCustomUnits } from './unitsRepo';

/**
 * 単位を増やす（追加仕様: 単位を増やす）。管理者だけが開けます。
 *
 * ★ 最初からある6つは消せません。
 *
 *   すでにその単位で登録された食材や、記録された食事があります。
 *   消せるようにすると、**過去の記録の単位だけが消えます**。
 *   「2個」が「2」になる、という壊れ方です。
 *
 * ★ 足した単位も、すぐには消せるようにしていません。
 *   同じ理由です。使われているかどうかを調べずに消すのは危険なので、
 *   いまは足すだけにしてあります。要るようなら言ってください。
 */
export function UnitsCard() {
  const [units, setUnits] = useState<string[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUnits(await loadCustomUnits(true));
    } catch (e) {
      setError(readErrorMessage(e, '単位'));
      setUnits([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = text.trim();
  const already =
    (COUNTABLE_UNITS as readonly string[]).includes(value) || (units ?? []).includes(value);
  const full = (units ?? []).length >= MAX_CUSTOM_UNITS;
  const ok = isCountableUnit(value) && !already && !full;

  async function add() {
    if (!ok || units === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = [...units, value];
      await saveCustomUnits(next);
      setUnits(next);
      setText('');
    } catch (e) {
      setError(writeErrorMessage(e, '単位'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h3 className="card-title">単位を増やす</h3>

      <p className="note">
        ここで足した単位は、<b>全員の入力欄に出ます</b>。
        {/* ★ 足しただけでは数字は出ません。そこを誤解されると、
               「単位を足したのにカロリーが入らない」と言われます。 */}
        <br />
        足しただけでは栄養値は出ません。食材ごとに「1{value.length > 0 ? value : '杯'}
        ＝○g」を登録して、はじめて計算されます。
      </p>

      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <p className="field-hint">
        最初から使えるもの: {COUNTABLE_UNITS.join('・')}
      </p>

      {units !== null && units.length > 0 && (
        <p className="field-hint">足した単位: {units.join('・')}</p>
      )}

      <label className="field">
        <span className="field-label">足す単位</span>
        <input
          className="input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="切れ"
          maxLength={MAX_UNIT_LABEL}
          aria-label="足す単位"
        />
        <span className="field-hint">
          {MAX_UNIT_LABEL}文字まで。数えられるものだけにしてください
        </span>
      </label>

      {already && value.length > 0 && (
        <p className="note" role="status">
          「{value}」はもう使えます。
        </p>
      )}

      {full && (
        <p className="note" role="status">
          足せるのは{MAX_CUSTOM_UNITS}個までです。選択欄が長くなりすぎると、
          探すより g で打つほうが早くなってしまいます。
        </p>
      )}

      <div className="form-actions">
        <button
          className="button-secondary"
          type="button"
          onClick={() => void add()}
          disabled={!ok || busy}
        >
          足す
        </button>
      </div>

      {/* ★ 消せないことを、足す前に書いておきます。
             あとから「消せない」と気づくのがいちばん困ります。 */}
      <p className="note">
        足した単位は、あとから消せません。すでにその単位で記録された食事から、
        単位だけが消えてしまうためです（「2切れ」が「2」になります）。
      </p>
    </section>
  );
}
