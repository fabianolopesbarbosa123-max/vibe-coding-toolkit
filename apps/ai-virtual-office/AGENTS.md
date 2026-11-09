<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AI Virtual Office

Next.js 16 (App Router, Cache Components), React 19, strict TypeScript, Tailwind 4, Zod 4, Vitest. Product scope: [PRODUCT.md](PRODUCT.md). Structure: [docs/architecture.md](docs/architecture.md).

## Commands

- `npm run dev` — local server bound to 127.0.0.1.
- `npm run check` — lint, typecheck (`next typegen` + `tsc`), and tests. Run before every commit.
- `npm run build` — production build.

## Rules

- Never simulate AI output. When a provider is not configured, surface it as unavailable (`IntegrationUnavailableError` → HTTP 503).
- Secrets are read only in `src/server/**` (marked `server-only`). Never use `NEXT_PUBLIC_*` for keys.
- Every mutating route uses `readJson` (same-origin + JSON + Zod) because it can trigger paid API calls.
- Persistence goes through `getStore()`; keep the file and Supabase stores behaviorally identical, and update `supabase/migrations/` when the domain changes.
- Public errors use `describeError`; do not echo provider bodies, keys, or request payloads.
- UI text is pt-BR; code, comments, and docs are English. Keep files under 350 lines.
- Keep motion compatible with `prefers-reduced-motion`, and keep controls keyboard-accessible.
