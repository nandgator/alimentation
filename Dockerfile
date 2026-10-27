# syntax=docker/dockerfile:1

# One image for every place this runs outside Cloudflare Workers: a dedicated
# instance on any host that runs containers, and the test run in CI.
#
#   docker build -t alimentation .
#   docker compose up                              a dedicated instance with its own Postgres
#   docker compose -f compose.test.yaml run --rm test    the test suite against Postgres 18

ARG NODE=24-alpine

FROM docker.io/library/node:${NODE} AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci

# Everything, for running the tests.
FROM deps AS dev
COPY . .
CMD ["npm", "test"]

FROM dev AS build
RUN npm run build:server -w @alimentation/api \
 && mkdir -p apps/web/dist \
 && if [ -f apps/web/index.html ]; then npm run build:web; fi

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
