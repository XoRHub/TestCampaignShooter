import type { DiffChange, RunDiff, RunDiffEntry, TestOutcome } from '@tcs/shared-types';

export interface DiffableResult {
  testId: string;
  name: string;
  outcome: TestOutcome;
  durationMs: number;
}

function isFailing(outcome: TestOutcome): boolean {
  return outcome === 'failed' || outcome === 'error';
}

/**
 * Computes the delta between two runs of the same campaign: regressions
 * (passed → failed), fixes (failed → passed), new/removed tests and duration
 * variations.
 */
export function diffRuns(
  campaignId: string,
  base: { runId: string; results: DiffableResult[] },
  target: { runId: string; results: DiffableResult[] },
): RunDiff {
  const baseById = new Map(base.results.map((r) => [r.testId, r]));
  const targetById = new Map(target.results.map((r) => [r.testId, r]));
  const entries: RunDiffEntry[] = [];

  for (const after of target.results) {
    const before = baseById.get(after.testId);
    let change: DiffChange;
    if (!before) {
      change = 'new';
    } else if (isFailing(after.outcome) && !isFailing(before.outcome)) {
      change = 'regression';
    } else if (!isFailing(after.outcome) && isFailing(before.outcome)) {
      change = 'fixed';
    } else if (isFailing(after.outcome)) {
      change = 'still-failing';
    } else {
      change = 'stable';
    }
    entries.push({
      testId: after.testId,
      name: after.name,
      change,
      before: before ? { outcome: before.outcome, durationMs: before.durationMs } : undefined,
      after: { outcome: after.outcome, durationMs: after.durationMs },
      durationDeltaMs: before ? after.durationMs - before.durationMs : undefined,
    });
  }

  for (const before of base.results) {
    if (!targetById.has(before.testId)) {
      entries.push({
        testId: before.testId,
        name: before.name,
        change: 'removed',
        before: { outcome: before.outcome, durationMs: before.durationMs },
      });
    }
  }

  const order: DiffChange[] = ['regression', 'fixed', 'new', 'removed', 'still-failing', 'stable'];
  entries.sort(
    (a, b) => order.indexOf(a.change) - order.indexOf(b.change) || a.testId.localeCompare(b.testId),
  );

  const summary = Object.fromEntries(order.map((c) => [c, 0])) as Record<DiffChange, number>;
  for (const entry of entries) summary[entry.change] += 1;

  return { campaignId, baseRunId: base.runId, targetRunId: target.runId, summary, entries };
}
