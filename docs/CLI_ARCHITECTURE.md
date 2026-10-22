# TestCampaignShooter CLI Architecture

Comprehensive documentation of `apps/cli`: the `tcs` command-line tool for discovering tests and running campaigns locally, without the server/portal/Argo stack.

> **Scope:** this document maps `apps/cli` exhaustively (every file, command, flag). It does not replace [architecture.md](architecture.md) or [technical.md](technical.md), and it does not re-document the internals of the packages the CLI consumes — see [SHARED_PACKAGES_ARCHITECTURE.md](SHARED_PACKAGES_ARCHITECTURE.md) for `@tcs/core` / `@tcs/orchestration` / `@tcs/shared-types` internals. The CLI makes no HTTP call to `apps/server`: it is a fully standalone, single-process tool.

---

## Table of Contents

1. [Overview](#1-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Directory Structure](#3-directory-structure)
4. [Command Reference](#4-command-reference)
5. [Execution Lifecycle](#5-execution-lifecycle)
6. [Integration with Shared Packages](#6-integration-with-shared-packages)
7. [Error Handling & Exit Codes](#7-error-handling--exit-codes)
8. [Build & Tooling](#8-build--tooling)
9. [Testing](#9-testing)
10. [Appendix: Key Design Patterns](#10-appendix-key-design-patterns)

---

## 1. Overview

| Property             | Value                                                            |
| --------------------- | ----------------------------------------------------------------- |
| **Package name**     | `@tcs/cli`                                                       |
| **Bin name**         | `tcs`                                                             |
| **Language**         | TypeScript (ESM, `"type": "module"`)                              |
| **Runtime**          | Node.js, sources run directly via `tsx` (no build/compile step)   |
| **CLI framework**    | `commander` ^13.1.0                                               |
| **Workspace deps**   | `@tcs/core`, `@tcs/orchestration`, `@tcs/shared-types` (all `workspace:*`) |
| **Dev deps**         | `typescript` ^5.8.0, `@types/node` ^22.15.0                       |
| **Test framework**   | Vitest (`lib.test.ts`, `program.test.ts`)                          |
| **Entry point**      | `bin/tcs.mjs` → registers `tsx/esm/api` → imports `src/index.ts`   |
| **Subcommands**      | `discover`, `preview`, `run`, `engines` (4, verified against `program.ts`) |

The CLI is the only entry point in the monorepo that runs tests **without** going through the Fastify server, PostgreSQL, S3, or Kubernetes/Argo. It talks directly to `@tcs/core` (ingestion, discovery, rule evaluation, adapters) and to `@tcs/orchestration`'s `LocalProvider` (host-process or `docker run` execution) — the exact same `OrchestrationProvider` contract and `LocalProvider` implementation the server uses for its `local`/`docker` providers (see [technical.md §"Provided providers"](technical.md)). This is the dev/debug path; the scalable production path (Argo, one pod per test) is server/portal-driven only.

---

## 2. High-Level Architecture

```text
┌───────────────────────────────────────────────────────────────────┐
│                         Terminal (tcs <command>)                   │
└───────────────────────────────┬─────────────────────────────────── ┘
                                 │
                                 v
                   ┌─────────────────────────┐
                   │   bin/tcs.mjs            │  registers tsx/esm/api,
                   │   (shebang entry point)  │  imports src/index.ts
                   └────────────┬─────────────┘
                                 │
                                 v
                   ┌─────────────────────────┐
                   │   src/index.ts           │  createProgram().parseAsync(process.argv)
                   └────────────┬─────────────┘
                                 │
                                 v
                   ┌─────────────────────────┐
                   │   src/program.ts         │  commander Command tree:
                   │   (commander wiring)     │  discover / preview / run / engines
                   └──────┬───────┬───────┬────┘
                          │       │       │
         ┌────────────────┘       │       └─────────────────┐
         v                        v                         v
┌─────────────────┐    ┌───────────────────┐    ┌─────────────────────┐
│  src/lib.ts      │    │   @tcs/core        │    │  @tcs/orchestration  │
│  toSource()      │    │  fetchSource       │    │  LocalProvider        │
│  loadRule()      │    │  discoverTests     │    │  (host process or     │
└─────────────────┘    │  selectTests       │    │   `docker run` per     │
                        │  resolveExecution  │    │   test, same contract  │
                        │  fetchManifest /   │    │   as the Argo provider)│
                        │  installAdapter /  │    └──────────┬────────────┘
                        │  knownEngines /    │               │
                        │  requireAdapter    │               v
                        └─────────┬──────────┘    ┌─────────────────────┐
                                  │                │ Filesystem / git /   │
                                  v                │ Docker daemon        │
                        ┌─────────────────────┐    └─────────────────────┘
                        │ Filesystem / git     │
                        │ remote (clone/zip)   │
                        └─────────────────────┘
```

No network call to `apps/server` exists anywhere in `apps/cli`'s source — grepping the package turns up no `fetch`/`axios`/`http` call targeting the API. `fetchManifest` (adapter manifests) is the only outbound HTTP the CLI performs, and it talks to whatever manifest URL the user passes with `--adapter-manifest`, not to the TestCampaignShooter server.

---

## 3. Directory Structure

```text
apps/cli/
├── package.json            # name "@tcs/cli", bin "tcs" -> ./bin/tcs.mjs, workspace deps
├── tsconfig.json            # extends ../../tsconfig.base.json, types: ["node"], include: ["src"]
│
├── bin/
│   └── tcs.mjs              # shebang (#!/usr/bin/env node); registers tsx/esm/api,
│                            # then dynamically imports ../src/index.ts (no compiled JS is shipped)
│
└── src/
    ├── index.ts             # await createProgram().parseAsync(process.argv) — the only statement
    ├── index.test.ts        # (none present — index.ts has no dedicated test file; covered indirectly
    │                        #  via program.test.ts, which calls createProgram() directly)
    ├── program.ts            # commander Command tree: defines discover / preview / run / engines,
    │                         #  their flags, and the action handlers that call @tcs/core and
    │                         #  @tcs/orchestration
    ├── program.test.ts       # Vitest: subcommand registration + behavior against a temp fixture
    │                         #  source tree (discover/preview output, --json, --path)
    ├── lib.ts                # toSource(): URL/path -> TestsSource; loadRule(): --rule/--rule-file/
    │                         #  --path -> SelectionRule (via @tcs/core's parseRule)
    └── lib.test.ts           # Vitest: toSource() URL-vs-local-path detection, loadRule() precedence
                               #  and validation-failure behavior
```

Only 4 non-test source files (`bin/tcs.mjs`, `src/index.ts`, `src/program.ts`, `src/lib.ts`); the package has no `dist/` output and no build step beyond type-checking (see [§8](#8-build--tooling)).

---

## 4. Command Reference

All commands are defined in `program.ts` via `createProgram()`, which builds a **fresh** `commander.Command('tcs')` instance per call — deliberately, so repeated `parseAsync` calls (each CLI test, or multiple invocations in-process) never share option state (see the docstring on `createProgram`).

Three shared option builders compose flags across commands:

| Builder            | Adds                                                                                    | Used by                      |
| ------------------- | ----------------------------------------------------------------------------------------- | ----------------------------- |
| `sourceOptions`     | `-s, --source <urlOrPath>` (required), `--revision <rev>`                                 | `discover`, `preview`, `run`  |
| `ruleOptions`       | `-r, --rule <json>`, `-f, --rule-file <file>`, `-p, --path <subtree>`                      | `preview`, `run`              |
| `manifestOption`    | `--adapter-manifest <url>` — load extra/overridden engine adapters (see [adapter-plugins.md](adapter-plugins.md)) | all four commands |

### 4.1 `tcs discover`

**Synopsis:** `tcs discover -s <urlOrPath> [--revision <rev>] [--adapter-manifest <url>] [--json]`

Discovers every test (and metadata issue) in a source tree.

1. Applies the adapter manifest, if any (`applyAdapterManifest`).
2. `fetchSource(toSource(options))` — clones/fetches the source (git URL, local dir, or `.zip`).
3. `discoverTests(fetched.rootDir, { knownEngines: knownEngines() })`.
4. `--json`: prints `{ tests, issues }` as pretty JSON and returns.
5. Otherwise: prints a count + one line per test (`[engine] id (file)`), then a count + one line per discovery issue (`! kind: file — message`), if any.
6. Always calls `fetched.cleanup()` in a `finally` block, whether or not discovery succeeded.

### 4.2 `tcs preview`

**Synopsis:** `tcs preview -s <urlOrPath> [--revision <rev>] [--rule <json>] [--rule-file <file>] [--path <subtree>] [--adapter-manifest <url>]`

Evaluates a selection rule and lists the tests a campcampaign would run, without executing anything.

1. Applies the adapter manifest, if any.
2. `loadRule(options.rule, options.ruleFile, options.path)` — resolves the effective `SelectionRule`.
3. `fetchSource` + `discoverTests`, same as `discover`.
4. `selectTests(tests, rule)` — pure evaluation against the discovered tests.
5. Prints `N/M test(s) selected` plus one `[engine] id` line per selected test.
6. If discovery issues exist, prints a one-line pointer to `tcs discover` for details (does not print the issues themselves).
7. `fetched.cleanup()` in `finally`.

### 4.3 `tcs run`

**Synopsis:** `tcs run -s <urlOrPath> [--revision <rev>] [--rule <json>] [--rule-file <file>] [--path <subtree>] [--parallelism <n>] [--junit-out <file>] [--docker] [--adapter-manifest <url>]`

Runs a campaign **locally** — the dev/debug path, not the scalable one.

1. Applies the adapter manifest, if any.
2. Resolves the rule (`loadRule`) and the source (`toSource`).
3. `fetchSource`, then `discoverTests` + `selectTests` inside a `try`, with `fetched.cleanup()` in `finally` — note the source is cleaned up **before** execution starts (only the selection, not the fetched tree, is needed afterwards).
4. If the rule matches zero tests: prints `The selection rule matches no test.` to stderr, sets `process.exitCode = 2`, and returns (no provider is created).
5. Instantiates `new LocalProvider({}, options.docker ? { name: 'docker', runtime: 'docker' } : {})` — `--docker` switches the execution runtime from the default host-process runtime to `docker run` per test, container-encapsulated like an Argo pod.
6. Builds each selected test's `execution` via `resolveExecution(requireAdapter(test.engine), test)` and calls `provider.submit({ runId: 'cli-<timestamp>', campaignId: 'cli', campaignName: 'cli-run', source, parallelism, tests })`.
7. Prints a one-line banner (test count, parallelism, runtime), then `provider.watch(handle, onEvent)`:
   - on a non-`pending` `test` event: prints `  <status> <testId> (<message>)`.
   - on a `run` event with `finishedAt` set: prints `<PHASE> — <succeeded>/<total> passed, <failed> failed`.
8. If `--junit-out <file>` was given: writes `provider.getMergedJUnit(handle)` to that file and prints a confirmation line.
9. Reads the final state via `provider.getState(handle)` and sets `process.exitCode = state.run.phase === 'succeeded' ? 0 : 1`.

`--parallelism` defaults to `"2"` (a string flag, converted with `Number(...)` at submit time).

### 4.4 `tcs engines`

**Synopsis:** `tcs engines [--adapter-manifest <url>]`

1. Applies the adapter manifest, if any (so manifest-provided engines are included).
2. Prints one engine id per line from `knownEngines()`.

No source/rule options — this command only inspects the adapter registry.

---

## 5. Execution Lifecycle

```text
shell: tcs run -s ./repo -r '{"prop":"tags","op":"contains","value":"smoke"}' --docker
  │
  ├─ bin/tcs.mjs
  │    ├─ register(tsx/esm/api)              # lets Node import .ts sources directly, no build
  │    └─ import('../src/index.ts')
  │
  ├─ src/index.ts
  │    └─ createProgram().parseAsync(process.argv)
  │
  ├─ src/program.ts: createProgram()
  │    └─ new Command('tcs') + 4 subcommands wired with their option builders
  │        commander parses argv, routes to the `run` action handler
  │
  ├─ run action handler
  │    ├─ applyAdapterManifest(options.adapterManifest)      # no-op if flag absent
  │    ├─ loadRule(...) via src/lib.ts                        # -> SelectionRule
  │    ├─ toSource(options) via src/lib.ts                    # -> TestsSource (git | local)
  │    ├─ @tcs/core: fetchSource(source)                      # clone / copy / unzip
  │    ├─ @tcs/core: discoverTests(rootDir, { knownEngines }) # -> tests + issues
  │    ├─ @tcs/core: selectTests(tests, rule)                 # pure, in-memory
  │    ├─ fetched.cleanup()                                   # temp dir / clone removed
  │    ├─ guard: selected.length === 0 -> exitCode 2, return
  │    ├─ new LocalProvider({}, { name: 'docker', runtime: 'docker' })
  │    ├─ @tcs/core: resolveExecution(requireAdapter(engine), test)   # per selected test
  │    ├─ provider.submit({ runId, campaignId: 'cli', ..., tests })
  │    ├─ provider.watch(handle, onEvent)                     # streams test/run events to stdout
  │    │     (LocalProvider drives execution: host child process, or `docker run`
  │    │      per test when runtime === 'docker' — see SHARED_PACKAGES_ARCHITECTURE.md)
  │    ├─ optional: writeFile(junitOut, provider.getMergedJUnit(handle))
  │    └─ provider.getState(handle) -> process.exitCode (0 succeeded / 1 otherwise)
  │
  └─ process exits with process.exitCode
```

Each invocation is a **fresh, single-shot process**: there is no daemon, no persistent registry across invocations, and (per the docstring in `program.ts`) adapter manifests are installed straight into the process-wide adapter registry rather than threaded through an override map, since the process exits right after.

---

## 6. Integration with Shared Packages

| Import                              | From                  | Used by          | Purpose                                                                 |
| ------------------------------------ | ---------------------- | ----------------- | ------------------------------------------------------------------------- |
| `fetchSource`                       | `@tcs/core`            | discover/preview/run | Resolve a `TestsSource` (git/local/zip) into a local directory + `cleanup()` |
| `discoverTests`                     | `@tcs/core`            | discover/preview/run | Walk a source tree, return discovered tests + metadata issues           |
| `selectTests`                       | `@tcs/core`            | preview/run        | Pure evaluation of a `SelectionRule` against discovered tests           |
| `knownEngines`                      | `@tcs/core`            | discover/preview/run/engines | List registered engine adapter ids (built-in + installed manifest engines) |
| `resolveExecution`                  | `@tcs/core`            | run                | Merge test metadata over an adapter's defaults into a neutral `ResolvedExecution` |
| `requireAdapter`                    | `@tcs/core`            | run                | Look up the `EngineAdapter` for a test's engine, throwing if unknown    |
| `fetchManifest`                     | `@tcs/core`            | all (via `applyAdapterManifest`) | Download and parse an adapter manifest from a URL                    |
| `installAdapter`                    | `@tcs/core`            | all (via `applyAdapterManifest`) | Register a manifest-provided adapter into the process-wide registry      |
| `parseRule`                         | `@tcs/core`            | lib.ts (`loadRule`) | Validate + parse a raw JSON rule into a typed `SelectionRule`, throwing on an invalid op/shape |
| `LocalProvider`                     | `@tcs/orchestration`   | run                | Execute the selected tests (host process or `docker run` per test) behind the `OrchestrationProvider` contract |
| `SelectionRule`, `TestsSource`      | `@tcs/shared-types` (types) | lib.ts        | Typed shapes shared with the server/portal — no duplication of the schema |
| `MATCH_ALL_RULE`                    | `@tcs/shared-types`    | lib.ts (`loadRule` default) | Default rule (`{ all: [{ prop: 'engine', op: 'exists' }] }`) when no `--rule`/`--rule-file` is given |

`discover` and `preview` never touch `@tcs/orchestration` — only `run` instantiates a provider, since those two commands only need discovery/selection, not execution. See [SHARED_PACKAGES_ARCHITECTURE.md](SHARED_PACKAGES_ARCHITECTURE.md) for how `fetchSource`, `discoverTests`, `LocalProvider`, and the adapter registry work internally.

---

## 7. Error Handling & Exit Codes

| Exit code | Trigger                                                                 |
| --------- | -------------------------------------------------------------------------- |
| `0`       | Default success; for `run`, set explicitly when `state.run.phase === 'succeeded'` |
| `1`       | For `run`, set explicitly when the final phase is anything other than `succeeded` (e.g. `failed`) |
| `2`       | For `run`, set explicitly when the selection rule matches zero tests (no provider is ever created) |
| commander default | Any other uncaught error (invalid JSON in `--rule`/`--rule-file`, `parseRule` schema validation failure, missing required `--source`, unknown engine via `requireAdapter`, fetch/clone failure) propagates as a rejected promise; commander/Node's default unhandled-rejection behavior applies — no CLI-wide try/catch wraps the action handlers. |

`loadRule` validates eagerly: an invalid rule shape (e.g. `{"prop":"tags","op":"not-a-real-op"}`) throws before any source is fetched, via `parseRule`'s schema check (covered by `lib.test.ts`).

---

## 8. Build & Tooling

- **No compile step for running the CLI.** `bin/tcs.mjs` is a plain `.mjs` shebang script that calls `register()` from `tsx/esm/api` and then dynamically `import()`s `../src/index.ts` directly — TypeScript sources execute as-is under Node via `tsx`'s ESM loader hook. There is no `dist/` directory and nothing is pre-transpiled for local/dev use.
- **`typecheck` / `build` scripts are identical:** both run `tsc --noEmit` (`package.json`'s `"build": "tsc --noEmit"`) — "build" here only validates types, it does not emit JavaScript. This is consistent with `tcs` being invoked straight from source via `tsx` rather than from compiled output.
- **`tsconfig.json`** extends the repo-root `tsconfig.base.json`, adds `"types": ["node"]`, and restricts `include` to `src` (test files are included as they live under `src/` too).
- **Package manifest:** `"type": "module"` (ESM-only), `"bin": { "tcs": "./bin/tcs.mjs" }` — this is what pnpm/npm link into a `tcs` executable on `$PATH` when the package is installed/linked.
- **Dependencies:** `commander` (CLI parsing/wiring) and `tsx` (runtime TS execution) are the only non-workspace runtime dependencies; `@tcs/core`, `@tcs/orchestration`, `@tcs/shared-types` are pulled in as pnpm workspace packages (`workspace:*`), so the CLI always runs against the same in-repo version of those packages as the server.

---

## 9. Testing

| File                | Framework | Coverage                                                                                    |
| --------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `src/lib.test.ts`    | Vitest    | `toSource()`: git-URL detection (`http(s)://`, `git@`, `ssh://`) vs. local path/`.zip`/Windows path; revision passthrough. `loadRule()`: default `MATCH_ALL_RULE`, inline `--rule` JSON, `--rule-file` precedence over inline `--rule`, `--path` wrapping via `pathUnder`, and rejection of an invalid rule op. |
| `src/program.test.ts` | Vitest    | Subcommand registration (`discover`, `engines`, `preview`, `run` — alphabetical `toEqual`); `engines` lists built-in adapters (`cypress`, `robotframework`); against a temp fixture source tree: `discover --json` content, `discover` human output, `preview` rule filtering, `preview --path` subtree restriction. Runs `createProgram().parseAsync(['node', 'tcs', ...args])` and captures `console.log` via `vi.spyOn`. |

No dedicated test file exists for `src/index.ts` or `bin/tcs.mjs` (both are single-statement glue); their behavior is exercised indirectly by `program.test.ts` calling `createProgram()` directly rather than going through the bin entry point. There is no end-to-end test that actually spawns `tcs` as a subprocess.

---

## 10. Appendix: Key Design Patterns

| Pattern                          | Where                              | Purpose                                                                 |
| ----------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| **Fresh Command per call**         | `createProgram()`                    | Prevents option-state leakage across repeated invocations (tests, or multiple calls in one process) |
| **Shared option builders**         | `sourceOptions`, `ruleOptions`, `manifestOption` | Compose common flags (`--source`, `--rule`, `--adapter-manifest`) across commands without duplication |
| **Fetch → discover → select → cleanup** | `discover`/`preview`/`run` handlers | Consistent pipeline; `cleanup()` always runs in a `finally`, even on discovery/selection failure |
| **Process-wide adapter registry install** | `applyAdapterManifest`         | Safe because each CLI invocation is single-shot — no concurrent-request isolation needed, unlike the server |
| **Same `OrchestrationProvider` contract as production** | `LocalProvider` (`run`) | The CLI, the server's `local` provider, and the server's `docker` provider all share one implementation; only the execution runtime differs |
| **Explicit `process.exitCode`, no `process.exit()`** | `run` handler            | Lets pending I/O (e.g. the `--junit-out` write) flush before the process exits naturally |
| **Neutral execution contract**     | `resolveExecution` + `requireAdapter` | The CLI never special-cases an engine; it goes through the same adapter resolution the server uses |
