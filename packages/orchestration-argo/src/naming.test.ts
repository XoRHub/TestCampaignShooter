import { describe, expect, it } from 'vitest';
import { stepTemplateName, testNodeName, workflowName } from './naming.js';

describe('testNodeName', () => {
  it('sanitizes to lowercase DNS-1123-ish characters with a deterministic hash suffix', () => {
    const name = testNodeName('Suites/Checkout/Smoke.cy.ts');
    expect(name).toMatch(/^t-[a-z0-9-]+$/);
    expect(name).toBe(testNodeName('Suites/Checkout/Smoke.cy.ts'));
  });

  it('produces different names for different ids even after truncation collisions', () => {
    const longIdA = `${'a'.repeat(50)}-1`;
    const longIdB = `${'a'.repeat(50)}-2`;
    expect(testNodeName(longIdA)).not.toBe(testNodeName(longIdB));
  });

  it('collapses runs of invalid characters and trims leading/trailing dashes', () => {
    const name = testNodeName('___weird!!!id___');
    expect(name).toMatch(/^t-weird-id-[a-f0-9]{8}$/);
  });

  it('falls back to just the hash when the id sanitizes to nothing', () => {
    const name = testNodeName('!!!');
    expect(name).toMatch(/^t-[a-f0-9]{8}$/);
  });
});

describe('workflowName', () => {
  it('prefixes with tcs-run- and sanitizes the run id', () => {
    expect(workflowName('Run_ABC-123')).toBe('tcs-run-run-abc-123');
  });

  it('truncates very long run ids', () => {
    const name = workflowName('x'.repeat(100));
    expect(name.length).toBeLessThanOrEqual('tcs-run-'.length + 40);
  });
});

describe('stepTemplateName', () => {
  it('prefixes with tcs-step- and lowercases the engine name', () => {
    expect(stepTemplateName('Cypress')).toBe('tcs-step-cypress');
  });

  it('sanitizes invalid characters in the engine name', () => {
    expect(stepTemplateName('generic_java!')).toBe('tcs-step-generic-java-');
  });
});
