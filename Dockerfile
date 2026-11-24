# Dependencies come from the committed bun.lock, never from floating semver ranges: a rebuild
# months from now has to produce the React 19 / Vite 8 tree that was actually tested.
FROM oven/bun:1 AS build

WORKDIR /app

# A full Git SHA is shown as the build's commit. Builds without history carry a separate snapshot id.
ARG SOURCE_COMMIT=""
ARG SOURCE_BUILD_ID=""
ENV SOURCE_COMMIT=$SOURCE_COMMIT
ENV SOURCE_BUILD_ID=$SOURCE_BUILD_ID

# An optional one-line release note, shown in the app's update notice. Empty is normal.
ARG RELEASE_NOTE=""
ENV RELEASE_NOTE=$RELEASE_NOTE

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# Name a real commit when history or a full build argument is available. Otherwise stamp a
# reproducible source snapshot id; it identifies the shipped tree but is never called a commit.
RUN set -eu; \
    commit="${SOURCE_COMMIT}"; \
    if [ -z "$commit" ] && [ -d .git ]; then \
      commit="$(git rev-parse HEAD 2>/dev/null || true)"; \
    fi; \
    build_id="${SOURCE_BUILD_ID}"; \
    if [ -z "$commit" ] && [ -z "$build_id" ]; then build_id="$(bun scripts/tree-stamp.ts)"; fi; \
    if printf '%s' "$commit" | grep -Eq '^[0-9a-fA-F]{40}$'; then echo "Stamping the bundle with commit $commit"; else echo "Stamping source snapshot ${build_id:-$commit}"; fi; \
    SOURCE_COMMIT="$commit" SOURCE_BUILD_ID="$build_id" bun run build && bun run check:stamp && rm -rf .git

FROM node:22-slim

WORKDIR /app
COPY --from=build /app ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
