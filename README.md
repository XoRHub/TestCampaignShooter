# TestCampaignShooter

Test campaign orchestration platform, scalable on Kubernetes via Argo Workflows,
with an API server, a CLI, and a results portal.

- **Multi-engine test discovery** (Robot Framework, Selenium, Cypress, Protractor, generic
  Java/Node/Python runners) via `<test>.metadata.json` files.
- **Campaigns defined by a selection rule**: nested boolean expressions (AND/OR/NOT)
  over metadata properties + subtree restriction.
- **Execution delegated to Argo Workflows** (fan-out: one retryable node per test, configurable
  parallelism, JUnit aggregation) behind a **pluggable orchestration interface**:
  `argo` provider (one pod per test), `docker` provider (each test encapsulated in its own
  container image via `docker run` — iso-prod dev), and `local` provider (child processes, lightweight dev).
- **API server** (Fastify + Prisma/PostgreSQL): OIDC and/or password auth, RBAC,
  campaign CRUD with selection preview, timestamped runs, run-to-run diff, real-time SSE,
  Prometheus metrics (system `/metrics` + separate business-metrics push), S3/MinIO artifacts.
- **Portal** (Next.js): visual rule builder, real-time tracking, logs, targeted retry, dashboards.
- **Downloadable engine adapters** (instance-wide or per-campaign manifest, no redeploy needed) —
  see [adapter-plugins.md](docs/adapter-plugins.md).

## Quick start (dev)

```bash
pnpm install
docker compose up -d          # PostgreSQL + MinIO + Pushgateway
cp apps/server/.env.example apps/server/.env
pnpm --filter @tcs/server prisma:migrate
pnpm dev:server               # API on http://localhost:4000
pnpm dev:portal               # Portal on http://localhost:3000
```

Or the whole stack (server + portal included) in one command — see
[deployment.md](docs/deployment.md):

```bash
docker compose up --build     # portal http://localhost:3000, API http://localhost:4000
```

CLI:

```bash
pnpm --filter @tcs/cli exec tcs discover --source examples/tests
```

### CI/CD

Two equivalent pipelines exist: 
* `.gitlab-ci.yml` (+ `.gitlab/ci/*.yml`) runs on GitLab;
* `.github/workflows/` runs on GitHub
These 2 CI have the same shape (lint/typecheck/test/build, Helm lint+unittest, Trivy vulnerability scans + SBOM, a multi-arch
amd64+arm64 image build, and an automated release) in case this repo is ever also mirrored to GitHub or Gitlab. See [technical.md § Quality & CI](docs/technical.md#quality--ci) for the full breakdown, including the one thing that doesn't translate directly between forges.

### Toolchain & dependencies

- [`mise`](https://mise.jdx.dev) (`.mise.toml`) pins the local dev toolchain (Node, pnpm, Helm,
  helm-docs, Trivy) — `mise install` reproduces what CI uses.
- [Renovate](https://docs.renovatebot.com) (`renovate.json`) keeps pnpm/GitHub Actions/Docker
  base images/Helm chart images up to date automatically.

## Documentation

- **[User guide](docs/user-guide.md)** — logging in, creating/scheduling campaigns, following runs, targeted retries, diff and dashboards (for portal users)
- **[Getting started guide](docs/getting-started.md)** — testing locally (CLI, server+portal), running the binaries, a full Argo Workflows walkthrough, troubleshooting
- [Functional documentation](docs/functional.md)
- [Technical documentation](docs/technical.md)
- [Architecture documentation](docs/architecture.md)
- [Deployment documentation](docs/deployment.md) — per provider (`local`/`docker`/`argo`), per component, **complete configuration variable reference**
- [Engine adapters via manifest](docs/adapter-plugins.md) — add/override test engines on the fly via a downloadable manifest, at the instance or campaign level
- Per-component exhaustive code maps (directory trees, every route/table/interface — the mechanical complement to the two docs above): [Backend](docs/BACKEND_ARCHITECTURE.md), [Frontend](docs/FRONTEND_ARCHITECTURE.md), [CLI](docs/CLI_ARCHITECTURE.md), [Shared packages](docs/SHARED_PACKAGES_ARCHITECTURE.md)

## Repository structure

```
packages/shared-types        Shared neutral types + Zod schemas
packages/core                Ingestion, discovery, rule engine, engine adapters
packages/orchestration       Orchestration provider interface + registry + local provider
packages/orchestration-argo  Argo Workflows plugin (the only module depending on Kubernetes)
apps/server                  Fastify API server
apps/portal                  Next.js portal
apps/cli                     `tcs` CLI
deploy/                      Helm chart, docker-compose, kind, manual Argo step templates
examples/                    Sample test set with metadata.json
docs/                        Functional / technical / architecture documentation
```
