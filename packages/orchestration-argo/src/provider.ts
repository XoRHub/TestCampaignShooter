import { PassThrough } from 'node:stream';
import * as k8s from '@kubernetes/client-node';
import type {
  CampaignExecutionSpec,
  OrchestrationEvent,
  RunHandle,
  RunPhase,
  RunStateEvent,
  TestNodeStatus,
  TestStateEvent,
} from '@tcs/shared-types';
import { TERMINAL_RUN_PHASES } from '@tcs/shared-types';
import type { ArtifactRef, OrchestrationProvider, RunSnapshot } from '@tcs/orchestration';
import { argoConfigFromEnv, type ArgoProviderConfig } from './config.js';
import { buildWorkflow } from './workflow-builder.js';
import { resolveStepTemplates, type Manifest } from './step-templates.js';
import { RUN_ID_LABEL, TEST_MAP_ANNOTATION, testNodeName, workflowName } from './naming.js';

const GROUP = 'argoproj.io';
const VERSION = 'v1alpha1';

interface ArgoNode {
  displayName?: string;
  type?: string;
  phase?: string;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
  name?: string;
}

interface WorkflowResource {
  metadata?: {
    name?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
  spec?: { shutdown?: string };
  status?: {
    phase?: string;
    startedAt?: string;
    finishedAt?: string;
    message?: string;
    nodes?: Record<string, ArgoNode>;
  };
}

function mapTestStatus(node: ArgoNode): TestNodeStatus {
  switch (node.phase) {
    case 'Pending':
      return 'pending';
    case 'Running':
      return 'running';
    case 'Succeeded':
      return 'succeeded';
    case 'Failed':
    case 'Error':
      return /deadline|timeout/i.test(node.message ?? '') ? 'timeout' : 'failed';
    case 'Omitted':
    case 'Skipped':
      return 'cancelled';
    default:
      return 'pending';
  }
}

function mapRunPhase(wf: WorkflowResource): RunPhase {
  const shutdown = wf.spec?.shutdown === 'Stop' || wf.spec?.shutdown === 'Terminate';
  switch (wf.status?.phase) {
    case 'Succeeded':
      return 'succeeded';
    case 'Failed':
      return shutdown ? 'cancelled' : 'failed';
    case 'Error':
      return 'error';
    case 'Running':
      return 'running';
    default:
      return 'pending';
  }
}

/**
 * Default orchestration provider: runs campaigns as Argo Workflows.
 * All Kubernetes/Argo specifics (@kubernetes/client-node, CRDs, watches,
 * pod logs) live in this package only.
 */
export class ArgoProvider implements OrchestrationProvider {
  readonly name = 'argo';
  private readonly config: ArgoProviderConfig;
  private readonly kubeConfig: k8s.KubeConfig;
  private readonly customApi: k8s.CustomObjectsApi;
  private readonly coreApi: k8s.CoreV1Api;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.config = argoConfigFromEnv(env);
    this.kubeConfig = new k8s.KubeConfig();
    this.kubeConfig.loadFromDefault();
    this.customApi = this.kubeConfig.makeApiClient(k8s.CustomObjectsApi);
    this.coreApi = this.kubeConfig.makeApiClient(k8s.CoreV1Api);
  }

