import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
// Register orchestration providers (side-effect imports keep the rest of the
// app provider-agnostic; the active one is chosen via ORCHESTRATION_PROVIDER).
import '@tcs/orchestration';
import '@tcs/orchestration-argo';
import type { AppConfig } from './config.js';
import { SessionService } from './auth/session.js';
import { registerAuthGuards } from './auth/plugin.js';
import { ensureBootstrapAdmin } from './auth/users.js';
import { RunEventBus } from './events/bus.js';
import { ArtifactStore } from './storage/s3.js';
import { BusinessMetricsPusher } from './metrics/business.js';
import { registerHttpMetrics } from './metrics/system.js';
import { RunService } from './services/run-service.js';
import { SchedulerService } from './services/scheduler.js';
import { AdapterManifestService } from './services/adapter-manifests.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCampaignRoutes } from './routes/campaigns.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerInternalRoutes, registerMetaRoutes } from './routes/meta.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerProjectRoutes } from './routes/projects.js';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: 50 * 1024 * 1024, // aggregated JUnit reports can be large
  });

  await app.register(cookie);
  await app.register(cors, { origin: [config.PORTAL_ORIGIN], credentials: true });

  // The aggregation step POSTs raw XML.
  app.addContentTypeParser(['application/xml', 'text/xml'], { parseAs: 'string' }, (_req, body, done) =>
    done(null, body),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation failed',
        details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) request.log.error({ err }, 'unhandled error');
    return reply.code(statusCode).send({ error: err.message });
  });

  const sessions = new SessionService(config.SESSION_SECRET, config.SESSION_TTL_HOURS);
  registerAuthGuards(app, sessions);
  registerHttpMetrics(app);

  const bus = new RunEventBus();
  const store = new ArtifactStore(config);
  const business = new BusinessMetricsPusher(config, app.log);
  const runService = new RunService(config, bus, store, business, app.log);
  const scheduler = new SchedulerService(config, runService, app.log);
  const adapterManifests = new AdapterManifestService(app.log);

  await registerAuthRoutes(app, config, sessions);
  registerProjectRoutes(app);
  registerCampaignRoutes(app, config, runService, scheduler);
  registerRunRoutes(app, runService, bus, store);
  registerMetaRoutes(app, config, runService);
  registerInternalRoutes(app, config, runService);
  registerAdminRoutes(app, adapterManifests);

  app.addHook('onReady', async () => {
    // Startup best-effort: a temporarily unreachable DB/S3 must not prevent
    // the server from booting — /readyz reports the degraded state instead.
    if (config.authMethods.password) {
      await ensureBootstrapAdmin(config.ADMIN_EMAIL, config.ADMIN_PASSWORD).catch((err) =>
        app.log.warn({ err }, 'bootstrap admin creation failed (database unreachable?)'),
      );
    }
    await store.ensureBucket().catch((err) => app.log.warn({ err }, 'artifact bucket check failed'));
    // Fetch + install every enabled instance adapter manifest (docs/adapter-plugins.md).
    await adapterManifests
      .loadAll()
      .catch((err) => app.log.warn({ err }, 'adapter manifest load failed (database unreachable?)'));
    // Re-attach orchestration watches for runs interrupted by a restart.
    await runService
      .resumeWatches()
      .catch((err) => app.log.warn({ err }, 'resuming watches failed (database unreachable?)'));
    // Start the automatic campaign scheduler (cron).
    await scheduler
      .start()
      .catch((err) => app.log.warn({ err }, 'scheduler start failed (database unreachable?)'));
  });

  app.addHook('onClose', async () => scheduler.stop());

  return app;
}
