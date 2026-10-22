import type { CampaignExecutionSpec, TestExecutionSnapshot } from '@tcs/shared-types';
import type { ArgoProviderConfig } from './config.js';
import type { Manifest } from './step-templates.js';
import {
  CAMPAIGN_ID_LABEL,
  PART_OF_LABEL,
  PART_OF_VALUE,
  RUN_ID_LABEL,
  TEST_MAP_ANNOTATION,
  stepTemplateName,
  testNodeName,
  workflowName,
} from './naming.js';

const AGGREGATE_SCRIPT = `
import os, sys, urllib.request, xml.etree.ElementTree as ET

partials_dir = "/partials"
merged = ET.Element("testsuites")
totals = {"tests": 0, "failures": 0, "errors": 0}
time = 0.0

if os.path.isdir(partials_dir):
    for name in sorted(os.listdir(partials_dir)):
        if not name.endswith(".xml"):
            continue
        test_id = name[:-4]
        try:
            root = ET.parse(os.path.join(partials_dir, name)).getroot()
        except ET.ParseError as exc:
            print(f"skipping unparseable partial {name}: {exc}", file=sys.stderr)
            continue
        suites = root.findall("testsuite") if root.tag == "testsuites" else [root]
        for suite in suites:
            suite.set("name", test_id)
            merged.append(suite)
            totals["tests"] += int(suite.get("tests", len(suite.findall("testcase"))))
            totals["failures"] += int(suite.get("failures", 0))
            totals["errors"] += int(suite.get("errors", 0))
            time += float(suite.get("time", 0) or 0)

for key, value in totals.items():
    merged.set(key, str(value))
merged.set("time", f"{time:.3f}")
body = ET.tostring(merged, encoding="utf-8", xml_declaration=True)
with open("/tmp/junit.xml", "wb") as fh:
    fh.write(body)
print(f"aggregated {totals['tests']} tests ({totals['failures']} failures, {totals['errors']} errors)")

callback = os.environ.get("CALLBACK_URL", "")
if callback:
    headers = {"Content-Type": "application/xml", "X-Tcs-Run-Id": os.environ.get("RUN_ID", "")}
    if os.environ.get("CALLBACK_TOKEN"):
        headers["X-Tcs-Token"] = os.environ["CALLBACK_TOKEN"]
    req = urllib.request.Request(callback, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(f"callback -> HTTP {resp.status}")
`;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Builds the single shell line executed by the engine step for one test. */
export function buildCommandLine(test: TestExecutionSnapshot): string {
  const env = Object.entries(test.execution.env)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('; ');
  const cd = test.execution.workingDir ? `cd ${shellQuote(test.execution.workingDir)} && ` : '';
  const command = test.execution.command.map(shellQuote).join(' ');
  return `${env ? `${env}; ` : ''}${cd}${command}`;
}

function fetchSourceShell(spec: CampaignExecutionSpec): string {
  if (spec.source.type !== 'git') {
    // A local path only makes sense for the local dev provider.
    throw new Error(
      'The Argo provider requires a git tests source (a local directory is not reachable from cluster pods)',
    );
  }
  const revision = spec.source.revision ?? '';
  return [
    `set -e`,
    `URL=${shellQuote(spec.source.url)}`,
    `if [ -n "$GIT_TOKEN" ]; then URL=$(printf '%s' "$URL" | sed "s#^https://#https://oauth2:$GIT_TOKEN@#"); fi`,
    `git clone --depth 50 "$URL" /workspace`,
    revision ? `git -C /workspace checkout ${shellQuote(revision)}` : `true`,
    // Auto-extract top-level archives, mirroring the server-side ingestion.
    `for z in /workspace/*.zip; do [ -e "$z" ] || continue; d="\${z%.zip}"; mkdir -p "$d"; unzip -q "$z" -d "$d" && rm "$z"; done`,
  ].join('\n');
}

export interface BuiltWorkflow {
  manifest: Manifest;
  /** DAG task name → test id (also stored as a workflow annotation). */
  testMap: Record<string, string>;
}

