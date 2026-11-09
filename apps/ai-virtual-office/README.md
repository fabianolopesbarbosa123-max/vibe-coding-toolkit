# AI Virtual Office

A 2D virtual office where AI agents (CEO, programmer, designer, marketing, researcher, analyst) receive tasks, run them through real AI providers, share results, and report back — and you watch it happen.

## Run locally

Requires Node.js 20.9+ (24 recommended).

```bash
cd apps/ai-virtual-office
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm run dev                  # http://127.0.0.1:3000
```

Without keys the app still runs and shows each AI integration as unavailable; nothing is simulated.

## Use

1. **Escritório** — type a request in “Pedir ao CEO” (for example, “Crie um aplicativo de gestão financeira”). The CEO calls a meeting, plans, distributes tasks, the team works at their desks, and the CEO presents the result.
2. **Tarefas** — create tasks or projects manually, assign agents and priorities, run or retry tasks, and read results and history.
3. **Agentes** — edit the six default agents or register new ones (room, color, provider, model, instructions).
4. **Dashboard** — counts, API usage, estimated cost, errors, and integration status.

## Configuration

See [.env.example](.env.example). Data is stored in `.data/office.json` unless `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set; apply [the migration](supabase/migrations/0001_initial.sql) first.

## Checks

```bash
npm run check   # lint + typecheck + unit tests
npm run build
```

## Documents

- [PRODUCT.md](PRODUCT.md) — scope, constraints, roadmap
- [docs/architecture.md](docs/architecture.md) — modules and execution flow
- [AGENTS.md](AGENTS.md) — rules for coding agents

There is no authentication yet: keep the server on localhost until stage 2.
