import { z } from 'zod';

/** Comparison / membership / matching operators available on metadata properties. */
export const conditionOperators = [
  'eq',
  'ne',
  'in',
  'nin',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'matches',
  'exists',
] as const;

export type ConditionOperator = (typeof conditionOperators)[number];

/** Elementary condition on a metadata property (dot paths allowed, e.g. `execution.image`). */
export interface PropertyCondition {
  prop: string;
  op: ConditionOperator;
  value?: unknown;
}

/** Restricts the selection to tests whose file lives under the given subtree. */
export interface PathUnderCondition {
  pathUnder: string;
}

/**
 * A campaign selection rule: boolean tree with AND (`all`), OR (`any`),
 * negation (`not`), arbitrarily nested, over property/path conditions.
 */
export type SelectionRule =
  | { all: SelectionRule[] }
  | { any: SelectionRule[] }
  | { not: SelectionRule }
  | PropertyCondition
  | PathUnderCondition;

const propertyConditionSchema = z
  .object({
    prop: z.string().min(1),
    op: z.enum(conditionOperators),
    value: z.unknown().optional(),
  })
  .strict();

const pathUnderConditionSchema = z.object({ pathUnder: z.string().min(1) }).strict();

export const selectionRuleSchema: z.ZodType<SelectionRule> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(selectionRuleSchema).min(1) }).strict(),
    z.object({ any: z.array(selectionRuleSchema).min(1) }).strict(),
    z.object({ not: selectionRuleSchema }).strict(),
    propertyConditionSchema,
    pathUnderConditionSchema,
  ]),
);

/** Matches every discovered test (default rule of an empty campaign). */
export const MATCH_ALL_RULE: SelectionRule = { all: [{ prop: 'engine', op: 'exists' }] };
