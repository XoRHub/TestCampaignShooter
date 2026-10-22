import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { TERMINAL_RUN_PHASES, type RunPhase } from '@tcs/shared-types';
import { fromJson, prisma } from '../prisma.js';
import type { RunEventBus } from '../events/bus.js';
import type { RunService } from '../services/run-service.js';
import type { ArtifactStore } from '../storage/s3.js';
import { diffRuns, type DiffableResult } from '../services/diff.js';
import { canAccessCampaign } from '../services/access.js';
import { openSse } from './sse.js';

const resultsQuerySchema = z.object({
  outcome: z.enum(['passed', 'failed', 'error', 'skipped']).optional(),
  engine: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(50),
});

const retryBodySchema = z.object({ testIds: z.array(z.string()).optional() }).default({});
const testIdQuerySchema = z.object({ testId: z.string().min(1), download: z.string().optional() });

async function findRun(id: string) {
  return prisma.workflowRun.findUnique({
    where: { id },
    include: {
      campaign: true,
      triggeredBy: { select: { id: true, email: true, displayName: true } },
    },
  });
}

/**
 * Fetches a run and enforces the project-access gate shared by every route
 * in this file: a run inherits its visibility from its campaign (see
 * `canAccessCampaign`, docs/functional.md — projects). Sends the 404/403
 * itself and returns `undefined` so callers can just `if (!run) return;`.
 */
async function findAccessibleRun(request: FastifyRequest, reply: FastifyReply, id: string) {
  const run = await findRun(id);
  if (!run) {
    await reply.code(404).send({ error: 'run not found' });
    return undefined;
  }
  if (!(await canAccessCampaign(request, run.campaign))) {
    await reply.code(403).send({ error: 'you do not have access to this run' });
    return undefined;
  }
  return run;
}

function toDiffable(results: Array<{ testId: string; name: string; outcome: string; durationMs: number }>): DiffableResult[] {
  return results.map((r) => ({
    testId: r.testId,
    name: r.name,
    outcome: r.outcome as DiffableResult['outcome'],
    durationMs: r.durationMs,
  }));
}

