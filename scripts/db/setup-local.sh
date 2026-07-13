#!/usr/bin/env bash
# Set up the Vaani database: a stub `auth` schema compatible with the Supabase
# primitives our migrations use (auth.users, auth.uid()), the authenticated/anon
# roles RLS policies apply to, then migrations + seed.
#
# Two modes:
#   • DATABASE_URL set → runs against that Postgres via `psql "$DATABASE_URL"`.
#     Portable (Docker, or any Postgres you own + superuser). Needs a local
#     `psql` client. Use this on macOS/Windows.
#         docker run -d --name vaani-pg -e POSTGRES_PASSWORD=postgres \
#           -e POSTGRES_DB=vaani -p 5432:5432 postgres:16
#         DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/vaani pnpm db:setup
#   • DATABASE_URL unset → local system Postgres via `su postgres` (Debian/Ubuntu,
#     run with sudo). Creates the `vaani` database for you.
#
# For a managed Supabase project use the Supabase CLI instead (`supabase db push`
# then apply supabase/seed.sql) — auth + roles already exist there.
set -euo pipefail

DB_NAME="${DB_NAME:-vaani}"

# ── portable mode: everything through psql "$DATABASE_URL" ───────────────────
if [ -n "${DATABASE_URL:-}" ]; then
  command -v psql >/dev/null || { echo "psql client not found — install postgresql-client / libpq"; exit 1; }
  echo "▶ target: \$DATABASE_URL"
  echo "▶ stub Supabase auth schema + roles + migrations table"
  # single-quoted heredoc so the shell leaves $$ dollar-quoting alone
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists auth;
create extension if not exists pgcrypto;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
grant usage on schema public, auth to authenticated, anon;
create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now());
SQL

  echo "▶ migrations"
  for f in supabase/migrations/*.sql; do
    name="$(basename "$f")"
    already="$(psql "$DATABASE_URL" -tAq -c "select 1 from public._migrations where name='$name'")"
    if [ "$already" = "1" ]; then
      echo "  skip $name (applied)"
    else
      echo "  apply $name"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "insert into public._migrations (name) values ('$name')"
    fi
  done

  echo "▶ grants for RLS-tested roles"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "grant select, insert, update, delete on all tables in schema public to authenticated"
  echo "▶ seed (idempotent)"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql
  echo "✅ database ready at \$DATABASE_URL"
  exit 0
fi

# ── local system Postgres (Debian/Ubuntu, run with sudo) ─────────────────────
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
