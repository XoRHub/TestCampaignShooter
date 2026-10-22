# Technical documentation

> For an exhaustive, mechanical map of each component's code (full directory
> trees, every route/DB table/interface, not duplicated here), see
> [BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md),
> [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md),
> [CLI_ARCHITECTURE.md](CLI_ARCHITECTURE.md) and
> [SHARED_PACKAGES_ARCHITECTURE.md](SHARED_PACKAGES_ARCHITECTURE.md).

## Code structure (pnpm monorepo)

```
packages/shared-types        Neutral types + Zod schemas (metadata, rules, states, auth, diff)
packages/core                Ingestion (git/local/zip), discovery, rule engine,
                             engine adapters, JUnit utilities (parse/merge)
packages/orchestration       OrchestrationProvider interface + registry + `local` provider
packages/orchestration-argo  Argo provider (the ONLY module depending on @kubernetes/client-node)
apps/server                  Fastify API + Prisma/PostgreSQL + auth + SSE + metrics + S3
apps/portal                  Next.js portal (App Router)
apps/cli                     `tcs` CLI (discover/preview/run/engines)
deploy/                      Helm chart, RBAC, kind+Argo, manual Argo steps, docker-compose
```

Conventions: strict TypeScript everywhere, **Zod** validation at every
boundary, JSON persisted in text columns (connector portability), business
errors carry a `statusCode`.

## API (prefix `/api`, `tcs_session` session cookie or `Authorization: Bearer`)

### Auth

| Method | Route                                      | Role      | Description                                     |
| ------ | ------------------------------------------ | --------- | ----------------------------------------------- |
| GET    | `/auth/methods`                            | public    | active methods `{password, oidc, oidcLoginUrl}` |
| POST   | `/auth/login`                              | public    | local login `{email, password}`                 |
| GET    | `/auth/oidc/login` → `/auth/oidc/callback` | public    | OIDC flow (state+nonce), JIT provisioning       |
| POST   | `/auth/logout` · GET `/auth/me`            | logged in | session                                         |

### Projects (API/portal only — see docs/functional.md)

| Method         | Route                                                                              | Role          |
| -------------- | ---------------------------------------------------------------------------------- | ------------- |
| GET            | `/projects`                                                                        | viewer        |
| POST           | `/projects` `{name, description?}`                                                 | editor        |
| GET/PUT/DELETE | `/projects/:id` (PUT/DELETE: creator or admin; DELETE is soft if it has campaigns) | viewer/editor |
| POST           | `/projects/:id/members` `{email}` (creator or admin; 404 if no such user)          | editor        |
| DELETE         | `/projects/:id/members/:userId` (creator or admin)                                 | editor        |

`GET /projects` and `GET /projects/:id` only ever return projects the
requester can access (creator, member, or `admin` — `admin` bypasses the
restriction entirely, same as it already bypasses campaign ownership); a
403 is returned for a specific `:id` the requester can't access, distinct
from the 404 used when the project truly doesn't exist. See
`apps/server/src/services/access.ts` (`hasProjectAccess`/`isProjectCreator`
are pure and unit-tested; `canAccessProject`/`canAccessCampaign`/
`canMutateCampaignInProject` wrap them with the Prisma lookup).

### Campaigns

| Method         | Route                                                                                           | Role          |
| -------------- | ----------------------------------------------------------------------------------------------- | ------------- |
| GET            | `/campaigns` (`?includeDeleted=true`, `?projectId=`)                                            | viewer        |
| POST           | `/campaigns`                                                                                    | editor        |
| GET/PUT/DELETE | `/campaigns/:id` (PUT/DELETE: creator, project creator, or admin; DELETE is soft if runs exist) | viewer/editor |
| POST           | `/campaigns/preview` `{source, selectionRule}` → matched tests + issues                         | viewer        |
| POST           | `/campaigns/:id/runs` `{parallelism?, revision?}` → launches a run                              | editor        |
| GET            | `/campaigns/:id/runs?status&from&to&page&pageSize`                                              | viewer        |
| GET            | `/campaigns/:id/metrics` → dashboard aggregates                                                 | viewer        |

