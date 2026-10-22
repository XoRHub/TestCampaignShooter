# testcampaignshooter

Test campaign orchestration platform on Argo Workflows

![Version: 1.0.1](https://img.shields.io/badge/Version-1.0.1-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 1.0.1](https://img.shields.io/badge/AppVersion-1.0.1-informational?style=flat-square)

## Installing

```bash
helm install tcs deploy/helm/testcampaignshooter \
  --namespace tcs --create-namespace \
  --set image.registry=ghcr.io/OWNER/testcampaignshooter \
  --set image.tag=<TAG>
```

See [docs/deployment.md](../../../docs/deployment.md) for the full
per-provider (`local`/`docker`/`argo`) installation and configuration guide.

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| image.registry | string | `"ghcr.io/OWNER/testcampaignshooter"` |  |
| image.tag | string | `"latest"` |  |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| server.replicas | int | `1` |  |
| server.port | int | `4000` |  |
| server.publicBaseUrl | string | `"http://testcampaignshooter-server:4000"` |  |
| server.logLevel | string | `"info"` |  |
| server.env.ORCHESTRATION_PROVIDER | string | `"argo"` |  |
| server.env.DEFAULT_PARALLELISM | string | `"5"` |  |
| server.env.AUTH_PASSWORD_ENABLED | string | `"true"` |  |
| server.env.AUTH_OIDC_ENABLED | string | `"false"` |  |
| server.env.OIDC_ISSUER | string | `""` |  |
| server.env.OIDC_CLIENT_ID | string | `""` |  |
| server.env.OIDC_SCOPES | string | `"openid profile email"` |  |
| server.env.BUSINESS_METRICS_ENABLED | string | `"false"` |  |
| server.env.PUSHGATEWAY_URL | string | `""` |  |
| server.existingSecret | string | `"testcampaignshooter-server"` |  |
| portal.replicas | int | `1` |  |
| portal.port | int | `3000` |  |
| argo.namespace | string | `"argo"` |  |
| argo.serviceAccount | string | `"testcampaignshooter"` |  |
| argo.serverUrl | string | `"http://argo-server.argo.svc:2746"` |  |
| argo.artifactPrefix | string | `"tcs-runs"` |  |
| argo.gitSecretName | string | `""` |  |
| postgresql.enabled | bool | `true` |  |
| postgresql.image | string | `"postgres:16-alpine"` |  |
| postgresql.database | string | `"tcs"` |  |
| postgresql.username | string | `"tcs"` |  |
| postgresql.password | string | `"tcs"` |  |
| postgresql.storage | string | `"5Gi"` |  |
| minio.enabled | bool | `true` |  |
| minio.image | string | `"minio/minio:latest"` |  |
| minio.rootUser | string | `"tcs"` |  |
| minio.rootPassword | string | `"tcs-secret"` |  |
| minio.bucket | string | `"tcs-artifacts"` |  |
| minio.storage | string | `"10Gi"` |  |
| ingress.enabled | bool | `false` |  |
| ingress.className | string | `"nginx"` |  |
| ingress.host | string | `"tcs.example.com"` |  |
