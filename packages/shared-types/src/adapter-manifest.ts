import { z } from 'zod';

/**
 * Declarative validation rules a manifest engine entry can express — the two
 * patterns that cover every built-in adapter (`packages/core/src/adapters`):
 * "an explicit execution.command is required" (generic-node, selenium, ...)
 * or "the test file must have a given extension" (robotframework). No
 * downloaded code is ever executed to validate a test.
 */
export const engineValidationRulesSchema = z
  .object({
    requireExecutionCommand: z.boolean().optional(),
    requireFileExtension: z
      .union([z.string().min(1), z.array(z.string().min(1)).nonempty()])
      .nullable()
      .optional(),
  })
  .strict();

export type EngineValidationRules = z.infer<typeof engineValidationRulesSchema>;

/** One engine definition inside an adapter manifest — mirrors `EngineAdapter` as pure data. */
export const engineManifestEntrySchema = z
  .object({
    engine: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*$/, 'engine id must be lowercase kebab-case'),
    displayName: z.string().min(1),
    defaultImage: z.string().min(1),
    defaultJunitPath: z.string().min(1),
    defaultCommand: z.array(z.string().min(1)).nonempty().optional(),
    validate: engineValidationRulesSchema.optional(),
    deprecated: z.object({ reason: z.string().min(1) }).nullable().optional(),
  })
  .strict();

export type EngineManifestEntry = z.infer<typeof engineManifestEntrySchema>;

/** Top-level shape of a downloadable adapter manifest (JSON or YAML). */
export const adapterManifestSchema = z
  .object({
    apiVersion: z.literal('tcs.io/v1'),
    kind: z.literal('AdapterManifest'),
    engines: z.array(engineManifestEntrySchema).min(1),
  })
  .strict();

export type AdapterManifest = z.infer<typeof adapterManifestSchema>;
