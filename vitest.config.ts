import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks', // Safer for Playwright
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['dist/**'],
  },
});
