# Execution engine (Stage 3, phase 1)

Persistent queue that runs agent work outside the web server. Implemented in
[`supabase/migrations/20261111000000_stage3_execution_engine.sql`](../supabase/migrations/20261111000000_stage3_execution_engine.sql),
[`src/server/jobs.ts`](../src/server/jobs.ts) (user side), and [`src/worker/`](../src/worker/) (worker).
Design context: [Stage 3 architecture](stage3-architecture.md).

## Flow

```
User (JWT) ── POST /api/tasks/:id/run ──► validate (state, integration, budget for the exact prompt)
                                          └─► insert jobs (RLS: owner = auth.uid(), status forced to queued)
Worker (Postgres login role) ── office_claim_job() ──► running (lease) ──► orchestrator + ledger
     │  heartbeat every ≤3 s: extends lease, receives cancel requests
     └─ office_finish_job / office_fail_job (retry with backoff) / office_reap_jobs (dead workers, timeouts)
UI ◄── Realtime (jobs, activity) and /api/jobs/:id/events (logs)
```

In Supabase mode the three run points enqueue: `POST /api/tasks/:id/run` (`task_run`), `POST /api/projects/:id/run`
(`project_run`), and `POST /api/orchestrate` (`orchestrate`: CEO planning, then the project if auto-run is on).
Local mode (`OFFICE_LOCAL_MODE`) keeps in-process execution and has no queue.

## States

| State | Meaning | Next |
|---|---|---|
| `pending` | Reserved for jobs waiting on dependencies (Manager Agent, phase 2) | `queued`, `cancelled` |
| `queued` | Waiting for a worker (or for its retry time) | `running`, `cancelled` |
| `running` | Leased by one worker | `completed`, `failed`, `cancelled`, `queued` (retry), `waiting_approval` |
| `waiting_approval` | Reserved for human approval (phase 4) | `running`, `cancelled`, `failed` |
| `completed`, `failed`, `cancelled` | Final | — |

A trigger rejects any other transition, for every writer. Every change is written to `job_events`.

## Identity and permissions

- **Users** can insert jobs for themselves (the server forces state, attempts, and limits), set `cancel_requested`,
  and read their own jobs and logs. They cannot change a job's state, forge logs, or call worker functions.
- **Workers** connect to Postgres with a login role that is a member of `office_worker`. They never use the
  service-role key. They change jobs only through `office_*` security-definer functions, and RLS lets them read
  or write a user's agents, projects, tasks, conversations, activity, and usage **only while holding a live lease
  on one of that user's jobs** (`locked_by = session_user`). They have no access to files, profiles, Storage, or
  the `auth` schema, and cannot delete anything.

## Limits and protections

| Limit | Value | Where |
|---|---|---|
| Concurrent jobs per user | `usage_limits.max_concurrent_runs`, else `OFFICE_DEFAULT_MAX_CONCURRENT_RUNS` (2); enforced under a per-user lock when claiming, so racing workers cannot exceed it | `office_claim_job` |
| Waiting jobs per user | 50 | insert trigger |
| One active job per task and per project run | unique partial indexes | database |
| Attempts | `task_run` 3, `project_run` 2, `orchestrate` 1 (planning is not idempotent) | insert trigger |
| Retry backoff | 30 s, 60 s, 120 s … max 10 min; only for transient provider errors or a busy agent | `office_fail_job`, `src/worker/runner.ts` |
| Timeout per attempt | `task_run` 10 min, others 30 min; the worker aborts the AI call, the reaper fails it if the worker cannot | worker + `office_reap_jobs` |
| Lease | `WORKER_LEASE_SECONDS` (default 60 s); expired leases are requeued (or failed when out of attempts) and the task, project, and agents the dead worker left busy are released | `office_reap_jobs` |
| Worker parallelism | `WORKER_CONCURRENCY` (default 2, max 8) | worker |
| AI budget | Every AI call still goes through `ledger.ts` (per-call worst case, monthly/daily limits) | Stage 2 |

Not yet atomic: two jobs of the same user running at the same time can both pass the per-call budget check
(overshoot bounded by the in-flight calls; the concurrency limit caps them). Phase 6 adds the atomic reservation.

## Running a worker

The worker is a separate process. It must not run inside the web server.

### Local

```bash
npm run db:start
WORKER_ROLE=office_worker_local WORKER_PASSWORD='<strong password>' scripts/create-worker-role.sh
# .env.local
WORKER_DATABASE_URL=postgresql://office_worker_local:<password>@127.0.0.1:54322/postgres
npm run worker            # next to npm run dev
```

### Supabase cloud

1. Apply the migrations (`npx supabase db push`).
2. In the SQL editor, create one login role per worker host (never reuse `postgres`):
   ```sql
   create role office_worker_prod1 login password '<generated, 32+ chars>' in role office_worker;
   ```
3. On the worker host, set `WORKER_DATABASE_URL` to the **direct** connection string (or the session-mode
   pooler) with that role, plus the AI variables from `.env.example`. Store it in the host's secret manager.
4. Run `npm ci && npm run worker` under a supervisor (systemd, container restart policy). It stops gracefully on
   SIGTERM: running jobs are returned to the queue.
5. The UI shows "Nenhum worker de execução está ativo" when no worker has reported in the last 30 seconds.

Rotate a worker password with `alter role ... password ...`; revoke a host with `drop role` after its jobs finish.

## Observability

- `job_events`: enqueued, state changes, attempt start, each AI call (model, tokens, cost), activity, cancellation,
  and errors. Shown in **Tarefas → Execuções → Logs**.
- Worker stdout: one line per job start/finish/retry and reaper actions.
