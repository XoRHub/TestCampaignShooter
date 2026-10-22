import type { DiscoveredTest } from '@tcs/shared-types';
import type { EngineAdapter } from './types.js';

/**
 * Generic Python runner: executes the declared command (pytest, unittest,
 * ...) which must write a JUnit report at `execution.junitPath`.
 */
export const genericPythonAdapter: EngineAdapter = {
  engine: 'generic-python',
  displayName: 'Generic Python runner (pytest/unittest/...)',
  defaultImage: 'python:3.12-slim',
  defaultJunitPath: 'results/junit.xml',
  validate(test: DiscoveredTest): string[] {
    return test.metadata.execution.command
      ? []
      : ['generic-python tests must declare "execution.command" (e.g. ["pytest","{{testFile}}","--junitxml=results/junit.xml"])'];
  },
};
