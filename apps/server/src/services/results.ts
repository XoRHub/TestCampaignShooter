import type { JUnitReport, TestOutcome } from '@tcs/shared-types';

export interface PerTestResult {
  testId: string;
  outcome: TestOutcome;
  durationMs: number;
  message?: string;
}

/**
 * Folds the parsed aggregated JUnit report (one <testsuite> per test node,
 * named by test id, possibly several <testcase> each) into one row per test:
 * worst outcome wins (error > failed > skipped-only > passed), durations are
 * summed, the first failure message is kept.
 */
export function aggregateReportByTest(report: JUnitReport): PerTestResult[] {
  const perTest = new Map<string, { outcomes: TestOutcome[]; durationMs: number; message?: string }>();
  for (const testCase of report.cases) {
    if (!testCase.testId) continue;
    const entry = perTest.get(testCase.testId) ?? { outcomes: [], durationMs: 0 };
    entry.outcomes.push(testCase.outcome);
    entry.durationMs += testCase.durationMs;
    entry.message ??= testCase.message;
    perTest.set(testCase.testId, entry);
  }
  return [...perTest.entries()].map(([testId, entry]) => ({
    testId,
    outcome: entry.outcomes.includes('error')
      ? 'error'
      : entry.outcomes.includes('failed')
        ? 'failed'
        : entry.outcomes.every((o) => o === 'skipped')
          ? 'skipped'
          : 'passed',
    durationMs: entry.durationMs,
    message: entry.message,
  }));
}
