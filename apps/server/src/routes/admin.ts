import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdapterManifestService } from '../services/adapter-manifests.js';

const addManifestBodySchema = z.object({
  url: z.string().url(),
});

/**
 * Instance-level adapter manifest management (docs/adapter-plugins.md §4/§7)
 * — admin-only: a manifest's engines can run via the `local` process
 * runtime, i.e. execute arbitrary commands on the server host.
 */
export function registerAdminRoutes(app: FastifyInstance, manifests: AdapterManifestService): void {
  app.get(
    '/api/admin/adapter-manifests',
    { preHandler: app.requireRole('admin') },
    async () => manifests.list(),
  );

  app.post(
    '/api/admin/adapter-manifests',
    { preHandler: app.requireRole('admin') },
    async (request, reply) => {
      const body = addManifestBodySchema.parse(request.body);
      const record = await manifests.add(body.url, request.user!.sub);
      return reply.code(201).send(record);
    },
  );

  app.delete(
    '/api/admin/adapter-manifests/:id',
    { preHandler: app.requireRole('admin') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const removed = await manifests.remove(id);
      if (!removed) return reply.code(404).send({ error: 'adapter manifest not found' });
      return { deleted: true };
    },
  );

  app.post(
    '/api/admin/adapter-manifests/reload',
    { preHandler: app.requireRole('admin') },
    async () => {
      await manifests.reloadAll();
      return manifests.list();
    },
  );
}
