#!/bin/sh
# =============================================================================
# XStore worker container entrypoint (background jobs only, no HTTP server)
# =============================================================================
set -e

echo "[worker] waiting for PostgreSQL..."
until node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>{c.end();process.exit(0)}).catch(()=>process.exit(1))}" 2>/dev/null; do
  sleep 2
done

echo "[worker] starting background worker (provisioning + server status)"
exec node dist/worker.js
