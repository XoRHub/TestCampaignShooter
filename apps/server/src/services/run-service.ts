import type { Campaign, WorkflowRun } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type {
  CampaignExecutionSpec,
  OrchestrationEvent,
  RunHandle,
  SelectionRule,
  TestExecutionSnapshot,
  TestsSource,
} from '@tcs/shared-types';
import { TERMINAL_RUN_PHASES, type RunPhase } from '@tcs/shared-types';
import {
  AdapterManifestParseError,
  fetchManifest,
  ManifestFetchError,
  parseJUnitXml,
  requireAdapterWithOverrides,
  resolveExecution,
  type EngineAdapter,
} from '@tcs/core';
import { createProvider, type OrchestrationProvider, type RunSnapshot } from '@tcs/orchestration';
import type { AppConfig } from '../config.js';
import { fromJson, prisma, toJson } from '../prisma.js';
import type { RunEventBus } from '../events/bus.js';
import type { ArtifactStore } from '../storage/s3.js';
import type { BusinessMetricsPusher } from '../metrics/business.js';
import { activeWatchers, runsLaunched } from '../metrics/system.js';
import { previewSelection } from './discovery.js';
import { aggregateReportByTest } from './results.js';

export class RunService {
  private readonly provider: OrchestrationProvider;

  constructor(
    private readonly config: AppConfig,
    private readonly bus: RunEventBus,
    private readonly store: ArtifactStore,
    private readonly business: BusinessMetricsPusher,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.provider = createProvider(config.ORCHESTRATION_PROVIDER);
  }

  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Resolves a campaign's `adapterManifestUrl` (if set) into a per-run
   * engine override map — never mutates the shared instance registry (see
   * `requireAdapterWithOverrides` and docs/adapter-plugins.md §5). A
   * campaign that names a manifest must get exactly that manifest: a
   * fetch/parse failure fails the launch rather than silently falling back
   * to built-in/instance defaults.
   */
  private async resolveAdapterOverrides(
    campaign: Campaign,
  ): Promise<{ overrides: Map<string, EngineAdapter>; hash?: string }> {
    if (!campaign.adapterManifestUrl) return { overrides: new Map() };
    try {
      const { adapters, hash } = await fetchManifest(campaign.adapterManifestUrl);
      return { overrides: new Map(adapters.map((a) => [a.engine, a])), hash };
    } catch (err) {
      if (err instanceof ManifestFetchError || err instanceof AdapterManifestParseError) {
        throw Object.assign(new Error(`adapter manifest: ${err.message}`), { statusCode: 422 });
      }
      throw err;
    }
  }

  /** Launches a campaign: evaluates its selection rule now and snapshots the result. */
  async launch(
    campaign: Campaign,
    triggeredById: string,
    overrides: { parallelism?: number; revision?: string } = {},
  ): Promise<WorkflowRun> {
    const source = fromJson<TestsSource>(campaign.source, { type: 'local', path: '.' });
    if (overrides.revision && source.type === 'git') source.revision = overrides.revision;
    const rule = fromJson<SelectionRule>(campaign.selectionRule, { any: [] } as SelectionRule);

    const preview = await previewSelection(source, rule);
    if (preview.selected.length === 0) {
      throw Object.assign(new Error('The selection rule matches no test'), { statusCode: 422 });
    }
    const { overrides: adapterOverrides, hash } = await this.resolveAdapterOverrides(campaign);
    const snapshot: TestExecutionSnapshot[] = preview.selected.map((test) => ({
      testId: test.id,
      name: test.name,
      engine: test.engine,
      file: test.file,
      execution: resolveExecution(requireAdapterWithOverrides(test.engine, adapterOverrides), test),
      metadata: test.metadata,
    }));

    return this.submitRun(campaign, triggeredById, snapshot, source, overrides.parallelism, {
      adapterManifestUrl: campaign.adapterManifestUrl ?? undefined,
      adapterManifestHash: hash,
    });
  }

  /**
   * Replays a past run with the exact same tests (or parameter overrides).
   * The snapshot (`execution` per test) is already frozen — no adapter
   * resolution happens again, so the original run's manifest URL/hash
   * carry over unchanged (they describe exactly what produced this
   * snapshot, whether or not the campaign's field has since changed).
   */
  async replay(
    run: WorkflowRun & { campaign: Campaign },
    triggeredById: string,
    overrides: { parallelism?: number } = {},
  ): Promise<WorkflowRun> {
    const snapshot = fromJson<TestExecutionSnapshot[]>(run.testsSnapshot, []);
    const source = fromJson<TestsSource>(run.campaign.source, { type: 'local', path: '.' });
    return this.submitRun(
      run.campaign,
      triggeredById,
      snapshot,
      source,
      overrides.parallelism ?? run.parallelism,
      { adapterManifestUrl: run.adapterManifestUrl ?? undefined, adapterManifestHash: run.adapterManifestHash ?? undefined },
    );
  }

