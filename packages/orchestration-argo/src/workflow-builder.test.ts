import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CampaignExecutionSpec } from '@tcs/shared-types';
import { buildCommandLine, buildWorkflow } from './workflow-builder.js';
import { generateEngineStepTemplate, resolveStepTemplates } from './step-templates.js';
import { stepTemplateName, testNodeName, workflowName } from './naming.js';
import { argoConfigFromEnv } from './config.js';

const config = argoConfigFromEnv({ K8S_NAMESPACE: 'argo' });

function spec(): CampaignExecutionSpec {
  return {
    runId: 'RuN_42',
    campaignId: 'camp-1',
    campaignName: 'Smoke',
    source: { type: 'git', url: 'https://git.example.com/tests.git', revision: 'main' },
    parallelism: 5,
    resultsCallbackUrl: 'http://server:4000/api/internal/runs/RuN_42/results',
    tests: [
      {
        testId: 'suites/checkout/smoke.cy.ts',
        name: 'Checkout smoke',
        engine: 'cypress',
        file: 'suites/checkout/smoke.cy.ts',
        execution: {
          image: 'cypress/included:13.17.0',
          command: ['npx', 'cypress', 'run', '--spec', 'suites/checkout/smoke.cy.ts'],
          junitPath: 'results/junit.xml',
          timeoutSeconds: 600,
          env: { BASE_URL: 'http://staging' },
        },
        metadata: { engine: 'cypress', execution: {} },
      },
      {
        testId: 'api/login',
        name: 'Login API',
        engine: 'robotframework',
        file: 'suites/api/login.robot',
        execution: {
          image: 'ppodgorsek/robot-framework:latest',
          command: ['robot', '--xunit', 'junit.xml', 'suites/api/login.robot'],
          junitPath: 'results/junit.xml',
          timeoutSeconds: 1800,
          env: {},
        },
        metadata: { engine: 'robotframework', execution: {} },
      },
    ],
  };
}

describe('naming', () => {
  it('produces deterministic DNS-safe node names', () => {
    const a = testNodeName('suites/checkout/smoke.cy.ts');
    expect(a).toBe(testNodeName('suites/checkout/smoke.cy.ts'));
    expect(a).toMatch(/^t-[a-z0-9-]+$/);
    expect(a.length).toBeLessThanOrEqual(63);
    expect(testNodeName('a/b')).not.toBe(testNodeName('a-b')); // hash disambiguates
    expect(workflowName('RuN_42')).toBe('tcs-run-run-42');
  });
});

describe('buildWorkflow', () => {
  const { manifest, testMap } = buildWorkflow(spec(), config);
  const wfSpec = manifest.spec as {
    parallelism: number;
    templates: Array<{ name: string; dag?: { failFast: boolean; tasks: Array<Record<string, unknown>> } }>;
  };
  const dag = wfSpec.templates.find((t) => t.name === 'main')!.dag!;

  it('creates one distinct retryable node per test', () => {
    const testTasks = dag.tasks.filter((t) => String(t.name).startsWith('t-'));
    expect(testTasks).toHaveLength(2);
    expect(Object.values(testMap).sort()).toEqual(['api/login', 'suites/checkout/smoke.cy.ts']);
    // Each task references its engine's step template.
    const byName = Object.fromEntries(testTasks.map((t) => [t.name, t]));
    expect(byName[testNodeName('api/login')]!.templateRef).toEqual({
      name: stepTemplateName('robotframework'),
      template: 'run-test',
    });
  });

  it('throttles fan-out with workflow parallelism and isolates failures', () => {
    expect(wfSpec.parallelism).toBe(5);
    expect(dag.failFast).toBe(false);
  });

  it('always runs the aggregation step after all tests finish', () => {
    const aggregate = dag.tasks.find((t) => t.name === 'aggregate')!;
    const depends = String(aggregate.depends);
    for (const task of Object.keys(testMap)) {
      expect(depends).toContain(`${task}.Succeeded || ${task}.Failed || ${task}.Errored`);
    }
  });

  it('stores the node → test mapping as an annotation for the watcher', () => {
    const annotation = manifest.metadata.annotations as Record<string, string>;
    expect(JSON.parse(annotation['testcampaignshooter.io/test-map']!)).toEqual(testMap);
  });

  it('wires the callback URL into the aggregation step', () => {
    const aggregate = wfSpec.templates.find((t) => t.name === 'aggregate') as unknown as {
      script: { env: Array<{ name: string; value: string }> };
    };
    expect(aggregate.script.env).toContainEqual({
      name: 'CALLBACK_URL',
      value: 'http://server:4000/api/internal/runs/RuN_42/results',
    });
  });

  it('rejects local sources (unreachable from cluster pods)', () => {
    const bad = { ...spec(), source: { type: 'local' as const, path: '/tmp/tests' } };
    expect(() => buildWorkflow(bad, config)).toThrow(/git tests source/);
  });
});

describe('buildCommandLine', () => {
  it('quotes command, env and workingDir into a single shell line', () => {
    const line = buildCommandLine({
      testId: 't',
      name: 't',
      engine: 'generic-node',
      file: 'a.spec.ts',
      execution: {
        image: 'node:22',
        command: ['npx', 'jest', "it's a file.ts"],
        junitPath: 'r.xml',
        timeoutSeconds: 60,
        env: { BASE_URL: 'http://x' },
        workingDir: 'sub dir',
      },
      metadata: { engine: 'generic-node', execution: {} },
    });
    expect(line).toBe(
      `export BASE_URL='http://x'; cd 'sub dir' && 'npx' 'jest' 'it'\\''s a file.ts'`,
    );
  });
});

describe('step templates registry', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tcs-steps-'));
    await writeFile(
      path.join(dir, 'step-cypress.yaml'),
      [
        'apiVersion: argoproj.io/v1alpha1',
        'kind: WorkflowTemplate',
        'metadata:',
        `  name: ${stepTemplateName('cypress')}`,
        '  labels:',
        '    hand-written: "yes"',
        'spec:',
        '  templates:',
        '    - name: run-test',
      ].join('\n'),
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('generates a default template per engine with the shared contract', () => {
    const manifest = generateEngineStepTemplate('cypress');
    expect(manifest.metadata.name).toBe('tcs-step-cypress');
    const template = (manifest.spec.templates as Array<Record<string, unknown>>)[0]!;
    expect(template.name).toBe('run-test');
    const params = (template.inputs as { parameters: Array<{ name: string }> }).parameters.map(
      (p) => p.name,
    );
    expect(params).toEqual(['test-id', 'test-file', 'image', 'command', 'junit-path', 'timeout-seconds']);
  });

  it('lets hand-written step files override generated ones without touching others', async () => {
    const resolved = await resolveStepTemplates(['cypress', 'robotframework'], dir);
    expect(resolved.get('cypress')?.metadata.labels?.['hand-written']).toBe('yes');
    expect(resolved.get('robotframework')?.metadata.labels?.['testcampaignshooter.io/generated']).toBe(
      'true',
    );
  });
});
