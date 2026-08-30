import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Emulator との通信があるため、既定より長めに待つ
    testTimeout: 20000,
    hookTimeout: 30000,
    // Rules のテストは同じ Firestore を共有するため直列で走らせる
    fileParallelism: false,
  },
});
