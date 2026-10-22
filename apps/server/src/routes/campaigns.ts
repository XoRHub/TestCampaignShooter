import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Campaign, User } from '@prisma/client';
import { selectionRuleSchema, testsSourceSchema, hasRole } from '@tcs/shared-types';
import { fromJson, prisma, toJson } from '../prisma.js';
import { previewSelection } from '../services/discovery.js';
import type { RunService } from '../services/run-service.js';
import type { SchedulerService } from '../services/scheduler.js';
import { isValidCronExpression, nextOccurrence } from '../services/scheduler.js';
import type { AppConfig } from '../config.js';
import { campaignVisibilityFilter, canAccessCampaign, canAccessProject, canMutateCampaignInProject } from '../services/access.js';

const campaignBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  selectionRule: selectionRuleSchema,
  source: testsSourceSchema,
  parallelism: z.coerce.number().int().positive().max(200).optional(),
  /** Cron expression (5/6 champs) pour le lancement automatique planifié. */
  scheduleCron: z
    .string()
    .min(1)
    .refine(isValidCronExpression, { message: 'invalid cron expression (e.g. "0 6 * * 1-5")' })
    .nullable()
    .optional(),
  scheduleEnabled: z.boolean().optional(),
  /** Admin-only — see canSetAdapterManifestUrl (can run arbitrary commands via the `local` provider). */
  adapterManifestUrl: z.string().url().nullable().optional(),
  /** Optional project (see docs/functional.md) — restricts visibility to the project's creator + members. */
  projectId: z.string().min(1).nullable().optional(),
});

const previewBodySchema = z.object({
  selectionRule: selectionRuleSchema,
  source: testsSourceSchema,
});

const launchBodySchema = z
  .object({
    parallelism: z.coerce.number().int().positive().max(200).optional(),
    revision: z.string().optional(),
  })
  .default({});

