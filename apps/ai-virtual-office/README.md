# AI Virtual Office

A 2D virtual office where AI agents (CEO, programmer, designer, marketing, researcher, analyst) receive tasks, run them through real AI providers, share results, and report back — and you watch it happen. Multi-user with Supabase Auth, per-user data under Row Level Security, and live updates across devices.

## Run locally

Requires Node.js 20.9+ (24 recommended) and Docker for the local Supabase stack.

```bash
cd apps/ai-virtual-office
npm install
npm run db:start             # local Supabase; prints API_URL and PUBLISHABLE_KEY
cp .env.example .env.local   # fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, ANTHROPIC_API_KEY
npm run dev                  # http://127.0.0.1:3000
# in another terminal: the execution worker (see docs/execution-engine.md for the one-time role setup)
npm run worker
```

Create an account at `/signup`; the confirmation e-mail appears in Mailpit (http://127.0.0.1:54324).
For a cloud project, see [docs/supabase.md](docs/supabase.md).

Without Supabase, set `OFFICE_LOCAL_MODE=true` for the single-user development mode (no login, data in `.data/`).
Without AI keys the app still runs and shows each AI integration as unavailable; nothing is simulated.

## Use

1. **Escritório** — ask the CEO (for example, “Crie um aplicativo de gestão financeira”). The CEO calls a meeting, plans, distributes tasks, the team works at their desks, and the CEO presents the result.
2. **Tarefas** — create tasks or projects manually, run or retry them, upload project files, and read results and history.
3. **Agentes** — edit your six default agents or register new ones.
4. **Dashboard** — counts, monthly AI consumption against your limits, estimated cost, errors, and integration status.
5. **Perfil** — name, preferences, and password change by e-mail link.

## Checks

```bash
npm run check              # lint + typecheck + unit tests
npm run build
npm run test:integration   # RLS, isolation, storage, realtime (needs npm run db:start)
```

Browser end-to-end flow: see [docs/quality.md](docs/quality.md).

## Documents

- [PRODUCT.md](PRODUCT.md) — scope, constraints, roadmap
- [docs/architecture.md](docs/architecture.md) — modules, authorization layers, execution flow
- [docs/supabase.md](docs/supabase.md) — schema, RLS, and Supabase configuration
- [docs/quality.md](docs/quality.md) — what each check proves
- [docs/execution-engine.md](docs/execution-engine.md) — execution queue, worker setup, limits
- [docs/production-setup.md](docs/production-setup.md) — step-by-step production setup and validation
- [docs/stage3-architecture.md](docs/stage3-architecture.md) — Stage 3 design (phase 1 done, later phases planned)
- [AGENTS.md](AGENTS.md) — rules for coding agents
