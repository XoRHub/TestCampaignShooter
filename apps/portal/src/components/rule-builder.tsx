'use client';

import type { ConditionOperator, PropertyCondition, SelectionRule } from '@tcs/shared-types';
import { conditionOperators } from '@tcs/shared-types';

type Kind = 'all' | 'any' | 'not' | 'condition' | 'pathUnder';

function kindOf(rule: SelectionRule): Kind {
  if ('all' in rule) return 'all';
  if ('any' in rule) return 'any';
  if ('not' in rule) return 'not';
  if ('pathUnder' in rule) return 'pathUnder';
  return 'condition';
}

function defaultOf(kind: Kind): SelectionRule {
  switch (kind) {
    case 'all':
      return { all: [defaultOf('condition')] };
    case 'any':
      return { any: [defaultOf('condition')] };
    case 'not':
      return { not: defaultOf('condition') };
    case 'pathUnder':
      return { pathUnder: '' };
    case 'condition':
      return { prop: 'tags', op: 'contains', value: 'smoke' };
  }
}

function parseScalar(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

function parseValue(text: string, op: ConditionOperator): unknown {
  if (op === 'in' || op === 'nin') return text.split(',').map((part) => parseScalar(part));
  return parseScalar(text);
}

function valueToText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  return value === undefined ? '' : String(value);
}

const OP_LABELS: Record<ConditionOperator, string> = {
  eq: '=',
  ne: '≠',
  in: 'dans [liste]',
  nin: 'hors [liste]',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'contient',
  matches: 'regex',
  exists: 'existe',
};

/**
 * Visual editor of a campaign selection rule: nested AND/OR groups, negation,
 * property conditions and subtree restriction — mirrors the SelectionRule tree.
 */
export function RuleBuilder({
  rule,
  onChange,
  onRemove,
}: {
  rule: SelectionRule;
  onChange: (rule: SelectionRule) => void;
  onRemove?: () => void;
}) {
  const kind = kindOf(rule);

  const kindSelect = (
    <select
      value={kind}
      onChange={(e) => onChange(defaultOf(e.target.value as Kind))}
      aria-label="type de nœud"
    >
      <option value="condition">condition</option>
      <option value="all">ET (toutes)</option>
      <option value="any">OU (au moins une)</option>
      <option value="not">NON</option>
      <option value="pathUnder">sous-arbre</option>
    </select>
  );

  const removeButton = onRemove ? (
    <button type="button" className="btn small danger" onClick={onRemove} title="supprimer ce nœud">
      ✕
    </button>
  ) : null;

  if (kind === 'all' || kind === 'any') {
    const children = kind === 'all' ? (rule as { all: SelectionRule[] }).all : (rule as { any: SelectionRule[] }).any;
    const rebuild = (next: SelectionRule[]): SelectionRule =>
      kind === 'all' ? { all: next } : { any: next };
    return (
      <div className="rule-node">
        <div className="rule-row">
          {kindSelect}
          <button
            type="button"
            className="btn small"
            onClick={() => onChange(rebuild([...children, defaultOf('condition')]))}
          >
            + condition
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => onChange(rebuild([...children, defaultOf(kind === 'all' ? 'any' : 'all')]))}
          >
            + groupe
          </button>
          {removeButton}
        </div>
        {children.map((child, i) => (
          <RuleBuilder
            key={i}
            rule={child}
            onChange={(next) => onChange(rebuild(children.map((c, j) => (j === i ? next : c))))}
            onRemove={
              children.length > 1
                ? () => onChange(rebuild(children.filter((_, j) => j !== i)))
                : undefined
            }
          />
        ))}
      </div>
    );
  }

  if (kind === 'not') {
    const inner = (rule as { not: SelectionRule }).not;
    return (
      <div className="rule-node">
        <div className="rule-row">
          {kindSelect}
          {removeButton}
        </div>
        <RuleBuilder rule={inner} onChange={(next) => onChange({ not: next })} />
      </div>
    );
  }

  if (kind === 'pathUnder') {
    const value = (rule as { pathUnder: string }).pathUnder;
    return (
      <div className="rule-node">
        <div className="rule-row">
          {kindSelect}
          <input
            value={value}
            placeholder="ex. suites/checkout"
            onChange={(e) => onChange({ pathUnder: e.target.value })}
            style={{ minWidth: 220 }}
          />
          {removeButton}
        </div>
      </div>
    );
  }

  const condition = rule as PropertyCondition;
  return (
    <div className="rule-node">
      <div className="rule-row">
        {kindSelect}
        <input
          value={condition.prop}
          placeholder="propriété (ex. tags, team, criticality)"
          onChange={(e) => onChange({ ...condition, prop: e.target.value })}
          style={{ minWidth: 170 }}
        />
        <select
          value={condition.op}
          onChange={(e) => {
            const op = e.target.value as ConditionOperator;
            onChange({
              prop: condition.prop,
              op,
              ...(op === 'exists' ? {} : { value: parseValue(valueToText(condition.value), op) }),
            });
          }}
        >
          {conditionOperators.map((op) => (
            <option key={op} value={op}>
              {OP_LABELS[op]}
            </option>
          ))}
        </select>
        {condition.op !== 'exists' && (
          <input
            value={valueToText(condition.value)}
            placeholder="valeur"
            onChange={(e) => onChange({ ...condition, value: parseValue(e.target.value, condition.op) })}
            style={{ minWidth: 140 }}
          />
        )}
        {removeButton}
      </div>
    </div>
  );
}
