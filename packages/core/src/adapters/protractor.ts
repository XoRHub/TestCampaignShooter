import type { EngineAdapter } from './types.js';

/**
 * Protractor reached end-of-life in 2023. The adapter is kept for legacy
 * suites, isolated in this file so it can be dropped without touching
 * anything else. New tests should use Cypress or a generic runner.
 */
export const protractorAdapter: EngineAdapter = {
  engine: 'protractor',
  displayName: 'Protractor (deprecated)',
  defaultImage: 'node:16-bullseye-slim',
  defaultJunitPath: 'results/junit.xml',
  deprecated: {
    reason:
      'Protractor is end-of-life and unmaintained since 2023 — migrate to Cypress or Playwright.',
  },
  validate(): string[] {
    return [];
  },
  defaultCommand(): string[] {
    // Assumes jasmine-reporters is configured in the protractor config to emit results/junit.xml.
    return ['npx', 'protractor', '{{testFile}}'];
  },
};
