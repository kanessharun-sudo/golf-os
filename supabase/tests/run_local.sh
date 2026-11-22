#!/usr/bin/env bash
# Applies the shim, all migrations and both behaviour suites to a throwaway
# local Postgres 15+ database. Usage: DATABASE_URL=postgres://... npm run db:test
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to an empty scratch database (never Supabase)}"
dir="$(cd "$(dirname "$0")/.." && pwd)"
for file in tests/00_supabase_shim.sql migrations/001_initial_schema.sql \
            migrations/002_seed_asc_centre.sql migrations/003_checkout_flow.sql \
            migrations/004_function_privileges.sql migrations/005_demo_white_tee_only.sql \
            migrations/006_live_scoring.sql migrations/007_members_admin_caddy.sql migrations/008_demo_seed_today.sql \
            tests/10_phase1_behaviour.sql tests/20_phase2_checkout.sql \
            tests/30_function_privileges.sql tests/40_phase3_scoring.sql tests/50_phase4_members.sql; do
  echo "→ ${file}"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "${dir}/${file}"
done
