# Engine adapters via manifest

> **Status: implemented** — instance-level manifests (admin, portal + API),
> per-campaign manifests (portal + API), and the CLI's `--adapter-manifest`
> flag are all in place. This document describes the design and doubles as
> the reference.

## 1. Motivation

Today, adding a test engine ("engine") requires writing a TypeScript file
(`packages/core/src/adapters/<engine>.ts`), registering it in
`adapters/index.ts`, and **recompiling/redeploying** the server (see
technical.md §"Adding a test engine" guide). That's fine for generic engines
maintained by the platform team, but it doesn't let:

- an administrator add an in-house engine without going through a release;
- a **campaign** point at a different image/command (e.g. a newer Cypress
  version, a team-internal runner) without affecting other campaigns.

The idea: externalize an adapter's definition into a declarative
**manifest** (JSON/YAML), downloadable from a URL, at two levels — instance
(admin) and campaign — without touching any provider code.

## 2. Why the existing architecture is already a good fit

Three elements of the current architecture make this extension natural
rather than requiring a rewrite:

1. **The `ResolvedExecution` contract is already provider-neutral**
   (`packages/shared-types/src/orchestration.ts`): `{ image, command,
junitPath, timeoutSeconds, env, resources, workingDir }`. `local`
   (process/docker) and `argo` all three consume this same structure — a
   new adapter has **nothing provider-specific to write**.
