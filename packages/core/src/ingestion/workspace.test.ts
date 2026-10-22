import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace } from './workspace.js';

describe('createWorkspace', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'tcs-workspace-test-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('creates a fresh, writable directory under the given base', async () => {
    const workspace = await createWorkspace(baseDir);
    expect(workspace.root.startsWith(baseDir)).toBe(true);

    const info = await stat(workspace.root);
    expect(info.isDirectory()).toBe(true);

    await writeFile(path.join(workspace.root, 'file.txt'), 'content');
    await expect(readFile(path.join(workspace.root, 'file.txt'), 'utf8')).resolves.toBe('content');

    await workspace.cleanup();
  });

  it('creates distinct directories on each call', async () => {
    const a = await createWorkspace(baseDir);
    const b = await createWorkspace(baseDir);
    expect(a.root).not.toBe(b.root);
    await a.cleanup();
    await b.cleanup();
  });

  it('cleanup removes the directory and is safe to call twice', async () => {
    const workspace = await createWorkspace(baseDir);
    await workspace.cleanup();
    await expect(stat(workspace.root)).rejects.toThrow();
    await expect(workspace.cleanup()).resolves.toBeUndefined();
  });

  it('creates the base directory itself when it does not exist yet', async () => {
    const missingBase = path.join(baseDir, 'does', 'not', 'exist', 'yet');
    const workspace = await createWorkspace(missingBase);
    expect(workspace.root.startsWith(missingBase)).toBe(true);
    await workspace.cleanup();
  });
});
