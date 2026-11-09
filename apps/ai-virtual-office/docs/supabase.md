# Supabase setup

The schema, RLS policies, storage bucket, and Realtime publication live in
[`supabase/migrations/20261109000000_initial.sql`](../supabase/migrations/20261109000000_initial.sql).
Local auth settings live in [`supabase/config.toml`](../supabase/config.toml).

## Local stack (development and tests)

Requires Docker.

```bash
npm run db:start          # Postgres, Auth, REST, Realtime, Storage, Mailpit
npx supabase status       # API_URL and PUBLISHABLE_KEY for .env.local
npm run db:reset          # re-apply migrations on an empty database
```

Confirmation and recovery e-mails are captured by Mailpit at http://127.0.0.1:54324.

## Cloud project

1. Create a project and apply the migration: `npx supabase link --project-ref <ref>` then `npx supabase db push`
   (review the diff first; the target must be the project you intend to change).
2. **Authentication > URL Configuration:** set *Site URL* to the app URL and add
   `https://<your-domain>/auth/callback` (and `http://127.0.0.1:3000/auth/callback` for local use) to *Redirect URLs*.
3. **Authentication > Providers > Email:** keep *Confirm email* enabled. Set the minimum password length to 8 and
   require lowercase, uppercase, and digits (matches the app's validation).
4. **Authentication > SMTP:** configure a real SMTP provider; the built-in sender is rate-limited and for testing only.
5. **Project Settings > API:** copy the URL and the publishable (anon) key into `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Do not copy the secret / service-role key into the app.
6. JWT expiry (default 3600 s) bounds how long a background project run can keep writing; see
   [architecture](architecture.md#background-runs).

## Data model

| Table | Purpose | User access (RLS) |
|---|---|---|
| `profiles` | Name per auth user (created by trigger on sign-up) | read/update own |
| `user_settings` | Auto-run, reduced motion, default provider, `preferences` JSON | read/update own |
| `agents` | The user's AI team | full CRUD on own rows |
| `projects` | Requests and CEO results | full CRUD on own rows |
| `tasks` | Ordered work items | full CRUD on own rows |
| `agent_conversations` / `agent_messages` | Exact prompt/response of each planning, task, and summary call | full CRUD on own rows |
| `activity_events` | Activity history | read/insert own (append-only) |
| `usage_records` | Tokens and estimated cost per call, with `project_id` kept after project deletion | read/insert own (append-only) |
| `usage_limits` | Operator-defined limits per user (budget, tokens, daily calls, concurrency) | read own; **no user writes** |
| `files` | Metadata of uploads in the private `office-files` bucket | read/insert own; update only `name`/`project_id`; delete only after the object is gone |

Functions (security invoker, so RLS applies): `usage_summary(month_start, day_start)` returns the caller's totals;
`recover_stale_work(interval)` marks the caller's abandoned work as failed.

Every table has `owner_id uuid` (or `user_id`) referencing `auth.users` with `on delete cascade`. Composite foreign keys
`(id, owner_id)` make a task, conversation, or file unable to reference another user's agent or project, even if
an id leaks. `anon` has no table privileges. Storage policies allow access only under `<auth.uid()>/` in the
`office-files` bucket; `files.storage_path` must start with the owner's id.

### Storage and metadata consistency

- An object can only be uploaded after its `files` row exists (Storage insert policy), so no object exists without metadata.
- A `files` row can only be deleted once its object is gone, so no object is left without metadata.
- `files.project_id` references the project with `on delete restrict`: a project with files cannot be deleted
  directly, even through the REST API. The app removes objects, then rows, then the project.
- The bucket allows only the app's MIME types and 10 MB per file, also for direct API uploads.

## Per-user AI limits

Defaults come from `OFFICE_DEFAULT_*` environment variables. To change one user's limits, run in the SQL editor
(or with the secret key from a trusted script, never from the app):

```sql
insert into public.usage_limits (user_id, monthly_budget_usd, monthly_token_limit, daily_request_limit, max_concurrent_runs, note)
values ('<user uuid>', 25, 5000000, 300, 3, 'pilot customer')
on conflict (user_id) do update set monthly_budget_usd = excluded.monthly_budget_usd,
  monthly_token_limit = excluded.monthly_token_limit, daily_request_limit = excluded.daily_request_limit,
  max_concurrent_runs = excluded.max_concurrent_runs, note = excluded.note;
```

A null column falls back to the default. Users can only lower their budget (`personal_monthly_budget_usd`) and
choose the alert threshold (`budget_alert_percent`) on the profile page.

Realtime publishes `agents`, `projects`, `tasks`, `activity_events`, `usage_records`, and `files`; Realtime checks
RLS before delivering each change, so subscribers receive only their own rows.
