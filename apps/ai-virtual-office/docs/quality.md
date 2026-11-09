# Quality checks

| Command | What it proves | Needs |
|---|---|---|
| `npm run check` | Lint, types (`next typegen` + `tsc`), unit tests: stats, pricing, file store (atomic writes, claims, restart recovery), request guards, auth helpers (open-redirect guard, password rules, error mapping), seed ids | Node only |
| `npm run build` | Production build, including `proxy.ts` | Node only |
| `npm run check` (budget part) | Admission and per-call limits, unpriced models, alert thresholds, UTC periods, Haiku long-prompt tier, worst-case bound | Node only |
| `npm run test:integration` | Against a real Supabase stack: profile trigger; cross-user read/update/delete denial on projects, tasks, conversations, messages, files, and Storage; forged or reassigned `owner_id` rejection; composite FK isolation; append-only history; anonymous denial; atomic claims; Storage ↔ metadata invariants (no object without a row, no row deletion while the object exists, immutable path, MIME allowlist); project deletion order and restrict; operator-only limits; per-user usage totals; stale-work recovery scoped to the caller; Realtime delivery to the owner's other device and not to other users | `npm run db:start` (Docker) |
| `npm run test:integration` (queue) | Server-forced job state and limits; duplicate, state-change, ownership, and log forgery refused; worker functions unavailable to users; immediate cancellation of waiting jobs and no un-cancel; 50-job cap; project deletion blocked by active jobs; worker sees an owner's data only while holding that owner's lease and cannot write other owners' rows; per-user concurrency with racing workers; retry with backoff then final failure; no retry for permanent errors; cancellation delivered by heartbeat; reaper requeues dead workers' jobs and releases their tasks/agents; state machine enforced for privileged writers | `npm run db:start`; the tests create two worker login roles with the local superuser connection |
| `scripts/with-local-supabase.sh node scripts/e2e-auth.mjs` | Browser flow: route protection, sign-up + e-mail confirmation, unconfirmed login refusal, session after reload, project creation, cross-device Realtime, profile, files, project deletion with Storage cleanup, refusal to delete another user's project, logout, password recovery, isolation, cross-site rejection. With `E2E_AI_FIXTURE=1` and a worker running: a task run through the queue with logs, cancelling a running project between steps, per-project cost, budget alert, refusal before spending, per-user usage | Running app built with the local stack's `NEXT_PUBLIC_*` values, Mailpit, Playwright (`NODE_PATH="$(npm root -g)"` for a global install); for the budget steps, the app started with `ANTHROPIC_BASE_URL` pointing at `scripts/fixtures/fake-claude-api.mjs` |

| `node --env-file=.env.validation scripts/validate-engine.mjs [--persistence]` | Against a **real** project and worker: migrations present, anonymous denial, worker role privileges (optional), worker online with Claude configured, one real AI task through the queue, logs, usage/cost/conversation, isolation between two accounts, duplicate refusal, cancellation, permanent failure without retry or spend, cleanup; `--persistence` proves a job enqueued while no worker runs completes later | Two test accounts and the variables in [production setup](production-setup.md#step-5--real-end-to-end-test) |

The fake Claude API is a test fixture: its responses are labelled as fixture output, it only runs when a test
points `ANTHROPIC_BASE_URL` at it, and it is never used to present results to users. Real model behavior and real
billing still need a run with a real `ANTHROPIC_API_KEY`.

The E2E script creates throwaway users on the local stack only. Never point it or the integration tests at a
production project.

Security review: use the toolkit's [security review prompt](../../../docs/prompts/13-security-review.md) for changes to
auth, RLS, storage, or request handling.