/**
 * Builds the run Workflow: fetch-source → one DAG task **per test**
 * (templateRef to its engine's step template, stable deterministic name)
 * → aggregation step that always runs, merges partial JUnit reports and
 * notifies the server. `failFast: false` isolates test failures.
 */
export function buildWorkflow(spec: CampaignExecutionSpec, config: ArgoProviderConfig): BuiltWorkflow {
  const testMap: Record<string, string> = {};
  const testTasks = spec.tests.map((test) => {
    const taskName = testNodeName(test.testId);
    testMap[taskName] = test.testId;
    return {
      name: taskName,
      depends: 'fetch-source',
      templateRef: { name: stepTemplateName(test.engine), template: 'run-test' },
      arguments: {
        parameters: [
          { name: 'test-id', value: test.testId },
          { name: 'test-file', value: test.file },
          { name: 'image', value: test.execution.image },
          { name: 'command', value: buildCommandLine(test) },
          { name: 'junit-path', value: test.execution.junitPath },
          { name: 'timeout-seconds', value: String(test.execution.timeoutSeconds) },
        ],
        artifacts: [{ name: 'source', from: '{{tasks.fetch-source.outputs.artifacts.source}}' }],
      },
    };
  });

  // The aggregation runs whatever happened to the tests (finished = any terminal state).
  const finished = (task: string) =>
    `(${task}.Succeeded || ${task}.Failed || ${task}.Errored || ${task}.Skipped || ${task}.Omitted)`;
  const aggregateDepends = testTasks.map((t) => finished(t.name)).join(' && ');

  const artifactPrefix = `${config.artifactPrefix}/${spec.runId}`;

  const manifest: Manifest = {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Workflow',
    metadata: {
      name: workflowName(spec.runId),
      labels: {
        [PART_OF_LABEL]: PART_OF_VALUE,
        [RUN_ID_LABEL]: spec.runId,
        [CAMPAIGN_ID_LABEL]: spec.campaignId,
      },
      annotations: { [TEST_MAP_ANNOTATION]: JSON.stringify(testMap) },
    },
    spec: {
      entrypoint: 'main',
      // Fan-out throttle: number of tests executed simultaneously.
      parallelism: spec.parallelism,
      ...(config.serviceAccountName ? { serviceAccountName: config.serviceAccountName } : {}),
      arguments: { parameters: [{ name: 'artifact-prefix', value: artifactPrefix }] },
      templates: [
        {
          name: 'main',
          dag: { failFast: false, tasks: [{ name: 'fetch-source', template: 'fetch-source' }, ...testTasks, {
            name: 'aggregate',
            depends: aggregateDepends,
            template: 'aggregate',
          }] },
        },
        {
          name: 'fetch-source',
          container: {
            image: 'alpine/git:latest',
            command: ['/bin/sh', '-c'],
            args: [fetchSourceShell(spec)],
            ...(config.gitSecretName
              ? {
                  env: [
                    {
                      name: 'GIT_TOKEN',
                      valueFrom: {
                        secretKeyRef: { name: config.gitSecretName, key: 'token', optional: true },
                      },
                    },
                  ],
                }
              : {}),
          },
          outputs: { artifacts: [{ name: 'source', path: '/workspace' }] },
        },
        {
          name: 'aggregate',
          inputs: {
            artifacts: [
              {
                name: 'partials',
                path: '/partials',
                optional: true,
                s3: { key: `${artifactPrefix}/partials` },
              },
            ],
          },
          script: {
            image: 'python:3.12-alpine',
            command: ['python'],
            source: AGGREGATE_SCRIPT,
            env: [
              { name: 'CALLBACK_URL', value: spec.resultsCallbackUrl ?? '' },
              { name: 'CALLBACK_TOKEN', value: spec.resultsCallbackToken ?? '' },
              { name: 'RUN_ID', value: spec.runId },
            ],
          },
          outputs: {
            artifacts: [
              {
                name: 'junit',
                path: '/tmp/junit.xml',
                archive: { none: {} },
                s3: { key: `${artifactPrefix}/junit.xml` },
              },
            ],
          },
        },
      ],
    },
  };

  return { manifest, testMap };
}
