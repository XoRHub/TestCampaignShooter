import { Cron } from 'croner';
import type { Campaign } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { prisma, toJson } from '../prisma.js';
import type { AppConfig } from '../config.js';
import type { RunService } from './run-service.js';

export const SCHEDULER_USER_EMAIL = 'scheduler@testcampaignshooter.local';

/** True when the expression is a valid cron (5 or 6 fields, croner syntax). */
export function isValidCronExpression(expression: string): boolean {
  try {
    new Cron(expression, { paused: true }).stop();
    return true;
  } catch {
    return false;
  }
}

/** Next occurrence of a cron expression (ISO string), or undefined if invalid. */
export function nextOccurrence(expression: string, timezone?: string): string | undefined {
  try {
    const job = new Cron(expression, { paused: true, timezone });
    const next = job.nextRun();
    job.stop();
    return next?.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Launches campaigns automatically on their cron schedule. One in-process job
 * per campaign with `scheduleEnabled` + `scheduleCron`; jobs are (re)synced on
 * every campaign mutation. Runs are triggered by a dedicated system user so
 * the audit trail distinguishes scheduled from manual launches. Overlap
 * protection: a tick is skipped while a run of the campaign is still active.
 *
 * Single-instance by design (like the event bus): with several server
 * replicas, keep the scheduler enabled on exactly one (SCHEDULER_ENABLED).
 */
export class SchedulerService {
  private readonly jobs = new Map<string, Cron>();
  private systemUserId?: string;

  constructor(
    private readonly config: AppConfig,
    private readonly runService: RunService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async start(): Promise<void> {
    if (!this.config.SCHEDULER_ENABLED) {
      this.logger.info('campaign scheduler disabled (SCHEDULER_ENABLED=false)');
      return;
    }
    const campaigns = await prisma.campaign.findMany({
      where: { scheduleEnabled: true, scheduleCron: { not: null }, deletedAt: null },
    });
    for (const campaign of campaigns) this.schedule(campaign);
    this.logger.info({ scheduled: this.jobs.size }, 'campaign scheduler started');
  }

  stop(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }

  /** Re-syncs the job of one campaign after a create/update/delete. */
  async sync(campaignId: string): Promise<void> {
    this.jobs.get(campaignId)?.stop();
    this.jobs.delete(campaignId);
    if (!this.config.SCHEDULER_ENABLED) return;
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (campaign?.scheduleEnabled && campaign.scheduleCron && !campaign.deletedAt) {
      this.schedule(campaign);
    }
  }

  private schedule(campaign: Campaign): void {
    try {
      const job = new Cron(
        campaign.scheduleCron!,
        { timezone: this.config.SCHEDULER_TIMEZONE, protect: true },
        () => void this.fire(campaign.id),
      );
      this.jobs.set(campaign.id, job);
      this.logger.info(
        { campaignId: campaign.id, cron: campaign.scheduleCron, next: job.nextRun()?.toISOString() },
        `campaign "${campaign.name}" scheduled`,
      );
    } catch (err) {
      this.logger.error({ err, campaignId: campaign.id }, 'invalid cron expression — campaign not scheduled');
    }
  }

  private async fire(campaignId: string): Promise<void> {
    try {
      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign || campaign.deletedAt || !campaign.scheduleEnabled) return;
      // Overlap protection: never stack runs of the same campaign.
      const active = await prisma.workflowRun.count({
        where: { campaignId, status: { in: ['pending', 'running'] } },
      });
      if (active > 0) {
        this.logger.warn({ campaignId }, 'scheduled tick skipped: a run is still active');
        return;
      }
      const run = await this.runService.launch(campaign, await this.getSystemUserId());
      this.logger.info({ campaignId, runId: run.id }, `scheduled launch of "${campaign.name}"`);
    } catch (err) {
      this.logger.error({ err, campaignId }, 'scheduled launch failed');
    }
  }

  /** System account owning scheduled runs (auditable, not logged-in-able). */
  private async getSystemUserId(): Promise<string> {
    if (this.systemUserId) return this.systemUserId;
    const user = await prisma.user.upsert({
      where: { email: SCHEDULER_USER_EMAIL },
      create: {
        email: SCHEDULER_USER_EMAIL,
        displayName: 'Planificateur (cron)',
        roles: toJson(['editor']),
        authSource: 'local',
        // no passwordHash: this account can never log in
      },
      update: {},
    });
    this.systemUserId = user.id;
    return user.id;
  }
}
