# syntax=docker/dockerfile:1
# Build context = repository root (docker build -f apps/portal/Dockerfile .)

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types
COPY apps/portal ./apps/portal
RUN pnpm install --frozen-lockfile --filter @tcs/portal...
ENV NEXT_OUTPUT_STANDALONE=true
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @tcs/portal build

FROM node:22-slim AS runtime
# The base image's global npm install is never used at runtime (the
# standalone server.js is run directly), but bundles its own vendored
# tar/sigstore/brace-expansion/picomatch — periodically behind and flagged
# by image scans, independent of anything in this repo's own lockfile.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/portal/.next/standalone ./
COPY --from=build /app/apps/portal/.next/static ./apps/portal/.next/static
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/portal/server.js"]
