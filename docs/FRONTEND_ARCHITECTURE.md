# TestCampaignShooter Frontend Architecture

Comprehensive documentation of the TestCampaignShooter frontend: a Next.js (App Router) single-page portal for managing test campaigns, launching runs and watching them execute in real time.

> This document is a mechanical, exhaustive map of the frontend code (full file tree, every route, every component, the full API/SSE client). For the *why* behind the stack and cross-system diagrams (sequence/ER diagrams spanning server, orchestrator, Argo/K8s), see [architecture.md](architecture.md) and [technical.md](technical.md) — those remain the reference for rationale and are not duplicated here.

---

## Table of Contents

1. [Overview](#1-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Directory Structure](#3-directory-structure)
4. [Application Lifecycle](#4-application-lifecycle)
5. [Routing & Navigation](#5-routing--navigation)
6. [State Management](#6-state-management)
7. [API & Data Layer](#7-api--data-layer)
8. [Component Architecture](#8-component-architecture)
9. [Views & Pages](#9-views--pages)
10. [Theming & Styling](#10-theming--styling)
11. [Build & Tooling](#11-build--tooling)
12. [Type System](#12-type-system)

---

## 1. Overview

| Property             | Value                                                             |
| --------------------- | ------------------------------------------------------------------ |
| **Framework**         | Next.js 15.5 (App Router)                                        |
| **React**             | 19.1                                                              |
| **Language**          | TypeScript 5.8 (strict, via `tsconfig.base.json`)                 |
| **Rendering mode**    | 100% Client Components (every page/component starts `'use client'`) |
| **UI Library**        | None — hand-written CSS (`globals.css`), no Vuetify/Tailwind/MUI  |
| **State Management**  | None (no Redux/Zustand/Pinia) — local `useState`/`useEffect` per page + one shared hook (`useMe`) |
| **HTTP Client**       | Native `fetch`, wrapped in `lib/api.ts` (no Axios)                |
| **Real-time**         | Native browser `EventSource` (SSE), no Socket.IO                 |
| **i18n**              | None — UI copy is hardcoded French; `<html lang="fr">`             |
| **Package manager**   | pnpm workspace (`@tcs/portal`)                                    |
| **Shared types**      | `@tcs/shared-types` (workspace package, `transpilePackages`)      |
| **Dev port**          | 3000                                                              |

**Total:** 9 routes (pages), 6 feature components (+ 3 colocated test files), 2 `lib/` modules, 0 stores, 0 global providers beyond the root layout.

This is a deliberately small, dependency-light portal: no component library, no client-side state management library, no generated OpenAPI client, no design tokens pipeline. Everything one page needs is fetched with `fetch`/`EventSource` directly inside that page's component.

---

## 2. High-Level Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                           Browser                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌───────────────┐   ┌──────────────────┐                       │
│   │  Next.js App   │   │   useMe() hook    │                       │
│   │  Router (9     │   │  (auth/session,   │                       │
│   │  client routes)│   │   role checks)    │                       │
│   └───────┬───────┘   └─────────┬────────┘                       │
│           │                     │                                 │
│   ┌───────v─────────────────────v────────────────────────────┐   │
│   │                      Components (6)                        │   │
│   │  ┌─────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────┐ │   │
│   │  │ nav      │ │ campaign-  │ │ run-live │ │ rule-builder │ │   │
│   │  │ status   │ │ form       │ │ log-     │ │ charts       │ │   │
│   │  │          │ │            │ │ stream   │ │              │ │   │
│   │  └─────────┘ └────────────┘ └──────────┘ └──────────────┘ │   │
│   └──────────────────────┬──────────────────────────────────────┘   │
│                          │                                         │
│   ┌──────────────────────v──────────────────────────────────────┐ │
│   │                    lib/api.ts                                │ │
│   │  ┌───────────────┐        ┌───────────────────────────┐    │ │
│   │  │ api<T>(path)   │        │ openEvents(path)           │    │ │
│   │  │ fetch wrapper  │        │ EventSource factory        │    │ │
│   │  └──────┬────────┘        └──────────────┬──────────────┘    │ │
│   └─────────┼─────────────────────────────────┼──────────────────┘ │
│             │                                 │                     │
├─────────────┼─────────────────────────────────┼─────────────────────┤
│             v                                 v                     │
│       Fastify REST API                  SSE endpoints               │
│   (NEXT_PUBLIC_API_URL + /api/*)   (/api/runs/:id/events,           │
│   httpOnly session cookie            /api/runs/:id/logs/stream)     │
└──────────────────────────────────────────────────────────────────┘
```

Both the REST calls and the SSE connections target the backend server directly (`NEXT_PUBLIC_API_URL`, default `http://localhost:4000`) with `credentials: 'include'` / `withCredentials: true` — there is no Next.js API route/proxy layer (`src/app/**/route.ts` does not exist). The backend's own architecture (Fastify, Prisma, auth, SSE emission) is documented in [BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md).

### Layered Architecture

```text
┌───────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                       │
│  app/              Route segments (page.tsx per route)      │
│  app/layout.tsx     Root HTML shell + TopNav                 │
│  components/        Feature components (forms, live views)  │
├───────────────────────────────────────────────────────────┤
│                     DATA LAYER                               │
│  lib/api.ts          fetch wrapper, SSE factory, formatters  │
│  lib/use-me.ts       current-user hook (auth/role gate)      │
├───────────────────────────────────────────────────────────┤
│                     STYLING LAYER                             │
│  app/globals.css     CSS variables (light/dark), utility     │
│                       classes (.card, .btn, .badge, .list…)  │
├───────────────────────────────────────────────────────────┤
│                     TYPE LAYER                                │
│  @tcs/shared-types   Zod-derived types shared with the       │
│                       server (SelectionRule, RunStateEvent,   │
│                       AuthMethods, RunDiff, UserProfile…)     │
└───────────────────────────────────────────────────────────┘
```

---

## 3. Directory Structure

```text
apps/portal/
├── Dockerfile                      # Production image (standalone output)
├── .dockerignore
├── .env.example                    # NEXT_PUBLIC_API_URL
├── next.config.ts                  # transpilePackages, standalone output, webpack extensionAlias
├── next-env.d.ts                   # Next.js global type declarations
├── package.json                   # @tcs/portal — next, react, react-dom, @tcs/shared-types
├── tsconfig.json                   # extends tsconfig.base.json, "@/*" -> "./src/*"
│
└── src/
    ├── app/                        # App Router — every segment is 'use client'
    │   ├── layout.tsx              # Root layout: <html lang="fr">, <TopNav/>, <main>
    │   ├── globals.css             # Design tokens (light/dark) + utility classes
    │   ├── page.tsx                 # "/" — campaigns list
    │   ├── login/
    │   │   └── page.tsx             # "/login" — password + OIDC login
    │   ├── campaigns/
    │   │   ├── new/
    │   │   │   └── page.tsx         # "/campaigns/new" — create campaign
    │   │   └── [id]/
    │   │       ├── page.tsx         # "/campaigns/:id" — detail, runs history, metrics
    │   │       └── edit/
    │   │           └── page.tsx     # "/campaigns/:id/edit" — edit campaign
    │   ├── runs/
    │   │   └── [id]/
    │   │       ├── page.tsx         # "/runs/:id" — live run view
    │   │       └── diff/
    │   │           └── page.tsx     # "/runs/:id/diff" — diff vs. previous run
    │   ├── projects/
    │   │   ├── page.tsx             # "/projects" — list + create
    │   │   └── [id]/
    │   │       └── page.tsx         # "/projects/:id" — detail, members, campaigns
    │   └── admin/
    │       └── adapter-manifests/
    │           └── page.tsx         # "/admin/adapter-manifests" — admin only
    │
    ├── components/
    │   ├── nav.tsx                  # TopNav: brand, links gated by role, logout
    │   ├── status.tsx               # StatusBadge (+ status.test.tsx)
    │   ├── charts.tsx                # BarTrend (SVG bar chart), StatTile (+ charts.test.tsx)
    │   ├── rule-builder.tsx          # RuleBuilder (+ rule-builder.test.tsx) — recursive AST editor
    │   ├── campaign-form.tsx         # CampaignForm — create/edit + live selection preview
    │   ├── run-live.tsx              # RunLive — SSE + persisted-results merge, retry/cancel/replay
    │   └── log-stream.tsx            # LogStream — SSE log tail for one test
    │
    ├── lib/
    │   ├── api.ts                    # API_URL, ApiError, api<T>(), openEvents(), formatDate/Duration
    │   ├── api.test.ts
    │   └── use-me.ts                  # useMe() — current user + can(role) gate
    │
    └── jest-dom.d.ts                  # ambient types for the Vitest/jest-dom matchers used in *.test.tsx
```

No `services/`, `stores/`, `hooks/` (beyond `use-me.ts`), `types/`, or `styles/` directories exist — each of romm's equivalent concerns collapses into `lib/api.ts`, `lib/use-me.ts` and inline component state here.

---

## 4. Application Lifecycle

### Startup

```text
src/app/layout.tsx (Root Layout, Server Component by Next.js convention,
                     but renders only Client Components below it)
  ├── sets <html lang="fr">, document <title>/description (static metadata)
  ├── imports ./globals.css (design tokens + utility classes, app-wide)
  ├── renders <TopNav/>               — 'use client', calls useMe() on mount
  └── renders <main>{children}</main> — the active route's page.tsx
```

There is no client-side bootstrap step equivalent to romm's "initialize critical stores before mount": every page fetches its own data independently inside a `useEffect` on mount. The only cross-cutting bootstrap is `useMe()`, called from `TopNav` (every page) and again from any page that needs role gating (`campaigns/new`, `campaigns/[id]`, `admin/adapter-manifests`, …) — each call triggers its own `GET /api/auth/me`.

### Per-Page Data Lifecycle

```text
Component mount (useEffect, [] or [id] dependency)
    │
    ├─ api<T>(path)                      → GET/POST/PUT/DELETE via fetch
    │    ├─ credentials: 'include'        (httpOnly session cookie)
    │    ├─ 401 + not /api/auth/*         → window.location.href = '/login'
    │    └─ !response.ok                  → throws ApiError(status, message)
    │
    ├─ setState(result) on success, setError(err.message) on failure
    │
    └─ Component re-renders from local state (no store, no cache layer)
```

Pages that show live data (`runs/[id]`) additionally open an `EventSource` in a second effect and tear it down (`source.close()`) on unmount/param change.

---

## 5. Routing & Navigation

### Route Map (App Router — folders are URL segments, `[id]` is dynamic)

```text
/ (root)
│
├── /                              → Campaigns list (home)
├── /login                         → Login (password and/or OIDC, server-driven)
│
├── /campaigns/new                 → Create campaign (role: editor+)
├── /campaigns/:id                 → Campaign detail — runs history, trend charts, launch/edit/delete
├── /campaigns/:id/edit             → Edit campaign (role: editor+)
│
├── /runs/:id                      → Live run view (SSE events/logs, retry/cancel/replay)
├── /runs/:id/diff                  → Diff against the previous run
│
├── /projects                      → Projects list + create (role: editor+ to create)
├── /projects/:id                   → Project detail — members, scoped campaigns
│
└── /admin/adapter-manifests        → Instance adapter manifests (role: admin only)
```

No route groups (`(group)`), no parallel/intercepting routes, no `route.ts` API handlers, no `middleware.ts`, no `loading.tsx`/`error.tsx` boundaries. `/campaigns/new` and `/campaigns/:id/edit` wrap `<CampaignForm/>` in `<Suspense>` solely because `CampaignForm` calls `useSearchParams()` (a Next.js requirement for that hook under the App Router), not for streaming/data-fetching purposes.

### Route Guarding

There is **no router-level guard** (no `middleware.ts`, no shared layout-level redirect): access control is enforced per-page, in two different styles:

| Pattern                         | Where                                                   | Behavior                                                          |
| -------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| Soft (hide UI only)              | `/` (new-campaign link), `/campaigns/:id` (launch/edit/delete), `/projects` (create form), nav links in `TopNav` | `useMe().can(role)` conditionally renders the control; the route itself still renders for anyone |
| Hard (blocks the page)           | `/admin/adapter-manifests`                               | Renders `"Réservé aux administrateurs."` and returns early if `!can('admin')`, after `meLoading` resolves |
| Implicit (via API 401)           | Every page                                               | Any `api()` call that 401s redirects the whole tab to `/login` (global side effect inside `lib/api.ts`, not a route guard) |

Authorization is therefore ultimately enforced by the **backend** on every request; the frontend's checks are UX only (hide buttons, avoid a flash of admin-only content) and rely on `@tcs/shared-types`'s `hasRole()` against the `roles` array returned by `GET /api/auth/me`.

---

## 6. State Management

**There is no client-side state management library** (no Redux, Zustand, Jotai, Pinia-equivalent, React Context store, or React Query/SWR cache). State is:

| Scope                     | Mechanism                                                      |
| -------------------------- | ---------------------------------------------------------------- |
| Per-page server data       | `useState` + manual `useEffect` fetch, re-fetched via a `reload()`/`load()` closure after mutations |
| Cross-page "current user"  | `useMe()` hook (`lib/use-me.ts`) — re-fetches `GET /api/auth/me` independently in **every** component that calls it (no shared cache/context; `TopNav` and a page's own `useMe()` call each hit the endpoint separately) |
| Live run state              | Local `Map<string, TestStateEvent>` / `Map<string, PersistedResult>` inside `RunLive`, merged from SSE + a REST fallback |
| Form state                  | Local `useState` per field inside `CampaignForm` (controlled inputs), lifted to a single `save()` call on submit |
| URL state                   | `useSearchParams()` only to seed `projectId` when creating a campaign from a project page (`/campaigns/new?projectId=...`) |

This is a deliberate simplicity choice: with 9 routes and no cross-page shared entities beyond "who am I", a dedicated store would add machinery without a payoff. The one place this shows a cost is `useMe()` being called multiple times per page (once in `TopNav`, often again in the page itself) with no deduplication — each call is an independent `GET /api/auth/me` round trip.

---

## 7. API & Data Layer

### Fetch Wrapper (`lib/api.ts`)

```ts
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
    ...init,
  });
  if (response.status === 401 && typeof window !== 'undefined' && !path.startsWith('/api/auth')) {
    window.location.href = '/login';
  }
  if (!response.ok) throw new ApiError(response.status, body.error ?? `HTTP ${response.status}`);
  return text ? JSON.parse(text) : undefined;
}
```

- **Auth:** session cookie only (`credentials: 'include'`), matching the server's httpOnly JWT session — no bearer token handling, no CSRF header (see [architecture.md §Security](architecture.md#security--rbac) for the server side).
- **Errors:** every non-2xx response is thrown as `ApiError` (`status` + server-provided `error` message), caught at the call site and rendered in a `.error-box`.
- **401 handling:** a hard redirect to `/login` (not a React state change), except for calls to `/api/auth/*` itself (so the login page's own calls — `methods`, `login` — never bounce).
- No request/response interceptor chain, no retry logic, no request deduplication, no caching layer — one `fetch` per call, every time.

### SSE (`openEvents`)

```ts
export function openEvents(path: string): EventSource {
  return new EventSource(`${API_URL}${path}`, { withCredentials: true });
}
```

Used by two components, each opening and tearing down its own `EventSource`:

| Component    | Endpoint                                              | Events consumed                          |
| ------------- | -------------------------------------------------------- | ------------------------------------------- |
| `RunLive`     | `GET /api/runs/:id/events`                                | `test` (per-test `TestStateEvent`), `run` (`RunStateEvent`, triggers a results re-fetch on terminal phases) |
| `LogStream`   | `GET /api/runs/:id/logs/stream?testId=…`                  | `log` (`{chunk}` appended to a buffer), `end` (closes the stream) |

Both treat `onerror` as terminal (`source.close()`), i.e. **no reconnect-with-backoff** — a dropped connection simply stops updating until the user reloads the page.

### REST Surface Consumed

The portal calls the full `/api` surface documented in [technical.md](technical.md#api-prefix-api-tcs_session-session-cookie-or-authorization-bearer): auth (`/auth/methods`, `/auth/login`, `/auth/logout`, `/auth/me`), campaigns (CRUD, `/preview`, `/:id/runs`, `/:id/metrics`), runs (`/:id`, `/:id/results`, `/:id/diff`, `/:id/artifacts`, `/:id/retry`, `/:id/cancel`, `/:id/replay`, `/:id/junit`, `/:id/logs`), projects (CRUD, members), and admin adapter manifests. There is no generated client (no OpenAPI codegen step in `package.json`): every call site hand-writes its path string and a local response-shape `interface` (e.g. `CampaignRow`, `RunDetail`, `ProjectDetail`) rather than importing a canonical schema — only the pieces shared with validation logic (`SelectionRule`, `TestsSource`, `RunStateEvent`, `RunDiff`, `AuthMethods`, `UserProfile`/`Role`) come from `@tcs/shared-types`.

### Key Data Flow — Run Page

```text
Mount /runs/:id
  ├─ GET /api/runs/:id              → run metadata (campaign, provider, triggeredBy…)
  ├─ GET /api/runs/:id/artifacts    → artifact list
  └─ <RunLive runId=id>
       ├─ GET /api/runs/:id/results?pageSize=500   → persisted TestResult rows (may 404/empty if not ingested yet)
       └─ EventSource /api/runs/:id/events
            ├─ 'test'  → upsert into live Map<testId, TestStateEvent>
            └─ 'run'   → set run phase/progress; on terminal phase, re-fetch
                         results immediately AND again after a fixed 2s delay
                         (covers the race with the aggregation callback landing server-side)
```

The results table (`rows`) is the **union** of live (SSE) test IDs and persisted result IDs, so a finished run reloaded from scratch (no SSE history) still shows full state from the REST fallback alone.

---

## 8. Component Architecture

### Organization

Flat `components/` directory, 6 components, no nested feature folders — small enough that romm-style tiering (common/feature/console) would be over-structuring:

| Component        | Responsibility                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `nav.tsx`          | `TopNav` — app shell navigation, role-gated links, logout                                      |
| `status.tsx`       | `StatusBadge` — dot + French label for any run/test status string, with a style map            |
| `charts.tsx`       | `BarTrend` (hand-rolled SVG bar chart, no charting library) and `StatTile` (KPI tile)           |
| `rule-builder.tsx` | `RuleBuilder` — recursive component editing a `SelectionRule` AST (all/any/not/condition/pathUnder) in place |
| `campaign-form.tsx`| `CampaignForm` — the only "big" component: full create/edit form, embeds `RuleBuilder`, calls `/campaigns/preview` live |
| `run-live.tsx`     | `RunLive` — SSE + REST merge, results table, retry/cancel/replay actions, embeds `LogStream`    |
| `log-stream.tsx`   | `LogStream` — single-test SSE log tail with a download link                                     |

### Communication

```text
┌────────────┐   props + onChange callback   ┌─────────────┐
│  Parent     │ ─────────────────────────────→│  Child       │
│  (page.tsx) │ ←───────────────────────────── │  component   │
└────────────┘      (controlled-component       └─────────────┘
                      pattern throughout)
```

- **Props + callbacks** (React's native pattern) is the *only* communication mechanism — no event bus (no Mitt equivalent), no context provider, no portal/dialog system.
- `RuleBuilder` is self-recursive: each AST node renders itself and passes an `onChange`/`onRemove` pair down to its own children, rebuilding the parent subtree on every edit (immutable tree reconstruction, no mutation).
- `RunLive` composes `StatusBadge` and `LogStream` directly as children; there is no shared "dialog system" (no modal/`RDialog` equivalent) — the only "modal-like" UI is a native `confirm()` call before delete actions (`campaigns/[id]`, `projects/[id]`).

### Testing

Three components have colocated `*.test.tsx` files (`status`, `charts`, `rule-builder`) plus `lib/api.test.ts` — run via the repo-root Vitest config (`vitest.config.ts`), not a separate frontend test runner.

---

## 9. Views & Pages

### Campaigns List (`/`)

Table of all campaigns visible to the caller (role- and project-scoped server-side), with schedule (`⏰ cron`) and project (`📁`) badges inline. "+ Nouvelle campagne" gated to `editor`+.

### Login (`/login`)

Fetches `GET /api/auth/methods` to decide which form(s) to render:

| Method available | UI                                                            |
| ------------------ | ---------------------------------------------------------------- |
| `oidc`              | A link button to the server's `oidcLoginUrl` (full-page redirect, no client-side OIDC logic) |
| `password`          | Email/password form, `POST /api/auth/login`, then `router.push('/')`                        |
| neither             | Error box: no auth method enabled server-side                                                |

### Campaign Create/Edit (`/campaigns/new`, `/campaigns/:id/edit`)

Both render `<CampaignForm/>` (new = no `initial`, edit = pre-fetched `CampaignInput`). The form covers: name/description, parallelism, project assignment, admin-only adapter manifest override, cron scheduling (expression + enable toggle), test source (git URL+revision or local path), and the nested `RuleBuilder`. A "Prévisualiser la sélection" button calls `POST /api/campaigns/preview` and renders matched tests + discovery issues without saving anything.

### Campaign Detail (`/campaigns/:id`)

- Header actions (editor+): Launch (`POST .../runs`, redirects to the new run), Edit, Delete (soft-delete via confirm dialog).
- KPI tiles + two `BarTrend` charts (success-rate % and cumulative duration) built from `GET /api/campaigns/:id/metrics`.
- Runs history table (`GET /api/campaigns/:id/runs`), each row linking to `/runs/:id`.

### Run Detail (`/runs/:id`)

Header (status badge, campaign link, provider/version/triggeredBy metadata), a link to the diff view, a JUnit download link if `junitKey` is set, the `<RunLive/>` live table (see §7), and an artifacts list.

### Run Diff (`/runs/:id/diff`)

`GET /api/runs/:id/diff` → six `StatTile`s (regression/fixed/new/removed/still-failing/stable counts) + a per-test table with before/after `StatusBadge`s and a duration delta.

### Projects List (`/projects`)

List + inline create form (editor+). Explains the visibility model in-page (creator + assigned members only; campaigns without a project stay globally visible) — mirrors [functional.md](functional.md).

### Project Detail (`/projects/:id`)

Project metadata with inline edit/delete (creator or admin — `canManage = can('admin') || project.createdBy?.id === me?.sub`), a members table with add/remove (email-based), and a table of the project's campaigns with a "+ Nouvelle campagne" link pre-filled with `?projectId=`.

### Admin — Adapter Manifests (`/admin/adapter-manifests`)

Admin-only (hard-gated). CRUD over instance-level adapter manifest URLs plus a "↻ Recharger tout" action (`POST .../reload`); each row shows last fetch time, content hash, and last error. See [adapter-plugins.md](adapter-plugins.md).

---

## 10. Theming & Styling

### Design Tokens (`app/globals.css`)

CSS custom properties, switched automatically via `@media (prefers-color-scheme: dark)` — no manual theme toggle, no `localStorage`-persisted preference:

| Token            | Light       | Dark        |
| ----------------- | ----------- | ----------- |
| `--page`          | `#f9f9f7`   | `#0d0d0d`   |
| `--surface-1`      | `#fcfcfb`   | `#1a1a19`   |
| `--text-primary`   | `#0b0b0b`   | `#ffffff`   |
| `--accent`/`--series-1` | `#2a78d6` | `#3987e5` |
| `--status-good/-warning/-serious/-critical` | `#0ca30c`/`#fab219`/`#ec835a`/`#d03b3b` | same good/critical, warning tuned |

A comment in the file points at the dataviz palette documented in `technical.md` — tokens are the shared single source between the portal's CSS and that palette.

### CSS Stack

No CSS framework (no Tailwind, no CSS Modules, no styled-components): one global stylesheet (`globals.css`) defines reusable utility classes consumed via plain `className` strings — `.card`, `.btn`/`.btn.primary`/`.btn.danger`/`.btn.small`, `.badge` (+ `.good`/`.bad`/`.warn`/`.busy` with an animated pulsing dot), `.grid`/`.grid.cols-2`/`.grid.tiles`, `table.list`, `.progress`, `pre.logs`, `.tile`, `.error-box`, `.row`, `code.chip`. A handful of components use inline `style={{...}}` for one-off layout tweaks (e.g. `campaign-form.tsx`'s field widths, `run-live.tsx`'s progress bar segment widths computed from live data).

### Data Visualization

`BarTrend` (in `charts.tsx`) is a **hand-written inline SVG** bar chart (no Chart.js/Recharts/D3): hairline quarter gridlines, rounded data-ends, a baseline, first/last direct labels, and a wider invisible hit-rect per bar for hover tooltips — explicitly documented in its own docstring as following "the dataviz method" referenced in `technical.md`.

---

## 11. Build & Tooling

### Scripts (`package.json`)

| Script       | Command                  | Purpose                                   |
| ------------- | -------------------------- | -------------------------------------------- |
| `dev`         | `next dev --port 3000`     | Development server                          |
| `build`       | `next build`               | Production build                            |
| `start`       | `next start --port 3000`   | Serve a production build                    |
| `typecheck`   | `tsc --noEmit`             | Type-check with the Next.js TS plugin        |

Linting and Vitest run from the repo root (`pnpm lint`, `pnpm test` — see [technical.md §Quality & CI](technical.md#quality--ci)); there is no portal-local ESLint/Vitest config.

### `next.config.ts`

```ts
const nextConfig: NextConfig = {
  transpilePackages: ['@tcs/shared-types'],
  output: process.env.NEXT_OUTPUT_STANDALONE === 'true' ? 'standalone' : undefined,
  webpack: (config) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    return config;
  },
};
```

- `transpilePackages`: the workspace package `@tcs/shared-types` ships TS sources directly (no build step), so Next.js must transpile it itself.
- `output: 'standalone'` is opt-in via `NEXT_OUTPUT_STANDALONE=true`, used only in the Docker build — standalone tracing needs filesystem symlinks, which Windows dev hosts may lack the privilege for.
- The `extensionAlias` webpack tweak lets workspace packages use ESM-style `./foo.js` import specifiers that actually resolve to `./foo.ts` sources — a monorepo-with-"type":"module" convention, not a Next.js default.

### Docker

`apps/portal/Dockerfile` builds the standalone output (see [deployment.md](deployment.md) for the full image/runtime topology).

---

## 12. Type System

No `__generated__/` directory and no OpenAPI codegen — the portal does **not** generate types from the server's schema. Instead:

| Source                        | What                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `@tcs/shared-types` (workspace) | Cross-cutting types shared verbatim with the server: `SelectionRule`, `ConditionOperator`, `PropertyCondition`, `conditionOperators`, `TestsSource`, `DiscoveryIssue`, `RunPhase`, `TERMINAL_RUN_PHASES`, `RunStateEvent`, `TestStateEvent`, `RunDiff`, `AuthMethods`, `UserProfile`, `Role`, `hasRole()` |
| Local `interface`s per page     | Response shapes the portal actually reads (`CampaignRow`, `CampaignDetail`, `RunRow`, `RunMetric`, `RunDetail`, `ArtifactRow`, `ProjectRow`, `ProjectDetail`, `AdapterManifestRow`, `PersistedResult`, `PreviewResult`) — each is a narrow, hand-written projection of the real API response, not the full DTO |
| `lib/api.ts`                    | `ApiError` (status + message)                                                           |
| `next-env.d.ts`, `jest-dom.d.ts`| Ambient type declarations (Next.js globals, Vitest/jest-dom matchers)                    |

### Path Alias

```json
"@/*" → "./src/*"
```

Declared in `tsconfig.json` but barely used in practice — every file observed imports siblings via relative paths (`../lib/api`, `../../components/status`) rather than the `@/` alias.

---

## Appendix: Key Design Patterns

| Pattern                         | Where                          | Purpose                                                              |
| --------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| **Controlled components**        | `campaign-form.tsx`, `rule-builder.tsx` | Every input bound to local state, no uncontrolled/ref-based forms |
| **Immutable AST editing**         | `rule-builder.tsx`                | Each recursive edit rebuilds the subtree and calls `onChange` upward, never mutates `rule` in place |
| **SSE + REST reconciliation**     | `run-live.tsx`                    | Live events (SSE) and persisted results (REST) are merged into one row set so the view is correct whether the run is live, just finished, or reloaded from history |
| **Fixed-delay re-fetch after terminal event** | `run-live.tsx`         | Works around the race between the SSE terminal event and the server-side JUnit aggregation callback (re-fetches immediately, then again after 2s) |
| **Global 401 → redirect**         | `lib/api.ts`                      | Centralizes session-expiry handling in one fetch wrapper rather than per-call |
| **Soft vs. hard role gating**     | most pages vs. `admin/adapter-manifests` | Cheap UX hiding everywhere, with one true server-mirrored hard gate on the admin-only page |
| **Hand-rolled SVG charts**        | `charts.tsx`                      | Avoids a charting library dependency for two simple visualizations   |
| **No client-side cache/store**    | entire app                        | Every page re-fetches on mount; simplicity traded for extra round trips (notably repeated `useMe()` calls) |
