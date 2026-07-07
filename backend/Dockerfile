FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate only needs DATABASE_URL to *resolve*, not to be a real connection —
# it never connects to the DB during generation, only reads the schema.
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV DATABASE_URL=${DATABASE_URL}
RUN bunx prisma generate

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app .

EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]