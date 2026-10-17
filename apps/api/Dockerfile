# =============================================================================
# XStore API - production Dockerfile (multi-stage)
# Build context: ./apps/api
# =============================================================================

# ---------- Stage 1: build ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Install build toolchain for any native deps (pg etc. ship prebuilt, this is a safety net)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# dumb-init for correct signal handling / graceful shutdown
RUN apk add --no-cache dumb-init curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts ./scripts
RUN chmod +x ./scripts/*.sh

# Run as an unprivileged user
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "scripts/api-entrypoint.sh"]

# The worker service overrides the command:
#   command: ["sh", "scripts/worker-entrypoint.sh"]
