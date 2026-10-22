import client from 'prom-client';
import type { FastifyInstance } from 'fastify';

/**
 * System/technical metrics, exposed on `/metrics` and scraped by the infra
 * Prometheus. Business metrics (test results) go to a separate, dedicated
 * target — see business.ts.
 */
export const systemRegistry = new client.Registry();
client.collectDefaultMetrics({ register: systemRegistry });

const httpDuration = new client.Histogram({
  name: 'tcs_http_request_duration_seconds',
  help: 'API request latency',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.025, 0.1, 0.25, 1, 2.5, 10],
  registers: [systemRegistry],
});

export const activeWatchers = new client.Gauge({
  name: 'tcs_orchestration_watchers_active',
  help: 'Number of active orchestration watch loops',
  registers: [systemRegistry],
});

export const runsLaunched = new client.Counter({
  name: 'tcs_runs_launched_total',
  help: 'Campaign runs launched since server start',
  labelNames: ['provider'],
  registers: [systemRegistry],
});

export function registerHttpMetrics(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    httpDuration.observe(
      {
        method: request.method,
        route: request.routeOptions.url ?? 'unknown',
        status: String(reply.statusCode),
      },
      reply.elapsedTime / 1000,
    );
  });
}
