import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type {
  CampaignExecutionSpec,
  OrchestrationEvent,
  RunHandle,
  RunPhase,
  RunProgress,
  RunStateEvent,
  TestExecutionSnapshot,
  TestNodeStatus,
  TestStateEvent,
} from '@tcs/shared-types';
import { TERMINAL_RUN_PHASES } from '@tcs/shared-types';
import { buildMergedJUnitXml, fetchSource } from '@tcs/core';
import type { ArtifactRef, OrchestrationProvider, RunSnapshot } from '../provider.js';
import { createRuntime, type TestRuntime } from './runtimes.js';

interface LocalTestState {
  snapshot: TestExecutionSnapshot;
  status: TestNodeStatus;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
  logs: string;
  junitXml?: string;
}

interface LocalRun {
  spec: CampaignExecutionSpec;
  phase: RunPhase;
  startedAt?: string;
  finishedAt?: string;
  tests: Map<string, LocalTestState>;
  listeners: Set<(event: OrchestrationEvent) => void>;
  logListeners: Map<string, Set<(chunk: string) => void>>;
  abort: AbortController;
}

export interface LocalProviderOptions {
  /** Provider name exposed to the registry ("local" or "docker"). */
  name?: string;
  /** Execution runtime; defaults to config LOCAL_PROVIDER_RUNTIME, else "process". */
  runtime?: 'process' | 'docker';
}

/**
 * Development/testing provider: runs each test on the local machine (no
 * cluster) while honouring the same contract as the Argo provider —
 * parallelism, per-test retry, logs, cancellation and aggregated JUnit
 * callback. Two execution runtimes are available:
 *
 * - `process` : commande exécutée en child process hôte (zéro dépendance) ;
 * - `docker`  : chaque test encapsulé dans **son image de conteneur**
 *   (`execution.image`, workspace monté sur /workspace) — l'équivalent local
 *   d'un pod Argo. Sélection via ORCHESTRATION_PROVIDER=docker ou
 *   LOCAL_PROVIDER_RUNTIME=docker.
 */
export class LocalProvider implements OrchestrationProvider {
  readonly name: string;
  private readonly runtime: TestRuntime;
  private readonly runs = new Map<string, LocalRun>();

  constructor(
    private readonly config: Record<string, string | undefined> = {},
    options: LocalProviderOptions = {},
  ) {
    const runtimeName =
      options.runtime ??
      (config.LOCAL_PROVIDER_RUNTIME === 'docker' ? 'docker' : 'process');
    this.runtime = createRuntime(runtimeName, config.LOCAL_PROVIDER_DOCKER_BIN);
    this.name = options.name ?? 'local';
  }

  async submit(spec: CampaignExecutionSpec): Promise<RunHandle> {
    const run: LocalRun = {
      spec,
      phase: 'pending',
      tests: new Map(
        spec.tests.map((t) => [t.testId, { snapshot: t, status: 'pending' as const, logs: '' }]),
      ),
      listeners: new Set(),
      logListeners: new Map(),
      abort: new AbortController(),
    };
    this.runs.set(spec.runId, run);
    void this.execute(run, [...run.tests.keys()]);
    return { provider: this.name, externalId: spec.runId };
  }

