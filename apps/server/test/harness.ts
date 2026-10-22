import type { FastifyInstance } from 'fastify';
import type { User } from '@prisma/client';
import type { Role } from '@tcs/shared-types';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { SessionService } from '../src/auth/session.js';
import { prisma, toJson } from '../src/prisma.js';

/** Builds a fully wired app (real routes, real Postgres) ready for `.inject()`. */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp(loadConfig(process.env));
  await app.ready();
  return app;
}

let userSeq = 0;

/** Inserts a real user row (FK target for createdById/triggeredById/... columns). */
export async function createTestUser(roles: Role[], overrides: Partial<Pick<User, 'email' | 'displayName'>> = {}): Promise<User> {
  userSeq += 1;
  return prisma.user.create({
    data: {
      email: overrides.email ?? `test-user-${userSeq}@example.test`,
      displayName: overrides.displayName ?? `Test User ${userSeq}`,
      roles: toJson(roles),
      authSource: 'local',
    },
  });
}

/** A Bearer header the running app will accept as this user, without going through /api/auth/login. */
export async function authHeaderFor(user: User, roles: Role[]): Promise<Record<string, string>> {
  const config = loadConfig(process.env);
  const sessions = new SessionService(config.SESSION_SECRET, config.SESSION_TTL_HOURS);
  const token = await sessions.issue({
    sub: user.id,
    email: user.email,
    displayName: user.displayName,
    roles,
    authSource: 'local',
  });
  return { authorization: `Bearer ${token}` };
}

/**
 * Wipes every app table. Only ever called between integration test files/
 * suites against the dedicated `tcs_test` database (see integration-setup.ts's
 * DATABASE_URL guard) — never point this at a real environment.
 */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "TestResult","Artifact","WorkflowRun","ProjectMember","Campaign","Project","AdapterManifest","User" RESTART IDENTITY CASCADE',
  );
}
