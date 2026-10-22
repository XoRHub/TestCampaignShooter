import { describe, expect, it } from 'vitest';
import path from 'node:path';
import type { TestExecutionSnapshot } from '@tcs/shared-types';
import { buildDockerRunArgs, toDockerCpus, toDockerMemory } from './runtimes.js';
import { createProvider, listProviderNames } from '../index.js';

function snapshot(overrides: Partial<TestExecutionSnapshot['execution']> = {}): TestExecutionSnapshot {
  return {
    testId: 'checkout/smoke',
    name: 'Checkout smoke',
    engine: 'cypress',
    file: 'suites/checkout/smoke.cy.js',
    execution: {
      image: 'cypress/included:13.17.0',
      command: ['npx', 'cypress', 'run', '--spec', 'suites/checkout/smoke.cy.js'],
      junitPath: 'results/junit.xml',
      timeoutSeconds: 600,
      env: { BASE_URL: 'http://staging' },
      ...overrides,
    },
    metadata: { engine: 'cypress', execution: {} },
  };
}

describe('docker provider registration', () => {
  it('exposes both local runtimes as providers', () => {
    expect(listProviderNames()).toEqual(expect.arrayContaining(['docker', 'local']));
    expect(createProvider('docker').name).toBe('docker');
    expect(createProvider('local').name).toBe('local');
  });
});

describe('buildDockerRunArgs', () => {
  it('encapsulates the test in its metadata image with the workspace mounted', () => {
    const args = buildDockerRunArgs(snapshot(), '/tmp/ws/nodes/checkout_smoke', 'tcs-abc');
    expect(args.slice(0, 4)).toEqual(['run', '--rm', '--name', 'tcs-abc']);
    expect(args).toContain(`${path.resolve('/tmp/ws/nodes/checkout_smoke')}:/workspace`);
    expect(args).toContain('-w');
    expect(args[args.indexOf('-w') + 1]).toBe('/workspace');
    expect(args).toContain('BASE_URL=http://staging');
    // image then the command, verbatim (no shell wrapping needed)
    const imageIndex = args.indexOf('cypress/included:13.17.0');
    expect(imageIndex).toBeGreaterThan(0);
    expect(args.slice(imageIndex + 1)).toEqual([
      'npx',
      'cypress',
      'run',
      '--spec',
      'suites/checkout/smoke.cy.js',
    ]);
  });

  it('maps workingDir and k8s-style resources to docker flags', () => {
    const args = buildDockerRunArgs(
      snapshot({ workingDir: 'sub\\dir', resources: { cpu: '500m', memory: '1Gi' } }),
      '/tmp/ws/n1',
      'tcs-x',
    );
    expect(args[args.indexOf('-w') + 1]).toBe('/workspace/sub/dir');
    expect(args[args.indexOf('--cpus') + 1]).toBe('0.5');
    expect(args[args.indexOf('--memory') + 1]).toBe('1g');
  });
});

describe('resource conversions', () => {
  it('converts cpu millicores', () => {
    expect(toDockerCpus('500m')).toBe('0.5');
    expect(toDockerCpus('2')).toBe('2');
    expect(toDockerCpus('1500m')).toBe('1.5');
  });

  it('converts kubernetes memory quantities', () => {
    expect(toDockerMemory('512Mi')).toBe('512m');
    expect(toDockerMemory('1Gi')).toBe('1g');
    expect(toDockerMemory('1G')).toBe('1g');
    expect(toDockerMemory('64Ki')).toBe('64k');
    expect(toDockerMemory('128')).toBe('128b');
  });
});
