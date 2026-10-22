import { describe, expect, it } from 'vitest';
import type { EngineAdapter } from './types.js';
import {
  getAdapter,
  installAdapter,
  knownEngines,
  listAdapters,
  originOf,
  registerAdapter,
  requireAdapter,
  requireAdapterWithOverrides,
  uninstallInstanceAdapters,
} from './registry.js';

function fakeAdapter(engine: string, displayName: string = engine): EngineAdapter {
  return {
    engine,
    displayName,
    defaultImage: `${engine}:latest`,
    defaultJunitPath: 'results/junit.xml',
    validate: () => [],
  };
}

describe('adapter registry (two-tier: builtins + installed)', () => {
  it('starts empty', () => {
    expect(knownEngines()).toEqual([]);
    expect(getAdapter('foo')).toBeUndefined();
  });

  it('registers built-ins and rejects duplicates', () => {
    registerAdapter(fakeAdapter('alpha'));
    expect(knownEngines()).toEqual(['alpha']);
    expect(() => registerAdapter(fakeAdapter('alpha'))).toThrow(/already registered/);
  });

  it('requireAdapter throws a clear error listing known engines', () => {
    expect(() => requireAdapter('nope')).toThrow(/No adapter registered for engine "nope"/);
    expect(() => requireAdapter('nope')).toThrow(/alpha/);
  });

  it('installAdapter shadows a built-in of the same id without touching it', () => {
    const overridden = fakeAdapter('alpha', 'Alpha (overridden)');
    installAdapter(overridden, 'https://example.test/manifest.json');

    expect(getAdapter('alpha')).toBe(overridden);
    expect(originOf('alpha')).toBe('https://example.test/manifest.json');
  });

  it('installAdapter can also add a brand new engine not built in', () => {
    installAdapter(fakeAdapter('beta'), 'https://example.test/manifest.json');
    expect(knownEngines()).toEqual(['alpha', 'beta']);
    expect(originOf('beta')).toBe('https://example.test/manifest.json');
  });

  it('originOf reports "built-in" for an unshadowed built-in, undefined for unknown engines', () => {
    registerAdapter(fakeAdapter('gamma'));
    expect(originOf('gamma')).toBe('built-in');
    expect(originOf('nope')).toBeUndefined();
  });

  it('uninstallInstanceAdapters clears installed engines but keeps built-ins', () => {
    uninstallInstanceAdapters();
    expect(getAdapter('alpha')).toBeDefined();
    expect(getAdapter('alpha')?.displayName).toBe('alpha'); // back to the built-in, not the override
    expect(getAdapter('beta')).toBeUndefined();
    expect(originOf('alpha')).toBe('built-in');
  });

  it('listAdapters is sorted by engine name', () => {
    expect(listAdapters().map((a) => a.engine)).toEqual(['alpha', 'gamma']);
  });

  describe('requireAdapterWithOverrides', () => {
    it('prefers the run-scoped override over the shared registry', () => {
      const override = fakeAdapter('alpha', 'Alpha (run override)');
      const overrides = new Map([['alpha', override]]);

      expect(requireAdapterWithOverrides('alpha', overrides)).toBe(override);
      // The shared registry itself is untouched by the override map.
      expect(getAdapter('alpha')?.displayName).toBe('alpha');
    });

    it('falls back to the shared registry when no override is given for that engine', () => {
      const resolved = requireAdapterWithOverrides('gamma', new Map());
      expect(resolved.engine).toBe('gamma');
    });

    it('throws for an engine unknown to both the overrides and the shared registry', () => {
      expect(() => requireAdapterWithOverrides('nope', new Map())).toThrow(
        /No adapter registered for engine "nope"/,
      );
    });
  });
});
