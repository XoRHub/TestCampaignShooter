# TestCampaignShooter Shared Packages Architecture

Exhaustive map of the 4 shared, framework-agnostic packages of the pnpm
monorepo: `packages/shared-types`, `packages/core`, `packages/orchestration`,
`packages/orchestration-argo`. They contain every piece of domain logic that
is *not* tied to Fastify, Next.js or a CLI framework, so `apps/server`,
`apps/portal` and `apps/cli` can all depend on the same neutral primitives.

> This document is a mechanical, file-by-file inventory (directory trees,
> every exported type/interface, every built-in adapter/provider). The
> narrative "why" (rationale, sequence diagrams, security/RBAC) lives in
> [architecture.md](architecture.md) and [technical.md](technical.md) —
> read those first for the big picture, this one for exact signatures.
> Consumers: [BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md) (`apps/server`),
> [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) (`apps/portal`, indirectly
> through the API), [CLI_ARCHITECTURE.md](CLI_ARCHITECTURE.md) (`apps/cli`).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Package Dependency Graph](#2-package-dependency-graph)
3. [packages/shared-types](#3-packagesshared-types)
4. [packages/core](#4-packagescore)
5. [packages/orchestration](#5-packagesorchestration)
6. [packages/orchestration-argo](#6-packagesorchestration-argo)
7. [Extension Guides](#7-extension-guides)
8. [Testing](#8-testing)
9. [Appendix: Key Design Patterns](#9-appendix-key-design-patterns)

---

## 1. Overview

| Package                        | Role                                                                             | Runtime deps (own)                                                            | Consumed by                                                   |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `@tcs/shared-types`             | Neutral types + Zod schemas: metadata, rules, orchestration events, results, auth, adapter manifests. Zero I/O. | `zod`                                                                           | all other packages, `apps/server`, `apps/portal` (`.d.ts` only) |
| `@tcs/core`                     | Ingestion (git/local/zip), test discovery, rule engine, engine adapters, JUnit parse/merge | `@tcs/shared-types`, `adm-zip`, `fast-glob`, `fast-xml-parser`, `simple-git`, `yaml`, `zod` | `@tcs/orchestration`, `apps/server`, `apps/cli`                 |
| `@tcs/orchestration`            | `OrchestrationProvider` interface + factory registry + `local`/`docker` providers | `@tcs/core`, `@tcs/shared-types`                                               | `apps/server`, `apps/cli` (`--docker`/`--local`)                |
| `@tcs/orchestration-argo`       | `argo` provider (production default) — **the only package depending on `@kubernetes/client-node`** | `@kubernetes/client-node`, `@tcs/orchestration`, `@tcs/shared-types`, `yaml`    | `apps/server` (imported once for its registration side effect)  |

All four are private workspace packages (`"private": true`, pnpm
`workspace:*` cross-deps), published as raw TypeScript (`"exports": {".":
"./src/index.ts"}` — no build step, `tsc --noEmit` is only used for
type-checking). Each has its own `tsconfig.json` and a Vitest `*.test.ts`
file colocated with the module it tests.

---

## 2. Package Dependency Graph

```text
                     ┌───────────────────────┐
                     │  @tcs/shared-types     │   (leaf: no workspace deps)
                     └───────────▲────────────┘
                                 │
                     ┌───────────┴────────────┐
                     │      @tcs/core          │   ingestion, discovery, rules,
                     └───────────▲────────────┘   adapters, JUnit
                                 │
                     ┌───────────┴────────────┐
                     │   @tcs/orchestration    │   provider interface + registry
                     └───────────▲────────────┘   + local/docker providers
                                 │
                     ┌───────────┴────────────┐
                     │ @tcs/orchestration-argo │   argo provider (k8s client)
                     └─────────────────────────┘

        consumers (apps/*) ─────────────────────────────────────────────
        apps/server    → core, orchestration, orchestration-argo (registration only)
        apps/cli       → core, orchestration (local/docker), orchestration-argo not needed
        apps/portal    → shared-types only, via generated/duplicated API DTOs (no server code)
```

**Key abstraction boundary**: `@tcs/orchestration-argo` is the *only* module
in the whole monorepo importing `@kubernetes/client-node`. Everything else —
`apps/server`, `apps/portal`, the database — only ever sees the neutral types
from `@tcs/shared-types` (`RunHandle`, `OrchestrationEvent`, `RunSnapshot`).
Swapping/adding an orchestrator is "a new package + one `registerProviderFactory`
call", never a change to the consuming types.

---

## 3. packages/shared-types

### Directory Structure

```text
packages/shared-types/
├── package.json              # deps: zod only
├── tsconfig.json
└── src/
    ├── index.ts               # re-exports every module below
    ├── metadata.ts            # ExecutionSpec, TestMetadata, DiscoveredTest, DiscoveryIssue
    ├── rules.ts               # ConditionOperator, SelectionRule, selectionRuleSchema
    ├── orchestration.ts       # TestNodeStatus, RunPhase, CampaignExecutionSpec, events, RunHandle
    ├── results.ts             # TestOutcome, JUnitReport/TestCase, RunDiff
    ├── auth.ts                # Role, hasRole(), AuthMethods, UserProfile
    └── adapter-manifest.ts    # EngineManifestEntry, AdapterManifest (declarative adapters)
```

### `metadata.ts` — the `<test>.metadata.json` contract

| Export                 | Kind           | Shape / Notes                                                                                                                   |
| ----------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `executionSpecSchema`   | Zod schema     | `.strict()` object: `image?`, `command?: string[]` (nonempty), `junitPath?`, `timeoutSeconds?` (int, 1–86 400), `env?: Record<string,string>`, `resources?: {cpu?, memory?}`, `workingDir?` |
| `ExecutionSpec`         | type           | `z.infer<typeof executionSpecSchema>`                                                                                           |
| `testMetadataSchema`    | Zod schema     | `.passthrough()` object: `id?` (regex `^[a-zA-Z0-9]([a-zA-Z0-9._/-]*[a-zA-Z0-9])?$`, ≤200 chars), `name?`, `engine` (required), `execution` (defaults to `{}`). Passthrough lets arbitrary selection attributes (tags, team, criticality…) ride along for the rule engine. |
| `TestMetadata`          | type           | `z.infer<typeof testMetadataSchema>`                                                                                            |
| `DiscoveredTest`        | interface      | `{ id, name, engine, file, metadataFile, metadata }` — one test found by `discoverTests`                                        |
| `DiscoveryIssue`        | interface      | `{ file, kind, message }`, `kind ∈ {missing-metadata, invalid-json, invalid-metadata, unknown-engine, duplicate-id}`             |

### `rules.ts` — selection rule grammar

| Export                  | Kind       | Shape / Notes                                                                                   |
| ------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `conditionOperators`     | const array | `['eq','ne','in','nin','gt','gte','lt','lte','contains','matches','exists']`                     |
| `ConditionOperator`      | type       | union of the above                                                                                 |
| `PropertyCondition`      | interface  | `{ prop: string, op: ConditionOperator, value?: unknown }` — `prop` supports dot paths             |
| `PathUnderCondition`     | interface  | `{ pathUnder: string }`                                                                            |
| `SelectionRule`          | type       | recursive union: `{all:[...]}` \| `{any:[...]}` \| `{not:...}` \| `PropertyCondition` \| `PathUnderCondition` |
| `selectionRuleSchema`    | Zod schema | `z.lazy` recursive schema mirroring `SelectionRule`, every branch `.strict()`                      |
| `MATCH_ALL_RULE`         | const      | `{ all: [{ prop: 'engine', op: 'exists' }] }` — default rule of an empty campaign                   |

### `orchestration.ts` — the provider-neutral runtime contract

| Export                      | Kind       | Shape / Notes                                                                                                     |
| ----------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `testNodeStatuses` / `TestNodeStatus` | const/type | `pending \| running \| succeeded \| failed \| cancelled \| timeout`                                                 |
| `TERMINAL_TEST_STATUSES`      | `ReadonlySet` | `{succeeded, failed, cancelled, timeout}`                                                                           |
| `runPhases` / `RunPhase`      | const/type | `pending \| running \| succeeded \| failed \| cancelled \| error`                                                   |
| `TERMINAL_RUN_PHASES`         | `ReadonlySet` | `{succeeded, failed, cancelled, error}`                                                                             |
| `testsSourceSchema` / `TestsSource` | Zod discriminated union | `{type:'git', url, revision?, tokenSecretRef?}` \| `{type:'local', path}`                                     |
| `ResolvedExecution`           | interface  | `{ image, command: string[], junitPath, timeoutSeconds, env, resources?, workingDir? }` — fully resolved, provider-ready |
| `TestExecutionSnapshot`       | interface  | `{ testId, name, engine, file, execution: ResolvedExecution, metadata }` — frozen at submission time                 |
| `CampaignExecutionSpec`       | interface  | `{ runId, campaignId, campaignName, source, tests: TestExecutionSnapshot[], parallelism, resultsCallbackUrl?, resultsCallbackToken? }` |
| `RunHandle`                   | interface  | `{ provider, externalId, namespace? }` — opaque, provider-defined                                                     |
| `TestStateEvent`              | interface  | `{ type:'test', runId, testId, status, startedAt?, finishedAt?, message? }`                                           |
| `RunProgress`                 | interface  | `{ total, pending, running, succeeded, failed }`                                                                      |
| `RunStateEvent`               | interface  | `{ type:'run', runId, phase, progress, startedAt?, finishedAt?, message? }`                                           |
| `OrchestrationEvent`          | type       | `TestStateEvent \| RunStateEvent`                                                                                     |
| `LogChunk`                    | interface  | `{ testId, content, timestamp? }`                                                                                     |

### `results.ts` — JUnit outcomes & diffing

| Export          | Kind      | Shape / Notes                                                                                               |
| ----------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `TestOutcome`     | type      | `passed \| failed \| error \| skipped`                                                                           |
| `JUnitTestCase`   | interface | `{ testId, name, classname?, outcome, durationMs, message?, systemOut? }`                                        |
| `JUnitReport`     | interface | `{ total, passed, failed, errors, skipped, durationMs, cases: JUnitTestCase[] }`                                  |
| `DiffChange`      | type      | `regression \| fixed \| new \| removed \| still-failing \| stable`                                               |
| `RunDiffEntry`    | interface | `{ testId, name, change, before?, after?, durationDeltaMs? }`                                                     |
| `RunDiff`         | interface | `{ campaignId, baseRunId, targetRunId, summary: Record<DiffChange, number>, entries: RunDiffEntry[] }`            |

### `auth.ts` — roles & identity

| Export          | Kind      | Shape / Notes                                                                                   |
| ----------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `roles`           | const     | `['viewer', 'editor', 'admin']` (ascending privilege)                                               |
| `Role`            | type      | union of the above                                                                                   |
| `hasRole(userRoles, required)` | function | rank-based check (`viewer=0 < editor=1 < admin=2`); unknown role strings are ignored safely          |
| `AuthSource`      | type      | `oidc \| local`                                                                                      |
| `AuthMethods`     | interface | `{ oidc, password, oidcLoginUrl? }` — served by `GET /api/auth/methods`                             |
| `UserProfile`     | interface | `{ id, email, displayName, roles, authSource, active }`                                             |

### `adapter-manifest.ts` — declarative engine definitions

| Export                        | Kind       | Shape / Notes                                                                                                |
| -------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `engineValidationRulesSchema`    | Zod schema | `.strict()`: `requireExecutionCommand?: boolean`, `requireFileExtension?: string \| string[] \| null`             |
| `EngineValidationRules`          | type       | inferred                                                                                                            |
| `engineManifestEntrySchema`      | Zod schema | `.strict()`: `engine` (lowercase kebab-case regex `^[a-z][a-z0-9-]*$`, ≤64), `displayName`, `defaultImage`, `defaultJunitPath`, `defaultCommand?`, `validate?`, `deprecated?: {reason}` |
| `EngineManifestEntry`            | type       | inferred — pure-data mirror of `EngineAdapter`                                                                     |
| `adapterManifestSchema`         | Zod schema | `.strict()`: `{ apiVersion: 'tcs.io/v1', kind: 'AdapterManifest', engines: EngineManifestEntry[] }` (min 1)         |
| `AdapterManifest`                | type       | inferred top-level manifest shape                                                                                   |

---

## 4. packages/core

### Directory Structure

```text
packages/core/
├── package.json                 # deps: @tcs/shared-types, adm-zip, fast-glob,
│                                 #       fast-xml-parser, simple-git, yaml, zod
├── tsconfig.json
└── src/
    ├── index.ts                  # re-exports rules/engine, ingestion, discovery, adapters, junit
    │
    ├── ingestion/
    │   ├── index.ts              # fetchSource() — the single entry point
    │   ├── workspace.ts          # createWorkspace() — tmp dir + cleanup()
    │   ├── git.ts                # fetchGitSource() — shallow clone + token auth
    │   └── zip.ts                # extractZip() — zip-slip-safe extraction
    │
    ├── discovery/
    │   └── discover.ts           # discoverTests() — metadata-driven test discovery
    │
    ├── rules/
    │   └── engine.ts             # evaluateRule(), selectTests(), getProperty(), isPathUnder()
    │
    ├── adapters/
    │   ├── types.ts              # EngineAdapter interface, resolveExecution(), substitutePlaceholders()
    │   ├── registry.ts           # registerAdapter/installAdapter/getAdapter/listAdapters/...
    │   ├── manifest.ts           # parseAdapterManifest(), engineManifestEntryToAdapter()
    │   ├── fetch-manifest.ts     # fetchManifest() — HTTP download + size/timeout guard + sha256
    │   ├── index.ts              # registers the 7 built-in adapters at import time
    │   ├── robotframework.ts
    │   ├── cypress.ts
    │   ├── selenium.ts
    │   ├── protractor.ts         # deprecated
    │   ├── generic-java.ts
    │   ├── generic-node.ts
    │   └── generic-python.ts
    │
    └── junit/
        └── junit.ts              # parseJUnitXml(), reportOutcome(), buildMergedJUnitXml()
```

### 4.1 Ingestion (`ingestion/`)

`fetchSource(source: TestsSource, { workspaceBaseDir? })` is the single
entry point consumed by `apps/server` (run launch) and the `local`/`docker`
orchestration provider. It always materializes the tests into a fresh
temp workspace (`createWorkspace`, under `os.tmpdir()/tcs-workspaces` by
default) and returns `{ rootDir, cleanup }`.

| Source branch                           | Behavior                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `{type:'git', url, revision?, tokenSecretRef?}` | `fetchGitSource` — shallow clone (`--depth 1`, or `--depth 50` + `checkout <revision>`), then auto-extracts any top-level `*.zip`.           |
| `{type:'local', path}` pointing to a `.zip` | `extractZip` directly into the workspace.                                                                                                     |
| `{type:'local', path}` pointing to a directory | Recursive `cp` into the workspace (excludes `node_modules`) so discovery/execution never mutates the original tree, then top-level zip extraction. |

- **`git.ts`**: token resolution order is explicit `token` → `process.env[tokenSecretRef]` → `process.env.GIT_TOKEN`; injected into the clone URL as `oauth2:<token>@host` for HTTPS only (SSH relies on the ambient agent). Error messages are redacted (`redact()` replaces the token substring with `***`) so a thrown `GitIngestionError` never leaks the secret. Class: `GitIngestionError`.
- **`zip.ts`**: `extractZip(zipFile, targetDir)` resolves every entry's destination and throws `ZipExtractionError` if it would escape `targetDir` (zip-slip protection), before calling `AdmZip#extractAllTo`.
- **`workspace.ts`**: `createWorkspace(baseDir?)` → `mkdtemp` under `<base>/ws-*`; `cleanup()` is `rm(root, {recursive:true, force:true, maxRetries:3})`, safe to call twice.

### 4.2 Discovery (`discovery/discover.ts`)

`discoverTests(rootDir, { knownEngines? })` walks the source tree with
`fast-glob` and builds the list of executable tests **exclusively from
`<test>.metadata.json` files** (`METADATA_SUFFIX = '.metadata.json'`).  For
every metadata file found it:

1. Checks the adjacent test file exists → else `missing-metadata` issue.
2. Parses JSON → else `invalid-json` issue.
3. Validates against `testMetadataSchema` → else `invalid-metadata` issue (each Zod issue joined into the message).
4. Checks `metadata.engine` is in `knownEngines` (if provided) → else `unknown-engine` issue.
5. Builds a `DiscoveredTest` (`id` defaults to the test file's relative path).

Results are sorted by file path for determinism, then deduplicated by `id`
(`duplicate-id` issue on collision, first occurrence wins). As a secondary
pass, `LIKELY_TEST_FILE_PATTERNS` (`*.robot`, `*.cy.*`, `*.spec.*`,
`*.test.*`, `test_*.py`, `*_test.py`, `*Test.java`, `*IT.java`) flags
probable test files that have **no** adjacent metadata file as
`missing-metadata` issues too — purely advisory, discovery never aborts on
any issue. `IGNORED` always excludes `node_modules`, `.git`, `dist`,
`__pycache__`.

### 4.3 Rule Engine (`rules/engine.ts`)

Pure, synchronous evaluation of the `SelectionRule` tree from
`@tcs/shared-types` against a `DiscoveredTest`:

- `getProperty(obj, path)` — dot-path reader (`execution.image` etc.), returns `undefined` on any non-object hop.
- `evaluateCondition` reads the property from `test.metadata` **first**, falling back to the pseudo-properties `{id, name, engine, file}` from the `DiscoveredTest` itself if the metadata lookup is `undefined`.
- `evaluateOperator(actual, op, expected)` implements all 11 operators from `conditionOperators`; `gt/gte/lt/lte` only compare matching `number`/`string` pairs (`compareOrdered`, else `false`); `matches` builds a `RegExp` and returns `false` (never throws) on an invalid pattern; `in`/`nin` require `expected` to be an array.
- `isPathUnder(file, subtree)` — normalizes both paths (backslashes → `/`, strips leading `./` and trailing `/`) before a prefix/equality check; an empty `subtree` matches everything.
- `evaluateRule(test, rule)` — recursive: `all` → every child true, `any` → some child true, `not` → negation, `pathUnder` → `isPathUnder`, else a `PropertyCondition` via `evaluateCondition`.
- `selectTests(tests, rule)` — the public entry point (`Array.filter`).
- `parseRule(input)` — `selectionRuleSchema.parse(input)`, throws `ZodError` on invalid untrusted input (API payload / DB row).

### 4.4 Engine Adapters (`adapters/`)

#### The `EngineAdapter` contract (`types.ts`)

```ts
export interface EngineAdapter {
  readonly engine: string;              // id referenced by metadata.engine
  readonly displayName: string;
  readonly defaultImage: string;        // used unless execution.image is set
  readonly defaultJunitPath: string;    // used unless execution.junitPath is set
  readonly deprecated?: { reason: string };
  validate(test: DiscoveredTest): string[];           // [] = valid
  defaultCommand?(test: DiscoveredTest): string[];    // undefined => command required
}
```

`substitutePlaceholders(command, test)` replaces `{{testFile}}`/`{{testId}}`
in every command token. `resolveExecution(adapter, test)`:

1. Runs `adapter.validate(test)`.
2. Resolves `command = metadata.execution.command ?? adapter.defaultCommand?.(test)`; if still absent, appends an error.
3. Throws `AdapterValidationError(testId, errors)` if any error accumulated.
4. Otherwise returns a `ResolvedExecution` — metadata always overrides adapter defaults, `DEFAULT_TIMEOUT_SECONDS = 1800` when unset.

#### Built-in adapters (registered in `adapters/index.ts` at import time)

| Engine            | Default image                           | Default JUnit path                    | `validate`                                                     | `defaultCommand`                                                                                    |
| -------------------- | ---------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `robotframework`     | `ppodgorsek/robot-framework:latest`      | `results/junit.xml`                      | file must end in `.robot`                                          | `robot --outputdir results --xunit junit.xml {{testFile}}` (native JUnit output)                        |
| `cypress`            | `cypress/included:13.17.0`               | `results/junit.xml`                      | none                                                                | `npx cypress run --spec {{testFile}} --reporter junit --reporter-options mochaFile=results/junit.xml`   |
| `selenium`           | `selenium/standalone-chrome:latest`      | `results/junit.xml`                      | `execution.command` required (Selenium is a library, not a runner) | none — command is mandatory                                                                              |
| `protractor` (**deprecated**, EOL 2023) | `node:16-bullseye-slim`                  | `results/junit.xml`                      | none                                                                | `npx protractor {{testFile}}` (assumes `jasmine-reporters` configured)                                   |
| `generic-java`       | `maven:3.9-eclipse-temurin-21`           | `target/surefire-reports/TEST-*.xml`     | `execution.command` required                                       | none — command is mandatory                                                                              |
| `generic-node`       | `node:22-slim`                           | `results/junit.xml`                      | `execution.command` required                                       | none — command is mandatory                                                                              |
| `generic-python`     | `python:3.12-slim`                       | `results/junit.xml`                      | `execution.command` required                                       | none — command is mandatory                                                                              |

#### Registry (`registry.ts`)

Two parallel maps: `builtins` (populated once by `registerAdapter`, throws
if an engine id is registered twice) and `installed` (admin-managed,
instance-level manifest adapters — `installAdapter` **silently shadows**
any built-in or previously-installed engine of the same id;
`uninstallInstanceAdapters()` clears it wholesale before a full reload).
`getAdapter`/`requireAdapter` check `installed` before `builtins`.
`requireAdapterWithOverrides(engine, overrides)` additionally consults a
caller-supplied `ReadonlyMap` **first** — this is how a campaign's
`adapterManifestUrl` can override an engine for one run only, without ever
touching the shared registry (no cross-run leakage). `listAdapters()` /
`knownEngines()` merge both maps, built-ins first, sorted by engine id.

#### Declarative manifests (`manifest.ts`, `fetch-manifest.ts`)

- `parseAdapterManifest(raw: string)`: parses JSON **or** YAML (the `yaml` package parses both), validates against `adapterManifestSchema`, and maps each `EngineManifestEntry` through `engineManifestEntryToAdapter` into a real `EngineAdapter` — no code from the manifest is ever executed, only data. `validate()` on the resulting adapter checks `requireExecutionCommand` and/or `requireFileExtension` (string or string[]) from the entry's `validate` rules. Throws `AdapterManifestParseError` on any schema/YAML violation.
- `fetchManifest(url, timeoutMs = 10_000)`: `fetch` with `AbortSignal.timeout`, enforces `MAX_MANIFEST_BYTES = 1_000_000` via both the `content-length` header and the actual decoded size, then `parseAdapterManifest`. Returns `{ adapters, hash }` where `hash` is the sha256 (hex) of the raw content — used for audit/reproducibility (`AdapterManifest.lastHash` / `WorkflowRun.adapterManifestHash` in the DB, see technical.md). Shared verbatim by `apps/server` (instance + per-campaign manifests) and `apps/cli` (`--adapter-manifest`) — it lives in `core` rather than the server specifically so the CLI doesn't need Prisma. Throws `ManifestFetchError`.

### 4.5 JUnit utilities (`junit/junit.ts`)

- `parseJUnitXml(xml, defaultTestId = '')`: uses `fast-xml-parser` (`isArray` forced for `testsuite`/`testcase` so single-element reports still produce arrays). Collects every `<testcase>` across every `<testsuite>` into a flat `JUnitTestCase[]`; `caseOutcome` priority is `failure > error > skipped > passed`; `failureMessage` extracts `@_message` or `#text` from the first `failure`/`error` node. Returns totals (`total/passed/failed/errors/skipped/durationMs`) plus `cases`.
- `reportOutcome(report)`: single-test-node summary — `errors>0 → error`, else `failed>0 → failed`, else `skipped===total → skipped`, else `passed`.
- `buildMergedJUnitXml(parts: {testId, xml}[])`: re-parses each partial report (tagging it with its `testId`), rebuilds one `<testsuite name="<testId>">` per part with re-derived `@_tests/@_failures/@_errors/@_skipped/@_time` attributes and a `<testcase>` per case, wraps everything in a single `<testsuites>` with grand totals, and serializes with `fast-xml-parser`'s `XMLBuilder`. This is the exact function the `local`/`docker` provider calls for its aggregation step, and whose logic the Argo provider's embedded Python aggregation script reimplements for in-cluster execution (see §6).

---

## 5. packages/orchestration

### Directory Structure

```text
packages/orchestration/
├── package.json              # deps: @tcs/core, @tcs/shared-types
├── tsconfig.json
└── src/
    ├── index.ts               # registers 'local' and 'docker' factories
    ├── provider.ts            # OrchestrationProvider interface + registry
    └── local/
        ├── local-provider.ts  # LocalProvider — in-memory run/test state machine
        └── runtimes.ts        # ProcessRuntime / DockerRuntime (TestRuntime)
```

### 5.1 The `OrchestrationProvider` interface (`provider.ts`)

```ts
export interface RunSnapshot {
  run: RunStateEvent;
  tests: TestStateEvent[];
}

export interface ArtifactRef {
  name: string;
  key: string; // provider-relative locator (e.g. S3 key), resolved to a URL by the server
}

export interface OrchestrationProvider {
  readonly name: string;
  submit(spec: CampaignExecutionSpec): Promise<RunHandle>;
  watch(handle: RunHandle, onEvent: (e: OrchestrationEvent) => void, signal?: AbortSignal): Promise<void>;
  getState(handle: RunHandle): Promise<RunSnapshot>;
  retryFailed(handle: RunHandle, testIds?: string[]): Promise<RunHandle>; // never replays successes
  cancel(handle: RunHandle): Promise<void>;
  getLogs(handle: RunHandle, testId: string): Promise<string>;
  streamLogs?(handle: RunHandle, testId: string, onChunk: (c: string) => void, signal?: AbortSignal): Promise<void>;
  getArtifacts(handle: RunHandle): Promise<ArtifactRef[]>;
}
```

#### Factory registry

```ts
export type ProviderFactory = (config: Record<string, string | undefined>) => OrchestrationProvider;
export function registerProviderFactory(name: string, factory: ProviderFactory): void; // throws if name taken
export function listProviderNames(): string[];
export function createProvider(name: string, config = process.env): OrchestrationProvider;
```

A package registers itself purely as an **import side effect**
(`registerProviderFactory` call at module scope). `createProvider` looks the
factory up by name (typically the `ORCHESTRATION_PROVIDER` env var) and
throws listing the registered names if unknown.

### 5.2 `local`/`docker` providers (`index.ts`)

```ts
registerProviderFactory('local', (config) => new LocalProvider(config));
registerProviderFactory('docker', (config) => new LocalProvider(config, { name: 'docker', runtime: 'docker' }));
```

Both names resolve to the **same class**, `LocalProvider` — only the
`TestRuntime` differs (`runtimes.ts`).

### 5.3 `LocalProvider` (`local/local-provider.ts`)

A fully in-memory `OrchestrationProvider` keyed by `runId`, used for dev
without a cluster and for unit/integration tests. State per run
(`LocalRun`): `spec`, `phase`, timestamps, `tests: Map<testId, LocalTestState>`,
`listeners`/`logListeners` (event-emitter-style), and an `AbortController`
for cancellation.

- **`submit`**: registers the run, fires `execute()` in the background (not awaited), returns `{provider, externalId: runId}` immediately.
- **`execute`**: calls `@tcs/core`'s `fetchSource(spec.source, {workspaceBaseDir: LOCAL_PROVIDER_WORKSPACE_DIR})`, then runs tests through a worker pool sized `min(parallelism, queueLength)` (`Math.max(1, …)`). On completion: `cancelled` phase if aborted, else `failed` if any test isn't `succeeded`, else `succeeded`. **Aggregation always runs** — if `resultsCallbackUrl` is set, POSTs the merged JUnit exactly like the Argo aggregation node, and any callback failure flips the run to `error` (results are already safe elsewhere). Always calls `source.cleanup()` in a `finally`.
- **`runTest`**: gives every test its **own isolated copy** of the source tree (`cp` into `<workspace>/../nodes/<sanitized-testId>`) — mirrors Argo's one-pod-per-test isolation so concurrent tests can never clobber a shared `results/junit.xml`. Delegates to `this.runtime.run(...)`, then reads the JUnit file at `execution.junitPath` (relative to `workingDir` if set) — a missing file simply yields `junitXml: undefined` (synthesized later).
- **`watch`**: replays the current snapshot first (hydration), then resolves once a `run` event reaches a terminal phase or `signal` aborts.
- **`retryFailed`**: only valid once the run reached a terminal phase; resets the matching tests (`failed`/`timeout`/`cancelled`, optionally filtered by `testIds`) to `pending` and re-executes just those.
- **`mergeJUnit`**: delegates to `@tcs/core`'s `buildMergedJUnitXml`, synthesizing a minimal single-`<testcase>` report for any test with no `junitXml` captured.
- **`getMergedJUnit(handle)`**: extra method (not part of `OrchestrationProvider`) exposed for the CLI and tests to read the aggregated report directly, since there's no S3/cluster to fetch it from.

### 5.4 Execution runtimes (`local/runtimes.ts`)

```ts
export interface ExecutionOutcome { code: number | null; timedOut: boolean }
export interface TestRuntime {
  readonly name: 'process' | 'docker';
  run(test: TestExecutionSnapshot, nodeDir: string, onOutput: (chunk: string) => void, signal: AbortSignal): Promise<ExecutionOutcome>;
}
export function createRuntime(name: 'process' | 'docker', dockerBin?: string): TestRuntime;
```

| Runtime         | Class            | Behavior                                                                                                                                                                      |
| ----------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `process` (default) | `ProcessRuntime`  | `child_process.spawn(cmd, args, {cwd, env: {...process.env, ...execution.env}, signal})`; a `setTimeout` matching `timeoutSeconds` kills the child and reports `timedOut`. |
| `docker`           | `DockerRuntime`   | Builds a full `docker run --rm --name <generated> -v <nodeDir>:/workspace -w <workdir> [-e K=V ...] [--cpus ...] [--memory ...] <image> <command>` via `buildDockerRunArgs`. On timeout/abort, explicitly `docker kill <container>` (SIGTERM alone doesn't reach a `docker run` client reliably). Exit code `125` is flagged specially (daemon/image error). |

Helpers: `toDockerCpus('500m') → '0.5'`, `toDockerCpus('2') → '2'`;
`toDockerMemory('1Gi') → '1g'`, `('512Mi') → '512m'`. `buildDockerRunArgs` is
exported standalone so tests (and potentially other tooling) can assert on
the exact argv without spawning a real container.

---

## 6. packages/orchestration-argo

### Directory Structure

```text
packages/orchestration-argo/
├── package.json                 # deps: @kubernetes/client-node, @tcs/orchestration,
│                                 #       @tcs/shared-types, yaml
├── tsconfig.json
└── src/
    ├── index.ts                  # registers the 'argo' factory
    ├── config.ts                 # ArgoProviderConfig + argoConfigFromEnv()
    ├── naming.ts                 # deterministic names + label/annotation constants
    ├── step-templates.ts         # generated + hand-written WorkflowTemplate resolution
    ├── workflow-builder.ts       # buildWorkflow() — the run Workflow CRD + aggregation script
    └── provider.ts               # ArgoProvider — the OrchestrationProvider implementation
```

### 6.1 Configuration (`config.ts`)

```ts
export interface ArgoProviderConfig {
  namespace: string;
  serviceAccountName?: string;
  argoServerUrl?: string;     // required for targeted retry
  argoServerToken?: string;
  manualStepsDir: string;     // hand-written step-<engine>.yaml lookup dir
  gitSecretName?: string;     // k8s Secret (key "token") for the fetch-source step
  artifactPrefix: string;     // S3 prefix (bucket comes from Argo's artifact repository config)
}
```

`argoConfigFromEnv(env)` reads `K8S_NAMESPACE` (default `argo`),
`ARGO_SERVICE_ACCOUNT` (default `testcampaignshooter`), `ARGO_SERVER_URL`,
`ARGO_SERVER_TOKEN`, `ARGO_MANUAL_STEPS_DIR` (default `deploy/argo/steps`),
`ARGO_GIT_SECRET_NAME`, `ARGO_ARTIFACT_PREFIX` (default `tcs-runs`).

### 6.2 Deterministic naming (`naming.ts`)

| Function                 | Format                                                                                    | Purpose                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `testNodeName(testId)`      | `t-<sanitized-32char-slug->-<sha256-8hex>` (slug may be empty → `t-<hash>`)                   | stable DAG task name → `displayName=` targeted retry, node↔testId mapping |
| `workflowName(runId)`       | `tcs-run-<sanitized-40char-slug>`                                                            | Workflow CRD name                                                        |
| `stepTemplateName(engine)`  | `tcs-step-<lowercased-engine>`                                                               | per-engine `WorkflowTemplate` name                                       |

Constants: `TEST_MAP_ANNOTATION = 'testcampaignshooter.io/test-map'` (JSON
`{taskName: testId}` stashed on the Workflow so the watcher can map Argo
nodes back to tests), `RUN_ID_LABEL`, `CAMPAIGN_ID_LABEL`, `ENGINE_LABEL`,
`PART_OF_LABEL`/`PART_OF_VALUE` (`app.kubernetes.io/part-of: testcampaignshooter`).
The sha8 suffix exists specifically so two different `testId`s whose slugs
collapse to the same sanitized string still get distinct, deterministic node
names.

### 6.3 Step templates (`step-templates.ts`)

`generateEngineStepTemplate(engine)` builds a `WorkflowTemplate` manifest
with one `run-test` template:

- **inputs.parameters**: `test-id`, `test-file`, `image`, `command` (one shell line), `junit-path`, `timeout-seconds` (default `'1800'`).
- **inputs.artifacts**: `source` → mounted at `/workspace`.
- **container**: `image={{inputs.parameters.image}}`, `workingDir: /workspace`, `command: [/bin/sh, -c]`, `args: ['{{inputs.parameters.command}}']`, `activeDeadlineSeconds: '{{inputs.parameters.timeout-seconds}}'`.
- **outputs.artifacts**: `junit` → `{{workflow.parameters.artifact-prefix}}/partials/{{inputs.parameters.test-id}}.xml`, `optional: true`, `archive: {none: {}}` (raw file, not tarred).

`loadManualStepTemplates(dir)` reads every `step-<engine>.yaml` file in
`dir` (convention-based discovery; a missing directory just yields an empty
map), parses it as YAML, and requires `kind: WorkflowTemplate` or throws.
`resolveStepTemplates(engines, manualStepsDir)` returns one resolved
`Manifest` per **unique, sorted** engine — a manual file always takes
precedence over the generated default for that engine, letting an operator
drop `deploy/argo/steps/step-<engine>.yaml` to override behavior without
touching any code.

### 6.4 Workflow generation (`workflow-builder.ts`)

`buildWorkflow(spec: CampaignExecutionSpec, config: ArgoProviderConfig):
{ manifest, testMap }` assembles the full run `Workflow` CRD:

1. **`fetch-source` template**: a `container` running `alpine/git:latest` with an inline shell script (`fetchSourceShell`) — `git clone --depth 50 <url>` (+ `checkout <revision>` if set), token injected via `sed` substitution from `$GIT_TOKEN` (sourced from the `gitSecretName` Secret, `optional: true`), then a loop auto-extracting any top-level `*.zip` with `unzip`. **Throws** if `spec.source.type !== 'git'` — the Argo provider cannot reach a path on the submitting machine, only the `local`/`docker` providers support a `local` source.
2. **One DAG task per test**: `templateRef: {name: stepTemplateName(engine), template: 'run-test'}`, `depends: 'fetch-source'`, arguments built from the resolved `TestExecutionSnapshot` (`buildCommandLine` renders `execution.env`/`workingDir`/`command` into one shell-quoted line via `shellQuote`), artifact `source` wired from `{{tasks.fetch-source.outputs.artifacts.source}}`. Each task's name is the deterministic `testNodeName(testId)`, recorded into `testMap`.
3. **`aggregate` task**: `depends` on **every** test task being in *any* terminal state (`Succeeded||Failed||Errored||Skipped||Omitted` per task, AND-joined) — so the DAG's `failFast: false` combined with this depends-expression guarantees aggregation always runs regardless of individual test outcomes. Its `script` template (`python:3.12-alpine`) runs `AGGREGATE_SCRIPT` inline: reads every `/partials/<testId>.xml` (mounted from S3 via `inputs.artifacts.partials`), merges them into one `<testsuites>` with `xml.etree.ElementTree`, writes `/tmp/junit.xml`, and — if `CALLBACK_URL` env is set — POSTs it to the server with `X-Tcs-Run-Id` / `X-Tcs-Token` headers via `urllib.request`. Output artifact `junit` is pushed to S3 at `<artifactPrefix>/<runId>/junit.xml`.
4. **Workflow-level**: `entrypoint: main`, `spec.parallelism = spec.parallelism` (fan-out throttle), optional `serviceAccountName`, labels `part-of`/`run-id`/`campaign-id`, annotation carrying the JSON `testMap`.

`buildCommandLine(test)` and the aggregation Python source both reimplement
(in their respective runtimes) the same merge semantics as `@tcs/core`'s
`buildMergedJUnitXml` — necessarily duplicated because the aggregation step
runs **inside the cluster**, with no access to the Node.js `core` package.

### 6.5 `ArgoProvider` (`provider.ts`)

Implements `OrchestrationProvider` using `@kubernetes/client-node`
(`CustomObjectsApi` for the `argoproj.io/v1alpha1` `workflows` /
`workflowtemplates` CRDs, `CoreV1Api` + `Log` for pod logs). `KubeConfig`
is loaded via `loadFromDefault()` (in-cluster service account or local
kubeconfig).

| Method              | Behavior                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submit`              | `resolveStepTemplates` → `upsertWorkflowTemplate` each (create, on `409` conflict `get` + `replace` with the existing `resourceVersion`) → `buildWorkflow` → `createNamespacedCustomObject` (`workflows`). Returns `{provider:'argo', externalId: workflowName, namespace}`. |
| `watch`               | Loops a `k8s.Watch` on `/apis/argoproj.io/v1alpha1/namespaces/<ns>/workflows` filtered by `fieldSelector metadata.name=<id>`; maps every update through `workflowEvents`; on terminal `run` phase, stops. On watch disconnect (not finished), re-syncs once via `getState` (covers a missed terminal event) then re-establishes the watch after a 2s backoff — **reconnect + resync** semantics. |
| `getState`            | One-shot `getNamespacedCustomObject` → `workflowEvents(wf)`.                                                                                                                                                                 |
| `retryFailed`         | Requires `argoServerUrl` (throws otherwise — this calls the **Argo Server HTTP API**, not the K8s API, because retry/resubmit isn't a CRD operation). `PUT /api/v1/workflows/{ns}/{name}/retry`, `restartSuccessful:false`; a **single** `testIds` entry adds `nodeFieldSelector=displayName=<taskName>` (Argo field selectors are AND-only, so multiple ids fall back to "retry every failed node", which still never replays successes). |
| `cancel`              | `patchNamespacedCustomObject` setting `spec.shutdown: 'Stop'`.                                                                                                                                                                |
| `getLogs`             | Finds the pod backing the test's latest node (`findTestPod`), `coreApi.readNamespacedPodLog({container:'main'})`.                                                                                                             |
| `streamLogs`          | Same pod lookup, then `k8s.Log#log(..., {follow:true})` piped through a `PassThrough` stream, chunks forwarded to `onChunk`; aborts the controller on `signal`.                                                              |
| `getArtifacts`        | Derives `runId` from the `RUN_ID_LABEL`, returns the aggregated `junit.xml` plus one entry per `partials/<testId>.xml` from the stored `testMap`.                                                                           |

Internal mapping helpers: `mapTestStatus(node)` (`Pending→pending`,
`Running→running`, `Succeeded→succeeded`, `Failed|Error→failed` unless the
message matches `/deadline|timeout/i` → `timeout`, `Omitted|Skipped→cancelled`,
else `pending`); `mapRunPhase(wf)` (`Succeeded→succeeded`, `Failed→cancelled`
if `spec.shutdown` is `Stop`/`Terminate` else `failed`, `Error→error`,
`Running→running`, else `pending`); `workflowEvents(wf)` rebuilds the full
`TestStateEvent[]` + one `RunStateEvent` from `wf.status.nodes` (matched to
tests via `displayName` + the `testMap` annotation) — this is what both
`watch` and `getState` ultimately emit, so the server and portal only ever
see the neutral `OrchestrationEvent` shape, never a raw Argo node.
`findTestPod` filters pods by the `workflows.argoproj.io/workflow` label and
the `workflows.argoproj.io/node-name` annotation, taking the most recently
created match (handles retried nodes).

---

## 7. Extension Guides

### 7.1 Adding a built-in engine adapter (`@tcs/core`)

1. Create `packages/core/src/adapters/<engine>.ts` exporting a `const
   xAdapter: EngineAdapter` (see the 7 existing files in §4.4 for the two
   recurring shapes: "ships a working default command" vs. "command is
   mandatory, declare only `validate`").
2. Register it with one line in `packages/core/src/adapters/index.ts`:
   import it, add it to the `for (const adapter of [...])` array (calls
   `registerAdapter`), and re-export it from the same file.
3. Nothing else changes — `discoverTests`'s `knownEngines` check, the rule
   engine, the Argo step-template generator (keyed by `engine` string) and
   the CLI/portal's `GET /api/engines` listing all pick it up immediately
   because they all go through `listAdapters()`/`getAdapter()`.
4. No manifest/no-code alternative: ship an `AdapterManifest` (JSON/YAML,
   `apiVersion: tcs.io/v1`) and have an admin register its URL — see
   `adapter-manifest.ts` (§3) and `fetch-manifest.ts`/`manifest.ts` (§4.4).
   This never requires a redeploy, but the validation surface is limited to
   `requireExecutionCommand`/`requireFileExtension` (no custom `validate`
   logic).

### 7.2 Adding an orchestration provider

1. New package `packages/orchestration-<tech>` (own `package.json`,
   `tsconfig.json`), depending on `@tcs/orchestration` and
   `@tcs/shared-types` (and whatever client library the target system
   needs — e.g. `@kubernetes/client-node` for `orchestration-argo`; this
   dependency must stay confined to the new package).
2. Implement a class satisfying `OrchestrationProvider` (§5.1) —
   `ArgoProvider` (§6.5) and `LocalProvider` (§5.3, ~300 lines, in-memory)
   are the two reference implementations.
3. At the package's `index.ts` **import time**, call
   `registerProviderFactory('<tech>', (env) => new MyProvider(env))` —
   mirror `orchestration-argo/src/index.ts`.
4. Import the new package once, for its side effect, wherever the app
   bootstraps providers (`apps/server/src/app.ts` today imports
   `@tcs/orchestration-argo` for exactly this reason).
5. Selection is then purely by configuration: `ORCHESTRATION_PROVIDER=<tech>`
   — no code elsewhere changes. Every type the new provider exchanges with
   the rest of the system must stay inside `@tcs/shared-types`'s neutral
   vocabulary (`RunHandle`, `OrchestrationEvent`, `RunSnapshot`,
   `ArtifactRef`) — never leak a provider-specific type across the
   interface boundary.

---

## 8. Testing

All four packages use Vitest with `*.test.ts` files colocated next to the
module they cover (no separate `tests/` tree) — part of the root `pnpm test`
run (`vitest.config.ts`), DB-less and cluster-less.

| Package                   | Test files                                                                                                   | Coverage focus                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@tcs/core`                 | `rules/engine.test.ts`, `discovery/discover.test.ts`, `ingestion/{index,workspace,zip}.test.ts`, `adapters/{adapters,manifest,fetch-manifest,registry}.test.ts`, `junit/junit.test.ts` | rule evaluation incl. edge operators, discovery issue kinds, ingestion (incl. zip-slip rejection), every built-in adapter's `validate`/`defaultCommand`, manifest parsing/fetch guards, registry override/shadowing semantics, JUnit parse/merge round-trips |
| `@tcs/orchestration`        | `provider.test.ts`, `local/local-provider.test.ts`, `local/runtimes.test.ts`                                       | factory registry (duplicate/unknown provider errors), full `LocalProvider` lifecycle (submit/watch/retry/cancel/logs), `buildDockerRunArgs`/unit conversions |
| `@tcs/orchestration-argo`   | `naming.test.ts`, `config.test.ts`, `step-templates.test.ts`, `workflow-builder.test.ts`                           | deterministic name generation/collision handling, env parsing/defaults, manual-vs-generated template precedence, full `Workflow` manifest shape (DAG deps, aggregation `depends` expression, command-line shell-quoting) |
| `@tcs/shared-types`         | *(none — pure types/schemas, exercised indirectly through every consumer's tests)*                                 | —                                                                                                     |

Notably absent: no test spins up a real Kubernetes cluster or Argo Server —
`ArgoProvider`'s live-cluster behavior (`submit`/`watch`/`retryFailed`
against a real API server) is exercised only indirectly, through the
builder/naming/config unit tests plus the server's own integration suite
and manual/staging verification (see `deploy/kind`).

---

## 9. Appendix: Key Design Patterns

| Pattern                              | Where                                               | Purpose                                                                                      |
| --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **Neutral type boundary**               | `@tcs/shared-types`                                    | No provider/runtime type ever crosses a package boundary; swapping providers touches nothing else |
| **Factory registry + side-effect registration** | `orchestration/provider.ts`, `orchestration-argo/index.ts`, `core/adapters/index.ts` | New providers/adapters/engines plug in via one import + one register call, no central switch statement |
| **Declarative extensibility (data, not code)** | `adapter-manifest.ts`, `core/adapters/manifest.ts`      | Remote adapter manifests extend engines at runtime without ever executing downloaded code         |
| **Metadata-over-defaults resolution**   | `adapters/types.ts` (`resolveExecution`)                | Per-test `execution.*` always overrides the adapter's compiled-in defaults, never the reverse      |
| **Deterministic identity**              | `orchestration-argo/naming.ts`                          | Stable, collision-resistant node/workflow names enable targeted retry and node↔test correlation    |
| **Shadow-map override scoping**         | `core/adapters/registry.ts` (`requireAdapterWithOverrides`) | Per-run engine overrides never mutate global registry state — safe under concurrent runs           |
| **Isolated per-test workspace**         | `LocalProvider.runTest`, Argo's one-pod-per-test tasks  | No two tests can clobber a shared output path (e.g. `results/junit.xml`)                           |
| **Always-run aggregation**              | `LocalProvider.execute`, Argo's `aggregate` depends expression | Results are collected and the server notified regardless of individual test outcomes               |
| **Reconnect + resync watch**            | `ArgoProvider.watch`                                    | Tolerates watch-connection drops without losing or duplicating terminal state                       |
| **Runtime-pluggable execution**         | `orchestration/local/runtimes.ts` (`TestRuntime`)       | `local`/`docker` providers share 100% of state-machine logic, differing only in how a command runs |
| **Fetch guard (timeout + size cap)**    | `core/adapters/fetch-manifest.ts`                       | A slow/huge remote manifest can never hang a run launch, server boot, or CLI call                   |