Scheduling fields (create/update): `scheduleCron` (5/6-field expression,
validated — e.g. `0 6 * * 1-5`, `@hourly`) and `scheduleEnabled` (boolean).
The DTO also exposes `nextScheduledAt` (computed next occurrence).
`scheduleEnabled` without `scheduleCron` → 400.

`adapterManifestUrl` (optional) adds/overrides engine adapters for this
campaign's runs only — **restricted to the `admin` role** even though the
rest of the campaign is editor-editable (see
[adapter-plugins.md](adapter-plugins.md)).

`projectId` (optional) attaches the campaign to a project (docs/functional.md):
the requester must already have access to that project (creator, member, or
admin) — setting it to a project you can't access is a 403. A campaign with
no `projectId` is visible to any `viewer`, exactly as before this field
existed; one with a `projectId` is only visible to that project's creator,
members, and admins — every campaign-scoped route (detail, launch, runs
list, metrics, and every `/runs/:id*` route, since a run inherits its
campaign's visibility) enforces this, returning 403 rather than silently
filtering.

### Runs & results

| Method    | Route                                                                    | Description                               |
| --------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| GET       | `/runs/:id`                                                              | detail + snapshot + live state if running |
| GET       | `/runs/:id/results?outcome&engine&page`                                  | paginated/filtered results                |
| GET       | `/runs/:id/diff?against=previous\|<runId>`                               | delta between runs                        |
| POST      | `/runs/:id/replay` · `/runs/:id/retry` `{testIds?}` · `/runs/:id/cancel` | actions (editor)                          |
| GET       | `/runs/:id/junit`                                                        | aggregated JUnit report (S3)              |
| GET       | `/runs/:id/artifacts`                                                    | run artifacts                             |
| GET       | `/runs/:id/logs?testId=…&download=1`                                     | one test's logs                           |
| GET (SSE) | `/runs/:id/events`                                                       | normalized `test`/`run` events            |
| GET (SSE) | `/runs/:id/logs/stream?testId=…`                                         | live logs                                 |
| GET       | `/tests/history?testId&campaignId&limit`                                 | a test's history                          |

### Misc

`GET /healthz` (liveness), `GET /readyz` (DB), `GET /metrics` (system
Prometheus), `GET /api/engines` (includes `origin`: `built-in` or the
instance manifest URL that provided the engine), `POST
/api/internal/runs/:runId/results` (JUnit callback from the aggregation
step, raw XML, optional `x-tcs-token` token).

### Adapter manifests (admin) — see [adapter-plugins.md](adapter-plugins.md)

| Method   | Route                                  | Role  |
| -------- | -------------------------------------- | ----- |
| GET/POST | `/api/admin/adapter-manifests` `{url}` | admin |
| DELETE   | `/api/admin/adapter-manifests/:id`     | admin |
| POST     | `/api/admin/adapter-manifests/reload`  | admin |

## Campaign scheduler (cron)

`services/scheduler.ts` — one in-process job (the `croner` library) per
campaign with `scheduleEnabled=true`, re-synced on every
create/update/delete:

- on each tick: the campaign is launched via `RunService.launch` under the
  **system account** `scheduler@testcampaignshooter.local` ("Scheduler
  (cron)", editor role, no password — cannot log in) → the audit trail
  distinguishes scheduled launches from manual ones;
- **overlap protection**: a tick is skipped if a run of the campaign is
  still `pending`/`running`;
- timezone: `SCHEDULER_TIMEZONE` (IANA, defaults to the server's own);
- global disable: `SCHEDULER_ENABLED=false` — **in a multi-replica setup,
  only keep it active on one instance** (like the event bus).

## Result ingestion (aggregated JUnit → per-test results in the DB)

At the end of every run — whichever provider — the aggregation step POSTs
the merged JUnit report to `POST /api/internal/runs/:runId/results`. The
server **breaks it down** as follows (`RunService.ingestResults`):

1. **Parsing** (`parseJUnitXml`, core): the report holds one `<testsuite>`
   per test, **named by the test's id**;
2. **Per-test aggregation** (`aggregateReportByTest`): one row per test —
   worst status wins (`error` > `failed` > `skipped` > `passed`), durations
   summed, first failure message kept;
3. **`TestResult` upsert** (idempotent, key `(runId, testId)`), attached to
   the run and therefore the campaign: this feeds per-campaign/run/date
   browsing, **per-test history**, and **run-to-run diff**;
4. **Run status reconciliation**: the aggregated report is authoritative —
   if the watch missed the end (server restart, outage), the run moves to
   `failed`/`succeeded` based on the results;
5. **Best-effort S3 archiving**: an unreachable artifact store is logged
   but never loses the results (already in the DB);
6. **Business metrics push** (if enabled).

At startup, `resumeWatches()` re-attaches the watches of runs still marked
`running` (possible with `argo`, whose state lives in the cluster) and
closes as `error` those of the in-memory providers (`local`/`docker`) whose
state was lost.

On the portal side, a run's page **merges** real-time events (SSE) with
these persisted results: a finished run — or one viewed again after a
restart — always shows its per-test statuses, durations and messages.

## Database schema (Prisma)

- **User**: unique email, displayName, passwordHash?, roles (JSON),
  authSource (`local|oidc`), oidcSubject?, active.
- **Campaign**: selectionRule (JSON), source (JSON), parallelism,
  **version** (incremented on every update), **createdBy → User**,
  deletedAt (soft delete), **adapterManifestUrl?** (see adapter-plugins.md),
  **projectId?** (optional, see below).
- **WorkflowRun**: campaignId + campaignVersion, status (normalized phase),
  **testsSnapshot** (JSON — the tests actually selected), handle (opaque
  provider JSON), provider, parallelism, **triggeredBy → User**,
  createdAt/startedAt/finishedAt, junitKey (S3),
  **adapterManifestUrl?/adapterManifestHash?** (frozen at creation — see
  adapter-plugins.md). Index `(campaignId, createdAt)` → date filtering and
  run-to-run diff.
- **TestResult**: runId + testId (unique), name, engine, outcome
  (`passed|failed|error|skipped`), durationMs, message. Index `(testId,
createdAt)` → trends/flakiness.
- **Artifact**: runId, name, storageKey (S3), contentType.
- **AdapterManifest**: url (unique), enabled, **addedBy → User**,
  lastFetchedAt?, lastHash?, lastError? — instance manifests (admin), see
  [adapter-plugins.md](adapter-plugins.md).
- **Project**: name, description?, **createdBy → User**, deletedAt (soft
  delete once it has campaigns) — see docs/functional.md. `Campaign.project`
  is a plain optional FK (`onDelete: SetNull`); a project's campaigns aren't
  reassigned or hidden when the project itself is soft-deleted.
- **ProjectMember**: `@@unique([projectId, userId])`, projectId → Project
  (`onDelete: Cascade`), userId → User, addedAt. Binary membership, no
  per-member role — a member gets the same **read** access as the creator
  to every campaign in the project, but mutating a campaign a member didn't
  create themselves still follows the usual editor-owns-it rule: only the
  project's **creator** (or an admin) can mutate any campaign in it (see
  docs/functional.md).

## Engine adapter interface

`packages/core/src/adapters/types.ts`:

```ts
interface EngineAdapter {
  engine: string; // id referenced by metadata.engine
  displayName: string;
  defaultImage: string; // default image
  defaultJunitPath: string; // default JUnit path
  deprecated?: { reason: string };
  validate(test: DiscoveredTest): string[]; // engine-specific errors
  defaultCommand?(test: DiscoveredTest): string[]; // absent => command required
}
```

Code-free alternative (declarative, on the fly): a downloadable **adapter
manifest** — at the instance level (admin, persisted) or per campaign
(scoped override, resolved once per run) — see
[adapter-plugins.md](adapter-plugins.md).

`resolveExecution(adapter, test)` merges metadata over adapter defaults,
substitutes `{{testFile}}`/`{{testId}}`, and produces a neutral
**`ResolvedExecution`** (image, command, junitPath, timeout, env,
resources) consumed by any provider.

### "Adding a test engine" guide (both parts)

**a) Application adapter**

1. Create `packages/core/src/adapters/<engine>.ts` implementing `EngineAdapter`.
2. Register it in `packages/core/src/adapters/index.ts` (one
   `registerAdapter` line). Nothing else changes: discovery, selection,
   the portal and the CLI all pick it up immediately.

**b) Argo step template (split file)**

