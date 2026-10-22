import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { JUnitReport, JUnitTestCase, TestOutcome } from '@tcs/shared-types';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['testsuite', 'testcase'].includes(name),
});

interface RawCase {
  '@_name'?: string;
  '@_classname'?: string;
  '@_time'?: string;
  failure?: unknown;
  error?: unknown;
  skipped?: unknown;
  'system-out'?: unknown;
}

function caseOutcome(raw: RawCase): TestOutcome {
  if (raw.failure !== undefined) return 'failed';
  if (raw.error !== undefined) return 'error';
  if (raw.skipped !== undefined) return 'skipped';
  return 'passed';
}

function failureMessage(raw: RawCase): string | undefined {
  const node = raw.failure ?? raw.error;
  if (node === undefined) return undefined;
  const first = Array.isArray(node) ? node[0] : node;
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') {
    const obj = first as Record<string, unknown>;
    return String(obj['@_message'] ?? obj['#text'] ?? 'failure');
  }
  return 'failure';
}

/**
 * Parses a JUnit XML report. `defaultTestId` associates every parsed case to
 * a TestCampaignShooter test id (one partial report per test node).
 */
export function parseJUnitXml(xml: string, defaultTestId = ''): JUnitReport {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const suitesRoot = (doc.testsuites ?? doc) as Record<string, unknown>;
  const suites: Record<string, unknown>[] = Array.isArray(suitesRoot.testsuite)
    ? (suitesRoot.testsuite as Record<string, unknown>[])
    : doc.testsuite
      ? (doc.testsuite as Record<string, unknown>[])
      : [];

  const cases: JUnitTestCase[] = [];
  for (const suite of suites) {
    const rawCases = (suite.testcase ?? []) as RawCase[];
    for (const raw of rawCases) {
      cases.push({
        testId: defaultTestId || String(suite['@_name'] ?? raw['@_classname'] ?? raw['@_name'] ?? ''),
        name: String(raw['@_name'] ?? 'unnamed'),
        classname: raw['@_classname'] ? String(raw['@_classname']) : undefined,
        outcome: caseOutcome(raw),
        durationMs: Math.round(Number(raw['@_time'] ?? 0) * 1000),
        message: failureMessage(raw),
      });
    }
  }

  const count = (outcome: TestOutcome) => cases.filter((c) => c.outcome === outcome).length;
  return {
    total: cases.length,
    passed: count('passed'),
    failed: count('failed'),
    errors: count('error'),
    skipped: count('skipped'),
    durationMs: cases.reduce((sum, c) => sum + c.durationMs, 0),
    cases,
  };
}

/** Overall outcome of one test node from its (single-test) JUnit report. */
export function reportOutcome(report: JUnitReport): TestOutcome {
  if (report.errors > 0) return 'error';
  if (report.failed > 0) return 'failed';
  if (report.total > 0 && report.skipped === report.total) return 'skipped';
  return 'passed';
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
});

/**
 * Merges per-test JUnit partial reports into a single `<testsuites>` document:
 * one `<testsuite>` per test node, named after its test id.
 */
export function buildMergedJUnitXml(parts: Array<{ testId: string; xml: string }>): string {
  const suites = parts.map(({ testId, xml }) => {
    const report = parseJUnitXml(xml, testId);
    return {
      '@_name': testId,
      '@_tests': String(report.total),
      '@_failures': String(report.failed),
      '@_errors': String(report.errors),
      '@_skipped': String(report.skipped),
      '@_time': (report.durationMs / 1000).toFixed(3),
      testcase: report.cases.map((c) => ({
        '@_name': c.name,
        '@_classname': c.classname ?? testId,
        '@_time': (c.durationMs / 1000).toFixed(3),
        ...(c.outcome === 'failed' ? { failure: { '@_message': c.message ?? 'failed' } } : {}),
        ...(c.outcome === 'error' ? { error: { '@_message': c.message ?? 'error' } } : {}),
        ...(c.outcome === 'skipped' ? { skipped: {} } : {}),
      })),
    };
  });

  const totals = parts.map(({ testId, xml }) => parseJUnitXml(xml, testId));
  const doc = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    testsuites: {
      '@_tests': String(totals.reduce((s, r) => s + r.total, 0)),
      '@_failures': String(totals.reduce((s, r) => s + r.failed, 0)),
      '@_errors': String(totals.reduce((s, r) => s + r.errors, 0)),
      '@_time': (totals.reduce((s, r) => s + r.durationMs, 0) / 1000).toFixed(3),
      testsuite: suites,
    },
  };
  return builder.build(doc) as string;
}
