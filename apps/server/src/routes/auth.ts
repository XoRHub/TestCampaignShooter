import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AuthMethods } from '@tcs/shared-types';
import type { AppConfig } from '../config.js';
import { SESSION_COOKIE, type SessionService } from '../auth/session.js';
import { createOidcService, type OidcService } from '../auth/oidc.js';
import { upsertOidcUser, userRoles, verifyPassword } from '../auth/users.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const OIDC_STATE_COOKIE = 'tcs_oidc_state';

export async function registerAuthRoutes(
  app: FastifyInstance,
  config: AppConfig,
  sessions: SessionService,
): Promise<void> {
  let oidcService: OidcService | undefined;
  if (config.authMethods.oidc) {
    oidcService = await createOidcService(config);
  }

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: config.PUBLIC_BASE_URL.startsWith('https'),
  };

  // The portal adapts its login form to whatever is enabled.
  app.get('/api/auth/methods', async (): Promise<AuthMethods> => {
    return {
      password: config.authMethods.password,
      oidc: config.authMethods.oidc,
      oidcLoginUrl: config.authMethods.oidc ? '/api/auth/oidc/login' : undefined,
    };
  });

  app.post('/api/auth/login', async (request, reply) => {
    if (!config.authMethods.password) {
      return reply.code(404).send({ error: 'password authentication is disabled' });
    }
    const body = loginSchema.parse(request.body);
    const user = await verifyPassword(body.email, body.password);
    if (!user) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    const token = await sessions.issue({
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: userRoles(user),
      authSource: 'local',
    });
    return reply
      .setCookie(SESSION_COOKIE, token, cookieOptions)
      .send({ id: user.id, email: user.email, displayName: user.displayName, roles: userRoles(user) });
  });

  app.get('/api/auth/oidc/login', async (request, reply) => {
    if (!oidcService) return reply.code(404).send({ error: 'OIDC authentication is disabled' });
    const state = randomBytes(16).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    return reply
      .setCookie(OIDC_STATE_COOKIE, `${state}.${nonce}`, { ...cookieOptions, maxAge: 600 })
      .redirect(oidcService.buildLoginUrl(state, nonce));
  });

  app.get('/api/auth/oidc/callback', async (request, reply) => {
    if (!oidcService) return reply.code(404).send({ error: 'OIDC authentication is disabled' });
    const [expectedState, expectedNonce] = (request.cookies[OIDC_STATE_COOKIE] ?? '.').split('.');
    if (!expectedState || !expectedNonce) {
      return reply.code(400).send({ error: 'missing OIDC state cookie' });
    }
    const currentUrl = new URL(request.url, config.PUBLIC_BASE_URL);
    const profile = await oidcService.handleCallback(currentUrl, expectedState, expectedNonce);
    // JIT provisioning + re-sync of the profile from the claims.
    const user = await upsertOidcUser(profile);
    if (!user.active) return reply.code(403).send({ error: 'account disabled' });
    const token = await sessions.issue({
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: userRoles(user),
      authSource: 'oidc',
    });
    return reply
      .clearCookie(OIDC_STATE_COOKIE, { path: '/' })
      .setCookie(SESSION_COOKIE, token, cookieOptions)
      .redirect(config.PORTAL_ORIGIN);
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true });
  });

  app.get('/api/auth/me', { preHandler: app.requireAuth }, async (request) => {
    return request.user;
  });
}
