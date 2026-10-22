## [1.0.1](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/compare/v1.0.0...v1.0.1) (2026-08-12)


### Bug Fixes

* **ci,docs:** regenerate stale Helm README, auto-regen on future releases ([d500c38](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/d500c38740641898a5dc4fa3faebeafa2b92252b))
* **ci:** retry external curl downloads (transient DNS failures on the Pi runner) ([5950d9c](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/5950d9c4829fe6d470f55a18bbfbb0fdc0f26f58))

# 1.0.0 (2026-08-11)


### Bug Fixes

* **build:** support running the same checkout from Windows and WSL ([3673cba](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/3673cbab6b6b68c82814e1da27ccc8899f11464e))
* **ci,deps:** purge stale node_modules before Kaniko builds, patch undici CVE ([363cb46](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/363cb4655c3a52acc5c5b1f193013876c09b6d4a))
* **ci,docker:** fix comment-in-RUN and busybox tar pipe extraction ([e44b8cc](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/e44b8cc6505c86b5f7024b9adc784e8e2b0cc13f))
* **ci:** build images with Kaniko, drop docker:dind (arm64-only runner) ([d8b4ea8](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/d8b4ea8c49042aa6faa48fda090d09c8d75a9e81))
* **ci:** bump pinned Trivy to 0.72.0 ([d8dbf1c](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/d8dbf1cce792529fd14d5e5b8ee155ee509829bc))
* **ci:** correct kaniko flags (--tar-path, always pass --destination) ([5371239](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/5371239f10af0ddf02a2760d6494e7034a3e1dd3))
* **ci:** disable kaniko's registry build cache (stale layer suspected) ([766f8ae](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/766f8aec83265d9e91a0cd4deda5059a13b7125d))
* **ci:** fix buildx builder creation on GitLab dind TLS endpoint ([08c3da5](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/08c3da517da187debf1aa5c1df6f058da62713ba))
* **deps:** patch critical/high CVEs in adm-zip, fast-uri, sharp ([5b0c292](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/5b0c29230033062d774f9fba4f1bb2bbd620f043))
* **deps:** patch CVEs in brace-expansion, picomatch, sigstore, tar ([b5b3077](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/b5b3077091eb3481ae21335c229c6a46a7b03f70))
* **deps:** patch CVEs in fast-uri and ip-address ([a403402](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/a403402f53a559bc4559183590fdebf6b4504162))
* **deps:** patch CVEs in find-my-way, next, postcss ([6c4afc9](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/6c4afc99091f93274bd1ee3d80cc3d317c030acf))
* **deps:** patch CVEs in js-yaml and nanoid ([b124d1f](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/b124d1f8ba80e54dba27d1ae47256b340a5d3d24))
* **deps:** support arm64 CI runners, patch new postcss CVE ([1a4059b](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/1a4059bf66f2b2861f6ca7a005b892a634969b21))
* **docker,deps:** remove npm from server build stage, bump brace-expansion ([a795242](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/a795242405ee1b224c00a43eed068087ce2b8d06))
* **docker:** add .dockerignore to stop stale node_modules from leaking into images ([1a47f52](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/1a47f52690068a0afb823466702b8958410a8c95))
* **docker:** remove unused global npm from runtime images (real root cause) ([d13e6a7](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/d13e6a7aae3022b4e9bd04353cef33ac762b77ff))
* **server:** boot resiliently when DB/S3 are unreachable (readyz reports degraded state) ([b000ba9](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/b000ba99991882ba2b9f4fee1d060d42392bf678))
* **test:** generate the Prisma client before integration tests in CI ([3735f3d](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/3735f3d5f1b7593c344681fad8f96bf37f2f222c))


### Features

* **adapters:** downloadable engine adapter manifests (instance + per-campaign) ([3bf21ee](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/3bf21eeff5a76462eb4c98835144013f58afd0d0))
* **adapters:** portal admin UI, CLI --adapter-manifest flag, user guide ([0d80ad4](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/0d80ad46a8a8fea2a5c36b654ec219aa15992d05))
* **ci,deploy:** helm unit tests, mise toolchain, Renovate, and a complete CI ([3b15dca](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/3b15dca23a92066448c27968170b68291b686d07))
* **ci:** mirror GitHub CI on GitLab (quality/build/scan/release) ([6dadd81](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/6dadd812bd2e955c8abcf9f9823a9ded455887f1))
* **cli:** tcs discover/preview/run/engines + example test suites (4 tests, 3 engines, rich metadata) ([542308e](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/542308eb26c9258e17c97baed16006fe7f1b4bad))
* **core:** pluggable engine adapters (robot, selenium, cypress, protractor, generic java/node/python) ([4891e05](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/4891e0563efa34e9b40190aa5a423dd8843a6e5f))
* **core:** shared types, selection rule engine, ingestion (git/local/zip) and test discovery ([d2a20d8](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/d2a20d860a20457faddcb0202ecade24c2a40dfb))
* **deploy,docs:** docker-compose dev env, multi-stage Dockerfiles, Helm chart (server/portal/RBAC/dev postgres+minio), kind+Argo setup, manual step template contract, functional/technical/architecture docs with Mermaid diagrams ([fd44d0f](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/fd44d0fa3798226dc1de182e694b93eb631880fc))
* **dev:** add docker compose for dev deployment ([fae19cd](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/fae19cdb8fe8a07335fb3f73d1f4870d5749cd77))
* **orchestration:** container-encapsulated execution for the local provider (docker runtime) ([3d958ba](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/3d958babe97ccfb69e90ccd539c605b9eb8e0702))
* **orchestration:** pluggable provider interface, local dev provider, Argo Workflows plugin ([d0aa738](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/d0aa7384e6a0aa65fdc2acab79c41445ae314d46))
* **portal:** Next.js portal — adaptive login, campaign CRUD with visual rule builder + live selection preview, real-time run view (SSE), targeted retry, log streaming, run diff, dashboards ([a25814d](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/a25814d199b13ad5015866404fca4fc3a7d50bb9))
* **projects:** add project workspace scoping campaigns (API/portal only) ([adbab67](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/adbab67c8c7ae3bf6b571666e8692c3f17634340))
* **results:** reliable per-test results from the aggregated JUnit + portal display ([383d08f](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/383d08fec37a8b86c80a7fb0c27cf21be53baf1e))
* **scheduler:** automatic scheduled campaign launches (cron) ([f09b700](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/f09b7002f6c7f5484bf7f850dfc0ab9f5318cf45))
* **server:** Fastify API — auth (OIDC JIT + local password + RBAC), campaign CRUD with rule preview, runs, JUnit ingestion, diff, SSE, Prometheus metrics, S3 artifacts ([a7c148b](https://gitlab.com/cluster-mono-repo/test-ai/test-fable-tcs/commit/a7c148b7d09dd44bfb173c4710a3d2057c1b5a4a))
