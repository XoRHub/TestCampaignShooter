/** Outcome of one test case parsed from a JUnit report. */
export type TestOutcome = 'passed' | 'failed' | 'error' | 'skipped';

export interface JUnitTestCase {
  /** TestCampaignShooter test id (deterministic node/suite name). */
  testId: string;
  name: string;
  classname?: string;
  outcome: TestOutcome;
  durationMs: number;
  message?: string;
  systemOut?: string;
}

export interface JUnitReport {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  durationMs: number;
  cases: JUnitTestCase[];
}

/** Kind of change of one test between two runs of the same campaign. */
export type DiffChange = 'regression' | 'fixed' | 'new' | 'removed' | 'still-failing' | 'stable';

export interface RunDiffEntry {
  testId: string;
  name: string;
  change: DiffChange;
  before?: { outcome: TestOutcome; durationMs: number };
  after?: { outcome: TestOutcome; durationMs: number };
  durationDeltaMs?: number;
}

export interface RunDiff {
  campaignId: string;
  baseRunId: string;
  targetRunId: string;
  summary: Record<DiffChange, number>;
  entries: RunDiffEntry[];
}
