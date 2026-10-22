import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Only used to give portal component tests (`environment: jsdom`, set per
  // file via the `@vitest-environment` docblock) a real JSX transform —
  // the portal's own tsconfig sets `jsx: "preserve"` for Next's compiler,
  // which esbuild's default transform can't handle on its own.
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.{ts,tsx}'],
    // DB-backed integration tests live in their own suite (vitest.integration.config.ts,
    // `pnpm test:integration`) — this one must stay fast and DB-less for CI's main job.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/*.integration.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // JUnit report only in CI (GitLab reads it as `artifacts:reports:junit`
    // to render the pipeline's Tests tab) — keep local runs plain.
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: process.env.CI ? { junit: 'junit-report.xml' } : undefined,
  },
});
