import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverTests } from './discover.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tcs-discover-'));
  const write = async (rel: string, content: string) => {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  };

  await write(
    'suites/checkout/smoke.cy.ts',
    'it("adds to cart", () => {});',
  );
  await write(
    'suites/checkout/smoke.cy.ts.metadata.json',
    JSON.stringify({
      name: 'Checkout smoke',
      engine: 'cypress',
      tags: ['smoke'],
      team: 'payments',
      criticality: 3,
    }),
  );

  await write('suites/api/login.robot', '*** Test Cases ***');
  await write(
    'suites/api/login.robot.metadata.json',
    JSON.stringify({ id: 'api/login', engine: 'robotframework', tags: ['nightly'] }),
  );

  // invalid JSON
  await write('suites/bad/broken.robot', '');
  await write('suites/bad/broken.robot.metadata.json', '{ not json');

  // schema violation (engine missing)
  await write('suites/bad/noengine.robot', '');
  await write('suites/bad/noengine.robot.metadata.json', JSON.stringify({ name: 'x' }));

  // metadata without adjacent test file
  await write('suites/bad/ghost.robot.metadata.json', JSON.stringify({ engine: 'robotframework' }));

  // likely test file without metadata
  await write('suites/orphan/orphan.cy.ts', 'it("orphan", () => {});');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('discoverTests', () => {
  it('discovers valid tests with defaults applied', async () => {
    const { tests } = await discoverTests(root);
    expect(tests.map((t) => t.id).sort()).toEqual(['api/login', 'suites/checkout/smoke.cy.ts']);
    const smoke = tests.find((t) => t.engine === 'cypress')!;
    expect(smoke.name).toBe('Checkout smoke');
    expect(smoke.file).toBe('suites/checkout/smoke.cy.ts');
    expect(smoke.metadata.execution).toEqual({});
    expect((smoke.metadata as Record<string, unknown>).team).toBe('payments');
  });

  it('reports precise issues without aborting discovery', async () => {
    const { issues } = await discoverTests(root);
    const kinds = issues.map((i) => `${i.kind}:${i.file}`).sort();
    expect(kinds).toContain('invalid-json:suites/bad/broken.robot.metadata.json');
    expect(kinds).toContain('invalid-metadata:suites/bad/noengine.robot.metadata.json');
    expect(kinds).toContain('missing-metadata:suites/bad/ghost.robot.metadata.json');
    expect(kinds).toContain('missing-metadata:suites/orphan/orphan.cy.ts');
  });

  it('flags unknown engines when a known list is provided', async () => {
    const { tests, issues } = await discoverTests(root, { knownEngines: ['robotframework'] });
    expect(tests.map((t) => t.id)).toEqual(['api/login']);
    expect(issues.some((i) => i.kind === 'unknown-engine')).toBe(true);
  });
});
