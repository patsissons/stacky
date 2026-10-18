# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24
ARG DOCKER_CLI_VERSION=29

# ---------------------------------------------------------------------------
# build: runs on the build host's native platform (no Node under QEMU).
# Everything produced here is platform independent JS, plus better-sqlite3,
# which ships prebuilt binaries for every platform inside its npm package.
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS build
WORKDIR /src
RUN npm install -g pnpm@10.28.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter @stacky/server... --filter @stacky/web... --filter @stacky/shared

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @stacky/web build && pnpm --filter @stacky/server build

# Runtime node_modules: only the dependencies esbuild leaves external.
RUN mkdir -p /out/server && cp -r apps/server/dist /out/server/dist \
 && cp -r apps/web/dist /out/web \
 && cd /out/server \
 && node -e "const p=require('/src/apps/server/package.json');const d=p.dependencies;require('fs').writeFileSync('package.json',JSON.stringify({name:'stacky-server',private:true,type:'module',dependencies:{'better-sqlite3':d['better-sqlite3'],dockerode:d.dockerode}},null,2))" \
 && npm install --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund \
 && rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src \
 && find node_modules/better-sqlite3/prebuilds -type f ! -name 'linuxmusl-*' -delete

# ---------------------------------------------------------------------------
# docker CLI + compose + buildx plugins (compose v5 builds via bake/buildx)
# ---------------------------------------------------------------------------
FROM docker:${DOCKER_CLI_VERSION}-cli AS docker-cli

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
ARG STACKY_VERSION=dev
LABEL org.opencontainers.image.title="stacky" \
      org.opencontainers.image.description="A modern, compose-first Docker stack manager" \
      org.opencontainers.image.source="https://github.com/patsissons/stacky" \
      org.opencontainers.image.url="https://stacky.lgtm.page" \
      org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache tini git openssh-client ca-certificates tzdata

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

WORKDIR /app
COPY --from=build /out/server ./server
COPY --from=build /out/web ./web

ENV NODE_ENV=production \
    STACKY_VERSION=${STACKY_VERSION} \
    STACKY_PORT=5005 \
    STACKY_DATA_DIR=/app/data \
    STACKY_STACKS_DIR=/opt/stacks \
    STACKY_WEB_DIR=/app/web

VOLUME /app/data
EXPOSE 5005

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.STACKY_PORT||5005)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/app/server/dist/index.js"]
