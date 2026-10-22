import type { FastifyBaseLogger } from 'fastify';
import type { AdapterManifest } from '@prisma/client';
import { fetchManifest, installAdapter, originOf, uninstallInstanceAdapters } from '@tcs/core';
import { prisma } from '../prisma.js';

/**
 * Manages instance-level adapter manifests (admin-managed, persisted —
 * `docs/adapter-plugins.md` §4/§6): fetched at boot (`loadAll`) and on
 * admin-triggered add/remove/reload, installed into `@tcs/core`'s registry
 * so every provider sees them exactly like a built-in engine.
 */
export class AdapterManifestService {
  constructor(private readonly logger: FastifyBaseLogger) {}

  list(): Promise<AdapterManifest[]> {
    return prisma.adapterManifest.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /**
   * Persists a new manifest and attempts an immediate fetch to fail fast on
   * an obviously broken URL — but the row is kept even if that first fetch
   * fails (transient network issues shouldn't block adding it; `lastError`
   * surfaces the problem for a later reload).
   */
  async add(url: string, addedById: string): Promise<AdapterManifest> {
    const record = await prisma.adapterManifest.create({ data: { url, addedById } });
    await this.applyOne(record).catch((err) =>
      this.logger.warn({ err, url }, 'initial adapter manifest fetch failed (kept, retry via reload)'),
    );
    return prisma.adapterManifest.findUniqueOrThrow({ where: { id: record.id } });
  }

  /** Returns false (no-op) if the manifest doesn't exist, instead of throwing. */
  async remove(id: string): Promise<boolean> {
    const { count } = await prisma.adapterManifest.deleteMany({ where: { id } });
    if (count === 0) return false;
    // Simplest correct approach: rebuild the whole installed tier from the
    // remaining enabled manifests rather than diff a single removal — the
    // expected manifest count is small (admin-curated list).
    await this.reloadAll();
    return true;
  }

  /** Called once at boot — best-effort, like the rest of the onReady hook. */
  async loadAll(): Promise<void> {
    await this.reloadAll();
  }

  /** Re-fetches every enabled manifest and rebuilds the installed-adapter tier from scratch. */
  async reloadAll(): Promise<void> {
    uninstallInstanceAdapters();
    const manifests = await prisma.adapterManifest.findMany({ where: { enabled: true } });
    for (const manifest of manifests) {
      await this.applyOne(manifest).catch((err) =>
        this.logger.warn({ err, url: manifest.url }, 'adapter manifest fetch/parse failed'),
      );
    }
  }

  private async applyOne(manifest: AdapterManifest): Promise<void> {
    try {
      const { adapters, hash } = await fetchManifest(manifest.url);
      for (const adapter of adapters) {
        const previousOrigin = originOf(adapter.engine);
        if (previousOrigin && previousOrigin !== manifest.url) {
          this.logger.warn(
            { engine: adapter.engine, previousOrigin, manifest: manifest.url },
            'adapter manifest overrides an existing engine definition',
          );
        }
        installAdapter(adapter, manifest.url);
      }
      await prisma.adapterManifest.update({
        where: { id: manifest.id },
        data: { lastFetchedAt: new Date(), lastHash: hash, lastError: null },
      });
    } catch (err) {
      await prisma.adapterManifest.update({
        where: { id: manifest.id },
        data: { lastFetchedAt: new Date(), lastError: (err as Error).message },
      });
      throw err;
    }
  }
}
