import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CampaignExecutionSpec, OrchestrationEvent, ResolvedExecution } from '@tcs/shared-types';
import { LocalProvider } from './local-provider.js';
import { createProvider, listProviderNames } from '../index.js';

let sourceDir: string;

beforeAll(async () => {
  sourceDir = await mkdtemp(path.join(tmpdir(), 'tcs-local-'));
  await writeFile(path.join(sourceDir, 'dummy.txt'), 'source tree', 'utf8');
});

afterAll(async () => {
  await rm(sourceDir, { recursive: true, force: true });
});

function execution(script: string): ResolvedExecution {
  return {
    image: 'unused-locally',
    command: [process.execPath, '-e', script],
    junitPath: 'unused.xml',
    timeoutSeconds: 30,
    env: {},
  };
}

function spec(runId: string): CampaignExecutionSpec {
  return {
    runId,
    campaignId: 'camp-1',
    campaignName: 'Smoke',
    source: { type: 'local', path: sourceDir },
    parallelism: 2,
    tests: [
      {
        testId: 'ok-test',
        name: 'ok test',
        engine: 'generic-node',
        file: 'dummy.txt',
        execution: execution('console.log("hello from ok"); process.exit(0)'),
        metadata: { engine: 'generic-node', execution: {} },
      },
      {
        testId: 'ko-test',
        name: 'ko test',
        engine: 'generic-node',
        file: 'dummy.txt',
        execution: execution('console.error("boom"); process.exit(3)'),
        metadata: { engine: 'generic-node', execution: {} },
      },
    ],
  };
}

describe('LocalProvider', () => {
  it('is registered as the "local" provider', () => {
    expect(listProviderNames()).toContain('local');
    expect(createProvider('local').name).toBe('local');
  });

  it('runs tests, emits normalized events and reports per-test status', async () => {
    const provider = new LocalProvider();
    const handle = await provider.submit(spec('run-1'));
    const events: OrchestrationEvent[] = [];
    await provider.watch(handle, (e) => events.push(e));

    const state = await provider.getState(handle);
    expect(state.run.phase).toBe('failed');
    expect(state.run.progress).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    const byId = Object.fromEntries(state.tests.map((t) => [t.testId, t.status]));
    expect(byId).toEqual({ 'ok-test': 'succeeded', 'ko-test': 'failed' });

    // Both statuses transitioned through "running".
    expect(events.some((e) => e.type === 'test' && e.testId === 'ok-test' && e.status === 'running')).toBe(true);
    expect(await provider.getLogs(handle, 'ok-test')).toContain('hello from ok');
    expect(await provider.getLogs(handle, 'ko-test')).toContain('boom');

    // Aggregated JUnit contains one suite per test even without report files.
    const junit = provider.getMergedJUnit(handle);
    expect(junit).toContain('name="ok-test"');
    expect(junit).toContain('failures="1"');
  }, 30_000);

  it('retries only failed tests', async () => {
    const provider = new LocalProvider();
    const handle = await provider.submit(spec('run-2'));
    await provider.watch(handle, () => undefined);

    const okFinishedAt = (await provider.getState(handle)).tests.find((t) => t.testId === 'ok-test')
      ?.finishedAt;

    await provider.retryFailed(handle);
    await provider.watch(handle, () => undefined);

    const state = await provider.getState(handle);
    // ko-test re-ran (still failing); ok-test result was untouched.
    expect(state.tests.find((t) => t.testId === 'ok-test')?.finishedAt).toBe(okFinishedAt);
    expect(state.run.phase).toBe('failed');
  }, 30_000);
});