- **Nominal case — generated**: nothing to do. The Argo provider generates
  `tcs-step-<engine>` (the common step contract) at launch time.
- **Manual case**: drop `deploy/argo/steps/step-<engine>.yaml` (see
  `step-custom.yaml.sample`). The step registry loads this file by naming
  convention; it **takes precedence** over the generated template and is
  **composed** into the Workflow via `templateRef`, **without modifying**
  any existing template.

Step contract: `run-test` template, params `test-id, test-file, image,
command, junit-path, timeout-seconds`, input artifact `source`
(`/workspace`), output artifact `junit` pushed to
`{{workflow.parameters.artifact-prefix}}/partials/<test-id>.xml`.

## Orchestration provider interface

`packages/orchestration/src/provider.ts`:

```ts
interface OrchestrationProvider {
  name: string;
  submit(spec: CampaignExecutionSpec): Promise<RunHandle>;
  watch(handle, onEvent, signal?): Promise<void>; // normalized test/run events
  getState(handle): Promise<RunSnapshot>;
  retryFailed(handle, testIds?): Promise<RunHandle>; // never replays successes
  cancel(handle): Promise<void>;
  getLogs(handle, testId): Promise<string>;
  streamLogs?(handle, testId, onChunk, signal?): Promise<void>;
  getArtifacts(handle): Promise<ArtifactRef[]>;
}
```

