import { createHash } from 'node:crypto';

/**
 * Maps an arbitrary test id to a deterministic DNS-1123-ish node/task name.
 * The 8-char hash suffix guarantees uniqueness even when two ids collapse to
 * the same sanitized form; determinism is what allows targeted `argo retry`
 * and correlation between Argo nodes, results and logs.
 */
export function testNodeName(testId: string): string {
  const sanitized = testId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  const hash = createHash('sha256').update(testId).digest('hex').slice(0, 8);
  return `t-${sanitized ? `${sanitized}-` : ''}${hash}`;
}

/** Deterministic Workflow name for a run. */
export function workflowName(runId: string): string {
  const sanitized = runId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `tcs-run-${sanitized}`;
}

/** Name of the per-engine step WorkflowTemplate. */
export function stepTemplateName(engine: string): string {
  return `tcs-step-${engine.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
}

/** Annotation carrying the nodeName → testId mapping on submitted Workflows. */
export const TEST_MAP_ANNOTATION = 'testcampaignshooter.io/test-map';
export const RUN_ID_LABEL = 'testcampaignshooter.io/run-id';
export const CAMPAIGN_ID_LABEL = 'testcampaignshooter.io/campaign-id';
export const ENGINE_LABEL = 'testcampaignshooter.io/engine';
export const PART_OF_LABEL = 'app.kubernetes.io/part-of';
export const PART_OF_VALUE = 'testcampaignshooter';
