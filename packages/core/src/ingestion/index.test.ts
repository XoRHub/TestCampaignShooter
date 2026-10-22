import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchSource } from './index.js';

describe('fetchSource (local sources)', () => {
  let baseDir: string;
  let workspaceBaseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'tcs-fetch-source-'));
    workspaceBaseDir = path.join(baseDir, 'workspaces');
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('copies a local directory into an isolated workspace, excluding node_modules', async () => {
    const sourceDir = path.join(baseDir, 'source');
    await mkdir(path.join(sourceDir, 'node_modules', 'dep'), { recursive: true });
    await writeFile(path.join(sourceDir, 'node_modules', 'dep', 'index.js'), '');
    await writeFile(path.join(sourceDir, 'test.robot'), '*** Test Cases ***');

    const fetched = await fetchSource({ type: 'local', path: sourceDir }, { workspaceBaseDir });
    try {
      expect(fetched.rootDir).not.toBe(sourceDir);
      await expect(readFile(path.join(fetched.rootDir, 'test.robot'), 'utf8')).resolves.toContain(
        'Test Cases',
      );
      await expect(
        readFile(path.join(fetched.rootDir, 'node_modules', 'dep', 'index.js'), 'utf8'),
      ).rejects.toThrow();
    } finally {
      await fetched.cleanup();
    }
  });

  it('extracts a local .zip source directly', async () => {
    const zip = new AdmZip();
    zip.addFile('suite.robot', Buffer.from('*** Test Cases ***'));
    const zipPath = path.join(baseDir, 'source.zip');
    zip.writeZip(zipPath);

    const fetched = await fetchSource({ type: 'local', path: zipPath }, { workspaceBaseDir });
    try {
      await expect(readFile(path.join(fetched.rootDir, 'suite.robot'), 'utf8')).resolves.toContain(
        'Test Cases',
      );
    } finally {
      await fetched.cleanup();
    }
  });

  it('auto-extracts a top-level *.zip found after copying a local directory', async () => {
    const sourceDir = path.join(baseDir, 'source-with-archive');
    await mkdir(sourceDir, { recursive: true });
    const nestedZip = new AdmZip();
    nestedZip.addFile('inner.robot', Buffer.from('*** Test Cases ***'));
    nestedZip.writeZip(path.join(sourceDir, 'bundle.zip'));

    const fetched = await fetchSource({ type: 'local', path: sourceDir }, { workspaceBaseDir });
    try {
      await expect(
        readFile(path.join(fetched.rootDir, 'bundle', 'inner.robot'), 'utf8'),
      ).resolves.toContain('Test Cases');
    } finally {
      await fetched.cleanup();
    }
  });

  it('rejects a local path that does not exist', async () => {
    await expect(
      fetchSource({ type: 'local', path: path.join(baseDir, 'missing') }, { workspaceBaseDir }),
    ).rejects.toThrow(/not found/);
  });

  it('rejects a local path that is neither a directory nor a .zip file', async () => {
    const filePath = path.join(baseDir, 'plain.txt');
    await writeFile(filePath, 'not an archive');

    await expect(
      fetchSource({ type: 'local', path: filePath }, { workspaceBaseDir }),
    ).rejects.toThrow(/must be a directory or a \.zip file/);
  });
});
