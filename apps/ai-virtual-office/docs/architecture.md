# Architecture

```
Browser (client components)                     Next.js server (Node.js runtime)
─────────────────────────────                   ──────────────────────────────────────────────────
Auth pages ── supabase-js (cookies, PKCE) ─┐    proxy.ts: refresh session cookie, redirect anonymous → /login,
                                           │              401 for /api/* without a session
OfficeProvider ── GET /api/state ──────────┼──► state route ─► getOfficeContext() ─► store.snapshot() + account + files
  ▲  Realtime postgres_changes (RLS) ──────┘
  │  → debounced refetch; polling only as fallback
Forms POST JSON (same origin) ─────────────────► mutation routes ─► readJson (origin + JSON + Zod)
Files: upload bytes to Storage (RLS path) ─────►   ├─ orchestrator.ts  claim (atomic) → after(execute)
       then POST /api/files metadata               │     ├─ ai/providers.ts  Claude API / OpenAI API
                                                   │     └─ ai/prompts.ts    role prompts + shared results
                                                   └─ store/  SupabaseStore (user JWT, RLS) | FileStore (local mode)
```

## Modes

| Mode | When | Auth | Data |
|---|---|---|---|
| `supabase` | `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set | Supabase Auth, cookie session | Postgres with RLS, Realtime, Storage |
| `local` | No Supabase and `OFFICE_LOCAL_MODE=true` | None (single user, 127.0.0.1 only) | `.data/office.json` |
| unconfigured | Neither | — | API answers 503 with setup instructions |

## Modules

| Path | Responsibility |
|---|---|
| `src/proxy.ts` | Session refresh and optimistic route protection (public: `/login`, `/signup`, `/forgot-password`, `/auth/callback`) |
| `src/app/(auth)/` | Login, sign-up, forgot and reset password pages |
| `src/app/(office)/` | Office, tasks, agents, dashboard, profile (inside `OfficeProvider`) |
| `src/app/auth/callback/route.ts` | Exchanges e-mail link codes (PKCE) for a session |
| `src/lib/domain.ts` | Domain types and Zod input schemas shared by client and server |
| `src/lib/supabase/` | Public config and the browser client |
| `src/server/supabase.ts` | Request client (cookies), token client (user JWT), `requireUser()` (verified claims) |
| `src/server/store/` | `OfficeContext`, `OfficeStore` interface, Supabase and file implementations |
| `src/server/account.ts` | Profile, settings, and file metadata/storage operations |
| `src/server/orchestrator.ts` | Task/project lifecycle, CEO planning, execution, summaries, usage, events, conversations |
| `src/server/http.ts` | Same-origin/JSON guard, validation, error responses |
| `src/components/office-provider.tsx` | Snapshot, Realtime subscription, fallback polling, toasts, connection state |

## Authorization layers

1. `proxy.ts` redirects anonymous page requests and rejects anonymous API calls (optimistic).
2. Each route handler calls `getOfficeContext()`, which verifies the JWT with `auth.getClaims()`.
3. Data access uses a client carrying the user's access token, so Postgres RLS enforces ownership; queries also
   filter by `owner_id`. Composite foreign keys block cross-user references. No service-role key is used at runtime.
4. Mutations require a same-origin JSON request and Zod-valid input.

## Execution flow

1. `POST /api/orchestrate` checks that the CEO's provider is configured (503 otherwise), creates a project in
   `planning`, and returns 202.
2. In `after()`, the CEO and idle agents move to the meeting room. The CEO's model returns a Zod-validated plan.
   Tasks are created in order.
3. `executeProject` claims each task atomically (agent `idle|done|error → working`, task `pending|failed → running`),
   sends the role prompt plus earlier results, stores the result, usage, cost, and the full conversation.
4. The CEO writes the final summary into `project.result`.
5. Every write fires a Realtime change; open devices refetch the snapshot.

### Background runs

Runs started with `after()` reuse the request's access token. A run that outlives the JWT (default one hour) fails
its next write; work in flight is marked failed on the next local restart only. Stage 3 replaces this with a job
queue and worker identity scoped per user.

## Prepared extension points

- **Stage 3 (code execution):** add a `runner` module behind `OfficeContext`; record commands and approvals as new
  owned tables with the same RLS pattern; conversations already store exact prompts and outputs.
- **Stage 4 (GitHub):** store installation/repository links per user in an owned table; never in `NEXT_PUBLIC_*`.
- **Stage 5 (research, memory, costs):** `usage_records` and `user_settings.preferences` hold the data for budgets;
  project files in Storage can feed shared memory.
