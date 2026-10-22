import type { DiscoveredTest, DiscoveryIssue, SelectionRule, TestsSource } from '@tcs/shared-types';
import { discoverTests, fetchSource, knownEngines, selectTests } from '@tcs/core';

export interface SelectionPreview {
  totalDiscovered: number;
  selected: DiscoveredTest[];
  issues: DiscoveryIssue[];
}

/**
 * Materializes the source, discovers every test and evaluates the campaign
 * selection rule — used by the preview endpoints and at launch time.
 */
export async function previewSelection(
  source: TestsSource,
  rule: SelectionRule,
): Promise<SelectionPreview> {
  const fetched = await fetchSource(source);
  try {
    const { tests, issues } = await discoverTests(fetched.rootDir, {
      knownEngines: knownEngines(),
    });
    return { totalDiscovered: tests.length, selected: selectTests(tests, rule), issues };
  } finally {
    await fetched.cleanup();
  }
}
