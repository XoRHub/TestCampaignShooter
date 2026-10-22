import type { DiscoveredTest } from '@tcs/shared-types';
import type { EngineAdapter } from './types.js';

/**
 * Generic Node.js runner: executes the declared command (Jest, Mocha,
 * Playwright, ...) which must write a JUnit report at `execution.junitPath`.
 */
export const genericNodeAdapter: EngineAdapter = {
  engine: 'generic-node',
  displayName: 'Generic Node.js runner (Jest/Mocha/Playwright/...)',
  defaultImage: 'node:22-slim',
  defaultJunitPath: 'results/junit.xml',
  validate(test: DiscoveredTest): string[] {
    return test.metadata.execution.command
      ? []
      : ['generic-node tests must declare "execution.command" (e.g. ["npx","jest","{{testFile}}","--reporters=jest-junit"])'];
  },
};
