# syntax=docker/dockerfile:1
# Build context = repository root (docker build -f apps/server/Dockerfile .)

FROM node:22-slim AS deps
RUN corepack enable && apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends git openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
# `--filter @tcs/server...` still pulls the root workspace's *devDependencies*
# into node_modules (pnpm resolves the whole lockfile graph regardless of
# filter scope) — among them `npm` itself (a transitive devDependency, via
# @semantic-release/npm), which vendors its own tar/sigstore/brace-expansion/
# ip-address, sometimes older than what this repo's own lockfile resolves.
# It's never imported by anything here (pnpm/tsx run everything) and this is
# a multi-stage build, so the runtime image would otherwise blanket-copy it
# straight from here (unlike the portal image's Next.js standalone tracing,
# which only carries over what's actually imported).
# Same story for `semantic-release` (drags in `handlebars`) and `vitest`/
# `vite` (drags in `tinypool`, whose v1 line — the only one vitest 3.x
# supports — has no fixed release for its current CVEs): all build/test-only
# tooling, never imported by apps/server/src at runtime, so it's stripped
# here rather than version-pinned (which would mean forcing an incompatible
# tinypool major onto vitest).
RUN pnpm install --frozen-lockfile --filter @tcs/server... \
  && pnpm --filter @tcs/server exec prisma generate \
  && find node_modules/.pnpm -maxdepth 1 \( \
       -iname 'npm@*' -o \
       -iname 'semantic-release@*' -o -iname '@semantic-release+*' -o -iname 'handlebars@*' -o \
       -iname 'vitest@*' -o -iname '@vitest+*' -o -iname 'vite@*' -o -iname '@vitejs+*' -o -iname 'tinypool@*' \
     \) -exec rm -rf {} +

# The base image's global npm install is never used at runtime (pnpm/tsx
# run everything here), but bundles its own vendored tar/sigstore/
# brace-expansion/picomatch — periodically behind and flagged by image
# scans, independent of anything in this repo's own lockfile.
FROM node:22-slim AS runtime
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends git openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
WORKDIR /app/apps/server
EXPOSE 4000
# Apply pending migrations then start (tsx runs the TS sources directly).
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec tsx src/index.ts"]
