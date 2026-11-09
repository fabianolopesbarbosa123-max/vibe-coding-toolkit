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
| `usage_records` | Tokens and estimated cost per call | read/insert own (append-only) |
| `files` | Metadata of uploads in the private `office-files` bucket | full CRUD on own rows |

Every table has `owner_id uuid` referencing `auth.users` with `on delete cascade`. Composite foreign keys
`(id, owner_id)` make a task, conversation, or file unable to reference another user's agent or project, even if
an id leaks. `anon` has no table privileges. Storage policies allow access only under `<auth.uid()>/` in the
`office-files` bucket; `files.storage_path` must start with the owner's id.

Realtime publishes `agents`, `projects`, `tasks`, `activity_events`, `usage_records`, and `files`; Realtime checks
RLS before delivering each change, so subscribers receive only their own rows.
