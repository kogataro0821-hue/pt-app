import { formatNutrients, scaleByGrams, sumNutrients, toInternal, type Nutrients } from '@pt/core';
import { APP_NAME } from '@/config/firebase';
import { useAuth } from '@/features/auth/AuthProvider';
import { useStandalone } from '@/hooks/useStandalone';
import type { AppUser } from '@/features/auth/authTypes';

/**
 * ログイン後の画面（Phase 3 時点）。
 *
 * いまは「誰としてログインしているか」と、PFC計算エンジンの動作確認を出すだけです。
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

export function HomeScreen({
  user,
  onChangePassword,
}: {
  user: AppUser;
  onChangePassword: () => void;
}) {
  const { signOutNow } = useAuth();
  const isStandalone = useStandalone();
  const total = sumNutrients(SAMPLE_ITEMS.map((i) => i.nutrients));

  return (
    <div className="app">
      <header className="appbar">
        <h1>{APP_NAME}</h1>
        <button className="appbar-action" type="button" onClick={() => void signOutNow()}>
          ログアウト
        </button>
      </header>

      <main className="main">
        <p className="eyebrow">PHASE 3 · ログインできました</p>
        <h2 className="title">
          {user.role === 'admin' ? '管理者としてログイン中' : `${user.clientId} としてログイン中`}
        </h2>
        <p className="lede">
          {user.role === 'admin'
            ? '全契約者のデータを閲覧・編集できる権限です。契約者管理の画面は Phase 4 で作ります。'
            : 'あなた自身のデータだけが見える権限です。カレンダーと食事記録は Phase 5 以降で作ります。'}
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
          <h3 className="card-title">アカウント</h3>
          <div className="kv">
            <span className="kv-key">権限</span>
            <span className="kv-value">{user.role === 'admin' ? '管理者' : '契約者'}</span>
          </div>
          {user.clientId !== null && (
            <div className="kv">
              <span className="kv-key">契約者ID</span>
              <span className="kv-value">{user.clientId}</span>
            </div>
          )}
          <button className="button-secondary" type="button" onClick={onChangePassword}>
            パスワードを変更する
          </button>
        </section>

        <section className="card">
          <h3 className="card-title">1食目（動作確認用サンプル）</h3>
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
