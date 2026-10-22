import type {
  ConditionOperator,
  DiscoveredTest,
  PropertyCondition,
  SelectionRule,
} from '@tcs/shared-types';
import { selectionRuleSchema } from '@tcs/shared-types';

/** Reads a possibly-nested property using a dot path (e.g. `execution.image`). */
export function getProperty(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function compareOrdered(actual: unknown, expected: unknown): number | undefined {
  if (typeof actual === 'number' && typeof expected === 'number') {
    return actual - expected;
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    return actual < expected ? -1 : actual > expected ? 1 : 0;
  }
  return undefined;
}

function evaluateOperator(actual: unknown, op: ConditionOperator, expected: unknown): boolean {
  switch (op) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'nin':
      return Array.isArray(expected) && !expected.includes(actual);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const cmp = compareOrdered(actual, expected);
      if (cmp === undefined) return false;
      if (op === 'gt') return cmp > 0;
      if (op === 'gte') return cmp >= 0;
      if (op === 'lt') return cmp < 0;
      return cmp <= 0;
    }
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(expected);
      if (typeof actual === 'string') return actual.includes(String(expected));
      return false;
    case 'matches': {
      if (typeof actual !== 'string' || typeof expected !== 'string') return false;
      try {
        return new RegExp(expected).test(actual);
      } catch {
        return false;
      }
    }
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
}

/** True when the test file lives at or under the given subtree. */
export function isPathUnder(file: string, subtree: string): boolean {
  const normalizedFile = normalizePath(file);
  const prefix = normalizePath(subtree);
  if (prefix === '') return true;
  return normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`);
}

function evaluateCondition(test: DiscoveredTest, condition: PropertyCondition): boolean {
  // Conditions are evaluated against the metadata first, with the discovery
  // fields (id, name, engine, file) available as fallback pseudo-properties.
  const fromMetadata = getProperty(test.metadata, condition.prop);
  const actual =
    fromMetadata !== undefined
      ? fromMetadata
      : getProperty({ id: test.id, name: test.name, engine: test.engine, file: test.file }, condition.prop);
  return evaluateOperator(actual, condition.op, condition.value);
}

/** Evaluates a selection rule (nested AND/OR/NOT tree) against one discovered test. */
export function evaluateRule(test: DiscoveredTest, rule: SelectionRule): boolean {
  if ('all' in rule) return rule.all.every((child) => evaluateRule(test, child));
  if ('any' in rule) return rule.any.some((child) => evaluateRule(test, child));
  if ('not' in rule) return !evaluateRule(test, rule.not);
  if ('pathUnder' in rule) return isPathUnder(test.file, rule.pathUnder);
  return evaluateCondition(test, rule);
}

/** Returns the subset of discovered tests selected by the rule (campaign preview). */
export function selectTests(tests: DiscoveredTest[], rule: SelectionRule): DiscoveredTest[] {
  return tests.filter((test) => evaluateRule(test, rule));
}

/** Parses and validates an untrusted rule (API payload, DB row). Throws ZodError. */
export function parseRule(input: unknown): SelectionRule {
  return selectionRuleSchema.parse(input);
}
