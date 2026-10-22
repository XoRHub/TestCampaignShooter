import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** An isolated working directory for one ingestion, always cleaned up by the caller. */
export interface Workspace {
  root: string;
  cleanup: () => Promise<void>;
}

export async function createWorkspace(baseDir?: string): Promise<Workspace> {
  const base = baseDir ?? path.join(tmpdir(), 'tcs-workspaces');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'ws-'));
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
