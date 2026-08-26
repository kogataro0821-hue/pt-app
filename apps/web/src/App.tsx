import { formatNutrients, scaleByGrams, sumNutrients, toInternal, type Nutrients } from '@pt/core';
import { APP_NAME, isFirebaseConfigured } from '@/config/env';
import { useStandalone } from '@/hooks/useStandalone';

/**
 * Phase 1 の動作確認画面。
 *
 * 目的:
 *   1. iPhone の Safari でアプリが開くことを確認する
 *   2. PFC計算エンジン（@pt/core）が呼べることを確認する
 *   3. 設計書 §15「食材合計 == 食事合計」が実機でも成立することを目で見る
 *
 * Phase 5 でカレンダー画面に置き換わります。
 */

const PER_100G = {
  白米: toInternal({ kcal: 156, p: 2.5, f: 0.3, c: 34.6 }),
  鶏ささみ: toInternal({ kcal: 98, p: 23.9, f: 0.8, c: 0.1 }),
  卵: toInternal({ kcal: 142, p: 12.2, f: 10.2, c: 0.4 }),
};

const SAMPLE_ITEMS = [
  { name: '白米', grams: 180, nutrients: scaleByGrams(PER_100G.白米, 180) },
  { name: '鶏ささみ', grams: 150, nutrients: scaleByGrams(PER_100G.鶏ささみ, 150) },
  { name: '卵', grams: 60, nutrients: scaleByGrams(PER_100G.卵, 60) },
];

export default function App() {
  const total = sumNutrients(SAMPLE_ITEMS.map((i) => i.nutrients));
  const firebaseReady = isFirebaseConfigured();
  const isStandalone = useStandalone();

  return (
    <div className="app">
      <header className="appbar">
        <h1>{APP_NAME}</h1>
      </header>

      <main className="main">
        <p className="eyebrow">PHASE 1 · 動作確認</p>
        <h2 className="title">セットアップが完了しました</h2>
        <p className="lede">
          Webアプリと PFC計算エンジンが動いています。この画面は Phase 5
          でカレンダー画面に置き換わります。
        </p>

        {!isStandalone && (
          <div className="install-hint">
            <p>この画面をアプリとして使えます。</p>
            <p>
              画面下の共有ボタン（□に↑のアイコン）→「ホーム画面に追加」を押すと、
              ホーム画面にアイコンが並び、Safari のバーが消えて全画面で開きます。
            </p>
          </div>
        )}

        <section className="card">
          <h3 className="card-title">1食目（サンプル）</h3>
          {SAMPLE_ITEMS.map((item) => (
            <Row key={item.name} label={`${item.name} ${item.grams}g`} value={item.nutrients} />
          ))}
          <div className="divider" />
          <Row label="合計" value={total} total />
          <p className="note">
            合計は各食品の値を積み上げて算出しています（設計書 §15）。
            内訳の表示は小数第1位に丸めているため、足し算が合わないように見えることがあります。
            正しいのは合計のほうです。
          </p>
        </section>

        <section className="card">
          <h3 className="card-title">次のフェーズの準備状況</h3>
          <Status label="Webアプリ（PWA）" done />
          <Status label="PFC計算エンジン（@pt/core）" done />
          <Status label="AIスキーマ（@pt/ai-contract）" done />
          <Status label="Firebase 接続設定（Phase 2）" done={firebaseReady} />
        </section>
      </main>
    </div>
  );
}

function Row({ label, value, total }: { label: string; value: Nutrients; total?: boolean }) {
  const f = formatNutrients(value);
  return (
    <div className={total ? 'row total' : 'row'}>
      <div className="row-label">{label}</div>
      <div className="macros">
        <span className="kcal">{f.kcal}kcal</span>
        <span className="macro p">P {f.p}</span>
        <span className="macro f">F {f.f}</span>
        <span className="macro c">C {f.c}</span>
      </div>
    </div>
  );
}

function Status({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="status">
      <span className="status-label">{label}</span>
      <span className={done ? 'badge ok' : 'badge wait'}>{done ? '完了' : '未設定'}</span>
    </div>
  );
}
