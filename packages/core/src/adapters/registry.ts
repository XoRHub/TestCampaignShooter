import type { EngineAdapter } from './types.js';

/** Compiled-in engines, registered once at import time (`adapters/index.ts`). */
const builtins = new Map<string, EngineAdapter>();

/**
 * Engines installed at runtime from an instance-level adapter manifest
 * (admin-managed — see `docs/adapter-plugins.md`). Shadows a built-in of the
 * same id if present. Rebuilt wholesale on every admin reload
 * (`uninstallInstanceAdapters` then re-`installAdapter` each enabled
 * manifest) rather than diffed, since the expected count is small.
 */
const installed = new Map<string, { adapter: EngineAdapter; origin: string }>();

export function registerAdapter(adapter: EngineAdapter): void {
  if (builtins.has(adapter.engine)) {
    throw new Error(`Engine adapter "${adapter.engine}" is already registered`);
  }
  builtins.set(adapter.engine, adapter);
}

/**
 * Installs (or overwrites) an engine from an instance-level manifest. Unlike
 * `registerAdapter`, silently shadows any existing engine (built-in or
 * previously installed) — the caller is expected to log when that happens
 * (it has the manifest URL for a useful message; this module doesn't).
 */
export function installAdapter(adapter: EngineAdapter, origin: string): void {
  installed.set(adapter.engine, { adapter, origin });
}

/** Clears every instance-installed engine (built-ins are untouched). Used before a full reload. */
export function uninstallInstanceAdapters(): void {
  installed.clear();
}

/** Where an engine's definition currently comes from, or `undefined` if unknown. */
export function originOf(engine: string): string | undefined {
  const install = installed.get(engine);
  if (install) return install.origin;
  return builtins.has(engine) ? 'built-in' : undefined;
}

export function getAdapter(engine: string): EngineAdapter | undefined {
  return installed.get(engine)?.adapter ?? builtins.get(engine);
}

export function requireAdapter(engine: string): EngineAdapter {
  const adapter = getAdapter(engine);
  if (!adapter) {
    throw new Error(`No adapter registered for engine "${engine}" (known: ${knownEngines().join(', ')})`);
  }
  return adapter;
}

/**
 * Resolves an engine honoring a run-scoped override map first (built from a
 * campaign's `adapterManifestUrl`, resolved once at launch time — see
 * `run-service.ts`). Never touches the shared instance/built-in registry, so
 * concurrent runs of different campaigns can't leak overrides into each
 * other.
 */
export function requireAdapterWithOverrides(
  engine: string,
  overrides: ReadonlyMap<string, EngineAdapter>,
): EngineAdapter {
  const adapter = overrides.get(engine) ?? getAdapter(engine);
  if (!adapter) {
    throw new Error(`No adapter registered for engine "${engine}" (known: ${knownEngines().join(', ')})`);
  }
  return adapter;
}

export function listAdapters(): EngineAdapter[] {
  const byEngine = new Map<string, EngineAdapter>();
  for (const [engine, adapter] of builtins) byEngine.set(engine, adapter);
  for (const [engine, { adapter }] of installed) byEngine.set(engine, adapter);
  return [...byEngine.values()].sort((a, b) => a.engine.localeCompare(b.engine));
}

export function knownEngines(): string[] {
  return listAdapters().map((a) => a.engine);
}