Every type exchanged (states, events, spec) is **neutral**
(`@tcs/shared-types`): the server, the portal and the DB never see an Argo
type.

### Provided providers & container encapsulation

| Provider              | Test execution                                                                                                                                                                       | Usage                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `argo` (prod default) | **Kubernetes pod** with the `execution.image` image                                                                                                                                  | scalable, production           |
| `docker`              | **`docker run`** with the `execution.image` image, the test's workspace mounted at `/workspace`, env/timeout/resources applied (cpu `500m`→`--cpus 0.5`, memory `1Gi`→`--memory 1g`) | single-machine iso-prod dev    |
| `local`               | host child process (the image is ignored)                                                                                                                                            | dev without Docker, unit tests |

`docker` and `local` share the same `LocalProvider`; only the **execution
runtime** changes (`packages/orchestration/src/local/runtimes.ts`).
Selection: `ORCHESTRATION_PROVIDER=docker`, or
`ORCHESTRATION_PROVIDER=local` + `LOCAL_PROVIDER_RUNTIME=docker`. CLI side:
`tcs run --docker`. In every case, each test keeps its own **isolated
workspace** and individual node (targeted retry, logs, cancellation all
work the same way).

### "Adding an orchestration provider" guide

1. New package `packages/orchestration-<tech>` implementing the interface.
2. At import time: `registerProviderFactory('<tech>', (env) => new MyProvider(env))`.
3. Import it (side-effect) in `apps/server/src/app.ts`.
4. Selection **by configuration**: `ORCHESTRATION_PROVIDER=<tech>` — no
   other code changes. References: `local-provider.ts` (~300 lines,
   in-memory) and `orchestration-argo` (a complete implementation).

## Generated Argo CRDs (default provider)

- **`WorkflowTemplate tcs-step-<engine>`** (one per engine, upserted on
  submit): the containerized step from the contract above.
