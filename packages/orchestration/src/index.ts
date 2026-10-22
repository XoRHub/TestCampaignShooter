import { registerProviderFactory } from './provider.js';
import { LocalProvider } from './local/local-provider.js';

export * from './provider.js';
export { LocalProvider, type LocalProviderOptions } from './local/local-provider.js';
export {
  DockerRuntime,
  ProcessRuntime,
  buildDockerRunArgs,
  toDockerCpus,
  toDockerMemory,
  type TestRuntime,
} from './local/runtimes.js';

// The local (dev) providers ship with the abstraction itself; the Argo
// provider registers from @tcs/orchestration-argo, other providers can do
// the same from their own package without touching this one.
//
// - "local"  : host child processes (or docker when LOCAL_PROVIDER_RUNTIME=docker)
// - "docker" : every test encapsulated in its metadata container image —
//              the single-machine equivalent of an Argo pod.
registerProviderFactory('local', (config) => new LocalProvider(config));
registerProviderFactory(
  'docker',
  (config) => new LocalProvider(config, { name: 'docker', runtime: 'docker' }),
);
