export interface ArgoProviderConfig {
  namespace: string;
  serviceAccountName?: string;
  /** Argo Server base URL — required for targeted retry/resubmit (e.g. http://argo-server:2746). */
  argoServerUrl?: string;
  /** Bearer token for the Argo Server API (optional when SSO/insecure). */
  argoServerToken?: string;
  /** Directory containing hand-written step templates (`step-<engine>.yaml`). */
  manualStepsDir: string;
  /** Kubernetes secret (key `token`) injected into the fetch-source step for git auth. */
  gitSecretName?: string;
  /** S3 prefix under which run artifacts are stored (bucket comes from the artifact repository). */
  artifactPrefix: string;
}

export function argoConfigFromEnv(env: Record<string, string | undefined>): ArgoProviderConfig {
  return {
    namespace: env.K8S_NAMESPACE ?? 'argo',
    serviceAccountName: env.ARGO_SERVICE_ACCOUNT ?? 'testcampaignshooter',
    argoServerUrl: env.ARGO_SERVER_URL,
    argoServerToken: env.ARGO_SERVER_TOKEN,
    manualStepsDir: env.ARGO_MANUAL_STEPS_DIR ?? 'deploy/argo/steps',
    gitSecretName: env.ARGO_GIT_SECRET_NAME,
    artifactPrefix: env.ARGO_ARTIFACT_PREFIX ?? 'tcs-runs',
  };
}
