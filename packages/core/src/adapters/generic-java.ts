import type { DiscoveredTest } from '@tcs/shared-types';
import type { EngineAdapter } from './types.js';

/**
 * Generic Java runner: executes the Maven/Gradle command declared in the
 * metadata (JUnit, TestNG, ...) and collects the surefire/failsafe reports.
 * No specific tool is hardcoded.
 */
export const genericJavaAdapter: EngineAdapter = {
  engine: 'generic-java',
  displayName: 'Generic Java runner (Maven/Gradle)',
  defaultImage: 'maven:3.9-eclipse-temurin-21',
  defaultJunitPath: 'target/surefire-reports/TEST-*.xml',
  validate(test: DiscoveredTest): string[] {
    return test.metadata.execution.command
      ? []
      : ['generic-java tests must declare "execution.command" (e.g. ["mvn","-q","test","-Dtest={{testId}}"])'];
  },
};
