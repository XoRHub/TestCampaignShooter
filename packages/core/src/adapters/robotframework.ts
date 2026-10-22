import type { DiscoveredTest } from '@tcs/shared-types';
import type { EngineAdapter } from './types.js';

/**
 * Robot Framework: `--xunit` natively produces a JUnit-compatible report,
 * so the default command needs no extra conversion step.
 */
export const robotFrameworkAdapter: EngineAdapter = {
  engine: 'robotframework',
  displayName: 'Robot Framework',
  defaultImage: 'ppodgorsek/robot-framework:latest',
  defaultJunitPath: 'results/junit.xml',
  validate(test: DiscoveredTest): string[] {
    return test.file.endsWith('.robot')
      ? []
      : [`Robot Framework tests must be ".robot" files (got "${test.file}")`];
  },
  defaultCommand(): string[] {
    return ['robot', '--outputdir', 'results', '--xunit', 'junit.xml', '{{testFile}}'];
  },
};
