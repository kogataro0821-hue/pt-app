import type { ExpoConfig } from 'expo/config';

/**
 * ★ 設計書 §5:
 *   「最終的なアプリ名は後で決める。アプリ名をコードに大量にハードコードしない。」
 *
 * アプリ名はこの1箇所だけで定義する。
 * 画面から参照するときは src/config/app.ts の APP_NAME を使うこと。
 * 名前を変えたいときは、下の APP_NAME と SLUG を書き換えるだけで済む。
 */
const APP_NAME = 'PT Manager';
const SLUG = 'pt-app';
const SCHEME = 'ptapp';

const config: ExpoConfig = {
  name: APP_NAME,
  slug: SLUG,
  scheme: SCHEME,
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',

  extra: {
    // 画面側から Constants.expoConfig.extra で読めるようにする
    appName: APP_NAME,
  },

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'jp.silce.ptapp',
  },

  android: {
    package: 'jp.silce.ptapp',
    adaptiveIcon: {
      backgroundColor: '#F3F5F2',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },

  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },

  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#F3F5F2',
        image: './assets/images/splash-icon.png',
        imageWidth: 160,
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
  },
};

export default config;
