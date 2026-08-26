import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/expo-env.d.ts',
      'apps/mobile/assets/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // ---------------------------------------------------------------------------
  // packages/core は「純粋ロジック」でなければならない（設計書 §3.1 / §14）。
  // Firebase も AI も import してはいけないことを、lint で機械的に強制する。
  // ---------------------------------------------------------------------------
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'firebase',
                'firebase/*',
                '@react-native-firebase/*',
                'react-native',
                'react',
                'expo',
                'expo/*',
                'expo-*',
              ],
              message:
                'packages/core は純粋ロジックです。Firebase / React Native / Expo / AI を import できません（設計書 §3.1）。',
            },
          ],
        },
      ],
    },
  },

  // ブラウザで動くコード（apps/web）はブラウザのグローバルを使う。
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        Navigator: 'readonly',
        HTMLElement: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
      },
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-console': 'off',
    },
  },

  // Cloudflare Worker。ブラウザでも Node でもない実行環境なので、
  // 使える道具をここで明示する（設計書 §9.2）。
  {
    files: ['worker/worker.js'],
    languageOptions: {
      globals: {
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        console: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      // 利用状況を Cloudflare のログに残すために使う（本文は残さない）
      'no-console': 'off',
    },
  },
);
