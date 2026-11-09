# AI Virtual Office — Product

## Problem

Coordinating several AI agents (planning, coding, design, marketing, research, analysis) means juggling prompts, results, and costs in separate tools. The owner wants one place to delegate work, watch it happen, and review results and spending.

## Audience

Individual users (solo founders, developers, small team leads), each with a private office, running AI agents on the operator's configured API keys.

## MVP (stage 1 — implemented)

- 2D top-down virtual office with seven rooms (planning, programming & design, research, marketing, meeting, support, monitoring) and animated pixel-art characters whose position and indicators follow real agent state: seated and typing while working, in the meeting room while the CEO plans, green when done, red on error.
- Six seeded agents (CEO, programmer, designer, marketing, researcher, analyst); create and edit agents (role, room, color, provider, model, instructions).
- Tasks with name, description, assignee, priority, status, creation date, and final result; projects that group ordered tasks.
- CEO orchestration: a request becomes a project, the CEO plans it with structured output, distributes tasks, the team executes them in order sharing earlier results, and the CEO presents a final summary.
- Manual tasks and projects, single-task runs, retries, and resuming failed projects.
- Dashboard: agent and task counts, active projects, history, API calls, tokens, estimated cost, errors and alerts, integration status.
- Real AI calls through the Claude API (default) or OpenAI API, per agent. Missing configuration is shown as unavailable; nothing is simulated.

## Stage 2 — Accounts, persistence, realtime (implemented)

- Supabase Auth: sign-up with name, e-mail, and password (e-mail confirmation), login, logout, password recovery by e-mail link, cookie session that survives reloads, protected routes with redirect to `/login`.
- Profile page with name and preferences (auto-run, reduced motion, default provider).
- Per-user data in Postgres: profiles, settings, agents, projects, tasks, agent conversations and messages, activity history, usage, and files (private Storage bucket).
- Row Level Security on every table, composite foreign keys against cross-user references, no service-role key in the app.
- Supabase Realtime replaces periodic polling; polling remains only as a fallback, with connection and offline banners.
- Toasts for success, clear error messages, loading and empty states.
- Per-user AI usage control: central server-side key configuration, model allowlist, token and cost recording per call/task/project, configurable limits, budget alerts, and refusal before overspending.
- Project deletion with confirmation that removes tasks, conversations, and Storage files without leaving orphans.

## Constraints

- Agents cannot browse the web, read files, or run code yet; prompts tell them so.
- Multi-user use requires Supabase. `OFFICE_LOCAL_MODE` is a single-user development mode without login; keep it on 127.0.0.1.
- AI keys belong to the operator and stay on the server. Each user has limits (monthly budget, tokens, daily calls, concurrency) set by the operator, can only tighten their own budget, and gets alerts; calls that could exceed a limit are refused before they are sent. Costs are estimates from the published price table.
- Background runs use `after()` with the user's JWT: bounded by the route's `maxDuration` and the JWT lifetime (default one hour).

## Roadmap

1. ~~Stage 2 — Accounts and persistence~~ (done).
2. **Stage 3 — Code execution:** programmer agent with file/command tools inside an isolated sandbox (container per run, no host mounts, CPU/memory/time limits, network allowlist), dependency allowlist, and human approval for sensitive commands, with full audit logs. Claude Code / Agent SDK integration lives here.
3. **Stage 4 — GitHub:** GitHub App with per-repository scopes; agents open branches and pull requests for human review, never pushing to protected branches.
4. **Stage 5 — Tools and memory:** web research tools with citations, shared project memory, budgets per project, and cost alerts.

## Acceptance

- Without keys, the UI loads, marks Claude/OpenAI as unavailable, and refuses to plan or run tasks with a clear message.
- With `ANTHROPIC_API_KEY`, a request to the CEO produces a project with 2–6 tasks that run in order and end with a CEO summary, visible live in the office.
- Users cannot read, change, or reference each other's data (integration tests against a real Supabase stack).
- `npm run check`, `npm run build`, `npm run test:integration`, and the E2E script pass.
