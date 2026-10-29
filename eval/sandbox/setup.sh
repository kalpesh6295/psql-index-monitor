#!/usr/bin/env bash
# One-shot sandbox setup: container, schema, data, planted damage, stats window.
# Approx runtime: 3-5 minutes total.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Starting Postgres 16 (+ hypopg, pg_stat_statements) on localhost:5499"
docker compose up -d --build --wait

echo "==> Dropping and recreating database"
docker compose exec -T indexdoctor-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS indexdoctor WITH (FORCE);" \
  -c "CREATE DATABASE indexdoctor;"

echo "==> Creating schema"
docker compose exec -T indexdoctor-db psql -U postgres -d indexdoctor -v ON_ERROR_STOP=1 -q -f /seed/01_schema.sql

echo "==> Seeding data (~6M rows, 1-2 min)"
docker compose exec -T indexdoctor-db psql -U postgres -d indexdoctor -v ON_ERROR_STOP=1 -q -f /seed/02_data.sql

echo "==> Planting damage + resetting stats"
docker compose exec -T indexdoctor-db psql -U postgres -d indexdoctor -v ON_ERROR_STOP=1 -q -f /seed/03_damage.sql

SANDBOX_URL='postgres://postgres:postgres@localhost:5499/indexdoctor'

echo "==> Running workload stats window (~13k queries, 1-2 min)"
cd ../.. && SANDBOX_DATABASE_URL="$SANDBOX_URL" npx tsx eval/sandbox/workload.ts

echo "==> Sandbox ready. To point the tools at it:"
echo "    export SANDBOX_DATABASE_URL='$SANDBOX_URL'"
