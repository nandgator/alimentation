# syntax=docker/dockerfile:1

# One image for every place this runs outside Cloudflare Workers: a dedicated
# instance on any host that runs containers, and the test run in CI.
#
#   docker build -t alimentation .
#   docker compose up                              a dedicated instance with its own Postgres
#   docker compose -f compose.test.yaml run --rm test    the test suite against Postgres 18

ARG NODE=24-alpine

# Packages are installed with bun, from bun.lock; Node stays the runtime and runs the scripts.
FROM docker.io/library/node:${NODE} AS deps
COPY --from=docker.io/oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /src
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/reference/package.json apps/reference/
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

# Everything, for running the tests.
FROM deps AS dev
COPY . .
CMD ["bun", "run", "test"]

FROM dev AS build
RUN bun run --filter @alimentation/api build:server \
 && mkdir -p apps/web/dist \
 && if [ -f apps/web/index.html ]; then bun run build:web; fi \
 && bun run build:reference

# The API reference: its own small image, apart from the app, started with `--profile reference`.
FROM docker.io/library/node:${NODE} AS reference
ENV PORT=8788
WORKDIR /app
COPY --from=build /src/apps/reference/dist ./dist
COPY apps/reference/serve.mjs ./
USER node
EXPOSE 8788
CMD ["node", "serve.mjs"]

FROM docker.io/library/node:${NODE} AS run
ENV NODE_ENV=production PORT=8787 WEB_DIR=/app/web INSTANCE_DIR=/data
WORKDIR /app
COPY --from=build /src/apps/api/dist/node.mjs /src/apps/api/dist/cli.mjs ./
COPY --from=build /src/apps/web/dist ./web
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
# The health check is in compose.yaml, not here: an image built in the OCI format (podman's default) cannot
# carry one, and says so on every build.
CMD ["node", "node.mjs"]
