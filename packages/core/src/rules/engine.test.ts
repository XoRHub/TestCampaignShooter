import { describe, expect, it } from 'vitest';
import type { DiscoveredTest, SelectionRule } from '@tcs/shared-types';
import { evaluateRule, isPathUnder, parseRule, selectTests } from './engine.js';

function makeTest(overrides: Partial<DiscoveredTest> & { extra?: Record<string, unknown> } = {}): DiscoveredTest {
  const { extra, ...rest } = overrides;
  return {
    id: 'suites/checkout/smoke-01',
    name: 'Checkout smoke',
    engine: 'cypress',
    file: 'suites/checkout/smoke-01.cy.ts',
    metadataFile: 'suites/checkout/smoke-01.metadata.json',
    metadata: {
      engine: 'cypress',
      execution: {},
      tags: ['smoke', 'checkout'],
      team: 'payments',
      criticality: 3,
      flaky: false,
      ...extra,
    },
    ...rest,
  };
}

describe('evaluateRule — elementary conditions', () => {
  it.each<[SelectionRule, boolean]>([
    [{ prop: 'team', op: 'eq', value: 'payments' }, true],
    [{ prop: 'team', op: 'eq', value: 'search' }, false],
    [{ prop: 'team', op: 'ne', value: 'search' }, true],
    [{ prop: 'team', op: 'in', value: ['payments', 'search'] }, true],
    [{ prop: 'team', op: 'nin', value: ['search'] }, true],
    [{ prop: 'criticality', op: 'gte', value: 3 }, true],
    [{ prop: 'criticality', op: 'gt', value: 3 }, false],
    [{ prop: 'criticality', op: 'lt', value: 4 }, true],
    [{ prop: 'criticality', op: 'lte', value: 2 }, false],
    [{ prop: 'tags', op: 'contains', value: 'smoke' }, true],
    [{ prop: 'tags', op: 'contains', value: 'nightly' }, false],
    [{ prop: 'name', op: 'matches', value: '^Checkout' }, true],
    [{ prop: 'owner', op: 'exists' }, false],
    [{ prop: 'team', op: 'exists' }, true],
  ])('%j → %s', (rule, expected) => {
    expect(evaluateRule(makeTest(), rule)).toBe(expected);
  });

  it('reads nested properties with dot paths', () => {
    const test = makeTest({ extra: { execution: { image: 'cypress/included:13' } } });
    expect(evaluateRule(test, { prop: 'execution.image', op: 'matches', value: 'cypress' })).toBe(true);
  });

  it('falls back to discovery fields (engine, file, id) when absent from metadata', () => {
    expect(evaluateRule(makeTest(), { prop: 'engine', op: 'eq', value: 'cypress' })).toBe(true);
    expect(evaluateRule(makeTest(), { prop: 'file', op: 'matches', value: '\\.cy\\.ts$' })).toBe(true);
  });

  it('never throws on an invalid regex', () => {
    expect(evaluateRule(makeTest(), { prop: 'name', op: 'matches', value: '([' })).toBe(false);
  });
});

describe('evaluateRule — boolean composition', () => {
  const nested: SelectionRule = {
    all: [
      { prop: 'tags', op: 'contains', value: 'smoke' },
      {
        any: [
          { prop: 'team', op: 'eq', value: 'payments' },
          { prop: 'criticality', op: 'gte', value: 4 },
        ],
      },
      { not: { prop: 'flaky', op: 'eq', value: true } },
    ],
  };

  it('supports arbitrarily nested all/any/not', () => {
    expect(evaluateRule(makeTest(), nested)).toBe(true);
    expect(evaluateRule(makeTest({ extra: { flaky: true } }), nested)).toBe(false);
    expect(evaluateRule(makeTest({ extra: { team: 'search', criticality: 2 } }), nested)).toBe(false);
    expect(evaluateRule(makeTest({ extra: { team: 'search', criticality: 5 } }), nested)).toBe(true);
  });

  it('supports deep nesting (not > any > all)', () => {
    const rule: SelectionRule = {
      not: {
        any: [
          { all: [{ prop: 'team', op: 'eq', value: 'payments' }, { prop: 'criticality', op: 'lt', value: 2 }] },
          { prop: 'tags', op: 'contains', value: 'quarantine' },
        ],
      },
    };
    expect(evaluateRule(makeTest(), rule)).toBe(true);
  });
});

describe('pathUnder', () => {
  it('matches files inside the subtree only', () => {
    expect(isPathUnder('suites/checkout/smoke.cy.ts', 'suites/checkout')).toBe(true);
    expect(isPathUnder('suites/checkout-v2/smoke.cy.ts', 'suites/checkout')).toBe(false);
    expect(isPathUnder('suites/search/a.robot', 'suites/checkout')).toBe(false);
    expect(isPathUnder('anything', '')).toBe(true);
  });

  it('combines with property conditions', () => {
    const rule: SelectionRule = {
      all: [{ pathUnder: 'suites/checkout' }, { prop: 'tags', op: 'contains', value: 'smoke' }],
    };
    expect(evaluateRule(makeTest(), rule)).toBe(true);
    expect(evaluateRule(makeTest({ file: 'suites/search/smoke.cy.ts' }), rule)).toBe(false);
  });
});

describe('selectTests', () => {
  it('returns the preview of matching tests', () => {
    const tests = [
      makeTest(),
      makeTest({ id: 't2', file: 'suites/search/a.cy.ts', extra: { team: 'search', tags: [] } }),
    ];
    const selected = selectTests(tests, { prop: 'team', op: 'eq', value: 'payments' });
    expect(selected.map((t) => t.id)).toEqual(['suites/checkout/smoke-01']);
  });
});

describe('parseRule', () => {
  it('accepts valid nested rules', () => {
    expect(() =>
      parseRule({ all: [{ any: [{ prop: 'a', op: 'eq', value: 1 }] }, { pathUnder: 'x' }] }),
    ).not.toThrow();
  });

  it('rejects unknown operators and malformed nodes', () => {
    expect(() => parseRule({ prop: 'a', op: 'like', value: 1 })).toThrow();
    expect(() => parseRule({ all: [] })).toThrow();
    expect(() => parseRule({ nope: true })).toThrow();
  });
});
