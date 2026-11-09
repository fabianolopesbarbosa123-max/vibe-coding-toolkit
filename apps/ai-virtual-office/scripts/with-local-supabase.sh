#!/usr/bin/env bash
# Exports the local Supabase stack's development keys (from `supabase status`) and runs a command.
# These are the CLI's well-known local defaults, not project credentials.
set -euo pipefail
eval "$(npx supabase status -o env 2>/dev/null | grep -E '^(API_URL|PUBLISHABLE_KEY|SECRET_KEY)=')"
export SUPABASE_TEST_URL="$API_URL" SUPABASE_TEST_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" SUPABASE_TEST_SECRET_KEY="$SECRET_KEY"
exec "$@"
