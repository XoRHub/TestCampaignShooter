import { registerAdapter } from './registry.js';
import { robotFrameworkAdapter } from './robotframework.js';
import { seleniumAdapter } from './selenium.js';
import { cypressAdapter } from './cypress.js';
import { protractorAdapter } from './protractor.js';
import { genericJavaAdapter } from './generic-java.js';
import { genericNodeAdapter } from './generic-node.js';
import { genericPythonAdapter } from './generic-python.js';

export * from './types.js';
export * from './registry.js';
export * from './manifest.js';
export * from './fetch-manifest.js';
export { robotFrameworkAdapter } from './robotframework.js';
export { seleniumAdapter } from './selenium.js';
export { cypressAdapter } from './cypress.js';
export { protractorAdapter } from './protractor.js';
export { genericJavaAdapter } from './generic-java.js';
export { genericNodeAdapter } from './generic-node.js';
export { genericPythonAdapter } from './generic-python.js';

// Built-in engines. Adding a new engine = one new file + one register call here.
for (const adapter of [
  robotFrameworkAdapter,
  seleniumAdapter,
  cypressAdapter,
  protractorAdapter,
  genericJavaAdapter,
  genericNodeAdapter,
  genericPythonAdapter,
]) {
  registerAdapter(adapter);
}
