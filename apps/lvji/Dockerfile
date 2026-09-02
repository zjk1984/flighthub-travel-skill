# Build from repository root:
#   docker build -f apps/lvji/Dockerfile -t lvji-travel .

FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable

# Repo-root FlyAI skill (shared by lvji flight/hotel)
COPY SKILL.md _meta.json ./
COPY references ./references
COPY scripts ./scripts

COPY apps/lvji/package.json apps/lvji/pnpm-lock.yaml ./apps/lvji/
WORKDIR /app/apps/lvji
RUN pnpm install --frozen-lockfile

COPY apps/lvji ./
RUN pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
RUN corepack enable

COPY apps/lvji/package.json apps/lvji/pnpm-lock.yaml ./apps/lvji/
WORKDIR /app/apps/lvji
RUN pnpm install --frozen-lockfile --prod && \
    pnpm add -D drizzle-kit && \
    pnpm store prune

COPY --from=builder /app/SKILL.md /app/SKILL.md
COPY --from=builder /app/references /app/references
COPY --from=builder /app/scripts /app/scripts
COPY --from=builder /app/apps/lvji/.next ./.next
COPY --from=builder /app/apps/lvji/public ./public
COPY --from=builder /app/apps/lvji/db ./db
COPY --from=builder /app/apps/lvji/drizzle.config.ts ./

EXPOSE 4173
CMD ["sh", "-c", "npx drizzle-kit push && exec pnpm start"]
