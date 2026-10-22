import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { authHeaderFor, buildTestApp, createTestUser, resetDb } from '../../test/harness.js';

let app: FastifyInstance;
let fixtureDir: string;

beforeAll(async () => {
  app = await buildTestApp();
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'tcs-campaigns-it-'));
  const write = async (rel: string, content: string) => {
    const abs = path.join(fixtureDir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  };
  await write('suites/api/login.robot', '*** Test Cases ***');
  await write(
    'suites/api/login.robot.metadata.json',
    JSON.stringify({ id: 'api/login', engine: 'robotframework', tags: ['smoke'] }),
  );
});

afterEach(resetDb);

afterAll(async () => {
  await app.close();
  await rm(fixtureDir, { recursive: true, force: true });
});

const localSource = () => ({ type: 'local' as const, path: fixtureDir });
const matchAllRule = { all: [{ prop: 'engine', op: 'exists' as const }] };
const matchNothingRule = { prop: 'engine', op: 'eq' as const, value: 'no-such-engine' };

async function createCampaign(
  headers: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/campaigns',
    headers,
    payload: {
      name: 'Nightly regression',
      selectionRule: matchAllRule,
      source: localSource(),
      ...overrides,
    },
  });
  return response;
}

describe('POST /api/campaigns', () => {
  it('a viewer cannot create a campaign', async () => {
    const viewer = await createTestUser(['viewer']);
    const response = await createCampaign(await authHeaderFor(viewer, ['viewer']));
    expect(response.statusCode).toBe(403);
  });

  it('an editor creates a campaign owned by them', async () => {
    const editor = await createTestUser(['editor']);
    const response = await createCampaign(await authHeaderFor(editor, ['editor']));
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: 'Nightly regression', createdBy: { id: editor.id } });
  });

  it('only an admin may set adapterManifestUrl', async () => {
    const editor = await createTestUser(['editor']);
    const response = await createCampaign(await authHeaderFor(editor, ['editor']), {
      adapterManifestUrl: 'https://example.test/manifest.json',
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects attaching a campaign to a project the requester cannot access', async () => {
    const otherCreator = await createTestUser(['editor'], { email: 'other@example.test' });
    const projectResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: await authHeaderFor(otherCreator, ['editor']),
      payload: { name: 'Someone else’s project' },
    });
    const project = projectResponse.json() as { id: string };

    const editor = await createTestUser(['editor']);
    const response = await createCampaign(await authHeaderFor(editor, ['editor']), {
      projectId: project.id,
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('campaign visibility follows project membership', () => {
  it('a campaign with no project is visible to any authenticated viewer', async () => {
    const editor = await createTestUser(['editor']);
    const campaign = (await createCampaign(await authHeaderFor(editor, ['editor']))).json() as {
      id: string;
    };

    const otherViewer = await createTestUser(['viewer'], { email: 'viewer2@example.test' });
    const response = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${campaign.id}`,
      headers: await authHeaderFor(otherViewer, ['viewer']),
    });
    expect(response.statusCode).toBe(200);
  });

  it('a campaign scoped to a project is hidden from non-members (403)', async () => {
    const creator = await createTestUser(['editor']);
    const creatorHeaders = await authHeaderFor(creator, ['editor']);
    const project = (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: creatorHeaders,
        payload: { name: 'Payments' },
      })
    ).json() as { id: string };
    const campaign = (await createCampaign(creatorHeaders, { projectId: project.id })).json() as {
      id: string;
    };

    const outsider = await createTestUser(['viewer'], { email: 'outsider@example.test' });
    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/campaigns/${campaign.id}`,
      headers: await authHeaderFor(outsider, ['viewer']),
    });
    expect(getResponse.statusCode).toBe(403);

    // The list endpoint filters it out entirely rather than 403ing the whole list.
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/campaigns',
      headers: await authHeaderFor(outsider, ['viewer']),
    });
    const ids = (listResponse.json() as { id: string }[]).map((c) => c.id);
    expect(ids).not.toContain(campaign.id);
  });

  it('the project creator can update a campaign created by someone else inside their project', async () => {
    const creator = await createTestUser(['editor']);
    const creatorHeaders = await authHeaderFor(creator, ['editor']);
    const project = (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: creatorHeaders,
        payload: { name: 'Payments' },
      })
    ).json() as { id: string };

    const member = await createTestUser(['editor'], { email: 'member@example.test' });
    await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/members`,
      headers: creatorHeaders,
      payload: { email: 'member@example.test' },
    });
    const campaign = (
      await createCampaign(await authHeaderFor(member, ['editor']), { projectId: project.id })
    ).json() as { id: string };

    const response = await app.inject({
      method: 'PUT',
      url: `/api/campaigns/${campaign.id}`,
      headers: creatorHeaders,
      payload: { name: 'Renamed by the project creator' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('an unrelated editor cannot update someone else’s campaign', async () => {
    const owner = await createTestUser(['editor']);
    const campaign = (await createCampaign(await authHeaderFor(owner, ['editor']))).json() as {
      id: string;
    };

    const otherEditor = await createTestUser(['editor'], { email: 'other-editor@example.test' });
    const response = await app.inject({
      method: 'PUT',
      url: `/api/campaigns/${campaign.id}`,
      headers: await authHeaderFor(otherEditor, ['editor']),
      payload: { name: 'Hijacked' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('POST /api/campaigns/preview', () => {
  it('evaluates a selection rule against a real source tree', async () => {
    const editor = await createTestUser(['editor']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/campaigns/preview',
      headers: await authHeaderFor(editor, ['editor']),
      payload: { selectionRule: matchAllRule, source: localSource() },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ totalDiscovered: 1, selectedCount: 1 });
  });
});

describe('POST /api/campaigns/:id/runs', () => {
  it('fails fast (422) when the selection rule matches no test, without touching the orchestrator', async () => {
    const editor = await createTestUser(['editor']);
    const headers = await authHeaderFor(editor, ['editor']);
    const campaign = (
      await createCampaign(headers, { selectionRule: matchNothingRule })
    ).json() as { id: string };

    const response = await app.inject({
      method: 'POST',
      url: `/api/campaigns/${campaign.id}/runs`,
      headers,
    });
    expect(response.statusCode).toBe(422);
  });
});
