# Dependencies come from the committed bun.lock, never from floating semver ranges: a rebuild
# months from now has to produce the React 19 / Vite 8 tree that was actually tested.
FROM oven/bun:1 AS build

WORKDIR /app

# The build reads the commit to stamp the app, so the context keeps .git and the image drops it
# again (see the build step below). A platform that builds without history can pass the commit:
# docker build --build-arg SOURCE_COMMIT=$(git rev-parse --short HEAD) .
ARG SOURCE_COMMIT=""
ENV SOURCE_COMMIT=$SOURCE_COMMIT

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# The commit is read from .git during the build; the runtime image does not need the history.
# The stamp check fails the image when the bundle cannot name its commit, so the container path
# fails the same way the local one does (bun run check:stamp) instead of shipping unstamped.
RUN bun run build && bun run check:stamp && rm -rf .git

FROM node:22-slim

WORKDIR /app
COPY --from=build /app ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
