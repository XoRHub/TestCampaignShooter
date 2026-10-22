import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@tcs/shared-types';
import { hasRole } from '@tcs/shared-types';
import { SESSION_COOKIE, type SessionPayload, type SessionService } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionPayload;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: Role) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Decorates the app with authentication + RBAC guards used as route preHandlers. */
export function registerAuthGuards(app: FastifyInstance, sessions: SessionService): void {
  app.decorateRequest('user', undefined);

  app.addHook('onRequest', async (request) => {
    const token =
      request.cookies[SESSION_COOKIE] ??
      request.headers.authorization?.replace(/^Bearer /, '');
    if (token) request.user = await sessions.verify(token);
  });

  app.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      await reply.code(401).send({ error: 'authentication required' });
    }
  });

  app.decorate('requireRole', (role: Role) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        await reply.code(401).send({ error: 'authentication required' });
        return;
      }
      if (!hasRole(request.user.roles, role)) {
        await reply.code(403).send({ error: `role "${role}" required` });
      }
    };
  });
}
