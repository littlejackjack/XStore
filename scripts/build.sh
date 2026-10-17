#!/usr/bin/env bash
# =============================================================================
# Builds every Docker image for the XStore stack.
#
#   ./scripts/build.sh
#
# Prerequisites: Docker >= 24 with the compose plugin, and a filled-in .env
# (cp .env.example .env). Equivalent to the compose build step of
# `docker compose up -d --build`.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run: cp .env.example .env   and fill in the values."
  exit 1
fi

# Generate strong secrets automatically if they are still empty.
if ! grep -qE '^(ENCRYPTION_KEY|JWT_SECRET)=..*' .env; then
  echo "==> Generating missing secrets in .env"
  sed -i "s|^ENCRYPTION_KEY=$|ENCRYPTION_KEY=$(openssl rand -base64 48)|" .env
  sed -i "s|^JWT_SECRET=$|JWT_SECRET=$(openssl rand -base64 48)|" .env
fi

echo "==> Building images (api, web)"
docker compose build app worker web

echo ""
echo "==> Images built successfully:"
docker compose images --format "table {{.Service}}\t{{.Repository}}\t{{.Tag}}"
echo ""
echo "Next step:  docker compose up -d"