  async submit(spec: CampaignExecutionSpec): Promise<RunHandle> {
    // 1. Ensure one step WorkflowTemplate per engine (manual files win over generated).
    const steps = await resolveStepTemplates(
      spec.tests.map((t) => t.engine),
      this.config.manualStepsDir,
    );
    for (const manifest of steps.values()) {
      await this.upsertWorkflowTemplate(manifest);
    }

    // 2. Submit the run Workflow (one retryable node per test).
    const { manifest } = buildWorkflow(spec, this.config);
    await this.customApi.createNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: this.config.namespace,
      plural: 'workflows',
      body: manifest,
    });
    return {
      provider: this.name,
      externalId: manifest.metadata.name,
      namespace: this.config.namespace,
    };
  }

  async watch(
    handle: RunHandle,
    onEvent: (event: OrchestrationEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const namespace = handle.namespace ?? this.config.namespace;
    let finished = false;

    while (!finished && !signal?.aborted) {
      const watcher = new k8s.Watch(this.kubeConfig);
      await new Promise<void>((resolve) => {
        let controller: AbortController | undefined;
        const stop = () => {
          controller?.abort();
          resolve();
        };
        signal?.addEventListener('abort', stop, { once: true });
        watcher
          .watch(
            `/apis/${GROUP}/${VERSION}/namespaces/${namespace}/workflows`,
            { fieldSelector: `metadata.name=${handle.externalId}` },
            (_type, obj) => {
              const wf = obj as WorkflowResource;
              for (const event of this.workflowEvents(wf)) onEvent(event);
              if (TERMINAL_RUN_PHASES.has(mapRunPhase(wf))) {
                finished = true;
                stop();
              }
            },
            () => resolve(), // connection closed → reconnect unless finished
          )
          .then((c) => {
            controller = c;
          })
          .catch(() => resolve());
      });
      if (!finished && !signal?.aborted) {
        // Re-sync once before re-watching, in case the terminal event was missed.
        const snapshot = await this.getState(handle).catch(() => undefined);
        if (snapshot) {
          snapshot.tests.forEach(onEvent);
          onEvent(snapshot.run);
          if (TERMINAL_RUN_PHASES.has(snapshot.run.phase)) return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  async getState(handle: RunHandle): Promise<RunSnapshot> {
    const wf = await this.getWorkflow(handle);
    const events = this.workflowEvents(wf);
    const tests = events.filter((e): e is TestStateEvent => e.type === 'test');
    const run = events.find((e): e is RunStateEvent => e.type === 'run')!;
    return { run, tests };
  }

  async retryFailed(handle: RunHandle, testIds?: string[]): Promise<RunHandle> {
    if (!this.config.argoServerUrl) {
      throw new Error(
        'Targeted retry requires the Argo Server API — set ARGO_SERVER_URL (e.g. http://argo-server:2746)',
      );
    }
    const namespace = handle.namespace ?? this.config.namespace;
    const body: Record<string, unknown> = {
      name: handle.externalId,
      namespace,
      restartSuccessful: false,
    };
    if (testIds && testIds.length === 1) {
      // Argo node field selectors are AND-only: a single test can be targeted
      // precisely; for several, retry restarts every failed node (successful
      // ones are never re-run either way).
      body.nodeFieldSelector = `displayName=${testNodeName(testIds[0]!)}`;
    }
    const response = await fetch(
      `${this.config.argoServerUrl}/api/v1/workflows/${namespace}/${handle.externalId}/retry`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(this.config.argoServerToken
            ? { authorization: `Bearer ${this.config.argoServerToken}` }
            : {}),
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      throw new Error(`Argo Server retry failed: HTTP ${response.status} ${await response.text()}`);
    }
    return handle;
  }

  async cancel(handle: RunHandle): Promise<void> {
    await this.customApi.patchNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: handle.namespace ?? this.config.namespace,
      plural: 'workflows',
      name: handle.externalId,
      body: { spec: { shutdown: 'Stop' } },
    });
  }

  async getLogs(handle: RunHandle, testId: string): Promise<string> {
    const pod = await this.findTestPod(handle, testId);
    if (!pod) return '';
    return this.coreApi.readNamespacedPodLog({
      name: pod,
      namespace: handle.namespace ?? this.config.namespace,
      container: 'main',
    });
  }

  async streamLogs(
    handle: RunHandle,
    testId: string,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const pod = await this.findTestPod(handle, testId);
    if (!pod) return;
    const log = new k8s.Log(this.kubeConfig);
    const stream = new PassThrough();
    stream.on('data', (chunk: Buffer) => onChunk(chunk.toString()));
    const controller = await log.log(
      handle.namespace ?? this.config.namespace,
      pod,
      'main',
      stream,
      { follow: true, timestamps: false },
    );
    await new Promise<void>((resolve) => {
      const stop = () => {
        controller.abort();
        resolve();
      };
      signal?.addEventListener('abort', stop, { once: true });
      stream.on('end', () => resolve());
      stream.on('close', () => resolve());
    });
  }

  async getArtifacts(handle: RunHandle): Promise<ArtifactRef[]> {
    const wf = await this.getWorkflow(handle);
    const runId = wf.metadata?.labels?.[RUN_ID_LABEL] ?? handle.externalId;
    const prefix = `${this.config.artifactPrefix}/${runId}`;
    const testMap = this.testMap(wf);
    return [
      { name: 'junit.xml', key: `${prefix}/junit.xml` },
      ...Object.values(testMap).map((testId) => ({
        name: `partials/${testId}.xml`,
        key: `${prefix}/partials/${testId}.xml`,
      })),
    ];
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async getWorkflow(handle: RunHandle): Promise<WorkflowResource> {
    return (await this.customApi.getNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace: handle.namespace ?? this.config.namespace,
      plural: 'workflows',
      name: handle.externalId,
    })) as WorkflowResource;
  }

  private async upsertWorkflowTemplate(manifest: Manifest): Promise<void> {
    const base = {
      group: GROUP,
      version: VERSION,
      namespace: this.config.namespace,
      plural: 'workflowtemplates',
    };
    try {
      await this.customApi.createNamespacedCustomObject({ ...base, body: manifest });
    } catch (err) {
      const status = (err as { code?: number }).code;
      if (status !== 409) throw err;
      const existing = (await this.customApi.getNamespacedCustomObject({
        ...base,
        name: manifest.metadata.name,
      })) as { metadata?: { resourceVersion?: string } };
      await this.customApi.replaceNamespacedCustomObject({
        ...base,
        name: manifest.metadata.name,
        body: {
          ...manifest,
          metadata: {
            ...manifest.metadata,
            resourceVersion: existing.metadata?.resourceVersion,
          },
        },
      });
    }
  }

  private testMap(wf: WorkflowResource): Record<string, string> {
    try {
      return JSON.parse(wf.metadata?.annotations?.[TEST_MAP_ANNOTATION] ?? '{}') as Record<
        string,
        string
      >;
    } catch {
      return {};
    }
  }

  /** Maps a Workflow resource to normalized test + run events. */
  private workflowEvents(wf: WorkflowResource): OrchestrationEvent[] {
    const runId = wf.metadata?.labels?.[RUN_ID_LABEL] ?? wf.metadata?.name ?? '';
    const testMap = this.testMap(wf);
    const nodeByDisplayName = new Map<string, ArgoNode>();
    for (const node of Object.values(wf.status?.nodes ?? {})) {
      if (node.type === 'Pod' && node.displayName) nodeByDisplayName.set(node.displayName, node);
    }

    const tests: TestStateEvent[] = Object.entries(testMap).map(([taskName, testId]) => {
      const node = nodeByDisplayName.get(taskName);
      return {
        type: 'test',
        runId,
        testId,
        status: node ? mapTestStatus(node) : 'pending',
        startedAt: node?.startedAt,
        finishedAt: node?.finishedAt,
        message: node?.message,
      };
    });

    const count = (statuses: TestNodeStatus[]) =>
      tests.filter((t) => statuses.includes(t.status)).length;
    const run: RunStateEvent = {
      type: 'run',
      runId,
      phase: mapRunPhase(wf),
      progress: {
        total: tests.length,
        pending: count(['pending']),
        running: count(['running']),
        succeeded: count(['succeeded']),
        failed: count(['failed', 'timeout', 'cancelled']),
      },
      startedAt: wf.status?.startedAt,
      finishedAt: wf.status?.finishedAt,
      message: wf.status?.message,
    };

    return [...tests, run];
  }

  /** Finds the pod backing the (latest) node of a test. */
  private async findTestPod(handle: RunHandle, testId: string): Promise<string | undefined> {
    const namespace = handle.namespace ?? this.config.namespace;
    const pods = await this.coreApi.listNamespacedPod({
      namespace,
      labelSelector: `workflows.argoproj.io/workflow=${handle.externalId}`,
    });
    const taskName = testNodeName(testId);
    const matching = pods.items
      .filter((pod) => {
        const nodeName = pod.metadata?.annotations?.['workflows.argoproj.io/node-name'] ?? '';
        return nodeName === `${handle.externalId}.${taskName}` || nodeName.endsWith(`.${taskName}`);
      })
      .sort(
        (a, b) =>
          new Date(a.metadata?.creationTimestamp ?? 0).getTime() -
          new Date(b.metadata?.creationTimestamp ?? 0).getTime(),
      );
    return matching.at(-1)?.metadata?.name;
  }
}

export { workflowName };
