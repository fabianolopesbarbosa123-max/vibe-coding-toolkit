# Quality checks

| Command | What it proves | Needs |
|---|---|---|
| `npm run check` | Lint, types (`next typegen` + `tsc`), unit tests: stats, pricing, file store (atomic writes, claims, restart recovery), request guards, auth helpers (open-redirect guard, password rules, error mapping), seed ids | Node only |
| `npm run build` | Production build, including `proxy.ts` | Node only |
| `npm run test:integration` | Against a real Supabase stack: profile trigger, cross-user read/update/delete denial, forged `owner_id` rejection, composite FK isolation, append-only history, anonymous denial, atomic claims, private Storage, Realtime delivery to the owner's other device and not to other users | `npm run db:start` (Docker) |
| `node scripts/e2e-auth.mjs` | Browser flow: route protection, sign-up + e-mail confirmation, unconfirmed login refusal, session persistence after reload, project creation, cross-device Realtime, profile, files, logout, password recovery, isolation between users, cross-site request rejection | Running app built with the local stack's `NEXT_PUBLIC_*` values, Mailpit, Playwright (`NODE_PATH="$(npm root -g)"` for a global install) |

The E2E script creates throwaway users on the local stack only. Never point it or the integration tests at a
production project.

Security review: use the toolkit's [security review prompt](../../../docs/prompts/13-security-review.md) for changes to
auth, RLS, storage, or request handling.
