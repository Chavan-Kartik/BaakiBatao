# syntax=docker/dockerfile:1.7
#
# One Dockerfile, several targets:
#
#   deps      workspace with dependencies installed from the lockfile alone,
#             so the layer caches until pnpm-lock.yaml changes
#   verify    runs the whole CI gate: typecheck · lint · dep-cruise · tests ·
#             both eval gates. `docker build --target verify .` is CI in a box
#   api       the case API — sign-in, uploads, the pipeline — on Node
#   eval      the evaluation CLI (`docker run … run --count 200 --profile degraded`)
#   web       the built UI served by nginx with the same cache rules CloudFront
#             uses: index.html never cached, fingerprinted assets immutable
#
# `docker compose up` wires api + web-dev together for local development.

ARG NODE_VERSION=22
ARG PNPM_VERSION=11.22.0

# ---------------------------------------------------------------- base
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm CI=1
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ---------------------------------------------------------------- deps
# `pnpm fetch` needs only the lockfile, so source edits do not invalidate the
# downloaded store; the offline install afterwards is seconds.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile

# ---------------------------------------------------------------- verify
FROM deps AS verify
RUN pnpm typecheck && pnpm lint && pnpm dep:cruise && pnpm test && pnpm eval:assert

# ---------------------------------------------------------------- api
FROM deps AS api
ENV NODE_ENV=production PORT=3000 FC_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
USER node
CMD ["pnpm", "--filter", "@fc/api", "start"]

# ---------------------------------------------------------------- eval
FROM deps AS eval
ENTRYPOINT ["pnpm", "--filter", "@fc/eval", "exec", "tsx", "src/cli.ts"]
CMD ["run", "--count", "40"]

# ---------------------------------------------------------------- web-build
FROM deps AS web-build
RUN pnpm web:build

# ---------------------------------------------------------------- web
FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