  private async submitRun(
    campaign: Campaign,
    triggeredById: string,
    snapshot: TestExecutionSnapshot[],
    source: TestsSource,
    parallelism?: number,
    adapterManifest: { adapterManifestUrl?: string; adapterManifestHash?: string } = {},
  ): Promise<WorkflowRun> {
    const run = await prisma.workflowRun.create({
      data: {
        campaignId: campaign.id,
        campaignVersion: campaign.version,
        status: 'pending',
        testsSnapshot: toJson(snapshot),
        adapterManifestUrl: adapterManifest.adapterManifestUrl,
        adapterManifestHash: adapterManifest.adapterManifestHash,
        provider: this.provider.name,
        parallelism: parallelism ?? campaign.parallelism,
        triggeredById,
      },
    });

    const spec: CampaignExecutionSpec = {
      runId: run.id,
      campaignId: campaign.id,
      campaignName: campaign.name,
      source,
      tests: snapshot,
      parallelism: run.parallelism,
      resultsCallbackUrl: `${this.config.PUBLIC_BASE_URL}/api/internal/runs/${run.id}/results`,
      resultsCallbackToken: this.config.INTERNAL_CALLBACK_TOKEN,
    };

    try {
      const handle = await this.provider.submit(spec);
      runsLaunched.inc({ provider: this.provider.name });
      const updated = await prisma.workflowRun.update({
        where: { id: run.id },
        data: { handle: toJson(handle), status: 'running', startedAt: new Date() },
      });
      this.startWatch(run.id, handle);
      return updated;
    } catch (err) {
      this.logger.error({ err, runId: run.id }, 'run submission failed');
      return prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: 'error', finishedAt: new Date() },
      });
    }
  }

  /** Watches the provider and fans events out to SSE subscribers + persistence. */
  private startWatch(runId: string, handle: RunHandle): void {
    activeWatchers.inc();
    const onEvent = (event: OrchestrationEvent) => {
      this.bus.publish(event);
      if (event.type === 'run' && TERMINAL_RUN_PHASES.has(event.phase)) {
        void prisma.workflowRun
          .update({
            where: { id: runId },
            data: { status: event.phase, finishedAt: event.finishedAt ? new Date(event.finishedAt) : new Date() },
          })
          .catch((err) => this.logger.error({ err, runId }, 'failed to persist run status'));
      }
    };
    this.provider
      .watch(handle, onEvent)
      .catch((err) => this.logger.error({ err, runId }, 'watch loop failed'))
      .finally(() => activeWatchers.dec());
  }

  handleOf(run: WorkflowRun): RunHandle {
    const handle = fromJson<RunHandle | undefined>(run.handle, undefined);
    if (!handle) {
      throw Object.assign(new Error(`Run ${run.id} has no orchestration handle`), {
        statusCode: 409,
      });
    }
    return handle;
  }

  async getLiveState(run: WorkflowRun): Promise<RunSnapshot> {
    return this.provider.getState(this.handleOf(run));
  }

  /** Targeted retry: re-executes failed tests only (optionally a subset). */
  async retry(run: WorkflowRun, testIds?: string[]): Promise<void> {
    const handle = await this.provider.retryFailed(this.handleOf(run), testIds);
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: 'running', finishedAt: null },
    });
    this.startWatch(run.id, handle);
  }

  async cancel(run: WorkflowRun): Promise<void> {
    await this.provider.cancel(this.handleOf(run));
  }

  async getLogs(run: WorkflowRun, testId: string): Promise<string> {
    return this.provider.getLogs(this.handleOf(run), testId);
  }

  async streamLogs(
    run: WorkflowRun,
    testId: string,
    onChunk: (chunk: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const handle = this.handleOf(run);
    if (this.provider.streamLogs) {
      return this.provider.streamLogs(handle, testId, onChunk, signal);
    }
    onChunk(await this.provider.getLogs(handle, testId));
  }

  /**
   * Ingests the aggregated JUnit report POSTed by the aggregation step:
   * breaks it down into one persisted TestResult per test of the run
   * (feeding per-campaign consultation, history and run-to-run diffs),
   * reconciles the run status, archives the report (best effort) and pushes
   * business metrics to the dedicated target. Idempotent (upserts).
   */
  async ingestResults(runId: string, junitXml: string): Promise<void> {
    const run = await prisma.workflowRun.findUniqueOrThrow({
      where: { id: runId },
      include: { campaign: true, triggeredBy: true },
    });
    const snapshot = fromJson<TestExecutionSnapshot[]>(run.testsSnapshot, []);
    const byTestId = new Map(snapshot.map((t) => [t.testId, t]));

    // The merged report contains one <testsuite> per test node, named by test id.
    const rows = aggregateReportByTest(parseJUnitXml(junitXml));
    for (const row of rows) {
      const test = byTestId.get(row.testId);
      await prisma.testResult.upsert({
        where: { runId_testId: { runId, testId: row.testId } },
        create: {
          runId,
          testId: row.testId,
          name: test?.name ?? row.testId,
          engine: test?.engine ?? 'unknown',
          outcome: row.outcome,
          durationMs: row.durationMs,
          message: row.message,
        },
        update: { outcome: row.outcome, durationMs: row.durationMs, message: row.message },
      });
    }
    this.logger.info({ runId, results: rows.length }, 'aggregated JUnit ingested');

    // The aggregated report is authoritative: if the watch missed the end of
    // the run (server restart, watch gap), reconcile the run status from it.
    if (!TERMINAL_RUN_PHASES.has(run.status as RunPhase)) {
      const failed = rows.some((r) => r.outcome === 'failed' || r.outcome === 'error');
      await prisma.workflowRun.update({
        where: { id: runId },
        data: { status: failed ? 'failed' : 'succeeded', finishedAt: run.finishedAt ?? new Date() },
      });
    }

    // Archiving is best effort: an unreachable artifact store must never
    // lose the parsed results (they are already in the database).
    try {
      const junitKey = await this.store.put(`runs/${runId}/junit.xml`, junitXml, 'application/xml');
      await prisma.artifact.createMany({
        data: [{ runId, name: 'junit.xml', storageKey: junitKey, contentType: 'application/xml' }],
      });
      await prisma.workflowRun.update({ where: { id: runId }, data: { junitKey } });
    } catch (err) {
      this.logger.warn({ err, runId }, 'junit archiving to the artifact store failed (results kept)');
    }

    await this.pushBusinessMetrics(run.id, run.campaign, run.triggeredBy.email);
  }

  /**
   * Called at startup: re-attaches watches for runs still marked running.
   * Cluster-backed providers (argo) can resume from their handle; in-memory
   * providers (local/docker) lost their state with the previous process —
   * those runs are closed as errors instead of staying "running" forever.
   */
  async resumeWatches(): Promise<void> {
    const stale = await prisma.workflowRun.findMany({
      where: { status: { in: ['pending', 'running'] } },
    });
    for (const run of stale) {
      const handle = fromJson<RunHandle | undefined>(run.handle, undefined);
      const resumable =
        handle && handle.provider === this.provider.name && !['local', 'docker'].includes(handle.provider);
      if (resumable) {
        this.logger.info({ runId: run.id }, 'resuming orchestration watch');
        this.startWatch(run.id, handle);
      } else {
        this.logger.warn({ runId: run.id }, 'closing stale run (orchestrator state lost)');
        await prisma.workflowRun.update({
          where: { id: run.id },
          data: { status: 'error', finishedAt: new Date() },
        });
      }
    }
  }

  private async pushBusinessMetrics(
    runId: string,
    campaign: Campaign,
    triggeredBy: string,
  ): Promise<void> {
    const results = await prisma.testResult.findMany({ where: { runId } });
    const previous = await prisma.workflowRun.findFirst({
      where: { campaignId: campaign.id, id: { not: runId }, results: { some: {} } },
      orderBy: { createdAt: 'desc' },
      include: { results: true },
    });
    const failing = (outcome: string) => outcome === 'failed' || outcome === 'error';
    const previousByTest = new Map(previous?.results.map((r) => [r.testId, r.outcome]) ?? []);
    const regressions = results.filter(
      (r) =>
        failing(r.outcome) &&
        previousByTest.has(r.testId) &&
        !failing(previousByTest.get(r.testId)!),
    ).length;

    await this.business.pushRun({
      campaignId: campaign.id,
      campaignName: campaign.name,
      runId,
      triggeredBy,
      status: results.some((r) => failing(r.outcome)) ? 'failed' : 'succeeded',
      totalTests: results.length,
      passed: results.filter((r) => r.outcome === 'passed').length,
      failed: results.filter((r) => failing(r.outcome)).length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      durationSeconds: results.reduce((s, r) => s + r.durationMs, 0) / 1000,
      regressions,
    });
  }
}
