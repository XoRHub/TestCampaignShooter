import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  testMetadataSchema,
  type DiscoveredTest,
  type DiscoveryIssue,
  type TestMetadata,
} from '@tcs/shared-types';

export const METADATA_SUFFIX = '.metadata.json';

/**
 * Heuristics used only to *warn* about probable test files lacking an adjacent
 * metadata file. Actual discovery is driven exclusively by metadata files.
 */
const LIKELY_TEST_FILE_PATTERNS = [
  '**/*.robot',
  '**/*.cy.{js,ts,jsx,tsx}',
  '**/*.spec.{js,ts,jsx,tsx}',
  '**/*.test.{js,ts,jsx,tsx}',
  '**/test_*.py',
  '**/*_test.py',
  '**/*Test.java',
  '**/*IT.java',
];

const IGNORED = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/__pycache__/**'];

export interface DiscoveryResult {
  tests: DiscoveredTest[];
  issues: DiscoveryIssue[];
}

export interface DiscoverOptions {
  /** When provided, metadata whose `engine` is not in this list raises an issue. */
  knownEngines?: readonly string[];
}

/**
 * Walks the source tree and builds the list of executable tests from
 * `<test>.metadata.json` files, validating each one and reporting precise
 * issues (missing metadata, invalid JSON, schema violations, unknown engine,
 * duplicate ids) without aborting the whole discovery.
 */
export async function discoverTests(
  rootDir: string,
  options: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const allFiles = await fg('**/*', { cwd: rootDir, ignore: IGNORED, dot: false });
  const fileSet = new Set(allFiles);
  const metadataFiles = allFiles.filter((f) => f.endsWith(METADATA_SUFFIX)).sort();

  const tests: DiscoveredTest[] = [];
  const issues: DiscoveryIssue[] = [];
  const seenIds = new Map<string, string>();

  await Promise.all(
    metadataFiles.map(async (metadataFile) => {
      const testFile = metadataFile.slice(0, -METADATA_SUFFIX.length);
      if (!fileSet.has(testFile)) {
        issues.push({
          file: metadataFile,
          kind: 'missing-metadata',
          message: `Metadata file has no adjacent test file "${testFile}"`,
        });
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(path.join(rootDir, metadataFile), 'utf8'));
      } catch (err) {
        issues.push({
          file: metadataFile,
          kind: 'invalid-json',
          message: `Invalid JSON: ${(err as Error).message}`,
        });
        return;
      }

      const parsed = testMetadataSchema.safeParse(raw);
      if (!parsed.success) {
        issues.push({
          file: metadataFile,
          kind: 'invalid-metadata',
          message: parsed.error.issues
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; '),
        });
        return;
      }

      const metadata: TestMetadata = parsed.data;
      if (options.knownEngines && !options.knownEngines.includes(metadata.engine)) {
        issues.push({
          file: metadataFile,
          kind: 'unknown-engine',
          message: `Unknown engine "${metadata.engine}" (known: ${options.knownEngines.join(', ')})`,
        });
        return;
      }

      const id = metadata.id ?? testFile;
      tests.push({
        id,
        name: metadata.name ?? path.posix.basename(testFile),
        engine: metadata.engine,
        file: testFile,
        metadataFile,
        metadata,
      });
    }),
  );

  // Deterministic order + duplicate id detection (map insertion order is async-dependent).
  tests.sort((a, b) => a.file.localeCompare(b.file));
  const deduped: DiscoveredTest[] = [];
  for (const test of tests) {
    const existing = seenIds.get(test.id);
    if (existing) {
      issues.push({
        file: test.metadataFile,
        kind: 'duplicate-id',
        message: `Duplicate test id "${test.id}" (already used by ${existing})`,
      });
      continue;
    }
    seenIds.set(test.id, test.metadataFile);
    deduped.push(test);
  }

  // Warn about likely test files with no metadata next to them.
  const likelyTests = await fg(LIKELY_TEST_FILE_PATTERNS, { cwd: rootDir, ignore: IGNORED });
  for (const file of likelyTests.sort()) {
    if (!fileSet.has(`${file}${METADATA_SUFFIX}`)) {
      issues.push({
        file,
        kind: 'missing-metadata',
        message: `Probable test file without a "${path.posix.basename(file)}${METADATA_SUFFIX}" metadata file — it will not be part of any campaign`,
      });
    }
  }

  return { tests: deduped, issues };
}
