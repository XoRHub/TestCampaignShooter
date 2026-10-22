import { z } from 'zod';

/**
 * Technical execution block of a metadata file. Every field is optional here:
 * engine adapters fill defaults and enforce the fields they actually require
 * (e.g. `command` is mandatory for generic-* engines).
 */
export const executionSpecSchema = z
  .object({
    /** Container image running the test. Adapters provide a default per engine. */
    image: z.string().min(1).optional(),
    /** Command executed in the container. Supports the `{{testFile}}` placeholder. */
    command: z.array(z.string().min(1)).nonempty().optional(),
    /** Path (relative to the working dir) where the engine writes its JUnit XML report. */
    junitPath: z.string().min(1).optional(),
    timeoutSeconds: z.number().int().positive().max(86_400).optional(),
    env: z.record(z.string()).optional(),
    resources: z
      .object({
        cpu: z.string().min(1).optional(),
        memory: z.string().min(1).optional(),
      })
      .optional(),
    /** Working directory inside the container, relative to the tests root. */
    workingDir: z.string().optional(),
  })
  .strict();

export type ExecutionSpec = z.infer<typeof executionSpecSchema>;

/**
 * Schema of a `<test>.metadata.json` file.
 *
 * Only the technical fields are validated strictly; every other property is a
 * free-form selection attribute (tags, team, criticality, platform, ...) kept
 * as-is thanks to `.passthrough()` and usable by the rule engine.
 */
export const testMetadataSchema = z
  .object({
    /** Stable identifier. Defaults to the normalized relative path of the test file. */
    id: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9]([a-zA-Z0-9._/-]*[a-zA-Z0-9])?$/, {
        message: 'id must only contain alphanumerics, ".", "_", "/" and "-"',
      })
      .optional(),
    name: z.string().min(1).optional(),
    /** Engine adapter identifier (robotframework, cypress, generic-node, ...). Required. */
    engine: z.string().min(1),
    execution: executionSpecSchema.default({}),
  })
  .passthrough();

export type TestMetadata = z.infer<typeof testMetadataSchema>;

/** A test found by the discovery phase, with its parsed metadata. */
export interface DiscoveredTest {
  /** Stable id: `metadata.id` or the normalized posix relative path of the test file. */
  id: string;
  name: string;
  engine: string;
  /** Posix relative path of the test file inside the source tree. */
  file: string;
  /** Posix relative path of the metadata file. */
  metadataFile: string;
  metadata: TestMetadata;
}

/** Problem reported while discovering/validating tests (missing or invalid metadata...). */
export interface DiscoveryIssue {
  file: string;
  kind: 'missing-metadata' | 'invalid-json' | 'invalid-metadata' | 'unknown-engine' | 'duplicate-id';
  message: string;
}
