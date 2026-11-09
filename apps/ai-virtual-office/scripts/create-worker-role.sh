#!/usr/bin/env bash
# Creates (or rotates) a worker login role in the LOCAL Supabase database.
# Usage: WORKER_ROLE=office_worker_local WORKER_PASSWORD='<strong password>' scripts/create-worker-role.sh
# For a cloud project, run the same SQL in the SQL editor (see docs/execution-engine.md).
set -euo pipefail
: "${WORKER_ROLE:?set WORKER_ROLE}"
: "${WORKER_PASSWORD:?set WORKER_PASSWORD}"
[[ "$WORKER_ROLE" =~ ^[a-z_][a-z0-9_]{2,40}$ ]] || { echo "invalid role name" >&2; exit 1; }
DB_URL="$(npx supabase status -o env 2>/dev/null | sed -n 's/^DB_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
psql "$DB_URL" -v ON_ERROR_STOP=1 -v role="$WORKER_ROLE" -v pass="$WORKER_PASSWORD" <<'SQL'
select format('create role %I login password %L in role office_worker', :'role', :'pass')
 where not exists (select 1 from pg_roles where rolname = :'role') \gexec
select format('alter role %I login password %L', :'role', :'pass') \gexec
SQL
echo "Worker role ready: $WORKER_ROLE"
