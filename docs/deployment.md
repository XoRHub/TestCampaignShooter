# Deployment documentation

This document describes **how to deploy each component** of the project and
**which topology to adopt depending on the orchestration provider**
(`local`, `docker`, `argo`). The provider is a **configuration** choice
(`ORCHESTRATION_PROVIDER`), not a build one: the same images/artifacts serve
all three.

> For a hands-on walkthrough (full commands, portal/API journey,
> troubleshooting), see [getting-started.md](getting-started.md); for how
> teams use the portal, see [user-guide.md](user-guide.md). The
> **exhaustive configuration variable reference** is in
> [§7](#7-complete-configuration-variable-reference).

## 1. Components and deployment artifacts

| Component                                  | Artifact                                                                 | Where it runs                             | Depends on                      |
| ------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------- |
| **API server** (`apps/server`)             | `server` image (multi-stage Dockerfile) or `pnpm dev:server`             | host, docker-compose, or a k8s Deployment | PostgreSQL, S3/MinIO, provider  |
| **Portal** (`apps/portal`)                 | `portal` image (Next.js standalone) or `pnpm dev:portal`                 | host, docker-compose, or a k8s Deployment | Server (REST+SSE)               |
| **CLI** (`apps/cli`)                       | `node apps/cli/bin/tcs.mjs` (no image — a workstation tool)              | developer workstation / CI                | —                               |
| **PostgreSQL**                             | `postgres:16-alpine` (compose) or the chart's StatefulSet / a managed DB | environment-dependent                     | —                               |
| **MinIO / S3**                             | `minio/minio` (compose) or the chart's StatefulSet / managed S3          | environment-dependent                     | —                               |
| **Pushgateway** (business metrics, opt-in) | `prom/pushgateway`                                                       | environment-dependent                     | a dedicated business Prometheus |
| **Argo Workflows**                         | official install (quick-start or the Argo chart)                         | k8s cluster only                          | S3 artifact repository          |
| **k8s RBAC** (SA, Role, RoleBinding)       | `deploy/helm/testcampaignshooter/templates/rbac.yaml`                    | k8s cluster                               | —                               |
| **Manual Argo steps**                      | `deploy/argo/steps/step-<engine>.yaml` files                             | mounted/bundled with the server           | —                               |

Building the images (context = repo root):

```bash
docker build -f apps/server/Dockerfile -t ghcr.io/OWNER/testcampaignshooter/server:TAG .
docker build -f apps/portal/Dockerfile -t ghcr.io/OWNER/testcampaignshooter/portal:TAG \
  --build-arg NEXT_PUBLIC_API_URL=https://tcs.example.com .
```

Or bring up the whole stack (postgres/minio/pushgateway + server + portal)
in one command — see [§3.1](#31-common-baseline):

```bash
docker compose up --build
```

> ⚠ `NEXT_PUBLIC_API_URL` is **baked into the portal's bundle** at build
> time: a portal image is tied to its API's public URL (or to an ingress
> exposing `/api` on the same origin — see §4.3).

CI (`.github/workflows/`) runs lint/typecheck/test/build, a Helm chart
lint/unittest gate, a Trivy vulnerability scan (filesystem + images), and
builds+pushes both images as a multi-arch (amd64+arm64) manifest to GHCR on
every push to `main`, with a CycloneDX SBOM generated per image.
[release-please](https://github.com/googleapis/release-please) then
promotes (re-tags, never rebuilds) the images of a released commit to the
bare SemVer + `latest` tags, and publishes the Helm chart as its own OCI
artifact — see [technical.md §Quality & CI](technical.md#quality--ci) for
the full pipeline.

## 2. Provider × topology matrix

|                            | `local` (process)                   | `docker`                                                | `argo` (production)                             |
| -------------------------- | ----------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| Running a test             | host child process                  | `docker run` with the metadata's image                  | Kubernetes pod                                  |
| Where to deploy the server | dev workstation (`pnpm dev:server`) | dev workstation/VM **with access to the Docker daemon** | k8s Deployment (Helm)                           |
| Test source                | local folder or git                 | local folder or git                                     | **git only**                                    |
| Dependencies to deploy     | postgres, minio, (pushgateway)      | same + Docker                                           | same + Argo Workflows + RBAC                    |
| Scalability                | 1 machine                           | 1 machine                                               | cluster (pod fan-out)                           |
| Targeted retry             | native to the provider              | native to the provider                                  | via the **Argo Server API** (`ARGO_SERVER_URL`) |
| Usage                      | lightweight dev, unit tests         | **iso-prod** dev (same images as the pods)              | production / staging                            |

## 3. `local` and `docker` provider deployment (dev workstation / single VM)

### 3.1 Common baseline

```bash
pnpm install
docker compose up -d                 # postgres:5432, minio:9000/9001, pushgateway:9091
cp apps/server/.env.example apps/server/.env
pnpm --filter @tcs/server prisma:migrate   # creates the schema
pnpm dev:server                      # API http://localhost:4000 (admin bootstrap)
pnpm dev:portal                      # portal http://localhost:3000
```

Or, to run the server and portal themselves in Docker too (their production
images, no hot reload — rebuild after a code change with `docker compose up
--build server portal`):

```bash
docker compose up --build             # portal http://localhost:3000, API http://localhost:4000
```

Minimal `.env`: `DATABASE_URL`, `SESSION_SECRET`, `S3_*` (values matching
the compose file), `ORCHESTRATION_PROVIDER=local|docker`.

### 3.2 `local`-specific notes (process runtime)

- No extra dependency: test commands run on the host → the invoked tools
  (node, pytest, robot…) must be installed there. The metadata's image is
  ignored. Reserved for quick debugging.

### 3.3 `docker`-specific notes

- The Docker daemon must be reachable from the **server process**
  (`docker info` must respond). Overridable binary: `LOCAL_PROVIDER_DOCKER_BIN`.
- **If the server itself runs in a container** (compose/k8s), two
  constraints apply:
  1. mount the socket: `-v /var/run/docker.sock:/var/run/docker.sock`
     (+ the docker CLI in the image);
  2. the `-v <workspace>:/workspace` mounts the provider creates are
     resolved **by the host's daemon**: the tests' working directory must
     be a path **visible from the host**. Point
     `LOCAL_PROVIDER_WORKSPACE_DIR` at a folder bind-mounted identically
     into the server container (e.g. `-v /srv/tcs-ws:/srv/tcs-ws` and
     `LOCAL_PROVIDER_WORKSPACE_DIR=/srv/tcs-ws`).
     The simplest option in dev remains: server on the host (`pnpm
dev:server`), dependencies in compose.
- Engine images (cypress/included, ppodgorsek/robot-framework,
  node:22-slim…) are pulled on first run — plan for registry access
  (`CONTAINER_REGISTRY`/an internal mirror if applicable, via the
  metadata's `execution.image`).

> Two equivalent ways to select containerized execution:
> `ORCHESTRATION_PROVIDER=docker`, or `ORCHESTRATION_PROVIDER=local` +
> `LOCAL_PROVIDER_RUNTIME=docker` (same implementation, a different
> provider name shows up on runs).

### 3.4 Results callback

`local` and `docker` POST the aggregated JUnit **from the server process
itself** to `PUBLIC_BASE_URL/api/internal/runs/:id/results`: in dev,
`PUBLIC_BASE_URL=http://localhost:4000` is enough.

### 3.5 Launching tests with each provider (usage recap)

The user experience (portal/API/CLI) is **identical regardless of the
provider** — only where execution happens changes:

| How to launch                                 | `local`                            | `docker`             | `argo`                      |
| --------------------------------------------- | ---------------------------------- | -------------------- | --------------------------- |
| Portal / API (`POST /api/campaigns/:id/runs`) | ✔ (git, folder or zip source)      | ✔ (same)             | ✔ (**git** source only)     |
| Cron scheduling (campaign)                    | ✔                                  | ✔                    | ✔                           |
| CLI without a server                          | `tcs run --source … --rule-file …` | `tcs run --docker …` | — (goes through the server) |

Detailed walkthroughs: [getting-started.md](getting-started.md) §2 (CLI),
§3 (portal/API locally), and §6 (Argo Workflows end to end).

## 4. `argo` provider deployment (Kubernetes, production)

### 4.1 Cluster prerequisites

1. **Argo Workflows** installed (`argo` namespace):
   `kubectl apply -n argo -f …/quick-start-minimal.yaml` (dev) or the
   official chart (prod). The **Argo Server** (`argo-server:2746`) is
   required for **targeted retry** (`ARGO_SERVER_URL`, optional
   `ARGO_SERVER_TOKEN`).
2. **S3/MinIO artifact repository** configured in the
   `workflow-controller-configmap` (patch provided:
   `deploy/kind/artifact-repository.yaml`) — the steps read/write
   `tcs-runs/<runId>/partials/*.xml` and `junit.xml` there.
3. **RBAC**: set up by the chart (`rbac.yaml`) —
   - `ServiceAccount testcampaignshooter` (argo namespace): carried by the
     workflow pods (+ `workflowtaskresults` Role);
   - Role `testcampaignshooter-orchestrator`: `workflows`/`workflowtemplates`
     CRUD + `pods`,`pods/log` read, bound to the server's SA (cross-namespace).

### 4.2 Helm install

```bash
helm install tcs deploy/helm/testcampaignshooter \
  --namespace tcs --create-namespace \
  --set image.registry=ghcr.io/OWNER/testcampaignshooter \
  --set image.tag=<TAG> \
  --set server.env.ORCHESTRATION_PROVIDER=argo \
  --set argo.namespace=argo \
  --set argo.serverUrl=http://argo-server.argo.svc:2746

kubectl -n tcs create secret generic testcampaignshooter-server \
  --from-literal=SESSION_SECRET='…32+ chars…' \
  --from-literal=DATABASE_URL='postgresql://…' \
  --from-literal=S3_ENDPOINT='http://tcs-minio:9000' \
  --from-literal=S3_ACCESS_KEY='…' --from-literal=S3_SECRET_KEY='…' \
  --from-literal=OIDC_CLIENT_SECRET='…' \
  --from-literal=ADMIN_EMAIL='admin@example.com' --from-literal=ADMIN_PASSWORD='…'
```

The chart deploys: the server (Deployment + Service + `/healthz`/`/readyz`
probes), the portal, RBAC, and — **dev only** (`postgresql.enabled`,
`minio.enabled`) — a PostgreSQL and a MinIO StatefulSet. In production,
disable those and point `DATABASE_URL`/`S3_*` at your managed services.
Prisma migrations apply at server container startup (`prisma migrate
deploy` in the image's CMD).

### 4.3 Argo-specific gotchas

- **`PUBLIC_BASE_URL`** must be reachable **from pods in the argo
  namespace** (the aggregation step POSTs the JUnit report there): use the
  internal Service (`http://tcs-server.tcs.svc:4000`) or the ingress URL.
  Optional: `INTERNAL_CALLBACK_TOKEN` to authenticate this callback.
- **Test source = git is mandatory** (a local folder isn't visible from the
  pods). Private repos: a `--from-literal=token=…` Secret referenced by
  `ARGO_GIT_SECRET_NAME` (injected into the `fetch-source` step, never
  logged).
- **Manual steps**: `deploy/argo/steps` must be readable by the server
  (`ARGO_MANUAL_STEPS_DIR`) — bundled in the image by default; a mounted
  ConfigMap works too.
- **Ingress** (`ingress.enabled=true`): routes `/api` + `/metrics` → the
  server, `/` → the portal (same origin ⇒ the build's `NEXT_PUBLIC_API_URL`
  can be the single public URL). The provided nginx annotations disable
  buffering and extend the read timeout for **SSE**.
- **Kubeconfig**: in-cluster, `@kubernetes/client-node` uses the mounted
  ServiceAccount (in-cluster) automatically; outside the cluster (dev), the
  current kubeconfig (`loadFromDefault`).
- Replication: 1 server replica (in-memory event bus). For N replicas,
  plug an external pub/sub into `RunEventBus` (see architecture.md).

### 4.4 Full dev cluster

`deploy/kind/README.md` provides the kind (Kubernetes-in-Docker)
walkthrough: cluster + Argo quick-start + chart + secret + artifact
repository patch + port-forwards + a verification scenario.

## 5. Observability & metrics (all providers)

- **`/metrics`** (server): system/HTTP/watcher metrics — scraped by the
  **infra Prometheus** (a ServiceMonitor or a scrape_config on the
  Service).
- **Business metrics**: `BUSINESS_METRICS_ENABLED=true` +
  `PUSHGATEWAY_URL=<dedicated pushgateway>` (+
  `PUSHGATEWAY_USERNAME/PASSWORD`). A **separate** target by design
  (cardinality isolation) — deploy the Pushgateway near the "test results"
  Prometheus, not the infra one.
- Probes: `/healthz` (liveness — process up) and `/readyz` (readiness — DB
  reachable). The server boots in a degraded mode if the DB/S3 are
  unreachable and reports it via `/readyz` (503).

## 6. Environments & secrets — summary

| Variable                                          | dev (`local`/`docker`)         | prod (`argo`)                                                        |
| ------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `ORCHESTRATION_PROVIDER`                          | `local` or `docker`            | `argo`                                                               |
| `DATABASE_URL`                                    | compose (`localhost:5432`)     | Secret → managed DB                                                  |
| `S3_*`                                            | compose (`localhost:9000`)     | Secret → S3/MinIO                                                    |
| `SESSION_SECRET`, `ADMIN_*`, `OIDC_CLIENT_SECRET` | `.env`                         | k8s Secret (`existingSecret`)                                        |
| `PUBLIC_BASE_URL`                                 | `http://localhost:4000`        | Service/ingress reachable from the pods                              |
| `AUTH_OIDC_ENABLED` + `OIDC_*`                    | often off                      | on (corporate issuer)                                                |
| `ARGO_*`                                          | —                              | namespace, SA, server URL, git secret, steps dir                     |
| `BUSINESS_METRICS_*`                              | off or the compose pushgateway | dedicated pushgateway                                                |
| `SCHEDULER_ENABLED` / `SCHEDULER_TIMEZONE`        | on (default)                   | on **on a single replica**; an explicit IANA timezone is recommended |

General rule: **every secret lives in an environment variable/k8s Secret**,
never in Helm values or in code; `.env*` files are git-ignored.

## 7. Complete configuration variable reference

Every variable read by the **server** (validated at startup by the Zod
schema in `apps/server/src/config.ts` — an invalid value fails the boot
with details) and by the **providers** (read when the provider is
created). `apps/server/.env.example` provides a commented `.env` aligned
with the docker-compose file.

### 7.1 HTTP server & basics

| Variable          | Default                 | Description                                                                                              |
| ----------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `PORT`            | `4000`                  | API listen port                                                                                          |
| `HOST`            | `0.0.0.0`               | Listen interface                                                                                         |
| `PUBLIC_BASE_URL` | `http://localhost:4000` | Base URL **reachable by the executors** (Argo pods) — target of the JUnit callback and of OIDC redirects |
| `PORTAL_ORIGIN`   | `http://localhost:3000` | Portal origin (CORS + post-login OIDC redirect)                                                          |
| `LOG_LEVEL`       | `info`                  | `fatal…trace` (pino)                                                                                     |
| `DATABASE_URL`    | **required**            | PostgreSQL (`postgresql://user:pass@host:5432/db`)                                                       |

### 7.2 Orchestration — common

| Variable                 | Default | Description                                                                                                           |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `ORCHESTRATION_PROVIDER` | `local` | `local` \| `docker` \| `argo` (or any registered provider)                                                            |
| `DEFAULT_PARALLELISM`    | `5`     | A campaign's default parallelism                                                                                      |
| `GIT_TOKEN`              | —       | Token to clone private repos **server-side** (preview/ingestion; never logged). For Argo pods: `ARGO_GIT_SECRET_NAME` |

### 7.3 `local` / `docker` providers

| Variable                       | Default       | Description                                                                                                               |
| ------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `LOCAL_PROVIDER_RUNTIME`       | `process`     | `process` (host child process) \| `docker` — ignored if `ORCHESTRATION_PROVIDER=docker` (already docker)                  |
| `LOCAL_PROVIDER_DOCKER_BIN`    | `docker`      | docker/podman binary to invoke                                                                                            |
| `LOCAL_PROVIDER_WORKSPACE_DIR` | system tmpdir | Root of test workspaces — **must be a path visible to the Docker daemon** if the server itself runs in a container (§3.3) |

### 7.4 `argo` provider

| Variable                | Default               | Description                                                                                    |
| ----------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| `K8S_NAMESPACE`         | `argo`                | Namespace for Workflows/WorkflowTemplates                                                      |
| `ARGO_SERVICE_ACCOUNT`  | `testcampaignshooter` | ServiceAccount carried by the workflow pods                                                    |
| `ARGO_SERVER_URL`       | —                     | Argo Server URL (`http://argo-server.argo.svc:2746`) — **required for targeted retry**         |
| `ARGO_SERVER_TOKEN`     | —                     | Argo Server bearer token (if auth is enabled)                                                  |
| `ARGO_MANUAL_STEPS_DIR` | `deploy/argo/steps`   | Directory of manual step templates (`step-<engine>.yaml`, take precedence over generated ones) |
| `ARGO_GIT_SECRET_NAME`  | —                     | k8s Secret (key `token`) injected into the `fetch-source` step for private repos               |
| `ARGO_ARTIFACT_PREFIX`  | `tcs-runs`            | S3 prefix for run artifacts (`<prefix>/<runId>/…`)                                             |

Beyond these variables: the kubeconfig is resolved automatically
(in-cluster ServiceAccount, otherwise the current kubeconfig).

### 7.5 Scheduler (cron)

| Variable             | Default                   | Description                                                                       |
| -------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `SCHEDULER_ENABLED`  | `true`                    | Automatic launches of scheduled campaigns — **only one replica** should enable it |
| `SCHEDULER_TIMEZONE` | the server's own timezone | IANA timezone applied to cron expressions (`Europe/Paris`)                        |

### 7.6 Authentication & sessions

| Variable                                | Default                | Description                                                                                                 |
| --------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `AUTH_PASSWORD_ENABLED`                 | `true`                 | Local email/password login                                                                                  |
| `AUTH_OIDC_ENABLED`                     | `false`                | OIDC SSO login (requires `OIDC_ISSUER` + `OIDC_CLIENT_ID`) — at least one of the two methods must be active |
| `SESSION_SECRET`                        | **required**           | ≥ 32 characters — signs session JWTs                                                                        |
| `SESSION_TTL_HOURS`                     | `12`                   | Session duration                                                                                            |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD`        | —                      | Bootstrap admin account created at startup (if missing in the DB)                                           |
| `OIDC_ISSUER`                           | —                      | Issuer URL (`.well-known` discovery)                                                                        |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | —                      | OIDC client                                                                                                 |
| `OIDC_SCOPES`                           | `openid profile email` | Requested scopes                                                                                            |
| `OIDC_ROLES_CLAIM`                      | `roles`                | Claim carrying the roles (`viewer`/`editor`/`admin`); no known role → `viewer`                              |

### 7.7 Artifact storage (S3/MinIO)

| Variable                          | Default         | Description                                                                   |
| --------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| `S3_ENDPOINT`                     | —               | S3 endpoint (`http://localhost:9000` for MinIO); empty = AWS S3 in the region |
| `S3_REGION`                       | `us-east-1`     | Region                                                                        |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | —               | Credentials                                                                   |
| `S3_BUCKET`                       | `tcs-artifacts` | Bucket (created at boot if missing, best-effort)                              |
| `S3_FORCE_PATH_STYLE`             | `true`          | Path style (required for MinIO)                                               |

### 7.8 Metrics & internal callback

| Variable                                        | Default         | Description                                                                                                                               |
| ----------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `BUSINESS_METRICS_ENABLED`                      | `false`         | Push business metrics (campaign results)                                                                                                  |
| `PUSHGATEWAY_URL`                               | —               | **Dedicated** Pushgateway (cardinality isolation, §5)                                                                                     |
| `BUSINESS_METRICS_JOB`                          | `tcs-campaigns` | Pushgateway job name                                                                                                                      |
| `PUSHGATEWAY_USERNAME` / `PUSHGATEWAY_PASSWORD` | —               | Optional basic auth                                                                                                                       |
| `INTERNAL_CALLBACK_TOKEN`                       | —               | If set, the `POST /api/internal/runs/:id/results` callback requires the `x-tcs-token` header (sent automatically by the aggregation step) |

### 7.9 Portal (**build**-time and runtime variables)

| Variable                 | When                      | Description                                                                                  |
| ------------------------ | ------------------------- | -------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`    | **build** (`--build-arg`) | The API's public URL, baked into the bundle (§1) — same origin via an ingress is recommended |
| `NEXT_OUTPUT_STANDALONE` | **build**                 | `true` in the Dockerfile (standalone Next.js bundle); leave empty in Windows dev             |
| `PORT`                   | runtime                   | Portal port (default `3000`)                                                                 |
