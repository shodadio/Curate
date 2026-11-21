# Dependencies come from the committed bun.lock, never from floating semver ranges: a rebuild
# months from now has to produce the React 19 / Vite 8 tree that was actually tested.
FROM oven/bun:1 AS build

WORKDIR /app

# The build reads the commit to stamp the app, so the context keeps .git and the image drops it
# again (see the build step below). A platform that builds without history can pass the commit:
# docker build --build-arg SOURCE_COMMIT=$(git rev-parse --short HEAD) .
ARG SOURCE_COMMIT=""
ENV SOURCE_COMMIT=$SOURCE_COMMIT

# An optional one-line release note, shown in the app's update notice. Empty is normal.
ARG RELEASE_NOTE=""
ENV RELEASE_NOTE=$RELEASE_NOTE

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# The stamp names the commit, so the build needs one, and it arrives one of three ways: the build
# argument above, the .git of a context that still has history, or — for a host that copies the
# tree without history and cannot pass build args, as Cloud Build does — scripts/tree-stamp.ts,
# a hash of the sources in the context. That hash is reproducible: the same tree always stamps
# the same build, so a deploy can still be matched to the sources it shipped.
# The stamp check then fails the image when none of those named anything, so the container path
# fails the way the local one does (bun run check:stamp) instead of shipping an unstamped bundle,
# and the runtime image drops the history it no longer needs.
RUN set -eu; \
    commit="${SOURCE_COMMIT}"; \
    if [ -z "$commit" ] && [ -d .git ]; then \
      commit="$(git rev-parse --short HEAD 2>/dev/null || true)"; \
    fi; \
    if [ -z "$commit" ]; then commit="$(bun scripts/tree-stamp.ts)"; fi; \
    echo "Stamping the bundle with $commit"; \
    SOURCE_COMMIT="$commit" bun run build && bun run check:stamp && rm -rf .git

FROM node:22-slim

WORKDIR /app
COPY --from=build /app ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
