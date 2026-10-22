import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import type { Role } from '@tcs/shared-types';
import { roles as knownRoles } from '@tcs/shared-types';
import { prisma, fromJson, toJson } from '../prisma.js';

export function userRoles(user: User): Role[] {
  const parsed = fromJson<string[]>(user.roles, []);
  return parsed.filter((r): r is Role => (knownRoles as readonly string[]).includes(r));
}

export async function verifyPassword(email: string, password: string): Promise<User | undefined> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash || !user.active) return undefined;
  return (await bcrypt.compare(password, user.passwordHash)) ? user : undefined;
}

export async function createLocalUser(input: {
  email: string;
  displayName: string;
  password: string;
  roles: Role[];
}): Promise<User> {
  return prisma.user.create({
    data: {
      email: input.email,
      displayName: input.displayName,
      passwordHash: await bcrypt.hash(input.password, 10),
      roles: toJson(input.roles),
      authSource: 'local',
    },
  });
}

/**
 * OIDC just-in-time provisioning: creates the user profile from the ID token
 * claims on first login, then re-syncs profile and roles on every login.
 */
export async function upsertOidcUser(input: {
  subject: string;
  email: string;
  displayName: string;
  roles: Role[];
}): Promise<User> {
  return prisma.user.upsert({
    where: { oidcSubject: input.subject },
    create: {
      email: input.email,
      displayName: input.displayName,
      oidcSubject: input.subject,
      roles: toJson(input.roles.length > 0 ? input.roles : ['viewer']),
      authSource: 'oidc',
    },
    update: {
      email: input.email,
      displayName: input.displayName,
      ...(input.roles.length > 0 ? { roles: toJson(input.roles) } : {}),
    },
  });
}

/** Creates the bootstrap admin account if it does not exist yet. */
export async function ensureBootstrapAdmin(email?: string, password?: string): Promise<void> {
  if (!email || !password) return;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return;
  await createLocalUser({ email, displayName: 'Administrator', password, roles: ['admin'] });
}
