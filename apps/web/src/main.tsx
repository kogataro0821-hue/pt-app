import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

/**
 * GitHub Pages では /pt-app/ の下に置かれるため、ルーターにもそれを伝えます。
 * import.meta.env.BASE_URL は vite.config.ts の base と同じ値になるので、
 * 独自ドメインへ移すときも、書き換えるのは vite.config.ts の1箇所だけです。
 *
 * URLを直接開いた場合、GitHub Pages は 404.html を返します。
 * その中身は index.html と同じにしてあるので（deploy.yml）、
 * 読み込まれたあとに、このルーターが正しい画面を描きます。
 */
const BASENAME = import.meta.env.BASE_URL;

const container = document.getElementById('root');
if (container === null) {
  throw new Error('#root が見つかりません');
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter basename={BASENAME}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
