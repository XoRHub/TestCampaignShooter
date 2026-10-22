import type {
  CampaignExecutionSpec,
  OrchestrationEvent,
  RunHandle,
  RunStateEvent,
  TestStateEvent,
} from '@tcs/shared-types';

/** Current snapshot of a run: overall phase plus the normalized state of every test. */
export interface RunSnapshot {
  run: RunStateEvent;
  tests: TestStateEvent[];
}

export interface ArtifactRef {
  name: string;
  /** Provider-relative locator (e.g. S3 key); resolved to a URL by the server. */
  key: string;
}

/**
 * The orchestration abstraction. Everything the rest of the application knows
 * about running campaigns goes through this interface — no Argo/Kubernetes
 * type ever leaks outside a provider implementation.
 *
 * Adding an orchestrator (Tekton, Temporal, ...) = implementing this
 * interface in its own package and calling `registerProviderFactory`.
 */
export interface OrchestrationProvider {
  readonly name: string;

  /** Submits one campaign run. Returns an opaque handle used by every other call. */
  submit(spec: CampaignExecutionSpec): Promise<RunHandle>;

  /**
   * Watches a run until it reaches a terminal phase (or `signal` aborts),
   * emitting normalized run/test state events.
   */
  watch(
    handle: RunHandle,
    onEvent: (event: OrchestrationEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;

  /** One-shot state snapshot (used to hydrate late subscribers and pollers). */
  getState(handle: RunHandle): Promise<RunSnapshot>;

  /**
   * Re-executes failed tests only (all of them, or the given subset) without
   * re-running successful ones. Returns the handle tracking the retried run.
   */
  retryFailed(handle: RunHandle, testIds?: string[]): Promise<RunHandle>;

  /** Cancels a running campaign. */
  cancel(handle: RunHandle): Promise<void>;

  /** Full logs of one test node. */
  getLogs(handle: RunHandle, testId: string): Promise<string>;

  /** Live log streaming of one test node (optional capability). */
  streamLogs?(
    handle: RunHandle,
    testId: string,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<void>;

  /** Artifacts produced by the run (aggregated JUnit, per-test outputs...). */
  getArtifacts(handle: RunHandle): Promise<ArtifactRef[]>;
}

export type ProviderFactory = (config: Record<string, string | undefined>) => OrchestrationProvider;

const factories = new Map<string, ProviderFactory>();

export function registerProviderFactory(name: string, factory: ProviderFactory): void {
  if (factories.has(name)) {
    throw new Error(`Orchestration provider "${name}" is already registered`);
  }
  factories.set(name, factory);
}

export function listProviderNames(): string[] {
  return [...factories.keys()].sort();
}

/**
 * Instantiates the provider selected by name (typically the
 * `ORCHESTRATION_PROVIDER` env var), passing it its configuration.
 */
export function createProvider(
  name: string,
  config: Record<string, string | undefined> = process.env,
): OrchestrationProvider {
  const factory = factories.get(name);
  if (!factory) {
    throw new Error(
      `Unknown orchestration provider "${name}" (registered: ${listProviderNames().join(', ') || 'none'})`,
    );
  }
  return factory(config);
}
