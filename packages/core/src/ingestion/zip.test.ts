import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractZip, ZipExtractionError } from './zip.js';

describe('extractZip', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'tcs-zip-test-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('extracts a well-formed archive, including nested directories', async () => {
    const zip = new AdmZip();
    zip.addFile('a.txt', Buffer.from('hello'));
    zip.addFile('nested/b.txt', Buffer.from('world'));
    const zipPath = path.join(workDir, 'good.zip');
    zip.writeZip(zipPath);

    const target = path.join(workDir, 'out');
    extractZip(zipPath, target);

    await expect(readFile(path.join(target, 'a.txt'), 'utf8')).resolves.toBe('hello');
    await expect(readFile(path.join(target, 'nested', 'b.txt'), 'utf8')).resolves.toBe('world');
  });

  it('rejects a zip entry that escapes the target directory (zip-slip)', async () => {
    // adm-zip's own addFile() normalizes ".." out of the entry name, so a
    // malicious entry has to be forged past that (this is exactly the shape
    // a hand-crafted malicious archive — not built with adm-zip — would take).
    const zip = new AdmZip();
    zip.addFile('placeholder.txt', Buffer.from('x'));
    zip.getEntries()[0]!.entryName = '../../evil.txt';
    const zipPath = path.join(workDir, 'evil.zip');
    zip.writeZip(zipPath);

    const target = path.join(workDir, 'out');
    expect(() => extractZip(zipPath, target)).toThrow(ZipExtractionError);
    expect(() => extractZip(zipPath, target)).toThrow(/escapes the extraction directory/);
  });

  it('wraps a corrupt/non-zip file in a ZipExtractionError', async () => {
    const badPath = path.join(workDir, 'not-a-zip.zip');
    await writeFile(badPath, 'this is not a zip file');

    expect(() => extractZip(badPath, path.join(workDir, 'out'))).toThrow(ZipExtractionError);
    expect(() => extractZip(badPath, path.join(workDir, 'out'))).toThrow(/Cannot read zip archive/);
  });

  it('allows an entry resolving exactly to the target directory root', async () => {
    // Guards the boundary condition in the escape check
    // (`destination !== resolvedTarget`) against false positives.
    await mkdir(workDir, { recursive: true });
    const zip = new AdmZip();
    zip.addFile('file.txt', Buffer.from('ok'));
    const zipPath = path.join(workDir, 'root.zip');
    zip.writeZip(zipPath);

    const target = path.join(workDir, 'out2');
    expect(() => extractZip(zipPath, target)).not.toThrow();
  });
});
