// Runs once per integration test file, before that file's own imports
// (`app.ts` → `prisma.ts` instantiates `PrismaClient` at import time, so
// `DATABASE_URL` must exist in `process.env` before that happens).
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(fileURLToPath(import.meta.url), '../..');

process.env.DATABASE_URL ??= 'postgresql://tcs:tcs@localhost:5432/tcs_test';
process.env.SESSION_SECRET ??= 'integration-tests-session-secret-needs-32-chars-minimum';
process.env.PORTAL_ORIGIN ??= 'http://localhost:3000';
process.env.PUBLIC_BASE_URL ??= 'http://localhost:4000';
process.env.AUTH_PASSWORD_ENABLED ??= 'true';
process.env.LOG_LEVEL ??= 'error';
// A firing cron job or a business-metrics push mid-test-run would be pure
// noise (and network flakiness) for what these tests actually assert.
process.env.SCHEDULER_ENABLED = 'false';
process.env.BUSINESS_METRICS_ENABLED = 'false';
// MinIO, from the same docker-compose.yml as the Postgres above.
process.env.S3_ENDPOINT ??= 'http://localhost:9000';
process.env.S3_ACCESS_KEY ??= 'tcs';
process.env.S3_SECRET_KEY ??= 'tcs-secret';
process.env.S3_BUCKET ??= 'tcs-test-artifacts';

// `resetDb()` (test/harness.ts) truncates every app table — refuse to even
// start against anything that isn't obviously a disposable test database.
if (
  !process.env.DATABASE_URL.includes('tcs_test') &&
  process.env.ALLOW_INTEGRATION_TESTS_ON_THIS_DB !== '1'
) {
  throw new Error(
    `Refusing to run integration tests against DATABASE_URL="${process.env.DATABASE_URL}": ` +
      'it does not look like a dedicated test database (expected the name to contain "tcs_test"). ' +
      'Set ALLOW_INTEGRATION_TESTS_ON_THIS_DB=1 to override.',
  );
}

// The generated client (node_modules/.prisma/client) isn't produced by a
// plain `pnpm install` — CI doesn't run pnpm's approved-builds postinstall
// for @prisma/client, and `app.ts`/`prisma.ts` need it to even import.
// Both commands are idempotent and fast when there's nothing to do, so
// running them unconditionally here (rather than trusting an earlier CI
// step to have done it) keeps this suite self-sufficient.
execSync('pnpm run prisma:generate', { cwd: serverDir, env: process.env, stdio: 'inherit' });
execSync('pnpm run prisma:deploy', { cwd: serverDir, env: process.env, stdio: 'inherit' });
