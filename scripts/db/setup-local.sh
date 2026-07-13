#!/usr/bin/env bash
# Local Postgres for integration tests (mirrors what Supabase provides).
# Creates the vaani database, a stub `auth` schema compatible with the
# Supabase primitives our migrations use (auth.users, auth.uid()), the
# authenticated/anon roles RLS policies apply to, then runs migrations + seed.
#
# Usage: bash scripts/db/setup-local.sh
# Then:  export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/vaani
set -euo pipefail

DB_NAME="${DB_NAME:-vaani}"
PSQL_SUPER=(su postgres -c)

run_sql() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -d '$1' -c \"$2\""; }
run_file() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -d '$1' -f '$2'"; }

echo "▶ ensuring password + database"
run_sql postgres "ALTER USER postgres PASSWORD 'postgres';"
if ! su postgres -c "psql -lqt" | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
  su postgres -c "createdb $DB_NAME"
fi

echo "▶ stub Supabase auth schema + roles"
run_sql "$DB_NAME" "CREATE SCHEMA IF NOT EXISTS auth;"
run_sql "$DB_NAME" "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
run_sql "$DB_NAME" "CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);"
# Supabase's auth.uid() reads the JWT sub claim; same trick works locally.
run_sql "$DB_NAME" "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \\\$\\\$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \\\$\\\$;"
run_sql "$DB_NAME" "DO \\\$\\\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END \\\$\\\$;"
run_sql "$DB_NAME" "GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;"

echo "▶ migrations"
applied_table_sql="CREATE TABLE IF NOT EXISTS public._migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"
run_sql "$DB_NAME" "$applied_table_sql"
for f in supabase/migrations/*.sql; do
  name="$(basename "$f")"
  already="$(su postgres -c "psql -tAq -d $DB_NAME -c \"SELECT 1 FROM public._migrations WHERE name='$name'\"")"
  if [ "$already" = "1" ]; then
    echo "  skip $name (applied)"
  else
    echo "  apply $name"
    run_file "$DB_NAME" "$PWD/$f"
    run_sql "$DB_NAME" "INSERT INTO public._migrations (name) VALUES ('$name');"
  fi
done

echo "▶ grants for RLS-tested roles"
run_sql "$DB_NAME" "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;"

echo "▶ seed (idempotent)"
run_file "$DB_NAME" "$PWD/supabase/seed.sql"

echo "✅ local DB ready — export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/$DB_NAME"