- **`Workflow tcs-run-<runId>`**:
  - `spec.parallelism` = the campaign's parameter (throttled fan-out);
  - DAG `fetch-source → one task PER test → aggregate`;
  - each task carries a **deterministic name** `t-<slug>-<hash8>` (the
    `testcampaignshooter.io/test-map` annotation = the node→testId mapping
    for the watcher);
  - `failFast: false`: one test failing doesn't stop the others;
  - `aggregate` depends on _all_ tests **regardless of their state**
    (depends `Succeeded||Failed||Errored||Skipped||Omitted`), merges the
    partial JUnit reports from S3, pushes `…/junit.xml`, and **POSTs** the
    report back to the server;
  - targeted retry: `PUT /api/v1/workflows/{ns}/{name}/retry` (Argo
    Server) with `restartSuccessful:false` (+ `nodeFieldSelector
displayName=…` for one specific test); cancellation: patch
    `spec.shutdown=Stop`.

## Selection rule engine

A JSON tree (`selectionRuleSchema`): `{all:[…]} | {any:[…]} | {not:…} |
{prop, op, value} | {pathUnder}`. Pure evaluation (`selectTests`) over the
discovered tests; properties read from the metadata (dotted paths), with a
fallback to the pseudo-properties `id`, `name`, `engine`, `file`. Invalid
regexes → the condition is false (evaluation never throws).

## Configuration (env — validated by Zod at startup)

