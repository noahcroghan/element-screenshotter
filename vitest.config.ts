import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          environment: 'node',
          // One real browser at a time; tests share it within a file.
          fileParallelism: false,
          testTimeout: 90_000,
          hookTimeout: 90_000,
        },
      },
    ],
  },
});
