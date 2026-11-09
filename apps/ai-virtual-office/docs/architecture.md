# Architecture

```
Browser (client components)              Next.js server (Node.js runtime)
──────────────────────────               ─────────────────────────────────────────────
OfficeProvider polls GET /api/state ───► state route ─► getStore().snapshot() + stats + integrations
Forms POST JSON (same origin) ─────────► mutation routes ─► readJson (origin + JSON + Zod)
                                            │
                                            ├─ orchestrator.ts  claim → after(execute)
                                            │     ├─ ai/providers.ts  Claude API / OpenAI API
                                            │     └─ ai/prompts.ts    role prompts + shared results
                                            └─ store/  FileStore (.data/office.json) | SupabaseStore
```

## Modules

| Path | Responsibility |
|---|---|
| `src/lib/domain.ts` | Domain types and Zod input schemas shared by client and server |
| `src/lib/seed.ts` | The six default agents |
| `src/lib/stats.ts`, `src/lib/pricing.ts` | Dashboard aggregation and cost estimates (null when the price is unknown) |
| `src/server/env.ts` | Validated server environment; errors name variables, never values |
| `src/server/store/` | `OfficeStore` interface with file and Supabase implementations |
| `src/server/ai/providers.ts` | Provider availability, text and structured generation, public error text |
| `src/server/orchestrator.ts` | Task/project lifecycle, CEO planning, sequential execution, summaries, usage and events |
| `src/server/http.ts` | Same-origin/JSON guard, validation, error responses |
| `src/app/api/**` | Route handlers |
| `src/components/office/` | Office map geometry, rooms, desks, animated characters |
| `src/components/**` | Task board, forms, agent management, dashboard, activity feed |

## Execution flow

1. `POST /api/orchestrate` checks that the CEO's provider is configured (503 otherwise), creates a project in `planning`, and returns 202.
2. In `after()`, the CEO and idle agents move to the meeting room. The CEO's model returns a Zod-validated plan (`messages.parse` with structured output on Claude; `responses.parse` on OpenAI). Tasks are created in order.
3. `executeProject` claims each task (agent → `working`), sends the role prompt plus the results of earlier tasks in the project, stores the result, token usage, and estimated cost, and marks the agent `done` or `error`.
4. After the last task the CEO writes the final summary into `project.result`.

An agent runs one task at a time. A restart marks running work as failed (`recoverInterrupted`) rather than resuming silently.

## Claude API usage

The default model is `claude-opus-5-5` (override with `ANTHROPIC_MODEL` or per agent). Requests on models that support it send `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta, so a safety-classifier refusal is retried server-side on Anthropic's recommended model; a remaining `refusal` or `max_tokens` stop is reported as a task error. Remove `anthropicExtras` in `providers.ts` to opt out.

## Data

`supabase/migrations/0001_initial.sql` mirrors the domain with snake_case columns. RLS is enabled with no public policies; the server uses the service-role key. Stage 2 adds Supabase Auth and per-user policies.
