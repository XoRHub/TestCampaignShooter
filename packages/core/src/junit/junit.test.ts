import { describe, expect, it } from 'vitest';
import { buildMergedJUnitXml, parseJUnitXml, reportOutcome } from './junit.js';

const PASSING = `<?xml version="1.0"?>
<testsuites><testsuite name="smoke" tests="2" failures="0">
  <testcase name="adds to cart" classname="checkout" time="1.5"/>
  <testcase name="pays" classname="checkout" time="0.5"/>
</testsuite></testsuites>`;

const FAILING = `<testsuite name="login" tests="2">
  <testcase name="ok" time="0.2"/>
  <testcase name="bad password" time="0.3"><failure message="expected 200 got 401"/></testcase>
</testsuite>`;

describe('parseJUnitXml', () => {
  it('parses testsuites and testsuite roots', () => {
    const report = parseJUnitXml(PASSING, 'checkout-smoke');
    expect(report.total).toBe(2);
    expect(report.passed).toBe(2);
    expect(report.durationMs).toBe(2000);
    expect(report.cases[0]?.testId).toBe('checkout-smoke');

    const failing = parseJUnitXml(FAILING, 'login');
    expect(failing.failed).toBe(1);
    expect(failing.cases[1]?.message).toBe('expected 200 got 401');
  });

  it('computes the overall outcome of a test node', () => {
    expect(reportOutcome(parseJUnitXml(PASSING, 't'))).toBe('passed');
    expect(reportOutcome(parseJUnitXml(FAILING, 't'))).toBe('failed');
  });
});

describe('buildMergedJUnitXml', () => {
  it('merges partial reports into one testsuites document', () => {
    const merged = buildMergedJUnitXml([
      { testId: 'checkout-smoke', xml: PASSING },
      { testId: 'login', xml: FAILING },
    ]);
    expect(merged).toContain('<testsuites');
    expect(merged).toContain('tests="4"');
    expect(merged).toContain('failures="1"');
    expect(merged).toContain('name="checkout-smoke"');
    expect(merged).toContain('name="login"');

    // The merged document itself is parseable.
    const reparsed = parseJUnitXml(merged);
    expect(reparsed.total).toBe(4);
    expect(reparsed.failed).toBe(1);
  });
});
