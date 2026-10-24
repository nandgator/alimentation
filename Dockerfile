# syntax=docker/dockerfile:1

# One image for every place this runs outside Cloudflare Workers: a dedicated
# instance on any host that runs containers, and the test run in CI.
#
#   docker build -t alimentation .
#   docker compose up                              a dedicated instance with its own Postgres
#   docker compose -f compose.test.yaml run --rm test    the test suite against Postgres 18

ARG NODE=24-alpine

FROM node:${NODE} AS deps
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

FROM node:${NODE} AS run
ENV NODE_ENV=production PORT=8787 WEB_DIR=/app/web INSTANCE_DIR=/data
WORKDIR /app
COPY --from=build /src/apps/api/dist/node.mjs /src/apps/api/dist/cli.mjs ./
COPY --from=build /src/apps/web/dist ./web
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=4 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "node.mjs"]
