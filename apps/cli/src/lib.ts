import { readFile } from 'node:fs/promises';
import type { SelectionRule, TestsSource } from '@tcs/shared-types';
import { MATCH_ALL_RULE } from '@tcs/shared-types';
import { parseRule } from '@tcs/core';

export interface SourceOptions {
  source: string;
  revision?: string;
}

/** A source starting with a git-ish scheme is fetched via git; anything else is a local path/.zip. */
export function toSource(options: SourceOptions): TestsSource {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(options.source)
    ? { type: 'git', url: options.source, revision: options.revision }
    : { type: 'local', path: options.source };
}

/** Resolves the effective selection rule from the CLI's `--rule`/`--rule-file`/`--path` options. */
export async function loadRule(
  rule?: string,
  ruleFile?: string,
  path?: string,
): Promise<SelectionRule> {
  let parsed: SelectionRule = MATCH_ALL_RULE;
  if (ruleFile) parsed = parseRule(JSON.parse(await readFile(ruleFile, 'utf8')));
  else if (rule) parsed = parseRule(JSON.parse(rule));
  return path ? { all: [{ pathUnder: path }, parsed] } : parsed;
}