2. **The logic of the 7 existing adapters is already near-declarative**:
   `validate()` boils down to two cases (" `execution.command` required"
   for generic-node/selenium/generic-java/generic-python, "file extension
   required" for robotframework) or no rule at all (cypress, protractor).
   No current adapter needs to run arbitrary logic — a purely data-driven
   manifest (no downloaded code) reproduces them 100%.
3. **Argo already has a dynamic override mechanism with no rebuild**:
   `deploy/argo/steps/step-<engine>.yaml`, loaded at runtime
   (`loadManualStepTemplates`), which **takes precedence** over the
   generated template. The design below generalizes that same precedence
   idea to every provider, at the adapter level rather than just the Argo
   template.

## 3. Manifest schema (v1, purely declarative)

```yaml
apiVersion: tcs.io/v1
kind: AdapterManifest
engines:
  - engine: playwright
    displayName: Playwright (Node)
    defaultImage: mcr.microsoft.com/playwright:v1.48.0-noble
    defaultJunitPath: results/junit.xml
    defaultCommand: [npx, playwright, test, '{{testFile}}', --reporter=junit]
    validate:
      requireExecutionCommand: false
      requireFileExtension: null
    deprecated: null
```

`validate` fields (cover all 7 current adapters, no exceptions):

| Rule                                         | Effect                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `requireExecutionCommand: true`              | Error if `metadata.execution.command` is absent (equivalent to not providing `defaultCommand`) |
| `requireFileExtension: ".robot"` (or a list) | Error if the test file doesn't have the expected extension                                     |
| no rule                                      | Always valid (equivalent to `validate() { return [] }`)                                        |

No downloaded code is ever executed: the manifest is parsed and validated
against a **Zod** schema (`packages/shared-types`, same convention as the
rest of the project), then turned into `EngineAdapter[]` by a pure function
(`packages/core`), symmetric to the existing `resolveExecution`.

## 4. Two resolution levels

|             | **Instance** level (admin)                                    | **Campaign** level                                                                        |
| ----------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Trigger     | At server boot + on-demand admin reload                       | Resolved once, at **run creation**                                                        |
| Reference   | `AdapterManifest` table (URL, enabled, last fetch)            | `Campaign.adapterManifestUrl` field (optional)                                            |
| Persistence | Database — survives restarts, reloadable without a redeploy   | Frozen on the run (`Run.adapterManifestUrl` + hash) — never re-fetched afterwards         |
| Scope       | Extends/overrides the **global registry** (`registerAdapter`) | Can define a **new** engine or **override** an existing one, scoped to that campaign only |
| RBAC        | `admin`                                                       | `admin` (see §8 — even though the rest of the campaign is editable by `editor`)           |

**Resolution precedence** (highest to lowest priority):

```
campaign manifest  >  installed instance manifests  >  compiled built-in adapters
```

Same logic as the precedence already in place between a manual
`step-<engine>.yaml` and the generated Argo template (technical.md §guide).

## 5. Resolution flow at run creation

Extends the existing call `resolveExecution(requireAdapter(test.engine),
test)` in `apps/server/src/services/run-service.ts`:

1. If `campaign.adapterManifestUrl` is set: `fetchManifest` (10s timeout +
   1 MB size cap, `apps/server/src/services/adapter-manifests.ts`)
   downloads, parses (Zod) and hashes (sha256) the manifest. A failure
   fails the run launch (HTTP 422) rather than silently falling back to the
   instance/built-in defaults — a campaign that names a manifest must get
   _exactly_ that manifest.
2. The manifest's engines go into a **`Map` local to that call**
   (`requireAdapterWithOverrides`, `packages/core/src/adapters/registry.ts`)
   — the global registry (built-in + instance manifests) is **never
   mutated** by a campaign resolution, so two concurrent runs from
   different campaigns can't step on each other.
3. Each test is resolved through this overrides map (falling back to the
   global registry if the engine isn't in it) — `resolveExecution` doesn't
   change, only the source of the `EngineAdapter` does.
4. `TestExecutionSnapshot.execution` stays frozen exactly as it does today
   (no schema change on that type); in addition, the `WorkflowRun` stores
   `adapterManifestUrl` + `adapterManifestHash` — traceability of _which
   version_ of the manifest produced this run, without depending on the
   URL's future availability. A **replay** reuses these same values as-is
   (the snapshot is already frozen, no resolution happens again).

At the instance level, an admin reload does the opposite: it **mutates**
the global registry persistently (`AdapterManifestService.reloadAll` —
`uninstallInstanceAdapters` then re-`installAdapter` for every enabled
manifest), logging a warning if an installed engine shadows a built-in or
another manifest.

## 6. Data model (Prisma)

New additions, in the spirit of the existing models (`Campaign`,
`WorkflowRun` — see technical.md §Database schema):

- **`AdapterManifest`** (new): `id`, `url` (unique), `enabled` (bool),
  `addedBy → User`, `lastFetchedAt`, `lastHash`, `lastError?`, `createdAt`.
  Managed by an admin via the portal/API — CRUD + a "reload" action.
- **`Campaign.adapterManifestUrl`** (new, optional field).
- **`WorkflowRun.adapterManifestUrl` / `.adapterManifestHash`** (new,
  optional fields) — captured once at creation, never modified afterwards.

## 7. Surfaces (API, portal, CLI)

- `GET/POST/DELETE /api/admin/adapter-manifests` (`admin` role) — list/add/
  remove instance manifests.
- `POST /api/admin/adapter-manifests/reload` (`admin` role) — refetch +
  rebuild the in-memory registry, no restart needed.
- `GET /api/engines` (existing) — extended to report each engine's origin
  (`built-in` / the instance manifest URL that provided it).
- `POST/PUT /campaigns/:id` — accepts `adapterManifestUrl`, but
  **restricted to `admin`** (see §8) even though the rest of the payload
  stays editable by `editor`.
- **Portal**: an admin-only "Manifests" page
  (`/admin/adapter-manifests` — list/add/remove/reload instance manifests)
  and an admin-gated "Adapter manifest" field on the campaign form.
- **CLI**: `--adapter-manifest <url>` on `discover`/`preview`/`run`/
  `engines` — installs the manifest's adapters into that one invocation's
  process-wide registry (safe: each CLI run is a fresh, single-shot
  process, unlike the server).

## 8. Security posture

- **Purely declarative manifest**: no downloaded code is executed, so
  there's no JS/WASM sandbox to build or audit.
- **The `local` (process) provider stays allowed** for a manifest-provided
  engine — an accepted choice: a command defined by a remote manifest can
  therefore run directly on the server host if
  `ORCHESTRATION_PROVIDER=local` + `LOCAL_PROVIDER_RUNTIME=process`. This
  is why **managing manifests (instance-level, or attaching one to a
  campaign) is restricted to the `admin` role** — an `editor` can always
  create/edit a campaign, but not attach a manifest to it.
- No additional restriction on the `docker`/`argo` side: that's already
  today's trust model (a test's `execution.image`, whether it comes from a
  built-in adapter or a manifest, runs in an isolated container —
  unchanged).

## 9. Resolved vs. remaining

Resolved (see §5/§8): redefining a built-in is allowed, with a warning;
10s fetch timeout + 1 MB cap (double-checked — the `content-length` header
and the actual body size, to catch a lying header); `apiVersion` versioned
from v1 (`tcs.io/v1`, otherwise rejected by the Zod schema); portal admin
screen and CLI flag (originally listed here as remaining work — now done,
see §7).

Nothing outstanding at this time; possible future work would be a UI
toggle for `AdapterManifest.enabled` (currently only add/remove/reload are
exposed) if the need arises.

## 10. Files

- `packages/shared-types/src/adapter-manifest.ts` — Zod schemas.
- `packages/core/src/adapters/manifest.ts` — parsing + conversion to `EngineAdapter`.
- `packages/core/src/adapters/fetch-manifest.ts` — download (timeout/size cap/hash), shared by the server and the CLI.
- `packages/core/src/adapters/registry.ts` — built-in/installed tiers +
  `requireAdapterWithOverrides`.
- `apps/server/src/services/adapter-manifests.ts` — `AdapterManifestService`
  (instance level: add/remove/reload/loadAll).
- `apps/server/src/services/run-service.ts` — per-campaign resolution in `launch()`.
- `apps/server/src/routes/admin.ts` — CRUD + reload (`admin` role).
- `apps/portal/src/app/admin/adapter-manifests/page.tsx` — instance manifests admin page.
- `apps/portal/src/components/campaign-form.tsx` — per-campaign field (admin-gated).
- `apps/cli/src/index.ts` — `--adapter-manifest` flag.
- `apps/server/prisma/migrations/20260721150000_adapter_manifests/` — migration
  (hand-written, **not applied/tested against a real Postgres** in the
  session that authored it — verified only via `prisma validate`/`generate`;
  the `codegen` CI job — `.github/workflows/ci-node.yml` — replays it
  against an ephemeral Postgres on every push).
