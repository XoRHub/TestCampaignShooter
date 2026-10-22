import { parse as parseYaml } from 'yaml';
import { adapterManifestSchema, type EngineManifestEntry } from '@tcs/shared-types';
import type { DiscoveredTest } from '@tcs/shared-types';
import type { EngineAdapter } from './types.js';
import { substitutePlaceholders } from './types.js';

/** Turns one declarative manifest entry into a runtime `EngineAdapter`. */
export function engineManifestEntryToAdapter(entry: EngineManifestEntry): EngineAdapter {
  const rules = entry.validate ?? {};
  return {
    engine: entry.engine,
    displayName: entry.displayName,
    defaultImage: entry.defaultImage,
    defaultJunitPath: entry.defaultJunitPath,
    deprecated: entry.deprecated ?? undefined,
    validate(test: DiscoveredTest): string[] {
      const errors: string[] = [];
      if (rules.requireExecutionCommand && !test.metadata.execution.command) {
        errors.push(`engine "${entry.engine}" tests must declare "execution.command"`);
      }
      const extensions = rules.requireFileExtension
        ? Array.isArray(rules.requireFileExtension)
          ? rules.requireFileExtension
          : [rules.requireFileExtension]
        : undefined;
      if (extensions && !extensions.some((ext) => test.file.endsWith(ext))) {
        errors.push(
          `engine "${entry.engine}" tests must have one of these extensions: ${extensions.join(', ')} (got "${test.file}")`,
        );
      }
      return errors;
    },
    defaultCommand: entry.defaultCommand
      ? (test: DiscoveredTest) => substitutePlaceholders(entry.defaultCommand!, test)
      : undefined,
  };
}

export class AdapterManifestParseError extends Error {
  constructor(message: string) {
    super(`invalid adapter manifest: ${message}`);
  }
}

/**
 * Parses raw manifest content (JSON or YAML — `yaml` parses both) into a list
 * of runtime adapters. Purely declarative: no code from the manifest is ever
 * executed, only data mapped onto the same `EngineAdapter` contract every
 * built-in engine already implements.
 */
export function parseAdapterManifest(raw: string): EngineAdapter[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new AdapterManifestParseError(`not valid YAML/JSON (${(err as Error).message})`);
  }
  const result = adapterManifestSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new AdapterManifestParseError(details);
  }
  return result.data.engines.map(engineManifestEntryToAdapter);
}
