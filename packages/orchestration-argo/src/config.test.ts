import { describe, expect, it } from 'vitest';
import { argoConfigFromEnv } from './config.js';

describe('argoConfigFromEnv', () => {
  it('applies defaults when no env vars are set', () => {
    expect(argoConfigFromEnv({})).toEqual({
      namespace: 'argo',
      serviceAccountName: 'testcampaignshooter',
      argoServerUrl: undefined,
      argoServerToken: undefined,
      manualStepsDir: 'deploy/argo/steps',
      gitSecretName: undefined,
      artifactPrefix: 'tcs-runs',
    });
  });

  it('reads every value from the provided env map', () => {
    expect(
      argoConfigFromEnv({
        K8S_NAMESPACE: 'tcs-prod',
        ARGO_SERVICE_ACCOUNT: 'tcs-runner',
        ARGO_SERVER_URL: 'http://argo-server:2746',
        ARGO_SERVER_TOKEN: 'secret-token',
        ARGO_MANUAL_STEPS_DIR: 'custom/steps',
        ARGO_GIT_SECRET_NAME: 'git-creds',
        ARGO_ARTIFACT_PREFIX: 'custom-runs',
      }),
    ).toEqual({
      namespace: 'tcs-prod',
      serviceAccountName: 'tcs-runner',
      argoServerUrl: 'http://argo-server:2746',
      argoServerToken: 'secret-token',
      manualStepsDir: 'custom/steps',
      gitSecretName: 'git-creds',
      artifactPrefix: 'custom-runs',
    });
  });

  it('ignores unrelated env vars', () => {
    expect(argoConfigFromEnv({ PATH: '/usr/bin', HOME: '/home/x' }).namespace).toBe('argo');
  });
});