Exhaustive reference (variable / default / description, including
providers and the portal): [deployment.md §7](deployment.md#7-complete-configuration-variable-reference);
`apps/server/.env.example` provides the commented version. Notable keys:
`ORCHESTRATION_PROVIDER`, `K8S_NAMESPACE`, `ARGO_SERVER_URL` (targeted
retry), `ARGO_MANUAL_STEPS_DIR`, `AUTH_PASSWORD_ENABLED` /
`AUTH_OIDC_ENABLED` + `OIDC_*`, `SESSION_SECRET` (≥32 chars),
`DATABASE_URL`, `S3_*`, `BUSINESS_METRICS_ENABLED` + `PUSHGATEWAY_URL`
(business target **separate** from the system `/metrics`),
`PUBLIC_BASE_URL` (aggregation callback), `DEFAULT_PARALLELISM`,
`GIT_TOKEN`, `SCHEDULER_ENABLED` + `SCHEDULER_TIMEZONE` (automatic
scheduled launches).

## Quality & CI

Local checks: `pnpm lint` (strict ESLint), `pnpm typecheck` (`tsc --noEmit`
per package), `pnpm test` (Vitest, DB-less: rule engine, discovery,
adapters, JUnit, local provider + docker runtime, Argo builders, diff,
portal components), `pnpm build`. `pnpm test:integration`
(`vitest.integration.config.ts`) is a separate, slower suite: it points
`DATABASE_URL` at a dedicated `tcs_test` Postgres database (created and
migrated automatically — see `apps/server/test/integration-setup.ts`) and
exercises real routes end to end via Fastify's `.inject()` — RBAC/project
access control in particular (`apps/server/src/routes/*.integration.test.ts`).
It refuses to run against anything whose `DATABASE_URL` doesn't look like
that dedicated database (it truncates every table between tests).
`mise install` (`.mise.toml`) reproduces the exact toolchain CI uses (Node,
pnpm, Helm, helm-docs, Trivy); [Renovate](https://docs.renovatebot.com)
(`renovate.json`) keeps pnpm/GitHub Actions/Docker base images/Helm chart
images up to date automatically.

Two equivalent CI pipelines exist, one per forge :
* GitLab, with `.gitlab-ci.yml` as CI workflows and `.gitlab/ci/` where are all workflow files for building project/release
* GitHub, with `.github/workflows/` where are all workflow files for building project/release

GitHub Actions (`.github/workflows/`) — an orchestrator (`ci.yml`, path
filtering) fans out to reusable workflows:

- **`ci-node.yml`**: the `quality` job above, a `codegen` job — a Prisma
  migration-drift gate that replays every committed migration into an
  ephemeral shadow database and fails if the result diverges from
  `schema.prisma` — and a `test-integration` job running
  `pnpm test:integration` against an ephemeral `tcs_test` Postgres service.
- **`ci-helm.yml`**: chart lint/render, a `helm-docs` drift check, and the
  `helm unittest` suite under `deploy/helm/testcampaignshooter/tests/`.
- **`ci-security.yml`**: Trivy filesystem vulnerability scan (blocking,
  unconditional on every PR/push) + hadolint on both Dockerfiles.
- **`ci-images.yml`**: an amd64+arm64 build matrix (QEMU) for the server
  and portal images, a Trivy vulnerability/secret scan of the image (local
  scan on PRs, merged-manifest scan on `main`), and a CycloneDX SBOM
  generated per image.
- **Releases**: [release-please](https://github.com/googleapis/release-please)
  in manifest mode manages two independent packages — the app root (drives
  image tags + `Chart.yaml`'s `appVersion`) and the Helm chart (its own
  SemVer, for an OCI chart artifact). Merging a release PR re-tags the
  already-built-and-scanned images (never a rebuild) and attaches the
  SBOMs to the GitHub Release; the chart release publishes the chart as an
  OCI artifact to GHCR.

GitLab CI (`.gitlab-ci.yml` + `.gitlab/ci/*.yml`) mirrors the same shape and stages (`quality`, `build`, `scan`, `release`), with GitLab-native equivalents in place of the
GitHub-specific pieces:

- `rules:changes:` replaces dorny/paths-filter for path-based job
  selection; still forced on for every job on a push to `main` (same
  build-all invariant).
- The image registry is this project's own GitLab Container Registry
  (`$CI_REGISTRY_IMAGE`) instead of GHCR. Images are built with
  [Kaniko](https://github.com/GoogleContainerTools/kaniko) rather than
  `docker buildx` + a `docker:dind` service: this project's GitLab Runner
  fleet is Raspberry Pi hardware without privileged containers, and
  Docker-in-Docker needs `--privileged` to run its own nested daemon —
  Kaniko builds a Dockerfile straight from a build context and pushes to
  the registry with no daemon involved, so it works unprivileged. Trade-off:
  **arm64 only** here (no multi-arch manifest, no `merge` stage) — emulating
  amd64 via QEMU/binfmt_misc is *also* a privileged, kernel-level operation,
  out of reach on this hardware regardless of build tool. GitHub Actions
  (`ci-images.yml`) remains the amd64+arm64 pipeline. Each build's tarball
  (`--tar-path`, not a registry push+pull) is scanned directly with
  `trivy image --input` for both the vuln/secret gate and the SBOM.
- **Releases**: release-please only talks to the GitHub API, so there's no
  direct equivalent here. [semantic-release](https://semantic-release.gitbook.io/)
- `@semantic-release/gitlab` (config: `.releaserc.json`) plays the same
  role but mechanically differently — a release lands **directly on
  merge** to `main` (no staged "release PR" to review first), computed
  from Conventional Commits exactly like release-please. Because
  semantic-release computes one version per config (no manifest mode), the
  app and the Helm chart share a **single unified version** here, instead
  of release-please's two independent SemVer tracks; `scripts/bump-chart-version.mjs`
  keeps `Chart.yaml`'s `version`/`appVersion` in lockstep with each
  release. Image promotion (re-tagging the already-scanned `<sha>` images
  to the released version, never a rebuild) uses
  [crane](https://github.com/google/go-containerregistry) — the same
  daemonless tool `images.yml` already uses for its `edge` tag, since
  neither job has a Docker daemon available (no `dind` service, and Kaniko
  itself doesn't run one either). **Requires** a `GITLAB_TOKEN` CI/CD variable (a Project Access Token,
  `api` + `write_repository` scopes, allowed to push to the protected
  `main` branch) — see the comment at the top of `.gitlab/ci/release.yml`.

Deployment (per-provider topologies, Helm, secrets, observability) is
detailed in [deployment.md](deployment.md).
