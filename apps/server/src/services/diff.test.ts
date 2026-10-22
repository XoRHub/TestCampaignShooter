import { describe, expect, it } from 'vitest';
import { diffRuns } from './diff.js';

const base = {
  runId: 'run-1',
  results: [
    { testId: 'a', name: 'A', outcome: 'passed' as const, durationMs: 1000 },
    { testId: 'b', name: 'B', outcome: 'failed' as const, durationMs: 2000 },
    { testId: 'c', name: 'C', outcome: 'failed' as const, durationMs: 500 },
    { testId: 'gone', name: 'Gone', outcome: 'passed' as const, durationMs: 100 },
  ],
};

const target = {
  runId: 'run-2',
  results: [
    { testId: 'a', name: 'A', outcome: 'failed' as const, durationMs: 1500 }, // regression
    { testId: 'b', name: 'B', outcome: 'passed' as const, durationMs: 1800 }, // fixed
    { testId: 'c', name: 'C', outcome: 'error' as const, durationMs: 500 }, // still failing
    { testId: 'fresh', name: 'Fresh', outcome: 'passed' as const, durationMs: 300 }, // new
  ],
};

describe('diffRuns', () => {
  const diff = diffRuns('camp-1', base, target);

  it('classifies regressions, fixes, new, removed and still-failing tests', () => {
    const byId = Object.fromEntries(diff.entries.map((e) => [e.testId, e.change]));
    expect(byId).toEqual({
      a: 'regression',
      b: 'fixed',
      c: 'still-failing',
      fresh: 'new',
      gone: 'removed',
    });
    expect(diff.summary).toEqual({
      regression: 1,
      fixed: 1,
      new: 1,
      removed: 1,
      'still-failing': 1,
      stable: 0,
    });
  });

  it('computes duration deltas and orders regressions first', () => {
    expect(diff.entries[0]?.change).toBe('regression');
    expect(diff.entries.find((e) => e.testId === 'a')?.durationDeltaMs).toBe(500);
    expect(diff.entries.find((e) => e.testId === 'fresh')?.durationDeltaMs).toBeUndefined();
  });
});
