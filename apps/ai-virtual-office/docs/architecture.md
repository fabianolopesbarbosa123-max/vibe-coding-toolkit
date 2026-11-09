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

Since Stage 3 (phase 1), Supabase mode runs agent work through a persistent queue executed by separate worker
processes instead of `after()`; see [execution engine](execution-engine.md).

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
| `src/server/account.ts` | Profile, settings, files, and project deletion (Storage → file rows → project) |
| `src/server/orchestrator.ts` | Task/project lifecycle, CEO planning, execution, summaries |
| `src/server/ai/config.ts` | Central AI configuration: server-only keys, allowed models, prices, default limits |
| `src/server/ledger.ts` | The only path to an AI call: budget check, call, usage + cost, alerts, conversation record |
| `src/server/usage.ts`, `src/lib/budget.ts` | Effective limits (default → operator → personal), usage totals, admission and per-call checks |
| `src/server/http.ts` | Same-origin/JSON guard, validation, error responses |
| `src/server/jobs.ts` | User side of the execution queue: enqueue, cancel, list jobs and logs |
| `src/worker/` | Queue worker process: claim, heartbeat, cancel, timeout, retry, reaper; `PgStore` acts for one leased user |
| `src/components/office-provider.tsx` | Snapshot, Realtime subscription, fallback polling, toasts, connection state |

## Authorization layers

1. `proxy.ts` redirects anonymous page requests and rejects anonymous API calls (optimistic).
2. Each route handler calls `getOfficeContext()`, which verifies the JWT with `auth.getClaims()`.
3. Data access uses a client carrying the user's access token, so Postgres RLS enforces ownership; queries also
   filter by `owner_id`. Composite foreign keys block cross-user references. No service-role key is used at runtime.
4. Mutations require a same-origin JSON request and Zod-valid input.

## AI usage control

Keys are read only in `src/server/ai/config.ts` and never sent to the browser (the snapshot carries only
"available/unavailable"). Every AI call goes through `ledger.ts`:

1. **Admission** when work starts (task claim, CEO request, project run): refused with HTTP 429 if the user is at a
   monthly budget, monthly token, daily call, or concurrency limit.
2. **Per-call check** right before sending, with the exact prompt: the worst case counts every prompt byte as a
   token plus the full 16,000-token output allowance, priced at the higher of the model's price and the refusal
   fallback's (Claude Opus 4.8). A call that could cross a limit is not sent. Models must be in the allowlist.
3. **Recording** after the call: tokens per billed attempt (`usage.iterations` when the API returns it), cost from
   the published price table (`src/lib/pricing.ts`, null when unknown), and the project/task it belongs to.
4. **Alerts**: crossing the user's alert threshold or 100% writes a warning/error event (shown live and as a banner).

Known bound: two runs of the same user started at the same moment can both pass the check; the overshoot is at
most the worst case of the calls already in flight (the concurrency limit caps how many). Stage 3 moves the check
into an atomic database reservation.

## Project deletion

`DELETE /api/projects/:id` (refused while planning or running): remove the project's Storage objects (paths must
start with the caller's id), then the `files` rows (the database refuses while an object exists), then the project,
which cascades to tasks and conversations. Usage and activity history are kept. Every step is idempotent, so a
failed deletion can be retried without orphans; the database also blocks deleting a project that still has files.

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

In Supabase mode, runs are queue jobs (leases, retries, timeouts, cancellation) handled by the worker; see
[execution engine](execution-engine.md). The paragraph below applies to local mode only.

Runs started with `after()` reuse the request's access token. Before each task and the summary, a run stops
cleanly (project → failed, "Retomar" continues it) if the token expires within 10 minutes, so writes never fail
mid-way. If a server dies mid-run, `recover_stale_work` marks work with no progress for `OFFICE_STALE_AFTER_MINUTES`
as failed on the user's next load, so nothing stays stuck in "running". Stage 3 replaces `after()` with a job queue;
see [Stage 3 architecture](stage3-architecture.md).

## Prepared extension points

- **Stage 3 (code execution):** see [Stage 3 architecture](stage3-architecture.md).
- **Stage 4 (GitHub):** store installation/repository links per user in an owned table; never in `NEXT_PUBLIC_*`.
- **Stage 5 (research, memory, costs):** `usage_records` and `user_settings.preferences` hold the data for budgets;
  project files in Storage can feed shared memory.
