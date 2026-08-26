import { useEffect, useState } from 'react';

/**
 * 「ホーム画面に追加」から開かれているかどうか。
 *
 * iOS の Safari は標準の `display-mode: standalone` に加えて
 * `navigator.standalone` という独自のプロパティを持っています。両方を見ます。
 *
 * ホーム画面から開かれているときは「追加してください」の案内を出さないために使います。
 */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(() => detect());

  useEffect(() => {
    const query = window.matchMedia('(display-mode: standalone)');
    const onChange = () => setStandalone(detect());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return standalone;
}

function detect(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  if (iosStandalone === true) return true;
  return window.matchMedia('(display-mode: standalone)').matches;
}
