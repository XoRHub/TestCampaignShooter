import { defineConfig } from 'vitest/config';

/**
 * Separate from the root `vitest.config.ts` on purpose: these tests hit a
 * real PostgreSQL database (`apps/server/test/integration-setup.ts` points
 * `DATABASE_URL` at a dedicated `tcs_test` database and runs pending
 * migrations before anything else loads) and must never run interleaved
 * with each other, so `pnpm test` — the fast, DB-less suite CI always
 * runs — stays untouched. See docs/technical.md § Quality & CI.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/server/src/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['./apps/server/test/integration-setup.ts'],
    // One database, truncated between files — never run two integration
    // test files at the same time.
    fileParallelism: false,
    testTimeout: 20_000,
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: process.env.CI ? { junit: 'junit-report-integration.xml' } : undefined,
  },
});
