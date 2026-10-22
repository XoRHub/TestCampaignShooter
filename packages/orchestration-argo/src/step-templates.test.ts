import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  generateEngineStepTemplate,
  loadManualStepTemplates,
  resolveStepTemplates,
} from './step-templates.js';

describe('generateEngineStepTemplate', () => {
  it('builds a WorkflowTemplate honoring the shared step contract', () => {
    const manifest = generateEngineStepTemplate('cypress');
    expect(manifest.kind).toBe('WorkflowTemplate');
    expect(manifest.metadata.name).toBe('tcs-step-cypress');
    expect(manifest.metadata.labels).toMatchObject({
      'testcampaignshooter.io/engine': 'cypress',
      'app.kubernetes.io/part-of': 'testcampaignshooter',
    });
    const template = (manifest.spec.templates as Record<string, unknown>[])[0]!;
    const inputParamNames = (template.inputs as { parameters: { name: string }[] }).parameters.map(
      (p) => p.name,
    );
    expect(inputParamNames).toEqual([
      'test-id',
      'test-file',
      'image',
      'command',
      'junit-path',
      'timeout-seconds',
    ]);
  });
});

describe('loadManualStepTemplates', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tcs-step-templates-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty map when the directory does not exist', async () => {
    const manual = await loadManualStepTemplates(path.join(dir, 'missing'));
    expect(manual.size).toBe(0);
  });

  it('loads one WorkflowTemplate per step-<engine>.yaml file', async () => {
    await writeFile(
      path.join(dir, 'step-robotframework.yaml'),
      'apiVersion: argoproj.io/v1alpha1\nkind: WorkflowTemplate\nmetadata:\n  name: custom-robot\nspec: {}\n',
    );
    await writeFile(path.join(dir, 'not-a-step-file.yaml'), 'kind: WorkflowTemplate\n');

    const manual = await loadManualStepTemplates(dir);
    expect([...manual.keys()]).toEqual(['robotframework']);
    expect(manual.get('robotframework')?.metadata.name).toBe('custom-robot');
  });

  it('throws when a step-<engine>.yaml file is not a WorkflowTemplate', async () => {
    await writeFile(path.join(dir, 'step-selenium.yaml'), 'kind: Pod\nmetadata:\n  name: x\nspec: {}\n');

    await expect(loadManualStepTemplates(dir)).rejects.toThrow(/expected a WorkflowTemplate/);
  });
});

describe('resolveStepTemplates', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tcs-resolve-templates-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('prefers a hand-written template over the generated one for the same engine', async () => {
    await writeFile(
      path.join(dir, 'step-cypress.yaml'),
      'apiVersion: argoproj.io/v1alpha1\nkind: WorkflowTemplate\nmetadata:\n  name: hand-written-cypress\nspec: {}\n',
    );

    const resolved = await resolveStepTemplates(['cypress', 'selenium'], dir);
    expect(resolved.get('cypress')?.metadata.name).toBe('hand-written-cypress');
    expect(resolved.get('selenium')?.metadata.name).toBe('tcs-step-selenium');
  });

  it('deduplicates engines appearing more than once', async () => {
    const resolved = await resolveStepTemplates(['cypress', 'cypress', 'selenium'], dir);
    expect(resolved.size).toBe(2);
  });
});