  async watch(
    handle: RunHandle,
    onEvent: (event: OrchestrationEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const run = this.getRun(handle);
    // Hydrate the subscriber with the current state before live events.
    for (const event of this.snapshotEvents(run)) onEvent(event);
    if (TERMINAL_RUN_PHASES.has(run.phase)) return;

    await new Promise<void>((resolve) => {
      const listener = (event: OrchestrationEvent) => {
        onEvent(event);
        if (event.type === 'run' && TERMINAL_RUN_PHASES.has(event.phase)) done();
      };
      const done = () => {
        run.listeners.delete(listener);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      run.listeners.add(listener);
      signal?.addEventListener('abort', done);
    });
  }

  async getState(handle: RunHandle): Promise<RunSnapshot> {
    const run = this.getRun(handle);
    return {
      run: this.runEvent(run),
      tests: [...run.tests.values()].map((t) => this.testEvent(run, t)),
    };
  }

  async retryFailed(handle: RunHandle, testIds?: string[]): Promise<RunHandle> {
    const run = this.getRun(handle);
    if (!TERMINAL_RUN_PHASES.has(run.phase)) {
      throw new Error(`Run ${handle.externalId} is still ${run.phase}; wait for it to finish`);
    }
    const retryable = [...run.tests.values()].filter(
      (t) =>
        (t.status === 'failed' || t.status === 'timeout' || t.status === 'cancelled') &&
        (!testIds || testIds.includes(t.snapshot.testId)),
    );
    if (retryable.length === 0) return handle;
    run.abort = new AbortController();
    for (const t of retryable) {
      t.status = 'pending';
      t.logs = '';
      t.junitXml = undefined;
      t.message = undefined;
    }
    run.phase = 'pending';
    run.finishedAt = undefined;
    void this.execute(run, retryable.map((t) => t.snapshot.testId));
    return handle;
  }

  async cancel(handle: RunHandle): Promise<void> {
    const run = this.getRun(handle);
    run.abort.abort();
  }

  async getLogs(handle: RunHandle, testId: string): Promise<string> {
    return this.getTest(handle, testId).logs;
  }

  async streamLogs(
    handle: RunHandle,
    testId: string,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const run = this.getRun(handle);
    const test = this.getTest(handle, testId);
    if (test.logs) onChunk(test.logs);
    if (TERMINAL_RUN_PHASES.has(run.phase) || test.status === 'succeeded' || test.status === 'failed') {
      return;
    }
    await new Promise<void>((resolve) => {
      let set = run.logListeners.get(testId);
      if (!set) run.logListeners.set(testId, (set = new Set()));
      const done = () => {
        set.delete(onChunk);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      set.add(onChunk);
      signal?.addEventListener('abort', done);
      run.listeners.add((event) => {
        if (event.type === 'test' && event.testId === testId && event.finishedAt) done();
        if (event.type === 'run' && TERMINAL_RUN_PHASES.has(event.phase)) done();
      });
    });
  }

  async getArtifacts(handle: RunHandle): Promise<ArtifactRef[]> {
    const run = this.getRun(handle);
    return [{ name: 'junit.xml', key: `local://${run.spec.runId}/junit.xml` }];
  }

  /** The merged JUnit document (exposed for tests and the CLI). */
  getMergedJUnit(handle: RunHandle): string {
    const run = this.getRun(handle);
    return this.mergeJUnit(run);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private getRun(handle: RunHandle): LocalRun {
    const run = this.runs.get(handle.externalId);
    if (!run) throw new Error(`Unknown local run "${handle.externalId}"`);
    return run;
  }

  private getTest(handle: RunHandle, testId: string): LocalTestState {
    const test = this.getRun(handle).tests.get(testId);
    if (!test) throw new Error(`Unknown test "${testId}" in run "${handle.externalId}"`);
    return test;
  }

  private emit(run: LocalRun, event: OrchestrationEvent): void {
    for (const listener of [...run.listeners]) listener(event);
  }

  private progress(run: LocalRun): RunProgress {
    const states = [...run.tests.values()].map((t) => t.status);
    return {
      total: states.length,
      pending: states.filter((s) => s === 'pending').length,
      running: states.filter((s) => s === 'running').length,
      succeeded: states.filter((s) => s === 'succeeded').length,
      failed: states.filter((s) => s === 'failed' || s === 'timeout' || s === 'cancelled').length,
    };
  }

  private runEvent(run: LocalRun): RunStateEvent {
    return {
      type: 'run',
      runId: run.spec.runId,
      phase: run.phase,
      progress: this.progress(run),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };
  }

  private testEvent(run: LocalRun, test: LocalTestState): TestStateEvent {
    return {
      type: 'test',
      runId: run.spec.runId,
      testId: test.snapshot.testId,
      status: test.status,
      startedAt: test.startedAt,
      finishedAt: test.finishedAt,
      message: test.message,
    };
  }

  private snapshotEvents(run: LocalRun): OrchestrationEvent[] {
    return [...[...run.tests.values()].map((t) => this.testEvent(run, t)), this.runEvent(run)];
  }

  private async execute(run: LocalRun, testIds: string[]): Promise<void> {
    run.phase = 'running';
    run.startedAt ??= new Date().toISOString();
    this.emit(run, this.runEvent(run));

    let source: { rootDir: string; cleanup: () => Promise<void> } | undefined;
    try {
      source = await fetchSource(run.spec.source, {
        workspaceBaseDir: this.config.LOCAL_PROVIDER_WORKSPACE_DIR,
      });
      const queue = [...testIds];
      const workers = Array.from(
        { length: Math.max(1, Math.min(run.spec.parallelism, queue.length)) },
        async () => {
          while (queue.length > 0 && !run.abort.signal.aborted) {
            const testId = queue.shift();
            if (testId) await this.runTest(run, run.tests.get(testId)!, source!.rootDir);
          }
        },
      );
      await Promise.all(workers);

      if (run.abort.signal.aborted) {
        for (const test of run.tests.values()) {
          if (test.status === 'pending' || test.status === 'running') {
            test.status = 'cancelled';
            this.emit(run, this.testEvent(run, test));
          }
        }
        run.phase = 'cancelled';
      } else {
        const failed = [...run.tests.values()].some((t) => t.status !== 'succeeded');
        run.phase = failed ? 'failed' : 'succeeded';
      }

      // Aggregation "step": merge partial reports and notify the server,
      // exactly like the Argo aggregation node does — even on failures.
      if (run.spec.resultsCallbackUrl) {
        await this.postResults(run).catch((err) => {
          run.phase = 'error';
          this.emit(run, { ...this.runEvent(run), message: `results callback failed: ${err}` });
        });
      }
    } catch (err) {
      run.phase = 'error';
      this.emit(run, { ...this.runEvent(run), message: (err as Error).message });
    } finally {
      run.finishedAt = new Date().toISOString();
      this.emit(run, this.runEvent(run));
      await source?.cleanup().catch(() => undefined);
    }
  }

  private async runTest(run: LocalRun, test: LocalTestState, rootDir: string): Promise<void> {
    const { execution } = test.snapshot;
    test.status = 'running';
    test.startedAt = new Date().toISOString();
    this.emit(run, this.testEvent(run, test));
    this.emit(run, this.runEvent(run));

    // Mirror Argo semantics: every test node gets its own isolated copy of
    // the source tree, so concurrent tests never clobber each other's
    // outputs (e.g. two engines writing the same results/junit.xml).
    const nodeDir = path.join(
      rootDir,
      '..',
      'nodes',
      test.snapshot.testId.replace(/[^a-zA-Z0-9.-]+/g, '_'),
    );
    await rm(nodeDir, { recursive: true, force: true });
    await mkdir(path.dirname(nodeDir), { recursive: true });
    await cp(rootDir, nodeDir, { recursive: true });

    const onOutput = (text: string) => {
      test.logs += text;
      for (const l of run.logListeners.get(test.snapshot.testId) ?? []) l(text);
    };
    const exitInfo = await this.runtime.run(test.snapshot, nodeDir, onOutput, run.abort.signal);

    test.finishedAt = new Date().toISOString();
    if (run.abort.signal.aborted) {
      test.status = 'cancelled';
    } else if (exitInfo.timedOut) {
      test.status = 'timeout';
      test.message = `timed out after ${execution.timeoutSeconds}s`;
    } else if (exitInfo.code === 0) {
      test.status = 'succeeded';
    } else {
      test.status = 'failed';
      test.message = `exit code ${exitInfo.code}`;
    }

    // JUnit path is relative to the working dir (host mount for docker).
    const junitBase = execution.workingDir ? path.join(nodeDir, execution.workingDir) : nodeDir;
    test.junitXml = await readFile(path.join(junitBase, execution.junitPath), 'utf8').catch(
      () => undefined,
    );
    this.emit(run, this.testEvent(run, test));
    this.emit(run, this.runEvent(run));
  }

  private mergeJUnit(run: LocalRun): string {
    const parts = [...run.tests.values()].map((t) => ({
      testId: t.snapshot.testId,
      xml:
        t.junitXml ??
        // Synthesize a minimal report for tests that produced none.
        `<testsuite name="${t.snapshot.testId}" tests="1" failures="${t.status === 'succeeded' ? 0 : 1}">
           <testcase name="${t.snapshot.name}" time="0">${
             t.status === 'succeeded' ? '' : `<failure message="${t.message ?? t.status}"/>`
           }</testcase>
         </testsuite>`,
    }));
    return buildMergedJUnitXml(parts);
  }

  private async postResults(run: LocalRun): Promise<void> {
    const response = await fetch(run.spec.resultsCallbackUrl!, {
      method: 'POST',
      headers: {
        'content-type': 'application/xml',
        'x-tcs-run-id': run.spec.runId,
        ...(run.spec.resultsCallbackToken ? { 'x-tcs-token': run.spec.resultsCallbackToken } : {}),
      },
      body: this.mergeJUnit(run),
    });
    if (!response.ok) {
      throw new Error(`callback returned HTTP ${response.status}`);
    }
  }
}