const runsQuerySchema = z.object({
  status: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export function serializeCampaign(
  campaign: Campaign & { createdBy?: User; project?: { id: string; name: string } | null; _count?: { runs: number } },
  timezone?: string,
) {
  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    selectionRule: fromJson(campaign.selectionRule, {}),
    source: fromJson(campaign.source, {}),
    parallelism: campaign.parallelism,
    scheduleCron: campaign.scheduleCron,
    scheduleEnabled: campaign.scheduleEnabled,
    nextScheduledAt:
      campaign.scheduleEnabled && campaign.scheduleCron && !campaign.deletedAt
        ? nextOccurrence(campaign.scheduleCron, timezone)
        : undefined,
    adapterManifestUrl: campaign.adapterManifestUrl,
    projectId: campaign.projectId,
    project: campaign.project ?? undefined,
    version: campaign.version,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    deletedAt: campaign.deletedAt,
    runCount: campaign._count?.runs,
    createdBy: campaign.createdBy
      ? { id: campaign.createdBy.id, email: campaign.createdBy.email, displayName: campaign.createdBy.displayName }
      : undefined,
  };
}

/**
 * Editors may modify their own campaigns; admins may modify any; the
 * creator of the campaign's project (if any) may modify any campaign
 * inside that project too (docs/functional.md — projects).
 */
async function canMutate(request: FastifyRequest, campaign: Campaign): Promise<boolean> {
  if (hasRole(request.user!.roles, 'admin')) return true;
  if (hasRole(request.user!.roles, 'editor') && campaign.createdById === request.user!.sub) return true;
  if (campaign.projectId) return canMutateCampaignInProject(request, campaign.projectId);
  return false;
}

/**
 * `adapterManifestUrl` is admin-only even though the rest of a campaign is
 * editor-editable: it can make the `local` provider run an arbitrary
 * command on the server host (docs/adapter-plugins.md §8).
 */
function canSetAdapterManifestUrl(request: FastifyRequest): boolean {
  return hasRole(request.user!.roles, 'admin');
}

export function registerCampaignRoutes(
  app: FastifyInstance,
  config: AppConfig,
  runService: RunService,
  scheduler: SchedulerService,
): void {
  const serialize = (
    campaign: Campaign & { createdBy?: User; project?: { id: string; name: string } | null; _count?: { runs: number } },
  ) => serializeCampaign(campaign, config.SCHEDULER_TIMEZONE);

  app.get('/api/campaigns', { preHandler: app.requireAuth }, async (request, reply) => {
    const { includeDeleted, projectId } = request.query as { includeDeleted?: string; projectId?: string };
    const isAdmin = hasRole(request.user!.roles, 'admin');
    if (projectId && !(await canAccessProject(request, projectId))) {
      return reply.code(403).send({ error: 'you do not have access to this project' });
    }
    const campaigns = await prisma.campaign.findMany({
      where: {
        ...(includeDeleted === 'true' ? {} : { deletedAt: null }),
        ...(projectId ? { projectId } : isAdmin ? {} : campaignVisibilityFilter(request.user!.sub)),
      },
      include: { createdBy: true, project: { select: { id: true, name: true } }, _count: { select: { runs: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return campaigns.map(serialize);
  });

  app.post('/api/campaigns', { preHandler: app.requireRole('editor') }, async (request, reply) => {
    const body = campaignBodySchema.parse(request.body);
    if (body.scheduleEnabled && !body.scheduleCron) {
      return reply.code(400).send({ error: 'scheduleEnabled requires a scheduleCron expression' });
    }
    if (body.adapterManifestUrl !== undefined && !canSetAdapterManifestUrl(request)) {
      return reply.code(403).send({ error: 'only an admin can set adapterManifestUrl' });
    }
    if (body.projectId && !(await canAccessProject(request, body.projectId))) {
      return reply.code(403).send({ error: 'you do not have access to this project' });
    }
    const campaign = await prisma.campaign.create({
      data: {
        name: body.name,
        description: body.description,
        selectionRule: toJson(body.selectionRule),
        source: toJson(body.source),
        parallelism: body.parallelism ?? config.DEFAULT_PARALLELISM,
        scheduleCron: body.scheduleCron ?? null,
        scheduleEnabled: body.scheduleEnabled ?? false,
        adapterManifestUrl: body.adapterManifestUrl ?? null,
        projectId: body.projectId ?? null,
        createdById: request.user!.sub,
      },
      include: { createdBy: true, project: { select: { id: true, name: true } } },
    });
    await scheduler.sync(campaign.id);
    return reply.code(201).send(serialize(campaign));
  });

  app.get('/api/campaigns/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: { createdBy: true, project: { select: { id: true, name: true } }, _count: { select: { runs: true } } },
    });
    if (!campaign) return reply.code(404).send({ error: 'campaign not found' });
    if (!(await canAccessCampaign(request, campaign))) {
      return reply.code(403).send({ error: 'you do not have access to this campaign' });
    }
    return serialize(campaign);
  });

  app.put('/api/campaigns/:id', { preHandler: app.requireRole('editor') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return reply.code(404).send({ error: 'campaign not found' });
    if (!(await canAccessCampaign(request, existing))) {
      return reply.code(403).send({ error: 'you do not have access to this campaign' });
    }
    if (!(await canMutate(request, existing))) {
      return reply.code(403).send({ error: 'only the campaign creator or an admin can modify it' });
    }
    const body = campaignBodySchema.partial().parse(request.body);
    if (body.adapterManifestUrl !== undefined && !canSetAdapterManifestUrl(request)) {
      return reply.code(403).send({ error: 'only an admin can set adapterManifestUrl' });
    }
    if (body.projectId && !(await canAccessProject(request, body.projectId))) {
      return reply.code(403).send({ error: 'you do not have access to this project' });
    }
    const nextCron = body.scheduleCron !== undefined ? body.scheduleCron : existing.scheduleCron;
    const nextEnabled =
      body.scheduleEnabled !== undefined ? body.scheduleEnabled : existing.scheduleEnabled;
    if (nextEnabled && !nextCron) {
      return reply.code(400).send({ error: 'scheduleEnabled requires a scheduleCron expression' });
    }
    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.selectionRule !== undefined ? { selectionRule: toJson(body.selectionRule) } : {}),
        ...(body.source !== undefined ? { source: toJson(body.source) } : {}),
        ...(body.parallelism !== undefined ? { parallelism: body.parallelism } : {}),
        ...(body.scheduleCron !== undefined ? { scheduleCron: body.scheduleCron } : {}),
        ...(body.adapterManifestUrl !== undefined ? { adapterManifestUrl: body.adapterManifestUrl } : {}),
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.scheduleEnabled !== undefined ? { scheduleEnabled: body.scheduleEnabled } : {}),
        version: { increment: 1 },
      },
      include: { createdBy: true, project: { select: { id: true, name: true } } },
    });
    await scheduler.sync(campaign.id);
    return serialize(campaign);
  });

  app.delete('/api/campaigns/:id', { preHandler: app.requireRole('editor') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.campaign.findUnique({
      where: { id },
      include: { _count: { select: { runs: true } } },
    });
    if (!existing || existing.deletedAt) return reply.code(404).send({ error: 'campaign not found' });
    if (!(await canAccessCampaign(request, existing))) {
      return reply.code(403).send({ error: 'you do not have access to this campaign' });
    }
    if (!(await canMutate(request, existing))) {
      return reply.code(403).send({ error: 'only the campaign creator or an admin can delete it' });
    }
    if (existing._count.runs > 0) {
      // Logical delete: history and results of executed runs stay auditable.
      await prisma.campaign.update({ where: { id }, data: { deletedAt: new Date() } });
      await scheduler.sync(id);
      return { deleted: 'soft' };
    }
    await prisma.campaign.delete({ where: { id } });
    await scheduler.sync(id);
    return { deleted: 'hard' };
  });

  // Preview of a rule against a source — used live by the portal rule builder.
  app.post('/api/campaigns/preview', { preHandler: app.requireAuth }, async (request) => {
    const body = previewBodySchema.parse(request.body);
    const preview = await previewSelection(body.source, body.selectionRule);
    return {
      totalDiscovered: preview.totalDiscovered,
      selectedCount: preview.selected.length,
      selected: preview.selected.map((t) => ({
        id: t.id,
        name: t.name,
        engine: t.engine,
        file: t.file,
        metadata: t.metadata,
      })),
      issues: preview.issues,
    };
  });

  app.post('/api/campaigns/:id/runs', { preHandler: app.requireRole('editor') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign || campaign.deletedAt) return reply.code(404).send({ error: 'campaign not found' });
    if (!(await canAccessCampaign(request, campaign))) {
      return reply.code(403).send({ error: 'you do not have access to this campaign' });
    }
    const overrides = launchBodySchema.parse(request.body ?? {});
    const run = await runService.launch(campaign, request.user!.sub, overrides);
    return reply.code(201).send(run);
  });

  app.get('/api/campaigns/:id/runs', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) return reply.code(404).send({ error: 'campaign not found' });
    if (!(await canAccessCampaign(request, campaign))) {
      return reply.code(403).send({ error: 'you do not have access to this campaign' });
    }
    const query = runsQuerySchema.parse(request.query);
    const where = {
      campaignId: id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    };
    const [total, runs] = await prisma.$transaction([
      prisma.workflowRun.count({ where }),
      prisma.workflowRun.findMany({
        where,
        include: {
          triggeredBy: { select: { id: true, email: true, displayName: true } },
          _count: { select: { results: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return reply.send({ total, page: query.page, pageSize: query.pageSize, items: runs });
  });

  // Aggregates feeding the portal dashboards (independent from Prometheus).
  app.get('/api/campaigns/:id/metrics', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) return reply.code(404).send({ error: 'campaign not found' });
    if (!(await canAccessCampaign(request, campaign))) {
      return reply.code(403).send({ error: 'you do not have access to this campaign' });
    }
    const runs = await prisma.workflowRun.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: { results: { select: { outcome: true, durationMs: true } } },
    });
    return runs
      .filter((run) => run.results.length > 0)
      .map((run) => {
        const failed = run.results.filter((r) => r.outcome === 'failed' || r.outcome === 'error').length;
        return {
          runId: run.id,
          createdAt: run.createdAt,
          status: run.status,
          total: run.results.length,
          passed: run.results.filter((r) => r.outcome === 'passed').length,
          failed,
          durationMs: run.results.reduce((s, r) => s + r.durationMs, 0),
          successRatio: run.results.length > 0 ? (run.results.length - failed) / run.results.length : 0,
        };
      });
  });
}
