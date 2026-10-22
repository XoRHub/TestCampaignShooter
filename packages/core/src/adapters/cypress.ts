import type { EngineAdapter } from './types.js';

export const cypressAdapter: EngineAdapter = {
  engine: 'cypress',
  displayName: 'Cypress',
  defaultImage: 'cypress/included:13.17.0',
  defaultJunitPath: 'results/junit.xml',
  validate(): string[] {
    return [];
  },
  defaultCommand(): string[] {
    return [
      'npx',
      'cypress',
      'run',
      '--spec',
      '{{testFile}}',
      '--reporter',
      'junit',
      '--reporter-options',
      'mochaFile=results/junit.xml',
    ];
  },
};
