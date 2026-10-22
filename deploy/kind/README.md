# Full dev environment with kind + Argo Workflows

Prerequisites: `docker`, `kind`, `kubectl`, `helm`.

```bash
# 1. kind cluster
kind create cluster --name tcs

# 2. Argo Workflows (argo namespace)
kubectl create namespace argo
kubectl apply -n argo -f https://github.com/argoproj/argo-workflows/releases/download/v3.6.5/quick-start-minimal.yaml

# 3. RBAC + TestCampaignShooter dependencies (dev postgres + minio included)
helm install tcs ../helm/testcampaignshooter \
  --namespace tcs --create-namespace \
  --set image.registry=ghcr.io/OWNER/testcampaignshooter

# 4. Server secret (adjust the values)
kubectl -n tcs create secret generic testcampaignshooter-server \
  --from-literal=SESSION_SECRET='change-me-32-chars-minimum-please!' \
  --from-literal=DATABASE_URL='postgresql://tcs:tcs@tcs-postgresql:5432/tcs' \
  --from-literal=S3_ENDPOINT='http://tcs-minio:9000' \
  --from-literal=S3_ACCESS_KEY='tcs' \
  --from-literal=S3_SECRET_KEY='tcs-secret' \
  --from-literal=ADMIN_EMAIL='admin@example.com' \
  --from-literal=ADMIN_PASSWORD='admin'

# 5. Argo artifact repository -> MinIO (workflow-controller configmap)
kubectl -n argo patch configmap workflow-controller-configmap --patch-file artifact-repository.yaml
```

`quick-start-minimal` includes an Argo Server at `argo-server.argo.svc:2746`
(used by the server for **targeted retry** — `ARGO_SERVER_URL`).

## Local access

```bash
kubectl -n tcs port-forward svc/tcs-server 4000:4000 &
kubectl -n tcs port-forward svc/tcs-portal 3000:3000 &
kubectl -n argo port-forward svc/argo-server 2746:2746 &
```

## Verification

1. Portal at http://localhost:3000 → log in as `admin@example.com` / `admin`.
2. Create a campaign pointing at a git repo containing `examples/tests`.
3. Launch it: each test becomes its own Argo node (`kubectl -n argo get wf`).
4. The `aggregate` step merges the JUnit reports and calls back the API
   (`PUBLIC_BASE_URL`).
