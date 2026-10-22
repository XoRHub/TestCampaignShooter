import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  ENGINE_LABEL,
  PART_OF_LABEL,
  PART_OF_VALUE,
  stepTemplateName,
} from './naming.js';

/** Loose typing of an Argo WorkflowTemplate manifest (we never depend on Argo TS types). */
export type Manifest = {
  apiVersion: string;
  kind: string;
  metadata: { name: string; labels?: Record<string, string>; [k: string]: unknown };
  spec: Record<string, unknown>;
};

/**
 * Generates the default step WorkflowTemplate for one engine. Every engine
 * step exposes the same contract so generated and hand-written templates are
 * interchangeable:
 *
 *   inputs.parameters: test-id, test-file, image, command (shell line),
 *                      junit-path, timeout-seconds
 *   inputs.artifacts:  source  (test tree, unpacked at /workspace)
 *   outputs.artifacts: junit   (pushed to <artifact-prefix>/partials/<test-id>.xml)
 */
export function generateEngineStepTemplate(engine: string): Manifest {
  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'WorkflowTemplate',
    metadata: {
      name: stepTemplateName(engine),
      labels: {
        [PART_OF_LABEL]: PART_OF_VALUE,
        [ENGINE_LABEL]: engine,
        'testcampaignshooter.io/generated': 'true',
      },
    },
    spec: {
      templates: [
        {
          name: 'run-test',
          inputs: {
            parameters: [
              { name: 'test-id' },
              { name: 'test-file' },
              { name: 'image' },
              { name: 'command' },
              { name: 'junit-path' },
              { name: 'timeout-seconds', value: '1800' },
            ],
            artifacts: [{ name: 'source', path: '/workspace' }],
          },
          activeDeadlineSeconds: '{{inputs.parameters.timeout-seconds}}',
          // One test == one pod: individually retryable, isolated failure domain.
          container: {
            image: '{{inputs.parameters.image}}',
            workingDir: '/workspace',
            command: ['/bin/sh', '-c'],
            args: ['{{inputs.parameters.command}}'],
          },
          outputs: {
            artifacts: [
              {
                name: 'junit',
                path: '/workspace/{{inputs.parameters.junit-path}}',
                optional: true,
                archive: { none: {} },
                s3: {
                  key: '{{workflow.parameters.artifact-prefix}}/partials/{{inputs.parameters.test-id}}.xml',
                },
              },
            ],
          },
        },
      ],
    },
  };
}

/**
 * Loads hand-written step templates from `dir`. Convention: one file per
 * engine named `step-<engine>.yaml`, containing a WorkflowTemplate with a
 * `run-test` template honouring the shared step contract. Dropping a new
 * file there registers a new engine step without touching anything else.
 */
export async function loadManualStepTemplates(dir: string): Promise<Map<string, Manifest>> {
  const manual = new Map<string, Manifest>();
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return manual; // directory absent = no manual templates
  }
  for (const file of files.sort()) {
    const match = /^step-(?<engine>[a-z0-9-]+)\.ya?ml$/.exec(file);
    if (!match?.groups?.engine) continue;
    const manifest = parseYaml(await readFile(path.join(dir, file), 'utf8')) as Manifest;
    if (manifest?.kind !== 'WorkflowTemplate') {
      throw new Error(`${file}: expected a WorkflowTemplate manifest`);
    }
    manual.set(match.groups.engine, manifest);
  }
  return manual;
}

/**
 * Resolves the step template of every engine used by a run: hand-written
 * templates (from `manualStepsDir`) take precedence over generated ones.
 */
export async function resolveStepTemplates(
  engines: string[],
  manualStepsDir: string,
): Promise<Map<string, Manifest>> {
  const manual = await loadManualStepTemplates(manualStepsDir);
  const resolved = new Map<string, Manifest>();
  for (const engine of [...new Set(engines)].sort()) {
    resolved.set(engine, manual.get(engine) ?? generateEngineStepTemplate(engine));
  }
  return resolved;
}
