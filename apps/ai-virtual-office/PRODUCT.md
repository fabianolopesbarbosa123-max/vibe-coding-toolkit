# AI Virtual Office — Product

## Problem

Coordinating several AI agents (planning, coding, design, marketing, research, analysis) means juggling prompts, results, and costs in separate tools. The owner wants one place to delegate work, watch it happen, and review results and spending.

## Audience

A single owner (solo founder, developer, or small team lead) running AI agents on their own API keys.

## MVP (stage 1 — implemented)

- 2D top-down virtual office with seven rooms (planning, programming & design, research, marketing, meeting, support, monitoring) and animated pixel-art characters whose position and indicators follow real agent state: seated and typing while working, in the meeting room while the CEO plans, green when done, red on error.
- Six seeded agents (CEO, programmer, designer, marketing, researcher, analyst); create and edit agents (role, room, color, provider, model, instructions).
- Tasks with name, description, assignee, priority, status, creation date, and final result; projects that group ordered tasks.
- CEO orchestration: a request becomes a project, the CEO plans it with structured output, distributes tasks, the team executes them in order sharing earlier results, and the CEO presents a final summary.
- Manual tasks and projects, single-task runs, retries, and resuming failed projects.
- Dashboard: agent and task counts, active projects, history, API calls, tokens, estimated cost, errors and alerts, integration status.
- Real AI calls through the Claude API (default) or OpenAI API, per agent. Missing configuration is shown as unavailable; nothing is simulated.

## Constraints

- Agents cannot browse the web, read files, or run code yet; prompts tell them so.
- Local mode stores data in `.data/office.json` (single process). Shared or deployed use requires Supabase.
- No authentication yet: the server binds to 127.0.0.1 and rejects cross-origin mutations. Do not expose it publicly before stage 2.
- Background runs use `after()`; on serverless hosts they are bounded by the route's `maxDuration`.

## Roadmap

1. **Stage 2 — Accounts and persistence:** Supabase Auth, per-user rows with RLS policies, realtime subscriptions instead of polling.
2. **Stage 3 — Code execution:** programmer agent with file/command tools inside an isolated sandbox (container per run, no host mounts, CPU/memory/time limits, network allowlist), dependency allowlist, and human approval for sensitive commands, with full audit logs. Claude Code / Agent SDK integration lives here.
3. **Stage 4 — GitHub:** GitHub App with per-repository scopes; agents open branches and pull requests for human review, never pushing to protected branches.
4. **Stage 5 — Tools and memory:** web research tools with citations, shared project memory, budgets per project, and cost alerts.

## Acceptance (stage 1)

- Without keys, the UI loads, marks Claude/OpenAI as unavailable, and refuses to plan or run tasks with a clear message.
- With `ANTHROPIC_API_KEY`, a request to the CEO produces a project with 2–6 tasks that run in order and end with a CEO summary, visible live in the office.
- `npm run check` and `npm run build` pass.
