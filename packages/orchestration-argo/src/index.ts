import { registerProviderFactory } from '@tcs/orchestration';
import { ArgoProvider } from './provider.js';

export { ArgoProvider } from './provider.js';
export { buildWorkflow, buildCommandLine } from './workflow-builder.js';
export {
  generateEngineStepTemplate,
  loadManualStepTemplates,
  resolveStepTemplates,
} from './step-templates.js';
export { testNodeName, workflowName, stepTemplateName } from './naming.js';
export { argoConfigFromEnv } from './config.js';

// Importing this package registers the Argo provider; selection stays
// config-driven via ORCHESTRATION_PROVIDER=argo.
registerProviderFactory('argo', (config) => new ArgoProvider(config));
