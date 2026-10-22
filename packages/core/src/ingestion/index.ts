import { cp, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import type { TestsSource } from '@tcs/shared-types';
import { createWorkspace } from './workspace.js';
import { extractZip } from './zip.js';
import { fetchGitSource } from './git.js';

export { createWorkspace, type Workspace } from './workspace.js';
export { extractZip, ZipExtractionError } from './zip.js';
export { fetchGitSource, GitIngestionError } from './git.js';

export interface FetchedSource {
  /** Directory containing the test tree, ready for discovery. */
  rootDir: string;
  /** Cleans the temporary workspace (no-op safe to call twice). */
  cleanup: () => Promise<void>;
}

/**
 * Materializes a tests source (git repository or local directory) into a
 * working directory. A source pointing at a `.zip` file is extracted
 * automatically, and so is any top-level `*.zip` found after fetching.
 */
export async function fetchSource(
  source: TestsSource,
  opts: { workspaceBaseDir?: string } = {},
): Promise<FetchedSource> {
  const workspace = await createWorkspace(opts.workspaceBaseDir);
  try {
    if (source.type === 'git') {
      const checkout = path.join(workspace.root, 'checkout');
      await fetchGitSource({
        url: source.url,
        revision: source.revision,
        tokenSecretRef: source.tokenSecretRef,
        targetDir: checkout,
      });
      await extractTopLevelArchives(checkout);
      return { rootDir: checkout, cleanup: workspace.cleanup };
    }

    const sourcePath = path.resolve(source.path);
    const info = await stat(sourcePath).catch(() => {
      throw new Error(`Local source not found: ${sourcePath}`);
    });

    if (info.isFile() && sourcePath.toLowerCase().endsWith('.zip')) {
      const extracted = path.join(workspace.root, 'extracted');
      extractZip(sourcePath, extracted);
      return { rootDir: extracted, cleanup: workspace.cleanup };
    }
    if (!info.isDirectory()) {
      throw new Error(`Local source must be a directory or a .zip file: ${sourcePath}`);
    }

    // Copy into the workspace so discovery/execution never mutates the original tree.
    const copy = path.join(workspace.root, 'source');
    await cp(sourcePath, copy, { recursive: true, filter: (src) => !src.includes('node_modules') });
    await extractTopLevelArchives(copy);
    return { rootDir: copy, cleanup: workspace.cleanup };
  } catch (err) {
    await workspace.cleanup();
    throw err;
  }
}

/** Extracts every `foo.zip` found at the root of `dir` into `dir/foo/`. */
async function extractTopLevelArchives(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
      const zipPath = path.join(dir, entry.name);
      extractZip(zipPath, path.join(dir, entry.name.slice(0, -'.zip'.length)));
      await rm(zipPath, { force: true });
    }
  }
}
