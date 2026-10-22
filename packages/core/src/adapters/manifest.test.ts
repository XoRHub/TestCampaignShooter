import { afterEach, describe, expect, it } from 'vitest';
import type { DiscoveredTest } from '@tcs/shared-types';
import {
  AdapterManifestParseError,
  getAdapter,
  installAdapter,
  knownEngines,
  originOf,
  parseAdapterManifest,
  requireAdapter,
  requireAdapterWithOverrides,
  uninstallInstanceAdapters,
} from './index.js';

function makeTest(engine: string, file: string, execution: Record<string, unknown> = {}): DiscoveredTest {
  return {
    id: `${engine}-test`,
    name: `${engine} test`,
    engine,
    file,
    metadataFile: `${file}.metadata.json`,
    metadata: { engine, execution },
  };
}

const validYaml = `
apiVersion: tcs.io/v1
kind: AdapterManifest
engines:
  - engine: playwright
    displayName: Playwright (Node)
    defaultImage: mcr.microsoft.com/playwright:v1.48.0-noble
    defaultJunitPath: results/junit.xml
    defaultCommand: [npx, playwright, test, '{{testFile}}', --reporter=junit]
  - engine: needs-command
    displayName: Needs an explicit command
    defaultImage: node:22-slim
    defaultJunitPath: results/junit.xml
    validate:
      requireExecutionCommand: true
  - engine: needs-extension
    displayName: Needs a specific file extension
    defaultImage: node:22-slim
    defaultJunitPath: results/junit.xml
    validate:
      requireFileExtension: ['.feature', '.story']
`;

describe('parseAdapterManifest', () => {
  it('parses a valid YAML manifest into runtime adapters', () => {
    const adapters = parseAdapterManifest(validYaml);
    expect(adapters.map((a) => a.engine)).toEqual(['playwright', 'needs-command', 'needs-extension']);
  });

  it('also parses plain JSON (yaml is a JSON superset)', () => {
    const json = JSON.stringify({
      apiVersion: 'tcs.io/v1',
      kind: 'AdapterManifest',
      engines: [
        {
          engine: 'cucumber',
          displayName: 'Cucumber',
          defaultImage: 'node:22-slim',
          defaultJunitPath: 'results/junit.xml',
        },
      ],
    });
    expect(parseAdapterManifest(json).map((a) => a.engine)).toEqual(['cucumber']);
  });

  it('rejects malformed YAML/JSON', () => {
    expect(() => parseAdapterManifest('{ not: [valid')).toThrow(AdapterManifestParseError);
  });

  it('rejects a manifest with the wrong apiVersion/kind', () => {
    expect(() => parseAdapterManifest('apiVersion: v2\nkind: AdapterManifest\nengines: []')).toThrow(
      AdapterManifestParseError,
    );
  });

  it('rejects an engine entry missing required fields', () => {
    const bad = `
apiVersion: tcs.io/v1
kind: AdapterManifest
engines:
  - engine: incomplete
`;
    expect(() => parseAdapterManifest(bad)).toThrow(/displayName/);
  });

  it('produced adapters apply declarative validation rules', () => {
    const [playwright, needsCommand, needsExtension] = parseAdapterManifest(validYaml);

    // playwright: no rules, has a defaultCommand with placeholder substitution.
    expect(playwright!.validate(makeTest('playwright', 'e2e/login.spec.ts'))).toEqual([]);
    expect(playwright!.defaultCommand!(makeTest('playwright', 'e2e/login.spec.ts'))).toEqual([
      'npx',
      'playwright',
      'test',
      'e2e/login.spec.ts',
      '--reporter=junit',
    ]);

    // requireExecutionCommand
    expect(needsCommand!.validate(makeTest('needs-command', 'x.ts'))).toEqual([
      'engine "needs-command" tests must declare "execution.command"',
    ]);
    expect(needsCommand!.validate(makeTest('needs-command', 'x.ts', { command: ['echo'] }))).toEqual([]);

    // requireFileExtension (array form)
    expect(needsExtension!.validate(makeTest('needs-extension', 'a.py'))[0]).toMatch(/\.feature, \.story/);
    expect(needsExtension!.validate(makeTest('needs-extension', 'a.feature'))).toEqual([]);
  });
});

describe('registry install/override tier', () => {
  afterEach(() => uninstallInstanceAdapters());

  it('installAdapter shadows a built-in engine and is visible via getAdapter/knownEngines', () => {
    const [override] = parseAdapterManifest(`
apiVersion: tcs.io/v1
kind: AdapterManifest
engines:
  - engine: cypress
    displayName: Cypress (custom pin)
    defaultImage: cypress/included:14.0.0
    defaultJunitPath: results/junit.xml
`);
    expect(getAdapter('cypress')!.defaultImage).toBe('cypress/included:13.17.0');

    installAdapter(override!, 'https://plugins.example.com/manifest.yaml');

    expect(getAdapter('cypress')!.defaultImage).toBe('cypress/included:14.0.0');
    expect(requireAdapter('cypress').defaultImage).toBe('cypress/included:14.0.0');
    expect(originOf('cypress')).toBe('https://plugins.example.com/manifest.yaml');
    expect(knownEngines()).toContain('cypress'); // no duplicate entry
  });

  it('installAdapter can also add a brand new engine unknown to the built-ins', () => {
    const [entry] = parseAdapterManifest(validYaml);
    installAdapter(entry!, 'https://plugins.example.com/manifest.yaml');
    expect(originOf('playwright')).toBe('https://plugins.example.com/manifest.yaml');
    expect(knownEngines()).toContain('playwright');
  });

  it('uninstallInstanceAdapters reverts to built-ins / removes purely-installed engines', () => {
    const [cypressOverride, playwright] = parseAdapterManifest(
      validYaml.replace('engine: playwright', 'engine: cypress'),
    );
    installAdapter(cypressOverride!, 'https://a.example.com');
    installAdapter(playwright!, 'https://a.example.com');
    expect(originOf('cypress')).toBe('https://a.example.com');

    uninstallInstanceAdapters();

    expect(originOf('cypress')).toBe('built-in');
    expect(getAdapter('needs-command')).toBeUndefined();
  });

  it('originOf returns undefined for a totally unknown engine', () => {
    expect(originOf('does-not-exist')).toBeUndefined();
  });
});

describe('requireAdapterWithOverrides', () => {
  afterEach(() => uninstallInstanceAdapters());

  it('a per-run override takes precedence over the instance registry without mutating it', () => {
    const [runOverride] = parseAdapterManifest(`
apiVersion: tcs.io/v1
kind: AdapterManifest
engines:
  - engine: cypress
    displayName: Cypress (campaign-pinned)
    defaultImage: cypress/included:12.0.0
    defaultJunitPath: results/junit.xml
`);
    const overrides = new Map([['cypress', runOverride!]]);

    expect(requireAdapterWithOverrides('cypress', overrides).defaultImage).toBe('cypress/included:12.0.0');
    // The shared registry is untouched — a concurrent run without overrides
    // (or a later call in this same test) still sees the built-in.
    expect(getAdapter('cypress')!.defaultImage).toBe('cypress/included:13.17.0');
  });

  it('falls back to the instance registry when the engine has no override', () => {
    expect(requireAdapterWithOverrides('cypress', new Map()).defaultImage).toBe('cypress/included:13.17.0');
  });

  it('throws the same clear error as requireAdapter for a totally unknown engine', () => {
    expect(() => requireAdapterWithOverrides('nope', new Map())).toThrow(
      /No adapter registered for engine "nope"/,
    );
  });
});