export function registerRunRoutes(
  app: FastifyInstance,
  runService: RunService,
  bus: RunEventBus,
  store: ArtifactStore,
): void {
  app.get('/api/runs/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await findAccessibleRun(request, reply, id);
    if (!run) return;

    const resultsSummary = await prisma.testResult.groupBy({
      by: ['outcome'],
      where: { runId: id },
      _count: true,
    });

    // While running, enrich with the live per-test state from the provider.
    let live;
    if (!TERMINAL_RUN_PHASES.has(run.status as RunPhase)) {
      live = await runService.getLiveState(run).catch(() => undefined);
    }

    return {
      ...run,
      testsSnapshot: fromJson(run.testsSnapshot, []),
      handle: undefined,
      summary: Object.fromEntries(resultsSummary.map((r) => [r.outcome, r._count])),
      live,
    };
  });

  app.get('/api/runs/:id/results', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await findAccessibleRun(request, reply, id);
    if (!run) return;
    const query = resultsQuerySchema.parse(request.query);
    const where = {
      runId: id,
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.engine ? { engine: query.engine } : {}),
    };
    const [total, items] = await prisma.$transaction([
      prisma.testResult.count({ where }),
      prisma.testResult.findMany({
        where,
        orderBy: { testId: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return reply.send({ total, page: query.page, pageSize: query.pageSize, items });
  });

  // Diff against the previous run of the same campaign (default) or a chosen run.
  app.get('/api/runs/:id/diff', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { against } = request.query as { against?: string };
    const run = await findAccessibleRun(request, reply, id);
    if (!run) return;

    const baseRun =
      against && against !== 'previous'
        ? await prisma.workflowRun.findFirst({ where: { id: against, campaignId: run.campaignId } })
        : await prisma.workflowRun.findFirst({
            where: { campaignId: run.campaignId, createdAt: { lt: run.createdAt }, results: { some: {} } },
            orderBy: { createdAt: 'desc' },
          });
    if (!baseRun) return reply.code(404).send({ error: 'no run to compare against' });

    const [baseResults, targetResults] = await Promise.all([
      prisma.testResult.findMany({ where: { runId: baseRun.id } }),
      prisma.testResult.findMany({ where: { runId: id } }),
    ]);
    return diffRuns(
      run.campaignId,
      { runId: baseRun.id, results: toDiffable(baseResults) },
      { runId: id, results: toDiffable(targetResults) },
    );
  });

  app.post('/api/runs/:id/replay', { preHandler: app.requireRole('editor') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await findAccessibleRun(request, reply, id);
    if (!run) return;
    const { parallelism } = (request.body ?? {}) as { parallelism?: number };
    const replayed = await runService.replay(run, request.user!.sub, { parallelism });
    return reply.code(201).send(replayed);
  });

  app.post('/api/runs/:id/retry', { preHandler: app.requireRole('editor') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await findAccessibleRun(request, reply, id);
    if (!run) return;
    const body = retryBodySchema.parse(request.body ?? {});
    await runService.retry(run, body.testIds);
    return { ok: true };
  });

  app.post('/api/runs/:id/cancel', { preHandler: app.requireRole('editor') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await findAccessibleRun(request, reply, id);
    if (!run) return;
    await runService.cancel(run);
    return { ok: true };
  });

  app.get('/api/runs/:id/junit', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await findAccessibleRun(request, reply, id);
    if (!run) return;
    if (!run.junitKey) return reply.code(404).send({ error: 'no aggregated report for this run' });
    const xml = await store.get(run.junitKey);
    if (!xml) return reply.code(404).send({ error: 'report not found in artifact store' });
    return reply
      .header('content-type', 'application/xml')
      .header('content-disposition', `attachment; filename="junit-${id}.xml"`)
      .send(xml);
  });

  app.get('/api/runs/:id/artifacts', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await findAccessibleRun(request, reply, id);
    if (!run) return;
    return prisma.artifact.findMany({ where: { runId: id }, orderBy: { createdAt: 'asc' } });
  });

  // Logs of one test (testId passed as query param — ids contain slashes).
  app.get('/api/runs/:id/logs', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = testIdQuerySchema.parse(request.query);
    const run = await findAccessibleRun(request, reply, id);
    if (!run) return;
    const logs = await runService.getLogs(run, query.testId);
    if (query.download) {
      return reply
        .header('content-type', 'text/plain')
        .header(
          'content-disposition',
          `attachment; filename="logs-${query.testId.replace(/[^a-zA-Z0-9.-]+/g, '_')}.txt"`,
        )
        .send(logs);
    }
    return reply.header('content-type', 'text/plain').send(logs);
  });

  app.get('/api/runs/:id/logs/stream', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = testIdQuerySchema.parse(request.query);
    const run = await findAccessibleRun(request, reply, id);
    if (!run) return;
    const sse = openSse(reply);
    try {
      await runService.streamLogs(run, query.testId, (chunk) => sse.send('log', { chunk }), sse.signal);
    } finally {
      sse.send('end', {});
      sse.close();
    }
  });

  // Live progress of a run: normalized events pushed over SSE.
  app.get('/api/runs/:id/events', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await findAccessibleRun(request, reply, id);
    if (!run) return;

    const sse = openSse(reply);
    const unsubscribe = bus.subscribe(id, (event) => sse.send(event.type, event));

    // Hydrate with the current state so late subscribers start complete.
    const live = await runService.getLiveState(run).catch(() => undefined);
    if (live) {
      for (const test of live.tests) sse.send('test', test);
      sse.send('run', live.run);
      if (TERMINAL_RUN_PHASES.has(live.run.phase)) {
        unsubscribe();
        sse.close();
        return;
      }
    }
    request.raw.on('close', unsubscribe);
  });

  // History of one test across runs (trends / flakiness). Scoped to one
  // campaign's access if `campaignId` is given; the unscoped (cross-campaign)
  // search predates projects and isn't restricted by them, same as the
  // campaign list already wasn't for campaigns with no project.
  app.get('/api/tests/history', { preHandler: app.requireAuth }, async (request, reply) => {
    const { testId, campaignId, limit } = request.query as {
      testId: string;
      campaignId?: string;
      limit?: string;
    };
    if (campaignId) {
      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign) return reply.code(404).send({ error: 'campaign not found' });
      if (!(await canAccessCampaign(request, campaign))) {
        return reply.code(403).send({ error: 'you do not have access to this campaign' });
      }
    }
    return prisma.testResult.findMany({
      where: { testId, ...(campaignId ? { run: { campaignId } } : {}) },
      include: { run: { select: { id: true, campaignId: true, createdAt: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit ?? 50), 200),
    });
  });
}
