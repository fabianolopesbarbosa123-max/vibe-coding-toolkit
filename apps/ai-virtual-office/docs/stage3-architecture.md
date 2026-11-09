# Stage 3 architecture

Status: **phase 1 (execution engine) implemented** — see [execution engine](execution-engine.md). Sections 2–10
below are still plans. This design extends
[architecture.md](architecture.md) without changing Stage 2 contracts (owner-scoped tables, RLS, `ledger.ts`).

## Goals and non-goals

- Agents create and edit files, install allowlisted dependencies, run commands and tests, and report results.
- Every run is isolated, resource-limited, auditable, and attributable to one user.
- Non-goals for Stage 3: GitHub pushes (Stage 4), internet research tools (Stage 5).

## Components

```
Next.js (request)                 Postgres (Supabase)                         Worker host(s)
─────────────────                 ───────────────────                         ──────────────
POST /api/runs ──insert──► jobs (owner_id, kind, status, budget)  ◄──claim── worker loop (office_worker role)
UI ◄─Realtime── job_events, approvals, tasks                       ──events──► sandbox per job (container)
POST /api/approvals ─► approvals (pending → approved/denied)        ◄─wait────  tool call needing approval
```

### 1. Job queue with per-user identity (implemented)

Implemented as described, with these concrete choices: job kinds `task_run`, `project_run`, `orchestrate`;
leases checked against `session_user`; RLS policies for `office_worker` scoped by `office_holds_lease(owner_id)`;
the reaper also releases tasks, projects, and agents left busy by a dead worker. Budget reservation (below, section
10) is not part of phase 1.

- New owned tables: `jobs` (owner_id, project_id, task_id, kind, status, attempts, lease_until, budget_usd),
  `job_events` (append-only log), `approvals`, `workspaces`, `workspace_files`. Same RLS pattern as Stage 2.
- Users enqueue jobs with their JWT (RLS). Workers never use the service-role key: they connect as a dedicated
  Postgres role `office_worker` that can only call `security definer` functions: `claim_job()` (`for update skip
  locked`, sets a lease), `append_job_event()`, `complete_job()`, `reserve_budget()`, `settle_budget()`.
  Each function receives the job id and acts only on that job's `owner_id`, so a worker cannot touch other users'
  data outside the job it holds.
- Leases replace `after()`: a crashed worker's job returns to the queue when `lease_until` passes. This removes
  the JWT-lifetime limit of Stage 2 background runs.

### 2. Specialized agents and the Manager Agent

- The CEO stays the planner of a request. A **Manager Agent** per project turns the plan into a dependency graph
  (`tasks.depends_on uuid[]`), assigns specialists, watches `job_events`, retries or re-plans on failure, and asks
  for approval when a tool call is sensitive.
- Specialists keep their role prompts; each gets only the tools its role needs (designer: files; programmer:
  files + commands + tests; analyst: read files + run tests).

### 3. Parallel execution

- Tasks whose dependencies are complete become jobs; the queue runs them in parallel up to the user's
  `max_concurrent_runs` (already in `usage_limits`) and a global worker capacity.
- Results are shared through the project workspace and the existing `shared_results` prompt section.

### 4. Isolated containers

- One ephemeral sandbox per job: rootless container under gVisor or a Firecracker microVM, read-only base image,
  non-root user, no host mounts, `no-new-privileges`, all capabilities dropped, seccomp default profile.
- The project workspace is mounted from a per-project volume; nothing else is writable. Files are synced to the
  `workspaces` Storage prefix `<owner_id>/<project_id>/` after each job.

### 5. Resource limits

- Per job: CPU quota, memory limit (no swap), PID limit, disk quota, wall-clock timeout, and output-size cap;
  values come from a `runner_limits` row per user with defaults in configuration (same model as `usage_limits`).
- Exceeding a limit kills the sandbox and records a `job_events` row with the reason.

### 6. Restricted network

- Default deny egress. A forwarding proxy allows only package registries on an allowlist (for allowlisted
  installs) and the AI provider endpoints used by the worker, never the sandbox. No access to the metadata service,
  the database, or private networks.

### 7. Human approval for sensitive commands

- Tool calls are classified before running: read-only and workspace edits run directly; dependency installs,
  deletions outside the workspace scratch area, network access, and anything not matching the allowlist create an
  `approvals` row (command, reason, risk, diff preview) and pause the job.
- The UI shows pending approvals live (Realtime); approve/deny is recorded with user id and timestamp. Denied or
  expired approvals fail the step, not the whole project.

### 8. File creation and editing tools

- `read_file`, `list_files`, `create_file`, `apply_patch` (unified diff), `delete_file` operate inside the
  workspace only (path normalization, no symlinks out). Every change is stored as a diff in `job_events`, so the
  UI can show and revert it.
- `run_command` and `run_tests` execute inside the sandbox with the limits above.

### 9. Execution monitoring

- `job_events` streams progress (step started, tool call, output excerpt, limit hit, approval requested) through
  Realtime; the office shows the agent at the desk with the live step, and the dashboard lists running jobs,
  durations, and failures.

### 10. Cost recording and budget enforcement

- AI calls from workers use the same `ledger.ts` rules. To remove Stage 2's concurrency overshoot, `reserve_budget`
  atomically reserves the call's worst case against the user's limits in a transaction, and `settle_budget`
  replaces the reservation with the actual cost after the call. Sandbox time can be recorded as a second cost
  dimension (CPU-seconds) once a price is defined by the operator.

## Delivery order

1. Queue tables, worker role, functions, and leases (replace `after()`), with RLS and integration tests.
2. Budget reservation in the database.
3. Sandbox runner with limits and network policy; file tools; command execution without installs.
4. Approvals, dependency installs from the allowlist, Manager Agent, and parallel scheduling.
5. Monitoring UI.
