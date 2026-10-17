#!/usr/bin/env bash
# =============================================================================
# Local development helper WITHOUT Docker.
# Requires a locally running PostgreSQL and Redis (or use Docker only for them:
#   docker run -d --name xstore-db -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16-alpine
#   docker run -d --name xstore-redis -p 6379:6379 redis:7-alpine
# ).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://xstore:dev@127.0.0.1:5432/xstore}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export JWT_SECRET="${JWT_SECRET:-dev-only-jwt-secret-at-least-32-characters}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-dev-only-encryption-key-32-chars-min}"
export DB_SYNC=true
export SEED_SUPER_ADMIN=true
export SWAGGER_ENABLED=true
export NODE_ENV=development

echo "==> Installing dependencies"
(cd apps/api && npm install)
(cd apps/web && npm install)

echo "==> Seeding database (super admin: ${SUPER_ADMIN_EMAIL:-admin@example.com})"
(cd apps/api && npm run build && npm run seed)

echo ""
echo "==> Starting API on :4000, web on :3000 (Ctrl+C to stop)"
(cd apps/api && npm run start:dev) &
(cd apps/web && npm run dev) &
wait
