import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          globalSetup: ['test/helpers/build-once.ts'],
          environment: 'node',
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        // Real AI model, real key: run on purpose with "npm run test:ai" (uses the key's quota).
        test: {
          name: 'ai',
          include: ['test/ai/**/*.test.ts'],
          environment: 'node',
          testTimeout: 600_000,
          hookTimeout: 600_000,
        },
      },
    ],
  },
});
