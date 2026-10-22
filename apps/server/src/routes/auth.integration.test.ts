import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { authHeaderFor, buildTestApp, createTestUser, resetDb } from '../../test/harness.js';
import { createLocalUser } from '../auth/users.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterEach(resetDb);

afterAll(async () => {
  await app.close();
});

describe('GET /api/auth/methods', () => {
  it('reflects the enabled auth methods', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/methods' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ password: true });
  });
});

describe('POST /api/auth/login', () => {
  it('issues a session cookie for valid credentials', async () => {
    await createLocalUser({
      email: 'alice@example.test',
      displayName: 'Alice',
      password: 'correct-horse-battery-staple',
      roles: ['editor'],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.test', password: 'correct-horse-battery-staple' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ email: 'alice@example.test', roles: ['editor'] });
    expect(response.cookies.some((c) => c.name === 'tcs_session')).toBe(true);
  });

  it('rejects an unknown email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.test', password: 'whatever' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a wrong password', async () => {
    await createLocalUser({
      email: 'bob@example.test',
      displayName: 'Bob',
      password: 'the-real-password',
      roles: ['viewer'],
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'bob@example.test', password: 'not-it' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a malformed payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'not-an-email' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
  });

  it('returns the profile carried by a valid Bearer token', async () => {
    const user = await createTestUser(['editor']);
    const headers = await authHeaderFor(user, ['editor']);

    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ sub: user.id, email: user.email, roles: ['editor'] });
  });

  it('rejects a garbage Bearer token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(response.statusCode).toBe(401);
  });
});
