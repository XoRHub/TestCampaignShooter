import type { FastifyInstance } from 'fastify';
import { listAdapters, originOf } from '@tcs/core';
import { prisma } from '../prisma.js';
import { systemRegistry } from '../metrics/system.js';
import type { AppConfig } from '../config.js';
import type { RunService } from '../services/run-service.js';

export function registerMetaRoutes(
  app: FastifyInstance,
  config: AppConfig,
  runService: RunService,
): void {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', provider: runService.providerName };
    } catch {
      return reply.code(503).send({ status: 'database unreachable' });
    }
  });

  // System/technical metrics — scraped by the infra Prometheus.
  app.get('/metrics', async (_request, reply) => {
    return reply.header('content-type', systemRegistry.contentType).send(await systemRegistry.metrics());
  });

  app.get('/api/engines', { preHandler: app.requireAuth }, async () => {
    return listAdapters().map((adapter) => ({
      engine: adapter.engine,
      displayName: adapter.displayName,
      defaultImage: adapter.defaultImage,
      deprecated: adapter.deprecated,
      // 'built-in' or the instance adapter manifest URL that provided it.
      origin: originOf(adapter.engine),
    }));
  });
}

/** Callback endpoint the aggregation step POSTs the merged JUnit report to. */
export function registerInternalRoutes(
  app: FastifyInstance,
  config: AppConfig,
  runService: RunService,
): void {
  app.post('/api/internal/runs/:runId/results', async (request, reply) => {
    if (
      config.INTERNAL_CALLBACK_TOKEN &&
      request.headers['x-tcs-token'] !== config.INTERNAL_CALLBACK_TOKEN
    ) {
      return reply.code(401).send({ error: 'invalid callback token' });
    }
    const { runId } = request.params as { runId: string };
    const xml = typeof request.body === 'string' ? request.body : '';
    if (!xml.trim()) return reply.code(400).send({ error: 'empty JUnit payload' });
    await runService.ingestResults(runId, xml);
    return { ok: true };
  });
}
