FROM oven/bun:1 AS base
WORKDIR /app

FROM base as deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 5173
CMD ["bun", "run", "start"]