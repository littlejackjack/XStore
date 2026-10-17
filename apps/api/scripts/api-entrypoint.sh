#!/bin/sh
# =============================================================================
# XStore API container entrypoint
#   1. wait for PostgreSQL
#   2. run pending SQL migrations (production-safe, no implicit schema sync)
#   3. optionally seed the super admin / default settings
#   4. start the HTTP server
# =============================================================================
set -e

echo "[entrypoint] waiting for PostgreSQL..."
until node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>{c.end();process.exit(0)}).catch(()=>process.exit(1))}" 2>/dev/null; do
  sleep 2
done
echo "[entrypoint] PostgreSQL is ready"

echo "[entrypoint] running database migrations"
node dist/database/run-migrations.js

if [ "${SEED_SUPER_ADMIN}" = "true" ]; then
  echo "[entrypoint] seeding super admin + defaults"
  node dist/database/seed.js
fi

echo "[entrypoint] starting API server"
exec node dist/main.js
