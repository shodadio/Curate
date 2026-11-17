# Dependencies come from the committed bun.lock, never from floating semver ranges: a rebuild
# months from now has to produce the React 19 / Vite 8 tree that was actually tested.
FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM node:22-slim

WORKDIR /app
COPY --from=build /app ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npx", "tsx", "server.ts"]
