import { describe, expect, it } from 'vitest';
import { parseJUnitXml } from '@tcs/core';
import { aggregateReportByTest } from './results.js';

// Realistic aggregated report: one <testsuite> per test node named by test id.
const MERGED = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="5" failures="1" errors="1" time="4.100">
  <testsuite name="unit/math" tests="2" failures="0" errors="0" time="2.000">
    <testcase name="adds numbers" classname="math" time="1.5"/>
    <testcase name="multiplies numbers" classname="math" time="0.5"/>
  </testsuite>
  <testsuite name="unit/strings" tests="1" failures="1" errors="0" time="0.100">
    <testcase name="uppercases" classname="strings" time="0.1">
      <failure message="expected HELLO got HeLLo"/>
    </testcase>
  </testsuite>
  <testsuite name="api/login" tests="2" failures="0" errors="1" time="2.000">
    <testcase name="ok" time="1.0"/>
    <testcase name="boom" time="1.0"><error message="connection refused"/></testcase>
  </testsuite>
</testsuites>`;

describe('aggregateReportByTest', () => {
  const rows = aggregateReportByTest(parseJUnitXml(MERGED));
  const byId = Object.fromEntries(rows.map((r) => [r.testId, r]));

  it('produces one row per test node keyed by suite name (= test id)', () => {
    expect(rows.map((r) => r.testId).sort()).toEqual(['api/login', 'unit/math', 'unit/strings']);
  });

  it('aggregates outcome (worst wins) and duration (summed)', () => {
    expect(byId['unit/math']).toMatchObject({ outcome: 'passed', durationMs: 2000 });
    expect(byId['unit/strings']).toMatchObject({
      outcome: 'failed',
      durationMs: 100,
      message: 'expected HELLO got HeLLo',
    });
    expect(byId['api/login']).toMatchObject({ outcome: 'error', durationMs: 2000 });
  });
});
