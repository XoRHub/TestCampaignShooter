import client from 'prom-client';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';

export interface RunBusinessMetrics {
  campaignId: string;
  campaignName: string;
  runId: string;
  triggeredBy: string;
  status: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationSeconds: number;
  regressions: number;
}

/**
 * Business metrics pusher. Results of every run (success rate, counts,
 * durations, regressions) are pushed to a *dedicated, configurable* target —
 * its own Pushgateway/Prometheus — entirely separate from the system
 * `/metrics` endpoint, so high-cardinality test data never pollutes the
 * infra monitoring. Fully optional (BUSINESS_METRICS_ENABLED).
 *
 * Cardinality strategy: labels stay at campaign/run granularity; the per-test
 * detail lives in the database and the JUnit artifacts, not in Prometheus.
 */
export class BusinessMetricsPusher {
  private readonly enabled: boolean;
  private readonly gateway?: client.Pushgateway<client.RegistryContentType>;
  private readonly registry = new client.Registry();

  private readonly runTests = this.gauge('tcs_run_tests_total', 'Tests selected in the run');
  private readonly runPassed = this.gauge('tcs_run_tests_passed', 'Tests passed');
  private readonly runFailed = this.gauge('tcs_run_tests_failed', 'Tests failed or errored');
  private readonly runSkipped = this.gauge('tcs_run_tests_skipped', 'Tests skipped');
  private readonly runDuration = this.gauge('tcs_run_duration_seconds', 'Total run duration');
  private readonly runSuccessRatio = this.gauge('tcs_run_success_ratio', 'passed / total');
  private readonly runRegressions = this.gauge(
    'tcs_run_regressions',
    'Tests passing in the previous run but failing in this one',
  );
  private readonly runStatus = this.gauge(
    'tcs_run_status',
    'Run status (1 for the current status label)',
    ['status'],
  );

  constructor(
    config: AppConfig,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.enabled = config.BUSINESS_METRICS_ENABLED && Boolean(config.PUSHGATEWAY_URL);
    if (this.enabled) {
      const headers: Record<string, string> = {};
      if (config.PUSHGATEWAY_USERNAME) {
        headers.Authorization = `Basic ${Buffer.from(
          `${config.PUSHGATEWAY_USERNAME}:${config.PUSHGATEWAY_PASSWORD ?? ''}`,
        ).toString('base64')}`;
      }
      this.gateway = new client.Pushgateway(
        config.PUSHGATEWAY_URL!,
        { headers },
        this.registry,
      );
    }
    this.jobName = config.BUSINESS_METRICS_JOB;
  }

  private readonly jobName: string;

  private gauge(name: string, help: string, extraLabels: string[] = []): client.Gauge {
    return new client.Gauge({
      name,
      help,
      labelNames: ['campaign_id', 'campaign_name', 'run_id', 'triggered_by', ...extraLabels],
      registers: [this.registry],
    });
  }

  async pushRun(metrics: RunBusinessMetrics): Promise<void> {
    if (!this.enabled || !this.gateway) return;
    const labels = {
      campaign_id: metrics.campaignId,
      campaign_name: metrics.campaignName,
      run_id: metrics.runId,
      triggered_by: metrics.triggeredBy,
    };
    this.runTests.set(labels, metrics.totalTests);
    this.runPassed.set(labels, metrics.passed);
    this.runFailed.set(labels, metrics.failed);
    this.runSkipped.set(labels, metrics.skipped);
    this.runDuration.set(labels, metrics.durationSeconds);
    this.runSuccessRatio.set(
      labels,
      metrics.totalTests > 0 ? metrics.passed / metrics.totalTests : 0,
    );
    this.runRegressions.set(labels, metrics.regressions);
    this.runStatus.set({ ...labels, status: metrics.status }, 1);
    try {
      await this.gateway.pushAdd({ jobName: this.jobName, groupings: { run_id: metrics.runId } });
    } catch (err) {
      this.logger.warn({ err }, 'business metrics push failed (non-fatal)');
    } finally {
      this.registry.resetMetrics();
    }
  }
}
