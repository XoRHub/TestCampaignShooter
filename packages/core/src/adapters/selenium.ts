import type { DiscoveredTest } from '@tcs/shared-types';
import type { EngineAdapter } from './types.js';

/**
 * Selenium is a browser-automation library, not a test runner: the metadata
 * must provide the command of the surrounding runner (pytest, mvn, ...).
 * The default image ships a standalone Chrome reachable on localhost:4444.
 */
export const seleniumAdapter: EngineAdapter = {
  engine: 'selenium',
  displayName: 'Selenium',
  defaultImage: 'selenium/standalone-chrome:latest',
  defaultJunitPath: 'results/junit.xml',
  validate(test: DiscoveredTest): string[] {
    return test.metadata.execution.command
      ? []
      : ['selenium tests must declare "execution.command" (the runner invoking Selenium)'];
  },
};
