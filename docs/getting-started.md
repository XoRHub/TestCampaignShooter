# Getting started guide — testing locally & running via Argo Workflows

A step-by-step runbook covering everything that's implemented: the CLI, the
server, the portal, the `local`/`docker`/`argo` providers. Detailed
references stay in [technical.md](technical.md) (API, interfaces) and
[deployment.md](deployment.md) (topologies, Helm, secrets, variable
reference). The **portal user's** journey (logging in, campaigns,
scheduling, analysis) is in [user-guide.md](user-guide.md).

---

## 1. Prerequisites & installation

| Tool                | Version                | Required for                                       |
| ------------------- | ---------------------- | -------------------------------------------------- |
| Node.js             | ≥ 20                   | everything                                         |
| pnpm                | ≥ 10 (`npm i -g pnpm`) | everything                                         |
| Docker (+ compose)  | recent                 | the `docker` provider, dev dependencies, Argo/kind |
| kind, kubectl, helm | recent                 | running via Argo Workflows (§6)                    |

Alternatively, [`mise`](https://mise.jdx.dev) (`.mise.toml`) pins the exact
toolchain versions CI uses (Node, pnpm, Helm, helm-docs, Trivy) — run `mise
install` once instead of installing everything by hand.

```bash
git clone <repo> && cd test-fable-tcs
pnpm install
```

Check that the project is healthy:

```bash
pnpm test        # full Vitest suite (DB-less)
pnpm typecheck   # strict TS across every package
pnpm lint
```

A separate, slower suite exercises the server's routes against a real
Postgres (`docker compose up -d postgres` first — it targets a dedicated
`tcs_test` database, created and migrated automatically, never your dev
data):

```bash
pnpm test:integration
```

---

## 2. Test locally without deploying anything: the CLI

The CLI runs discovery/selection/execution directly, with no server and no
DB. Binary: `node apps/cli/bin/tcs.mjs` (or `pnpm --filter @tcs/cli exec
tcs`).

```bash
# 1) Discover the sample test set's tests (+ metadata issues)
node apps/cli/bin/tcs.mjs discover --source examples/tests

# 2) Evaluate a selection rule without running anything (campaign preview)
node apps/cli/bin/tcs.mjs preview --source examples/tests \
  --rule-file examples/rules/smoke-payments.json

# inline rule + subtree restriction:
node apps/cli/bin/tcs.mjs preview --source examples/tests \
  --rule '{"prop":"tags","op":"contains","value":"unit"}' --path suites/unit

# 3) Run a local campaign (child processes)
node apps/cli/bin/tcs.mjs run --source examples/tests \
  --rule-file examples/rules/unit-only.json --parallelism 2 --junit-out junit.xml

# 4) Same, but each test encapsulated in ITS OWN container image (iso-Argo)
node apps/cli/bin/tcs.mjs run --docker --source examples/tests \
  --rule-file examples/rules/unit-only.json

# 5) List the registered engines
node apps/cli/bin/tcs.mjs engines

# 6) Add/override engines from a downloadable manifest (docs/adapter-plugins.md)
node apps/cli/bin/tcs.mjs engines --adapter-manifest https://example.com/adapters/manifest.yaml
```

Expected result of (3): `unit/math` **succeeded**, `unit/strings` **failed**
(a deliberate failure to demonstrate retry/diff), exit code 1, aggregated
JUnit written to `junit.xml`. The source can also be a **git URL**
(`--source https://… --revision main`, token via `GIT_TOKEN`) or a `.zip`.

---

## 3. Testing the full platform locally (server + portal)

### 3.1 Startup

```bash
docker compose up -d                      # postgres:5432, minio:9000, pushgateway:9091
cp apps/server/.env.example apps/server/.env    # defaults aligned with the compose file
pnpm --filter @tcs/server prisma:migrate  # creates the schema (first time)
pnpm dev:server                           # API http://localhost:4000
pnpm dev:portal                           # portal http://localhost:3000 (2nd terminal)
```

Or run the server and portal in Docker too (one command, no hot reload —
see [deployment.md §3.1](deployment.md#31-common-baseline)):
`docker compose up --build`.

Sanity check: `curl http://localhost:4000/healthz` → `{"status":"ok"}` and
`curl http://localhost:4000/readyz` → `{"status":"ready",…}`.

Provider choice in `.env`:

- `ORCHESTRATION_PROVIDER=local` — default, no prerequisites;
- `ORCHESTRATION_PROVIDER=docker` — each test in its own image (Docker required);
- `ORCHESTRATION_PROVIDER=argo` — see §6.

### 3.2 Portal walkthrough (http://localhost:3000)

1. **Login**: `admin@example.com` / `admin` (bootstrap account, admin role).
2. **+ New campaign**: name, `Local folder` source = the **absolute** path
   to `examples/tests`, a rule via the **rule builder** (e.g. condition
   `tags contains unit`), **Preview the selection** → list of matched
   tests, then create. Optional: set a **cron schedule** (e.g. `0 6 * *
1-5`) and check "Enable automatic launch" — the campaign will then
   launch itself at the scheduled times (⏰ badge + next launch time shown,
   runs attributed to "Scheduler (cron)").
3. **▶ Launch**: redirects to the **real-time** run view — progress,
   per-test badges, streamed logs (the _logs_ button), ETA. At the end of
   the run, the table shows the **persisted results** from the aggregated
   JUnit report (status, duration, failure message per test) — also
   visible when reopening the run later.
4. `unit/strings` fails → the **↻ retry** button on just that test, or
   "Retry N failure(s)".
5. **⇄ Compare to previous run**: the diff view
   (regressions/fixed/new/gone/Δ duration). **↻ Replay campaign** relaunches
   the exact same snapshot.
6. Campaign dashboard: tiles + trends (success rate, duration per run).
7. **⬇ Aggregated JUnit** and artifacts downloadable from the run view.

### 3.3 The same walkthrough via pure API (curl)

```bash
B=http://localhost:4000

# login → session cookie
curl -s -c /tmp/tcs.jar -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"admin"}' $B/api/auth/login

# preview a rule
curl -s -b /tmp/tcs.jar -H 'content-type: application/json' -d '{
  "source": {"type":"local","path":"examples/tests"},
  "selectionRule": {"all":[{"pathUnder":"suites/unit"}]}
}' $B/api/campaigns/preview

# create the campaign
CID=$(curl -s -b /tmp/tcs.jar -H 'content-type: application/json' -d '{
  "name":"Unit","source":{"type":"local","path":"examples/tests"},
  "selectionRule":{"all":[{"pathUnder":"suites/unit"}]},"parallelism":2
}' $B/api/campaigns | jq -r .id)

# launch a run then follow it over SSE
RID=$(curl -s -b /tmp/tcs.jar -X POST -H 'content-type: application/json' \
  -d '{}' $B/api/campaigns/$CID/runs | jq -r .id)
curl -N -b /tmp/tcs.jar $B/api/runs/$RID/events        # Ctrl-C to quit

# results, logs, targeted retry, diff, replay
curl -s -b /tmp/tcs.jar "$B/api/runs/$RID/results?outcome=failed"
curl -s -b /tmp/tcs.jar "$B/api/runs/$RID/logs?testId=unit/strings"
curl -s -b /tmp/tcs.jar -X POST -H 'content-type: application/json' \
  -d '{"testIds":["unit/strings"]}' $B/api/runs/$RID/retry
curl -s -b /tmp/tcs.jar "$B/api/runs/$RID/diff?against=previous"
curl -s -b /tmp/tcs.jar -X POST $B/api/runs/$RID/replay
```

### 3.4 Metrics

- System: `curl $B/metrics` (Prometheus format, always on).
- Business (opt-in): `BUSINESS_METRICS_ENABLED=true` +
  `PUSHGATEWAY_URL=http://localhost:9091` in `.env`, restart the server,
  run a campaign, then check http://localhost:9091 (job `tcs-campaigns`).

---

## 4. Running the "binaries" — per-component recap

| Component       | Dev                                              | Production                                                                                                                                              |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server          | `pnpm dev:server` (tsx watch)                    | Docker image: `docker run --env-file .env -p 4000:4000 ghcr.io/OWNER/testcampaignshooter/server:TAG` — the CMD runs `prisma migrate deploy` then starts |
| Portal          | `pnpm dev:portal`                                | Docker image (Next standalone): `docker run -p 3000:3000 ghcr.io/OWNER/testcampaignshooter/portal:TAG`                                                  |
| CLI             | `node apps/cli/bin/tcs.mjs …`                    | same (a workstation/CI tool, no image)                                                                                                                  |
| Migrations only | `pnpm --filter @tcs/server prisma:migrate` (dev) | `pnpm --filter @tcs/server prisma:deploy`                                                                                                               |

Building the images (context = repo root, see deployment.md §1):

```bash
docker build -f apps/server/Dockerfile -t tcs/server:dev .
docker build -f apps/portal/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:4000 -t tcs/portal:dev .
```

---

## 5. Understanding what actually runs (recap)

Whatever the provider, a run = **fetch the source → one node per test →
JUnit aggregation → server callback**. Only the implementation changes:

- `local`: host child processes, an isolated workspace per test;
- `docker`: `docker run <execution.image>` per test, workspace mounted at `/workspace`;
- `argo`: one **Kubernetes pod** per test (the metadata's image), fan-out
  throttled by `parallelism`, partial JUnit reports on S3, the `aggregate`
  step always runs.

---

## 6. Running through Argo Workflows (a full walkthrough)

### 6.1 kind + Argo dev cluster

```bash
kind create cluster --name tcs
kubectl create namespace argo
kubectl apply -n argo -f \
  https://github.com/argoproj/argo-workflows/releases/download/v3.6.5/quick-start-minimal.yaml
kubectl -n argo get pods   # wait for workflow-controller + argo-server Running
```

### 6.2 Images + chart

```bash
# build locally then load straight into kind (no registry needed)
docker build -f apps/server/Dockerfile -t tcs/server:dev .
docker build -f apps/portal/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:4000 -t tcs/portal:dev .
kind load docker-image tcs/server:dev tcs/portal:dev --name tcs

helm install tcs deploy/helm/testcampaignshooter \
  --namespace tcs --create-namespace \
  --set image.registry=tcs --set image.tag=dev --set image.pullPolicy=Never \
  --set server.env.ORCHESTRATION_PROVIDER=argo \
  --set server.publicBaseUrl=http://tcs-server.tcs.svc:4000 \
  --set argo.serverUrl=http://argo-server.argo.svc:2746
```

> The chart also sets up: RBAC (ServiceAccounts + workflows/pods/log
> Roles), a dev PostgreSQL and MinIO (can be disabled via values).

### 6.3 Secrets & artifact repository

```bash
kubectl -n tcs create secret generic testcampaignshooter-server \
  --from-literal=SESSION_SECRET='change-me-32-chars-minimum-please!' \
  --from-literal=DATABASE_URL='postgresql://tcs:tcs@tcs-postgresql:5432/tcs' \
  --from-literal=S3_ENDPOINT='http://tcs-minio:9000' \
  --from-literal=S3_ACCESS_KEY='tcs' --from-literal=S3_SECRET_KEY='tcs-secret' \
  --from-literal=ADMIN_EMAIL='admin@example.com' --from-literal=ADMIN_PASSWORD='admin'

# MinIO credentials for the Argo steps + artifact repository
kubectl -n argo create secret generic tcs-minio-creds \
  --from-literal=accessKey=tcs --from-literal=secretKey=tcs-secret
kubectl -n argo patch configmap workflow-controller-configmap \
  --patch-file deploy/kind/artifact-repository.yaml
kubectl -n tcs rollout restart deploy/tcs-server
```

### 6.4 Publish the tests to a git repo

With Argo, a campaign's source **must be git** (the pods can't see your
disk). Push, say, `examples/tests` to a repo, and for a private repo:

```bash
kubectl -n argo create secret generic tcs-git --from-literal=token=<PAT>
# + --set argo.gitSecretName=tcs-git on the helm install
```

### 6.5 Launch and observe

```bash
kubectl -n tcs  port-forward svc/tcs-server 4000:4000 &
kubectl -n tcs  port-forward svc/tcs-portal 3000:3000 &
kubectl -n argo port-forward svc/argo-server 2746:2746 &   # Argo UI https://localhost:2746
```

1. Portal → new campaign, **Git repo** source = your test repo, rule,
   preview, **Launch**.
2. On the cluster side, the server has created the CRDs:

```bash
kubectl -n argo get workflowtemplates      # tcs-step-<engine> (generated/manual)
kubectl -n argo get workflows              # tcs-run-<runId>
kubectl -n argo get pods -l workflows.argoproj.io/workflow=<wf>  # 1 pod per test
argo -n argo get <wf>                      # tree: fetch-source → t-…-… → aggregate
```

3. The portal's run view reflects node states in real time (watch → SSE);
   per-test logs come from the pods (the `kubectl logs` equivalent).
4. End of run: the `aggregate` step merges the `partials/*.xml` from MinIO,
   pushes `tcs-runs/<runId>/junit.xml`, and POSTs the report to the server
   (`PUBLIC_BASE_URL/api/internal/runs/<runId>/results`) → results in the
   DB, diff and dashboards available.
5. **Targeted retry**: the portal's retry button → the Argo Server API
   (the `argo retry` equivalent, `restartSuccessful:false` +
   `nodeFieldSelector displayName=t-…`) — only the failing nodes replay.
   Cancellation → `spec.shutdown: Stop`.

### 6.6 Adding an engine on the Argo side without redeploying code

Drop `deploy/argo/steps/step-<engine>.yaml` (the contract is described in
`deploy/argo/steps/README.md`, a `.sample` example is provided): on the
next launch, this file **takes precedence** over the generated template
for the same engine and is composed into the Workflow via `templateRef`,
without touching the others.

---

## 7. Troubleshooting

| Symptom                                                                                  | Likely cause / fix                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/readyz` → 503                                                                          | DB unreachable: `docker compose up -d`, `DATABASE_URL`, migrations                                                                                                                                   |
| `cannot invoke "docker"` in a test's logs                                                | the `docker` provider/runtime with no reachable Docker daemon (`docker info`)                                                                                                                        |
| A run stuck `pending` under Argo                                                         | `kubectl -n argo describe wf …`: image not found, RBAC, unpatched artifact repo                                                                                                                      |
| No results after an Argo run                                                             | callback failure: `PUBLIC_BASE_URL` must be reachable **from the pods** (`http://tcs-server.tcs.svc:4000`)                                                                                           |
| No results after a local/docker run                                                      | check the server logs for the `aggregated JUnit ingested` line; otherwise the callback error is there (the run is reconciled from the report at ingestion)                                           |
| Targeted retry errors out                                                                | `ARGO_SERVER_URL` missing (the Argo Server API is required)                                                                                                                                          |
| 401 on the API                                                                           | expired session → log in again; RBAC: `editor` is required to launch/retry                                                                                                                           |
| Portal: network/CORS errors                                                              | `PORTAL_ORIGIN` (server) and `NEXT_PUBLIC_API_URL` (portal) don't match                                                                                                                              |
| SSE cut off behind a proxy                                                               | disable buffering / extend the read timeout (already done in the provided ingress)                                                                                                                   |
| `SyntaxError: Unexpected token '.'` when launching pnpm (WSL)                            | the Windows `pnpm` is being run by a too-old WSL Node — install Node ≥ 20 in WSL (nvm) or launch from a Windows terminal                                                                             |
| `esbuild … "@esbuild/win32-x64" is present but this platform needs "@esbuild/linux-x64"` | a checkout shared between Windows/WSL: both platforms are declared (`pnpm.supportedArchitectures` + Prisma's `binaryTargets`) — rerun `pnpm install` (from Windows or WSL) to fetch both binary sets |
| Very slow startup from WSL on `/mnt/c` (>1 min)                                          | a WSL2 9P filesystem limitation — prefer a **Windows** terminal for `pnpm dev`, or clone the repo into the WSL filesystem (`~/…`)                                                                    |
