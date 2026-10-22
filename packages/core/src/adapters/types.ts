import type { DiscoveredTest, ResolvedExecution } from '@tcs/shared-types';

export const DEFAULT_TIMEOUT_SECONDS = 1800;

/**
 * An engine adapter knows how to turn a discovered test (and its metadata)
 * into a concrete container execution producing a JUnit XML report.
 *
 * Adding an engine = adding one file implementing this interface and
 * registering it in `adapters/index.ts` (see docs/technical.md).
 */
export interface EngineAdapter {
  /** Identifier referenced by `metadata.engine` and by Argo step templates. */
  readonly engine: string;
  readonly displayName: string;
  /** Image used when the metadata does not override `execution.image`. */
  readonly defaultImage: string;
  /** JUnit path (file or glob) used when the metadata does not override it. */
  readonly defaultJunitPath: string;
  /** Set for engines kept for compatibility but not recommended (e.g. Protractor). */
  readonly deprecated?: { reason: string };
  /** Returns engine-specific validation errors for this test (empty = valid). */
  validate(test: DiscoveredTest): string[];
  /** Default command when the metadata does not provide one (undefined = command required). */
  defaultCommand?(test: DiscoveredTest): string[];
}

export class AdapterValidationError extends Error {
  constructor(
    public readonly testId: string,
    public readonly errors: string[],
  ) {
    super(`Test "${testId}" is not executable: ${errors.join('; ')}`);
  }
}

/** Replaces supported placeholders (`{{testFile}}`, `{{testId}}`) in a command. */
export function substitutePlaceholders(command: string[], test: DiscoveredTest): string[] {
  return command.map((part) =>
    part.replaceAll('{{testFile}}', test.file).replaceAll('{{testId}}', test.id),
  );
}

/**
 * Shared resolution logic: metadata `execution` overrides adapter defaults.
 * Throws {@link AdapterValidationError} when the test cannot be executed.
 */
export function resolveExecution(adapter: EngineAdapter, test: DiscoveredTest): ResolvedExecution {
  const errors = adapter.validate(test);
  const exec = test.metadata.execution;
  const command = exec.command ?? adapter.defaultCommand?.(test);
  if (!command) {
    errors.push(`engine "${adapter.engine}" requires an explicit "execution.command"`);
  }
  if (errors.length > 0) {
    throw new AdapterValidationError(test.id, errors);
  }
  return {
    image: exec.image ?? adapter.defaultImage,
    command: substitutePlaceholders(command!, test),
    junitPath: exec.junitPath ?? adapter.defaultJunitPath,
    timeoutSeconds: exec.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
    env: exec.env ?? {},
    resources: exec.resources,
    workingDir: exec.workingDir,
  };
}
