import { z } from 'zod';
import type { TestMetadata } from './metadata.js';

/** Normalized, orchestrator-agnostic status of a single test node. */
export const testNodeStatuses = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timeout',
] as const;
export type TestNodeStatus = (typeof testNodeStatuses)[number];

export const TERMINAL_TEST_STATUSES: ReadonlySet<TestNodeStatus> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'timeout',
]);

/** Normalized status of a whole campaign run. */
export const runPhases = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'error',
] as const;
export type RunPhase = (typeof runPhases)[number];

export const TERMINAL_RUN_PHASES: ReadonlySet<RunPhase> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'error',
]);

/** Source of the test files, resolved at run submission time. */
export const testsSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('git'),
    url: z.string().min(1),
    revision: z.string().optional(),
    /** Name of the env var / secret holding the token — never the token itself. */
    tokenSecretRef: z.string().optional(),
  }),
  z.object({
    type: z.literal('local'),
    path: z.string().min(1),
  }),
]);
export type TestsSource = z.infer<typeof testsSourceSchema>;

/** Execution fully resolved by an engine adapter — what a provider actually runs. */
export interface ResolvedExecution {
  image: string;
  command: string[];
  junitPath: string;
  timeoutSeconds: number;
  env: Record<string, string>;
  resources?: { cpu?: string; memory?: string };
  workingDir?: string;
}

/** Immutable snapshot of one selected test, stored with the run and given to the provider. */
export interface TestExecutionSnapshot {
  testId: string;
  name: string;
  engine: string;
  file: string;
  execution: ResolvedExecution;
  metadata: TestMetadata;
}

/** Everything a provider needs to submit one campaign run. */
export interface CampaignExecutionSpec {
  runId: string;
  campaignId: string;
  campaignName: string;
  source: TestsSource;
  tests: TestExecutionSnapshot[];
  /** Max number of tests executed simultaneously. */
  parallelism: number;
  /** Server endpoint the aggregation step POSTs the merged JUnit report to. */
  resultsCallbackUrl?: string;
  /** Sent as the x-tcs-token header when the server requires INTERNAL_CALLBACK_TOKEN. */
  resultsCallbackToken?: string;
}

/** Opaque handle identifying a submitted run inside a provider (e.g. Argo Workflow name). */
export interface RunHandle {
  provider: string;
  externalId: string;
  namespace?: string;
}

export interface TestStateEvent {
  type: 'test';
  runId: string;
  testId: string;
  status: TestNodeStatus;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
}

export interface RunProgress {
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
}

export interface RunStateEvent {
  type: 'run';
  runId: string;
  phase: RunPhase;
  progress: RunProgress;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
}

export type OrchestrationEvent = TestStateEvent | RunStateEvent;

export interface LogChunk {
  testId: string;
  content: string;
  timestamp?: string;
}
