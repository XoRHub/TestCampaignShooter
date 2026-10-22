import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRule, toSource } from './lib.js';

describe('toSource', () => {
  it.each([
    ['https://github.com/org/repo.git', 'git'],
    ['http://internal.git.example/repo.git', 'git'],
    ['git@github.com:org/repo.git', 'git'],
    ['ssh://git@github.com/org/repo.git', 'git'],
  ])('treats %s as a %s source', (source, expectedType) => {
    expect(toSource({ source }).type).toBe(expectedType);
  });

  it.each([['./local/path'], ['/abs/local/path'], ['archive.zip'], ['C:\\Windows\\path']])(
    'treats %s as a local source',
    (source) => {
      expect(toSource({ source })).toEqual({ type: 'local', path: source });
    },
  );

  it('carries the revision through for a git source', () => {
    expect(toSource({ source: 'https://github.com/org/repo.git', revision: 'v1.2.3' })).toEqual({
      type: 'git',
      url: 'https://github.com/org/repo.git',
      revision: 'v1.2.3',
    });
  });
});

describe('loadRule', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tcs-cli-loadrule-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('defaults to matching everything when nothing is given', async () => {
    const rule = await loadRule();
    expect(rule).toEqual({ all: [{ prop: 'engine', op: 'exists' }] });
  });

  it('parses an inline JSON rule', async () => {
    const rule = await loadRule('{"prop":"tags","op":"contains","value":"smoke"}');
    expect(rule).toEqual({ prop: 'tags', op: 'contains', value: 'smoke' });
  });

  it('loads a rule from a file, taking precedence over an inline rule', async () => {
    const ruleFile = path.join(dir, 'rule.json');
    await writeFile(ruleFile, JSON.stringify({ prop: 'team', op: 'eq', value: 'payments' }));

    const rule = await loadRule('{"prop":"tags","op":"contains","value":"smoke"}', ruleFile);
    expect(rule).toEqual({ prop: 'team', op: 'eq', value: 'payments' });
  });

  it('wraps the rule with a pathUnder condition when a path is given', async () => {
    const rule = await loadRule(undefined, undefined, 'suites/checkout');
    expect(rule).toEqual({
      all: [{ pathUnder: 'suites/checkout' }, { all: [{ prop: 'engine', op: 'exists' }] }],
    });
  });

  it('rejects a rule that fails schema validation', async () => {
    await expect(loadRule('{"prop":"tags","op":"not-a-real-op"}')).rejects.toThrow();
  });
});
