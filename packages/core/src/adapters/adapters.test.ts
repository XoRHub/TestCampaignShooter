import { describe, expect, it } from 'vitest';
import type { DiscoveredTest } from '@tcs/shared-types';
import {
  AdapterValidationError,
  getAdapter,
  knownEngines,
  requireAdapter,
  resolveExecution,
  registerAdapter,
} from './index.js';

function makeTest(engine: string, execution: Record<string, unknown> = {}): DiscoveredTest {
  const file =
    engine === 'robotframework' ? 'suites/api/login.robot' : 'suites/checkout/smoke.cy.ts';
  return {
    id: `${engine}-test`,
    name: `${engine} test`,
    engine,
    file,
    metadataFile: `${file}.metadata.json`,
    metadata: { engine, execution },
  };
}

describe('adapter registry', () => {
  it('registers the 7 built-in engines', () => {
    expect(knownEngines()).toEqual([
      'cypress',
      'generic-java',
      'generic-node',
      'generic-python',
      'protractor',
      'robotframework',
      'selenium',
    ]);
  });

  it('rejects duplicate registrations', () => {
    expect(() => registerAdapter(requireAdapter('cypress'))).toThrow(/already registered/);
  });

  it('requireAdapter throws a clear error for unknown engines', () => {
    expect(getAdapter('nope')).toBeUndefined();
    expect(() => requireAdapter('nope')).toThrow(/No adapter registered for engine "nope"/);
  });

  it('marks protractor as deprecated', () => {
    expect(requireAdapter('protractor').deprecated?.reason).toMatch(/end-of-life/);
  });
});

describe('resolveExecution', () => {
  it('applies engine defaults and substitutes placeholders', () => {
    const resolved = resolveExecution(requireAdapter('cypress'), makeTest('cypress'));
    expect(resolved.image).toBe('cypress/included:13.17.0');
    expect(resolved.command).toContain('suites/checkout/smoke.cy.ts');
    expect(resolved.junitPath).toBe('results/junit.xml');
    expect(resolved.timeoutSeconds).toBe(1800);
  });

  it('lets metadata override every default', () => {
    const resolved = resolveExecution(
      requireAdapter('cypress'),
      makeTest('cypress', {
        image: 'cypress/included:14.0.0',
        command: ['npx', 'cypress', 'run', '--spec', '{{testFile}}'],
        junitPath: 'out/report.xml',
        timeoutSeconds: 60,
        env: { BASE_URL: 'http://staging' },
      }),
    );
    expect(resolved.image).toBe('cypress/included:14.0.0');
    expect(resolved.command).toEqual(['npx', 'cypress', 'run', '--spec', 'suites/checkout/smoke.cy.ts']);
    expect(resolved.junitPath).toBe('out/report.xml');
    expect(resolved.timeoutSeconds).toBe(60);
    expect(resolved.env).toEqual({ BASE_URL: 'http://staging' });
  });

  it('requires an explicit command for generic runners and selenium', () => {
    for (const engine of ['generic-java', 'generic-node', 'generic-python', 'selenium']) {
      expect(() => resolveExecution(requireAdapter(engine), makeTest(engine))).toThrow(
        AdapterValidationError,
      );
      expect(() =>
        resolveExecution(requireAdapter(engine), makeTest(engine, { command: ['echo', 'ok'] })),
      ).not.toThrow();
    }
  });

  it('validates robot framework file extensions', () => {
    const bad = { ...makeTest('robotframework'), file: 'suites/x.py' };
    expect(() => resolveExecution(requireAdapter('robotframework'), bad)).toThrow(/\.robot/);
  });
});
