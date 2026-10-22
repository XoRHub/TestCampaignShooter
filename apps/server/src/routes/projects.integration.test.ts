import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { authHeaderFor, buildTestApp, createTestUser, resetDb } from '../../test/harness.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
});

afterEach(resetDb);

afterAll(async () => {
  await app.close();
});

async function createProject(headers: Record<string, string>, name = 'Checkout squad') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers,
    payload: { name },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; name: string };
}

describe('POST /api/projects', () => {
  it('a viewer cannot create a project', async () => {
    const viewer = await createTestUser(['viewer']);
    const headers = await authHeaderFor(viewer, ['viewer']);
    const response = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'x' } });
    expect(response.statusCode).toBe(403);
  });

  it('an editor creates a project and becomes its creator', async () => {
    const editor = await createTestUser(['editor']);
    const headers = await authHeaderFor(editor, ['editor']);
    const project = await createProject(headers, 'New project');
    expect(project.name).toBe('New project');
  });
});

describe('project visibility (GET /api/projects/:id, GET /api/projects)', () => {
  it('the creator can access their own project', async () => {
    const creator = await createTestUser(['editor']);
    const creatorHeaders = await authHeaderFor(creator, ['editor']);
    const project = await createProject(creatorHeaders);

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
      headers: creatorHeaders,
    });
    expect(response.statusCode).toBe(200);
  });

  it('an unrelated user is refused access (403, not a silent 404)', async () => {
    const creator = await createTestUser(['editor']);
    const project = await createProject(await authHeaderFor(creator, ['editor']));

    const outsider = await createTestUser(['viewer']);
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
      headers: await authHeaderFor(outsider, ['viewer']),
    });
    expect(response.statusCode).toBe(403);
  });

  it('an admin can access any project regardless of membership', async () => {
    const creator = await createTestUser(['editor']);
    const project = await createProject(await authHeaderFor(creator, ['editor']));

    const admin = await createTestUser(['admin']);
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
      headers: await authHeaderFor(admin, ['admin']),
    });
    expect(response.statusCode).toBe(200);
  });

  it('a member added by the creator gains access; removing them revokes it', async () => {
    const creator = await createTestUser(['editor']);
    const creatorHeaders = await authHeaderFor(creator, ['editor']);
    const project = await createProject(creatorHeaders);

    const member = await createTestUser(['viewer'], { email: 'member@example.test' });
    const memberHeaders = await authHeaderFor(member, ['viewer']);

    // Not yet a member: refused.
    expect(
      (await app.inject({ method: 'GET', url: `/api/projects/${project.id}`, headers: memberHeaders }))
        .statusCode,
    ).toBe(403);

    const addResponse = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/members`,
      headers: creatorHeaders,
      payload: { email: 'member@example.test' },
    });
    expect(addResponse.statusCode).toBe(201);

    expect(
      (await app.inject({ method: 'GET', url: `/api/projects/${project.id}`, headers: memberHeaders }))
        .statusCode,
    ).toBe(200);

    const removeResponse = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}/members/${member.id}`,
      headers: creatorHeaders,
    });
    expect(removeResponse.statusCode).toBe(200);

    expect(
      (await app.inject({ method: 'GET', url: `/api/projects/${project.id}`, headers: memberHeaders }))
        .statusCode,
    ).toBe(403);
  });

  it('GET /api/projects lists only projects the requester created or belongs to', async () => {
    const creator = await createTestUser(['editor']);
    const creatorHeaders = await authHeaderFor(creator, ['editor']);
    await createProject(creatorHeaders, 'Mine');

    const outsider = await createTestUser(['editor'], { email: 'outsider@example.test' });
    await createProject(await authHeaderFor(outsider, ['editor']), 'Not mine');

    const response = await app.inject({ method: 'GET', url: '/api/projects', headers: creatorHeaders });
    expect(response.statusCode).toBe(200);
    const names = (response.json() as { name: string }[]).map((p) => p.name);
    expect(names).toEqual(['Mine']);
  });
});

describe('project management (PUT/DELETE, members) is creator/admin-only', () => {
  it('a member (not the creator) cannot rename or delete the project', async () => {
    const creator = await createTestUser(['editor']);
    const project = await createProject(await authHeaderFor(creator, ['editor']));

    const member = await createTestUser(['editor'], { email: 'member2@example.test' });
    await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/members`,
      headers: await authHeaderFor(creator, ['editor']),
      payload: { email: 'member2@example.test' },
    });
    const memberHeaders = await authHeaderFor(member, ['editor']);

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}`,
      headers: memberHeaders,
      payload: { name: 'Renamed by a non-creator' },
    });
    expect(putResponse.statusCode).toBe(403);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}`,
      headers: memberHeaders,
    });
    expect(deleteResponse.statusCode).toBe(403);
  });

  it('the creator can rename their project', async () => {
    const creator = await createTestUser(['editor']);
    const headers = await authHeaderFor(creator, ['editor']);
    const project = await createProject(headers);

    const response = await app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}`,
      headers,
      payload: { name: 'Renamed by the creator' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: 'Renamed by the creator' });
  });
});
