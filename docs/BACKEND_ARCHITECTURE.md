# TestCampaignShooter Backend Architecture

Comprehensive, mechanical map of `apps/server`: a Fastify API powering test-campaign orchestration, auth, real-time run tracking and result persistence.

> **Scope:** this document covers `apps/server` only (routes, services, auth, events, metrics, storage, Prisma schema). It does not replace [architecture.md](architecture.md) (component diagrams, sequence diagrams, technology rationale) or [technical.md](technical.md) (narrative API/DB/config reference) — read those for the *why*; this document is the exhaustive *what* (every route, every table, every env var). `apps/server` consumes `@tcs/core`, `@tcs/orchestration` and `@tcs/orchestration-argo` only through their public interfaces — their internals are documented in [SHARED_PACKAGES_ARCHITECTURE.md](SHARED_PACKAGES_ARCHITECTURE.md). The HTTP/SSE API documented here is consumed by [apps/portal](FRONTEND_ARCHITECTURE.md) (Next.js). [apps/cli](CLI_ARCHITECTURE.md) is a separate, standalone consumer of `@tcs/core`/`@tcs/orchestration` — it makes **no** HTTP call to this server.

---

## Table of Contents

1. [Overview](#1-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Directory Structure](#3-directory-structure)
4. [Application Lifecycle](#4-application-lifecycle)
5. [Database Layer](#5-database-layer)
6. [API Endpoints](#6-api-endpoints)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Business Logic (Services)](#8-business-logic-services)
9. [Real-Time Communication (SSE)](#9-real-time-communication-sse)
10. [Background Tasks & Scheduling](#10-background-tasks--scheduling)
11. [Artifact Storage (S3/MinIO)](#11-artifact-storage-s3minio)
12. [Metrics](#12-metrics)
13. [Configuration](#13-configuration)
14. [Error Handling](#14-error-handling)
15. [Testing](#15-testing)

Appendix: [Key Design Patterns](#appendix-key-design-patterns)

---

## 1. Overview

| Property           | Value                                                          |
| ------------------- | --------------------------------------------------------------- |
| **Framework**       | Fastify 5.4                                                     |
| **Language**        | TypeScript (strict), ESM (`"type": "module"`)                   |
| **ORM**              | Prisma 6.10 (`@prisma/client`)                                  |
| **Database**         | PostgreSQL                                                      |
| **Real-time**        | Server-Sent Events (hand-rolled over raw Fastify reply)          |
| **Auth**             | Session cookie (JWT, `jose`) + Bearer, password (`bcryptjs`) or OIDC (`openid-client`) |
| **Validation**       | Zod (config, request bodies/queries)                            |
| **Metrics**          | `prom-client` — system registry (`/metrics`) + business Pushgateway |
| **Object storage**   | `@aws-sdk/client-s3` (MinIO or any S3-compatible endpoint)       |
| **Scheduler**        | `croner` (in-process cron)                                      |
| **Dev runner**       | `tsx` (`tsx watch src/index.ts`)                                |
| **Shared packages**  | `@tcs/core`, `@tcs/orchestration`, `@tcs/orchestration-argo`, `@tcs/shared-types` (workspace) |

`apps/server` is responsible for:

- Campaign CRUD, preview (rule evaluation against a discovered test source) and launch
- Submitting/watching/retrying/cancelling runs through a pluggable `OrchestrationProvider`
- Persisting per-test results from the aggregated JUnit report POSTed back by the execution layer
- Password + OIDC authentication, JWT sessions, RBAC (`viewer`/`editor`/`admin`)
- Project-scoped visibility layer on top of RBAC
- Streaming live run/test state and logs over SSE
- Automatic campaign launches on a cron schedule
- Admin-managed adapter manifests (runtime engine extension, see `adapter-plugins.md`)
- System (`/metrics`) and business (Pushgateway) metrics, artifact storage (S3/MinIO)

---

## 2. High-Level Architecture

```text
                              +-----------------------+
                              |   Portal / CLI (HTTP)  |
                              +-----------+-----------+
                                          |
                                          v
                        +-----------------+------------------+
                        |          Fastify app (app.ts)        |
                        +-----------------+------------------+
                                          |
      +-----------------------------------+------------------------------------+
      |                     |                      |                          |
+-----v------+      +-------v--------+     +--------v--------+        +--------v--------+
| onRequest  |      |   Routes       |     |   Services      |        |  onReady hook   |
| hook: auth |      | auth/campaigns/|     | RunService       |        | bootstrap admin,|
| decode     |      | runs/projects/ |     | SchedulerService |        | bucket check,   |
| (cookie or |      | admin/meta/    |     | AdapterManifest  |        | adapter manifest|
| Bearer)    |      | internal       |     | Service          |        | load, resumeWat-|
+------------+      +----------------+     | access.ts        |        | ches, scheduler |
                                            | discovery/diff/  |        | start           |
                                            | results.ts       |        +-----------------+
                                            +---+----------+---+
                                                |          |
                          +---------------------+          +--------------------+
                          v                                                     v
                 +--------+---------+                                +---------+--------+
                 |  OrchestrationProvider (interface, @tcs/orchestration)      |
                 |  argo | docker | local — selected by ORCHESTRATION_PROVIDER |
                 +--------+---------+                                +---------+--------+
                          |                                                     |
                 +--------v---------+                                +---------v--------+
                 |   PostgreSQL      |                                |  S3 / MinIO       |
                 |  (Prisma client)  |                                | (ArtifactStore)    |
                 +-------------------+                                +--------------------+

      +----------------+          +-------------------+          +----------------------+
      |  RunEventBus   |<---------|  Provider.watch()  |          |  BusinessMetricsPusher|
      |  (in-memory     |         |  normalized events |          |  -> Pushgateway       |
      |  pub/sub)       |         +-------------------+          +----------------------+
      +-------+---------+
              |
      +-------v--------+
      | SSE routes      |
      | /runs/:id/events|
      | /runs/:id/logs/ |
      | stream          |
      +-----------------+
```

### Layered Architecture

```text
+-----------------------------------------------------------------------+
|                         PRESENTATION LAYER                             |
|  routes/auth.ts          Login/logout/OIDC/me                          |
|  routes/campaigns.ts     Campaign CRUD, preview, launch, metrics       |
|  routes/runs.ts          Run detail, results, diff, retry/cancel, SSE  |
|  routes/projects.ts      Project CRUD, members                         |
|  routes/admin.ts         Adapter manifest management (admin)           |
|  routes/meta.ts          healthz/readyz/metrics/engines + internal cb  |
|  routes/sse.ts           SSE channel helper (openSse)                  |
+-----------------------------------------------------------------------+
|                         BUSINESS LOGIC LAYER                           |
|  services/run-service.ts         Launch/replay/retry/cancel/ingest    |
|  services/scheduler.ts           Cron scheduling of campaign launches |
|  services/adapter-manifests.ts   Instance adapter manifest lifecycle  |
|  services/access.ts              Project/campaign visibility (RBAC+)  |
|  services/discovery.ts           Source fetch + rule preview          |
|  services/diff.ts                Run-to-run diff                      |
|  services/results.ts             JUnit report -> per-test aggregation |
|  auth/session.ts, oidc.ts, users.ts, plugin.ts  Auth subsystem        |
+-----------------------------------------------------------------------+
|                         DATA ACCESS LAYER                               |
|  prisma.ts            PrismaClient singleton + JSON (de)serialization  |
|  prisma/schema.prisma  ORM model definitions                           |
|  @tcs/orchestration    OrchestrationProvider registry (consumed only)  |
+-----------------------------------------------------------------------+
|                         INFRASTRUCTURE LAYER                           |
|  config.ts             Zod-validated environment configuration        |
|  events/bus.ts         In-memory pub/sub (RunEventBus)                 |
|  metrics/system.ts     prom-client system registry + HTTP hook         |
|  metrics/business.ts   Pushgateway business metrics                   |
|  storage/s3.ts         ArtifactStore (S3/MinIO wrapper)                |
+-----------------------------------------------------------------------+
```

---

## 3. Directory Structure

```text
apps/server/
├── package.json               # deps: fastify, prisma, zod, jose, openid-client, croner, prom-client, aws-sdk
├── tsconfig.json
├── Dockerfile
├── .env.example                # documented env var reference (mirrors config.ts)
├── .env                         # local dev values (gitignored in principle, present here)
│
├── prisma/
│   ├── schema.prisma            # datasource postgresql, binaryTargets native + debian-openssl-3.0.x
│   └── migrations/
│       ├── 0_init                              # baseline schema
│       ├── 20260715000000_campaign_schedule     # scheduleCron / scheduleEnabled
│       ├── 20260721150000_adapter_manifests     # AdapterManifest table
│       └── 20260722120000_projects              # Project / ProjectMember + Campaign.projectId
│
├── src/
│   ├── index.ts                 # entrypoint: loadConfig -> buildApp -> listen, SIGINT/SIGTERM shutdown
│   ├── app.ts                   # buildApp(): plugin registration, error handler, route wiring, onReady/onClose
│   ├── config.ts                 # Zod env schema (loadConfig), authMethods derivation, startup invariants
│   ├── prisma.ts                 # PrismaClient singleton + toJson/fromJson helpers (JSON-as-text columns)
│   │
│   ├── auth/
│   │   ├── plugin.ts              # registerAuthGuards: onRequest cookie/Bearer decode, requireAuth, requireRole
│   │   ├── session.ts             # SessionService: JWT (HS256) issue/verify, SESSION_COOKIE name
│   │   ├── session.test.ts
│   │   ├── oidc.ts                # createOidcService (openid-client), rolesFromClaims (configurable claim path)
│   │   └── users.ts               # verifyPassword, createLocalUser, upsertOidcUser (JIT), ensureBootstrapAdmin
│   │
│   ├── routes/
│   │   ├── auth.ts                # /api/auth/* : methods, login, oidc/login+callback, logout, me
│   │   ├── campaigns.ts           # /api/campaigns/* : CRUD, preview, launch, runs list, metrics
│   │   ├── runs.ts                # /api/runs/*, /api/tests/history : detail, results, diff, actions, SSE
│   │   ├── projects.ts            # /api/projects/* : CRUD, members
│   │   ├── admin.ts               # /api/admin/adapter-manifests/* (admin role)
│   │   ├── meta.ts                # /healthz, /readyz, /metrics, /api/engines, /api/internal/runs/:id/results
│   │   ├── sse.ts                 # openSse(reply): hijacks the reply, writes text/event-stream + heartbeats
│   │   ├── auth.integration.test.ts
│   │   ├── campaigns.integration.test.ts
│   │   └── projects.integration.test.ts
│   │
│   ├── services/
│   │   ├── run-service.ts         # RunService: launch/replay/retry/cancel/getLogs/streamLogs/ingestResults
│   │   ├── scheduler.ts           # SchedulerService: croner jobs per campaign, system account, overlap guard
│   │   ├── scheduler.test.ts
│   │   ├── adapter-manifests.ts   # AdapterManifestService: fetch/install/reload instance manifests
│   │   ├── access.ts              # Project/campaign visibility predicates + Prisma where-filter helper
│   │   ├── access.test.ts
│   │   ├── discovery.ts           # previewSelection: fetchSource -> discoverTests -> selectTests
│   │   ├── diff.ts                # diffRuns: regression/fixed/new/removed/still-failing/stable classification
│   │   ├── diff.test.ts
│   │   ├── results.ts             # aggregateReportByTest: JUnitReport -> one row per test (worst outcome wins)
│   │   └── results.test.ts
│   │
│   ├── events/
│   │   └── bus.ts                 # RunEventBus: in-memory Map<runId, Set<listener>> pub/sub
│   │
│   ├── metrics/
│   │   ├── system.ts              # systemRegistry, httpDuration histogram, activeWatchers, runsLaunched, registerHttpMetrics
│   │   └── business.ts            # BusinessMetricsPusher: per-run gauges pushed to a dedicated Pushgateway
│   │
│   └── storage/
│       └── s3.ts                  # ArtifactStore: ensureBucket/put/get over @aws-sdk/client-s3
│
└── test/
    ├── harness.ts                 # buildTestApp, createTestUser, authHeaderFor, resetDb (TRUNCATE guard)
    └── integration-setup.ts       # DATABASE_URL guard (must contain "tcs_test"), runs prisma generate+deploy
```

---

## 4. Application Lifecycle

### Startup Sequence

```text
1. src/index.ts
   ├── loadConfig(process.env)          # Zod parse + cross-field invariants (throws on invalid config)
   ├── buildApp(config)                  # see below
   └── app.listen({ port, host })
       on SIGINT/SIGTERM: app.close() -> prisma.$disconnect() -> process.exit(0)

2. buildApp(config)  (src/app.ts)
   ├── Fastify({ logger, bodyLimit: 50MB })   # 50MB: aggregated JUnit reports can be large
   ├── register @fastify/cookie
   ├── register @fastify/cors { origin: [PORTAL_ORIGIN], credentials: true }
   ├── addContentTypeParser(application/xml, text/xml)   # aggregation step POSTs raw XML
   ├── setErrorHandler                                    # ZodError -> 400; else statusCode ?? 500
   ├── new SessionService(SESSION_SECRET, SESSION_TTL_HOURS)
   ├── registerAuthGuards(app, sessions)                  # decorates requireAuth/requireRole
   ├── registerHttpMetrics(app)                            # onResponse hook -> httpDuration histogram
   ├── instantiate: RunEventBus, ArtifactStore, BusinessMetricsPusher,
   │                RunService (creates the OrchestrationProvider via ORCHESTRATION_PROVIDER),
   │                SchedulerService, AdapterManifestService
   ├── registerAuthRoutes / registerProjectRoutes / registerCampaignRoutes /
   │   registerRunRoutes / registerMetaRoutes / registerInternalRoutes / registerAdminRoutes
   └── addHook('onReady', async () => { ... })             # see below
       addHook('onClose', async () => scheduler.stop())

3. onReady hook (best-effort — a down DB/S3 must not block boot; /readyz reports the degraded state)
   ├── if AUTH_PASSWORD_ENABLED: ensureBootstrapAdmin(ADMIN_EMAIL, ADMIN_PASSWORD)
   ├── store.ensureBucket()
   ├── adapterManifests.loadAll()           # fetch + install every enabled instance manifest
   ├── runService.resumeWatches()           # re-attach watches for runs left "pending"/"running"
   └── scheduler.start()                    # start croner jobs for scheduleEnabled campaigns
```

Side-effect imports at the top of `app.ts` — `import '@tcs/orchestration'` and `import '@tcs/orchestration-argo'` — register the `local`/`docker` and `argo` provider factories before `RunService` calls `createProvider(ORCHESTRATION_PROVIDER)`.

### Middleware / Hook Stack (execution order)

| Order | Hook                  | Purpose                                                                     |
| ----- | --------------------- | ---------------------------------------------------------------------------- |
| 1     | `@fastify/cookie`      | Parses `request.cookies`                                                    |
| 2     | `@fastify/cors`        | Allows only `PORTAL_ORIGIN`, with credentials                                |
| 3     | content-type parser    | Accepts raw `application/xml`/`text/xml` bodies as a string                 |
| 4     | `onRequest` (auth)      | Reads `tcs_session` cookie or `Authorization: Bearer`, verifies JWT, sets `request.user` |
| 5     | `onResponse` (metrics) | Records `tcs_http_request_duration_seconds` per method/route/status          |
| —     | route `preHandler`     | `app.requireAuth` and/or `app.requireRole(role)` per route                   |
| —     | `setErrorHandler`       | `ZodError` → 400 with issue details; other errors → `statusCode ?? 500`      |

### Request Flow

```text
HTTP Request
    │
    ├─ onRequest: decode session (cookie/Bearer) -> request.user
    ├─ preHandler: requireAuth / requireRole('editor'|'admin') if the route needs it
    ├─ route handler
    │   ├─ Zod-parses body/query
    │   ├─ services/access.ts: project/campaign visibility + mutation checks
    │   ├─ Prisma query/mutation (prisma.ts, JSON columns via toJson/fromJson)
    │   └─ for run actions: RunService -> OrchestrationProvider
    ├─ onResponse: httpDuration.observe(...)
    └─ HTTP Response (or SSE stream, see §9)
```

---

## 5. Database Layer

**Provider:** PostgreSQL (`datasource db { provider = "postgresql" }`), accessed through Prisma 6.10. `generator client` targets `binaryTargets = ["native", "debian-openssl-3.0.x"]` (native Windows dev host + Debian/OpenSSL 3 containers/WSL). JSON-shaped fields (`selectionRule`, `source`, `testsSnapshot`, `handle`, `roles`) are stored as **serialized strings**, not native JSON columns, to keep the schema portable across connectors (`toJson`/`fromJson` in `prisma.ts`).

### Migrations

| Migration                          | Adds                                                             |
| ----------------------------------- | ------------------------------------------------------------------ |
| `0_init`                            | Baseline schema: User, Campaign, WorkflowRun, TestResult, Artifact |
| `20260715000000_campaign_schedule`  | `Campaign.scheduleCron` / `scheduleEnabled`                        |
| `20260721150000_adapter_manifests`  | `AdapterManifest` table                                           |
| `20260722120000_projects`           | `Project`, `ProjectMember`, `Campaign.projectId`                   |

### Models

#### User

| Column         | Type                | Notes                                        |
| -------------- | ------------------- | ----------------------------------------------- |
| `id`           | String (cuid) PK     |                                                   |
| `email`        | String               | `@unique`                                       |
| `displayName`  | String               |                                                   |
| `passwordHash` | String?              | Nullable for OIDC-only users                     |
| `roles`        | String (JSON array) | Default `["viewer"]`; one of `viewer/editor/admin` |
| `authSource`   | String               | `"local"` \| `"oidc"`, default `"local"`          |
| `oidcSubject`  | String?              | `@unique`                                        |
| `active`       | Boolean              | Default `true`                                   |
| `createdAt`/`updatedAt` | DateTime    | Auto                                            |

**Relations:** campaigns (1:M, `CampaignCreator`), runs (1:M, `RunTrigger`), adapterManifestsAdded (1:M), projectsCreated (1:M), projectMemberships (1:M).

---

#### Campaign

| Column               | Type      | Notes                                                                        |
| --------------------- | --------- | -------------------------------------------------------------------------------- |
| `id`                  | String PK  |                                                                                    |
| `name`                | String     |                                                                                    |
| `description`         | String?    |                                                                                    |
| `selectionRule`       | String (JSON) | Nested and/or/not tree (`SelectionRule`)                                      |
| `source`              | String (JSON) | `{type:"git",url,...}` \| `{type:"local",path}` (`TestsSource`)              |
| `parallelism`         | Int        | Default `5`                                                                      |
| `scheduleCron`        | String?    | 5/6-field cron expression                                                        |
| `scheduleEnabled`     | Boolean    | Default `false`                                                                   |
| `version`             | Int        | Incremented on every update; runs record the version they executed              |
| `createdById`         | String FK  | → User                                                                           |
| `createdAt`/`updatedAt` | DateTime |                                                                                    |
| `deletedAt`           | DateTime?  | Soft delete (only when the campaign has runs)                                   |
| `adapterManifestUrl`  | String?    | Admin-only field — per-campaign engine override (see adapter-plugins.md)        |
| `projectId`           | String?    | FK → Project, optional visibility scope                                          |

**Relations:** createdBy (M:1), project (M:1, optional), runs (1:M).

---

#### WorkflowRun

| Column                | Type       | Notes                                                                 |
| ----------------------- | ---------- | ------------------------------------------------------------------------ |
| `id`                    | String PK   |                                                                            |
| `campaignId`            | String FK   | → Campaign                                                                |
| `campaignVersion`       | Int         | Campaign version at launch time                                          |
| `status`                | String      | `RunPhase`: `pending\|running\|succeeded\|failed\|cancelled\|error`, default `pending` |
| `testsSnapshot`         | String (JSON) | `TestExecutionSnapshot[]` — tests actually selected at launch            |
| `handle`                | String? (JSON) | Opaque `RunHandle` from the orchestration provider                       |
| `provider`              | String      | Provider name (`argo`/`docker`/`local`)                                  |
| `parallelism`           | Int         |                                                                            |
| `triggeredById`         | String FK   | → User (may be the scheduler system account)                            |
| `createdAt`/`startedAt`/`finishedAt` | DateTime? |                                                                  |
| `junitKey`              | String?     | S3 key of the aggregated JUnit report                                    |
| `adapterManifestUrl`    | String?     | Frozen copy of the campaign's field at launch time (audit)              |
| `adapterManifestHash`   | String?     | sha256 of the resolved manifest content at launch time                  |

**Indexes:** `(campaignId, createdAt)`, `(status)`. **Relations:** campaign (M:1), results (1:M), artifacts (1:M).

---

#### TestResult

| Column       | Type    | Notes                                     |
| ------------- | ------- | -------------------------------------------- |
| `id`          | String PK |                                               |
| `runId`       | String FK | → WorkflowRun, `onDelete: Cascade`           |
| `testId`      | String   |                                               |
| `name`        | String   |                                               |
| `engine`      | String   |                                               |
| `outcome`     | String   | `passed\|failed\|error\|skipped`              |
| `durationMs`  | Int      | Default `0`                                   |
| `message`     | String?  |                                               |
| `createdAt`   | DateTime |                                               |

**Unique:** `(runId, testId)` — upsert target for idempotent ingestion. **Indexes:** `(testId, createdAt)`, `(outcome)`.

---

#### Artifact

| Column        | Type    | Notes                          |
| -------------- | ------- | --------------------------------- |
| `id`           | String PK |                                   |
| `runId`        | String FK | → WorkflowRun, `onDelete: Cascade` |
| `name`         | String   |                                   |
| `storageKey`   | String   | S3 key                            |
| `contentType`  | String?  |                                   |
| `createdAt`    | DateTime |                                   |

---

#### AdapterManifest

| Column          | Type      | Notes                                |
| ---------------- | --------- | ---------------------------------------- |
| `id`             | String PK  |                                           |
| `url`            | String     | `@unique`                                |
| `enabled`        | Boolean    | Default `true`                           |
| `addedById`      | String FK  | → User                                   |
| `lastFetchedAt`  | DateTime?  |                                           |
| `lastHash`       | String?    | sha256 of last successful fetch           |
| `lastError`      | String?    |                                           |
| `createdAt`      | DateTime   |                                           |

**Index:** `(enabled)`.

---

#### Project

| Column        | Type      | Notes                                                   |
| -------------- | --------- | ----------------------------------------------------------- |
| `id`           | String PK  |                                                               |
| `name`         | String     |                                                               |
| `description`  | String?    |                                                               |
| `createdById`  | String FK  | → User                                                        |
| `createdAt`/`updatedAt` | DateTime |                                                        |
| `deletedAt`    | DateTime?  | Soft delete once it has campaigns                            |

**Relations:** members (1:M), campaigns (1:M — plain optional FK on `Campaign.projectId`, `onDelete: SetNull`).

---

#### ProjectMember

| Column       | Type     | Notes                                      |
| ------------- | -------- | --------------------------------------------- |
| `id`          | String PK |                                               |
| `projectId`   | String FK | → Project, `onDelete: Cascade`               |
| `userId`      | String FK | → User                                        |
| `addedAt`     | DateTime  |                                               |

**Unique:** `(projectId, userId)`. Binary membership — no per-member role.

### Entity-Relationship Diagram

```text
┌──────────┐   CampaignCreator   ┌──────────────┐        ┌──────────────┐
│  User    │────────────────────>│  Campaign    │───────>│  Project     │ (optional FK,
└────┬─────┘                     └──────┬───────┘        └──────┬───────┘  SetNull)
     │ RunTrigger                        │ 1:M                    │ 1:M
     │                                   v                        v
     │                          ┌──────────────┐        ┌──────────────────┐
     ├─────────────────────────>│ WorkflowRun  │        │  ProjectMember   │
     │                          └──────┬───────┘        └──────────────────┘
     │ AdapterManifestAdder             │ 1:M (cascade)
     │                          ┌───────┴────────┐
     ├─────────────────────────>│                │
     │                   ┌──────v─────┐   ┌──────v─────┐
     │                   │ TestResult │   │  Artifact   │
     │                   └────────────┘   └─────────────┘
     │ ProjectCreator
     └─────────────────────────> Project.createdBy

AdapterManifest.addedBy -> User (separate relation, not pictured above for brevity)
```

---

## 6. API Endpoints

**Base URL:** no fixed `/api` prefix at the Fastify level — each route registers its own full path (all under `/api/*` except `/healthz`, `/readyz`, `/metrics`). **Auth:** `tcs_session` cookie or `Authorization: Bearer <jwt>`. **Pagination:** `page`/`pageSize` query params, `{ total, page, pageSize, items }` response shape (campaigns' runs, run results).

### 6.1 Auth (`/api/auth`) — `routes/auth.ts`

| Method | Path                     | Auth   | Description                                                  |
| ------ | ------------------------ | ------ | ---------------------------------------------------------------- |
| GET    | `/api/auth/methods`       | public | `{ password, oidc, oidcLoginUrl? }`                              |
| POST   | `/api/auth/login`         | public | `{email,password}` → sets `tcs_session` cookie                   |
| GET    | `/api/auth/oidc/login`    | public | Redirects to IdP, sets `tcs_oidc_state` cookie (state+nonce)       |
| GET    | `/api/auth/oidc/callback` | public | Verifies state/nonce, JIT-provisions user, sets session, redirects to `PORTAL_ORIGIN` |
| POST   | `/api/auth/logout`        | public | Clears the session cookie                                        |
| GET    | `/api/auth/me`            | auth   | Returns the decoded `SessionPayload`                             |

### 6.2 Projects (`/api/projects`) — `routes/projects.ts`

| Method | Path                               | Role              | Description                                                        |
| ------ | ----------------------------------- | ----------------- | ---------------------------------------------------------------------- |
| GET    | `/api/projects`                     | viewer            | Projects the requester can access (creator, member, or admin)         |
| POST   | `/api/projects`                     | editor            | `{name, description?}`                                                 |
| GET    | `/api/projects/:id`                 | viewer (access)    | 403 if inaccessible, 404 if absent                                      |
| PUT    | `/api/projects/:id`                 | editor (creator/admin) | Update name/description                                           |
| DELETE | `/api/projects/:id`                 | editor (creator/admin) | Soft delete if it has campaigns, else hard delete                 |
| POST   | `/api/projects/:id/members`         | editor (creator/admin) | `{email}` → 404 if no such user                                   |
| DELETE | `/api/projects/:id/members/:userId` | editor (creator/admin) |                                                                     |

### 6.3 Campaigns (`/api/campaigns`) — `routes/campaigns.ts`

| Method | Path                           | Role           | Description                                                             |
| ------ | ------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| GET    | `/api/campaigns`                | viewer         | `?includeDeleted=true`, `?projectId=` — visibility-filtered unless admin       |
| POST   | `/api/campaigns`                | editor         | Creates; `adapterManifestUrl` requires admin; `projectId` requires access      |
| GET    | `/api/campaigns/:id`            | viewer (access) |                                                                               |
| PUT    | `/api/campaigns/:id`            | editor (owns/admin/project-creator) | Partial update, re-syncs scheduler job                   |
| DELETE | `/api/campaigns/:id`            | editor (owns/admin/project-creator) | Soft delete if runs exist, else hard delete               |
| POST   | `/api/campaigns/preview`        | viewer         | `{source, selectionRule}` → matched tests + discovery issues (no persistence) |
| POST   | `/api/campaigns/:id/runs`       | editor (access) | `{parallelism?, revision?}` → launches a run                                  |
| GET    | `/api/campaigns/:id/runs`       | viewer (access) | `?status&from&to&page&pageSize`                                               |
| GET    | `/api/campaigns/:id/metrics`    | viewer (access) | Last 50 runs with results → totals/pass/fail/duration/successRatio            |

### 6.4 Runs & Results (`/api/runs`, `/api/tests`) — `routes/runs.ts`

| Method    | Path                                | Role            | Description                                                  |
| --------- | ------------------------------------ | --------------- | ------------------------------------------------------------------ |
| GET       | `/api/runs/:id`                      | viewer (access)  | Detail + testsSnapshot + results summary + live state if non-terminal |
| GET       | `/api/runs/:id/results`               | viewer (access)  | `?outcome&engine&page&pageSize`                                     |
| GET       | `/api/runs/:id/diff`                  | viewer (access)  | `?against=previous\|<runId>` — delta vs. another run                |
| POST      | `/api/runs/:id/replay`                | editor (access)  | `{parallelism?}` → relaunches the exact same test snapshot          |
| POST      | `/api/runs/:id/retry`                 | editor (access)  | `{testIds?}` → targeted retry (defaults to failed tests)             |
| POST      | `/api/runs/:id/cancel`                | editor (access)  |                                                                       |
| GET       | `/api/runs/:id/junit`                 | viewer (access)  | Aggregated JUnit XML from S3                                          |
| GET       | `/api/runs/:id/artifacts`             | viewer (access)  |                                                                       |
| GET       | `/api/runs/:id/logs`                  | viewer (access)  | `?testId=&download=1` — one test's logs                              |
| GET (SSE) | `/api/runs/:id/logs/stream`           | viewer (access)  | `?testId=` — live log tail                                           |
| GET (SSE) | `/api/runs/:id/events`                | viewer (access)  | Normalized `test`/`run` events, hydrated with live state              |
| GET       | `/api/tests/history`                  | viewer           | `?testId&campaignId&limit` — cross-run history (campaign-scoped access if `campaignId` given) |

### 6.5 Admin — Adapter Manifests (`/api/admin/adapter-manifests`) — `routes/admin.ts`

| Method | Path                                   | Role  | Description                      |
| ------ | --------------------------------------- | ----- | --------------------------------- |
| GET    | `/api/admin/adapter-manifests`          | admin | List instance manifests           |
| POST   | `/api/admin/adapter-manifests`          | admin | `{url}` → add + immediate fetch attempt |
| DELETE | `/api/admin/adapter-manifests/:id`      | admin | Remove + rebuild installed tier    |
| POST   | `/api/admin/adapter-manifests/reload`   | admin | Re-fetch every enabled manifest    |

### 6.6 Meta & Internal — `routes/meta.ts`

| Method | Path                                      | Auth                        | Description                                                        |
| ------ | ------------------------------------------ | --------------------------- | ----------------------------------------------------------------------- |
| GET    | `/healthz`                                 | public                      | Liveness, `{status:"ok"}`                                               |
| GET    | `/readyz`                                  | public                      | `SELECT 1`; 503 `{status:"database unreachable"}` on failure            |
| GET    | `/metrics`                                 | public                      | Prometheus system metrics (`systemRegistry`)                           |
| GET    | `/api/engines`                             | auth                        | Engine adapters with `origin` (`built-in` or manifest URL)              |
| POST   | `/api/internal/runs/:runId/results`        | optional `x-tcs-token`       | Aggregation-step callback: raw JUnit XML body → `runService.ingestResults` |

---

## 7. Authentication & Authorization

### Methods

| Method    | Module         | Flow                                                                                           |
| ---------- | -------------- | -------------------------------------------------------------------------------------------------- |
| Password   | `auth/users.ts` | `verifyPassword` (bcryptjs compare against `passwordHash`); disabled users rejected                 |
| OIDC       | `auth/oidc.ts`  | `openid-client` discovery + authorization-code flow with state+nonce cookie (`tcs_oidc_state`, 10 min TTL); JIT-provisions via `upsertOidcUser` (re-syncs displayName/email/roles on every login) |

Both methods issue the same session: `SessionService.issue()` signs a JWT (`jose`, HS256) with `{sub, email, displayName, roles, authSource}`, set as the `tcs_session` httpOnly cookie (`sameSite: lax`, `secure` if `PUBLIC_BASE_URL` is https) and also accepted as a `Bearer` header (used by tests and non-browser clients, e.g. the CLI).

### RBAC

Roles: `viewer < editor < admin` (`@tcs/shared-types`'s `hasRole`, hierarchical). Guards (`auth/plugin.ts`, decorated on `app`):

- `app.requireAuth` — 401 if no valid session
- `app.requireRole(role)` — 401 if no session, 403 if role insufficient

Ownership rules enforced in route handlers (not in the guard):

- A campaign is mutable by its creator (`editor`), any `admin`, or — if it belongs to a project — that project's creator (`canMutate` in `routes/campaigns.ts`).
- `adapterManifestUrl` on a campaign is settable by `admin` only, even for an otherwise-editable campaign (`canSetAdapterManifestUrl`) — a manifest-defined engine can execute arbitrary commands via the `local`/`docker` provider runtime.

### Projects — visibility layer (`services/access.ts`)

Orthogonal to RBAC, not a fourth role. Pure predicates (unit-tested) composed with Prisma lookups:

| Function                       | Kind            | Rule                                                                       |
| -------------------------------- | --------------- | ------------------------------------------------------------------------------- |
| `hasProjectAccess`               | pure             | admin, or creator, or member                                                     |
| `isProjectCreator`               | pure             | admin, or creator (not members)                                                  |
| `canAccessProject`               | Prisma-backed    | wraps `hasProjectAccess` with a DB lookup                                       |
| `canAccessCampaign`              | Prisma-backed    | no `projectId` → always visible; else delegates to `canAccessProject`          |
| `canMutateCampaignInProject`     | Prisma-backed    | wraps `isProjectCreator`                                                         |
| `campaignVisibilityFilter(userId)` | Prisma `where` fragment | used to list only visible campaigns for non-admins                          |

A campaign/run with no `projectId` is visible to any `viewer` (pre-existing behavior); one scoped to a project is visible only to that project's creator, members, and admins. Every campaign-scoped route enforces this (including every `/runs/:id*` route, since a run inherits its campaign's visibility via `findAccessibleRun`).

---

## 8. Business Logic (Services)

### `RunService` (`services/run-service.ts`)

Central orchestration-facing service — holds the single `OrchestrationProvider` instance (`createProvider(ORCHESTRATION_PROVIDER)`, from `@tcs/orchestration`).

| Method              | Behavior                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `launch`              | Resolves source + rule → `previewSelection`; rejects empty selection (422); resolves adapter overrides from the campaign's manifest URL (`resolveAdapterOverrides`, never mutates the shared registry); builds a `TestExecutionSnapshot[]` and calls `submitRun` |
| `replay`              | Re-submits a past run's **frozen** snapshot unchanged — no adapter re-resolution; carries over the original run's `adapterManifestUrl`/hash |
| `submitRun` (private) | Creates the `WorkflowRun` row (`pending`), builds a `CampaignExecutionSpec`, calls `provider.submit`; on success starts the watch and flips to `running`; on failure flips to `error` |
| `startWatch` (private) | Subscribes to `provider.watch`, republishes every event on `RunEventBus`, persists terminal `run` events to Prisma |
| `retry`                 | `provider.retryFailed(handle, testIds?)`, resets status to `running`, restarts the watch                        |
| `cancel`                | `provider.cancel(handle)`                                                                                        |
| `getLogs` / `streamLogs` | Delegates to the provider; falls back to one-shot `getLogs` if `streamLogs` is unimplemented                     |
| `ingestResults`         | Parses + aggregates the posted JUnit XML, upserts `TestResult` rows (idempotent), reconciles run status if the watch missed the end, archives the report to S3 (best-effort), pushes business metrics |
| `resumeWatches`         | Called at boot: re-attaches watches for runs still `pending`/`running` whose handle's provider matches the current one and isn't `local`/`docker`; otherwise closes them as `error` (in-memory provider state was lost) |

### `SchedulerService` (`services/scheduler.ts`)

One `croner` `Cron` job per campaign with `scheduleEnabled && scheduleCron`, keyed by campaign id in an in-memory `Map`.

- `start()` — loads all eligible campaigns and schedules them (no-op if `SCHEDULER_ENABLED=false`).
- `sync(campaignId)` — stops/removes then re-schedules a single campaign's job; called after every campaign create/update/delete.
- `fire(campaignId)` — re-checks the campaign is still eligible, skips if a run is already `pending`/`running` (overlap protection), then `runService.launch(campaign, systemUserId)`.
- System account: `scheduler@testcampaignshooter.local` (lazily upserted, `editor` role, no `passwordHash` — cannot log in) so the audit trail distinguishes scheduled from manual launches.
- `isValidCronExpression` / `nextOccurrence` — exported helpers reused by `routes/campaigns.ts` for validation and the `nextScheduledAt` field.

### `AdapterManifestService` (`services/adapter-manifests.ts`)

Manages instance-level (admin, persisted) adapter manifests, installed into `@tcs/core`'s shared registry (`installAdapter`/`uninstallInstanceAdapters`/`originOf`).

- `add(url, addedById)` — persists then attempts an immediate fetch (kept even on failure; `lastError` surfaces it).
- `remove(id)` — deletes then calls `reloadAll()` (rebuilds the whole installed tier rather than diffing one removal).
- `loadAll()` — called once at boot (`onReady`).
- `reloadAll()` — `uninstallInstanceAdapters()` then re-fetches every `enabled` manifest, warns on an engine-name collision with a different manifest URL.

### `services/access.ts`, `discovery.ts`, `diff.ts`, `results.ts`

See §7 (access), and:

- `discovery.ts` — `previewSelection(source, rule)`: `fetchSource` (materializes git/local/zip) → `discoverTests` → `selectTests`; always calls `fetched.cleanup()` in a `finally`.
- `diff.ts` — `diffRuns(campaignId, base, target)`: classifies every test as `new | regression | fixed | still-failing | removed | stable`, sorted by severity then `testId`.
- `results.ts` — `aggregateReportByTest(report)`: one row per `testId` from possibly several `<testcase>` entries; worst outcome wins (`error > failed > skipped-only > passed`), durations summed, first message kept.

---

## 9. Real-Time Communication (SSE)

### `openSse` (`routes/sse.ts`)

`reply.hijack()`s the Fastify reply to write a raw `text/event-stream` response: writes an initial `: connected` comment, a `: ping` heartbeat comment every 15s, and exposes `{ send(event, data), close(), signal }` (an `AbortSignal` aborted on `close`/socket-close).

### Event streams

| Route                             | Source                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /api/runs/:id/events`          | Subscribes to `RunEventBus` for the run id; hydrates late subscribers via `runService.getLiveState`, replaying `test` events then one `run` event; closes immediately if the hydrated state is already terminal |
| `GET /api/runs/:id/logs/stream`     | `runService.streamLogs(run, testId, onChunk, signal)` — emits `log` events with `{chunk}`, then `end` |

### `RunEventBus` (`events/bus.ts`)

In-memory `Map<runId, Set<listener>>` pub/sub. `RunService.startWatch` is the sole publisher (bridging `OrchestrationProvider.watch` events); SSE routes are the only subscribers. Explicitly single-instance — scaling to several server replicas requires swapping this for an external pub/sub (e.g. Redis).

---

## 10. Background Tasks & Scheduling

Covered in depth in §8 (`SchedulerService`). Single in-process scheduler, gated by `SCHEDULER_ENABLED` — must be kept enabled on exactly one replica in a multi-instance deployment (same constraint as `RunEventBus`). Timezone: `SCHEDULER_TIMEZONE` (IANA), defaults to the server's own.

---

## 11. Artifact Storage (S3/MinIO)

### `ArtifactStore` (`storage/s3.ts`)

Thin wrapper over `@aws-sdk/client-s3`, configured for any S3-compatible endpoint (MinIO in dev/self-hosted).

| Method          | Behavior                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `ensureBucket()`   | `HeadBucketCommand`; on failure, attempts `CreateBucketCommand` (races tolerated, swallowed) |
| `put(key, body, contentType)` | `PutObjectCommand`, returns the key                                              |
| `get(key)`         | `GetObjectCommand`, returns `undefined` on any failure (never throws)                       |

Used by `RunService.ingestResults` to archive the aggregated JUnit report at `runs/<runId>/junit.xml`, and by `GET /api/runs/:id/junit` to serve it back. Archiving failures are logged and swallowed — results already persisted in Postgres are never lost because of an S3 outage.

---

## 12. Metrics

### System (`metrics/system.ts`) — always on, `/metrics`

| Metric                                | Type      | Labels                        |
| ---------------------------------------- | --------- | -------------------------------- |
| Default Node.js process metrics          | various    | (via `client.collectDefaultMetrics`) |
| `tcs_http_request_duration_seconds`       | Histogram  | `method, route, status`            |
| `tcs_orchestration_watchers_active`       | Gauge      | —                                  |
| `tcs_runs_launched_total`                 | Counter    | `provider`                         |

### Business (`metrics/business.ts`) — opt-in, `BUSINESS_METRICS_ENABLED` + `PUSHGATEWAY_URL`

Pushed to a **separate, dedicated** Pushgateway (never the infra `/metrics`), grouped by `run_id`, registry reset after every push to avoid stale series accumulating.

| Metric                      | Type   | Extra label |
| ------------------------------ | ------ | -------------- |
| `tcs_run_tests_total`           | Gauge  | —               |
| `tcs_run_tests_passed`          | Gauge  | —               |
| `tcs_run_tests_failed`          | Gauge  | —               |
| `tcs_run_tests_skipped`         | Gauge  | —               |
| `tcs_run_duration_seconds`      | Gauge  | —               |
| `tcs_run_success_ratio`         | Gauge  | —               |
| `tcs_run_regressions`           | Gauge  | —               |
| `tcs_run_status`                | Gauge  | `status`         |

All gauges share base labels `campaign_id, campaign_name, run_id, triggered_by`. Pushgateway supports optional HTTP Basic auth (`PUSHGATEWAY_USERNAME`/`PASSWORD`); push failures are logged and swallowed (non-fatal).

---

## 13. Configuration

All variables are parsed and validated by the Zod schema in `config.ts` (`loadConfig`); invalid config throws at startup with a field-by-field message. Cross-field invariants: `AUTH_OIDC_ENABLED=true` requires `OIDC_ISSUER` + `OIDC_CLIENT_ID`; at least one of `AUTH_PASSWORD_ENABLED`/`AUTH_OIDC_ENABLED` must be true.

| Variable                   | Default                     | Description                                                  |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------ |
| `PORT`                         | `4000`                        | HTTP listen port                                                    |
| `HOST`                         | `0.0.0.0`                     | HTTP listen host                                                    |
| `PUBLIC_BASE_URL`              | `http://localhost:4000`       | Used for OIDC redirect URI and the results callback URL (must be reachable from execution pods) |
| `PORTAL_ORIGIN`                | `http://localhost:3000`       | CORS allow-origin + post-OIDC-login redirect target                 |
| `LOG_LEVEL`                    | `info`                        | `fatal\|error\|warn\|info\|debug\|trace`                             |
| `DATABASE_URL`                 | *(required)*                  | PostgreSQL connection string                                         |
| `ORCHESTRATION_PROVIDER`       | `local`                       | `argo \| docker \| local`                                            |
| `DEFAULT_PARALLELISM`          | `5`                           | Default campaign parallelism                                        |
| `SCHEDULER_ENABLED`            | `true`                        | Automatic cron campaign launches (one replica only)                  |
| `SCHEDULER_TIMEZONE`           | *(server's own)*               | IANA timezone for cron evaluation                                    |
| `AUTH_PASSWORD_ENABLED`        | `true`                        | Enables local password login                                         |
| `AUTH_OIDC_ENABLED`            | `false`                       | Enables OIDC login                                                   |
| `SESSION_SECRET`               | *(required, ≥32 chars)*        | HS256 JWT signing key                                                |
| `SESSION_TTL_HOURS`            | `12`                          | Session lifetime                                                    |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | *(optional)*                 | Bootstrap admin account, created at startup if password auth is enabled |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | *(optional)* | OIDC provider config                                                |
| `OIDC_SCOPES`                  | `openid profile email`        |                                                                       |
| `OIDC_ROLES_CLAIM`             | `roles`                       | Dotted claim path read for application roles                         |
| `S3_ENDPOINT`                  | *(optional)*                   | MinIO/S3-compatible endpoint                                         |
| `S3_REGION`                    | `us-east-1`                    |                                                                       |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | *(optional)*                 |                                                                       |
| `S3_BUCKET`                    | `tcs-artifacts`                 |                                                                       |
| `S3_FORCE_PATH_STYLE`          | `true`                         | Required for most non-AWS S3 endpoints                               |
| `BUSINESS_METRICS_ENABLED`     | `false`                         |                                                                       |
| `PUSHGATEWAY_URL`              | *(optional)*                    |                                                                       |
| `BUSINESS_METRICS_JOB`         | `tcs-campaigns`                  |                                                                       |
| `PUSHGATEWAY_USERNAME` / `PUSHGATEWAY_PASSWORD` | *(optional)*       | Basic auth for the pushgateway                                       |
| `INTERNAL_CALLBACK_TOKEN`      | *(optional)*                    | When set, `x-tcs-token` is required on the internal results callback  |

Other variables consumed by `@tcs/orchestration`/`@tcs/orchestration-argo` (`K8S_NAMESPACE`, `ARGO_SERVER_URL`, `LOCAL_PROVIDER_RUNTIME`, `GIT_TOKEN`, etc.) are documented in [SHARED_PACKAGES_ARCHITECTURE.md](SHARED_PACKAGES_ARCHITECTURE.md) and the full reference table in [deployment.md §7](deployment.md#7-complete-configuration-variable-reference).

---

## 14. Error Handling

Single global `setErrorHandler` (`app.ts`):

- `ZodError` → `400 { error: 'validation failed', details: [{path, message}, ...] }`
- Any other error → `statusCode ?? 500`; 5xx is logged via `request.log.error`, the response body is `{ error: message }`

Business errors are raised as plain `Error` objects augmented with a `statusCode` property (e.g. `RunService.launch` throws `422` when the selection rule matches no test; `RunService.handleOf` throws `409` when a run has no orchestration handle yet). Route handlers also send explicit `404`/`403` responses directly via `reply.code(...).send(...)` for not-found/forbidden cases rather than throwing.

---

## 15. Testing

| Suite         | Command                                   | Scope                                                                                      |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Unit             | `pnpm test` (Vitest, root config)             | Pure logic: `access.test.ts`, `diff.test.ts`, `results.test.ts`, `scheduler.test.ts`, `auth/session.test.ts` — no DB |
| Integration       | `pnpm test:integration` (`vitest.integration.config.ts`) | Full Fastify app via `.inject()` against a real `tcs_test` Postgres: `routes/*.integration.test.ts` |

`test/integration-setup.ts` runs once per test file, before other imports (env vars must exist before `prisma.ts` instantiates `PrismaClient` at import time):

- Defaults `DATABASE_URL` to `postgresql://tcs:tcs@localhost:5432/tcs_test`, disables the scheduler and business metrics (no cron noise/network flakiness during tests), points S3 at the local MinIO.
- **Refuses to run** unless `DATABASE_URL` contains `tcs_test` (or `ALLOW_INTEGRATION_TESTS_ON_THIS_DB=1`) — `test/harness.ts`'s `resetDb()` truncates every app table between tests.
- Runs `pnpm run prisma:generate` + `pnpm run prisma:deploy` synchronously (the generated Prisma client isn't produced by a plain `pnpm install` in CI).

`test/harness.ts` exposes `buildTestApp()` (wires the real app, real routes, real Postgres), `createTestUser(roles, overrides?)`, `authHeaderFor(user, roles)` (issues a Bearer JWT without going through `/api/auth/login`), and `resetDb()`.

---

## Appendix: Key Design Patterns

| Pattern                               | Where                              | Purpose                                                                     |
| ---------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| **Side-effect provider registration**     | `app.ts` top-level imports            | `@tcs/orchestration`/`@tcs/orchestration-argo` register factories before `RunService` resolves `ORCHESTRATION_PROVIDER` |
| **JSON-as-text columns**                  | `prisma.ts`, `schema.prisma`          | Keeps the schema portable across SQL connectors; `toJson`/`fromJson` centralize (de)serialization |
| **Pure predicate + DB-backed wrapper**     | `services/access.ts`                  | Unit-testable authorization logic (`hasProjectAccess`) separated from the Prisma lookup (`canAccessProject`) |
| **Frozen snapshot replay**                | `RunService.replay`                   | A replayed run re-executes exactly what was selected originally — no re-resolution of rules or adapters |
| **Best-effort side effects in `onReady`** | `app.ts`                              | A down DB/S3 at boot never prevents the server from listening; `/readyz` reports degraded state |
| **Idempotent upsert ingestion**           | `RunService.ingestResults`            | `(runId, testId)` unique constraint makes repeated JUnit callbacks safe             |
| **Hijacked raw SSE stream**               | `routes/sse.ts`                       | Bypasses Fastify's reply lifecycle for a long-lived `text/event-stream` response with heartbeats |
| **In-memory pub/sub, single-instance**    | `events/bus.ts`, `services/scheduler.ts` | Simplicity over horizontal scaling; both are explicitly documented as needing an external backend (Redis) to run multi-replica |
| **Dedicated business metrics target**     | `metrics/business.ts`                 | Isolates high-cardinality per-run labels from the infra Prometheus scraped at `/metrics` |
| **Admin-gated privilege escalation field** | `routes/campaigns.ts` (`adapterManifestUrl`) | A single field on an otherwise editor-editable resource is restricted because of its security blast radius |
