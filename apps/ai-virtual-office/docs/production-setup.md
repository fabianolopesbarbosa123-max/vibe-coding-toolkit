# Production setup: execution engine (Stage 3, phase 1)

Follow the steps in order. Commands run on **your computer** (in `apps/ai-virtual-office`) unless marked
**[server]** (the worker host). Never paste passwords or keys into chats, tickets, or the repository.

Prerequisites: a Supabase project with Stage 2 configured ([docs/supabase.md](supabase.md): Site URL, redirect
URLs, e-mail confirmation, SMTP), Node.js 20.9+ (24 LTS recommended), `psql` on your computer, a Linux host for the
worker with outbound HTTPS and Postgres (port 5432) access, and a Claude Console account.

## Step 1 — Apply the migrations

The repository has four migrations, applied in order:

| File | Adds |
|---|---|
| `20261109000000_initial.sql` | Stage 2 schema, RLS, Storage bucket, Realtime |
| `20261110000000_stage2_hardening.sql` | Budgets, Storage/metadata consistency, stale-work recovery |
| `20261111000000_stage3_execution_engine.sql` | Queue, worker role `office_worker`, worker functions |
| `20261112000000_worker_capabilities.sql` | Workers report their providers (names only) |

They were verified on a fresh database and as an upgrade, as the non-superuser `postgres` role (the same role
`db push` uses in the cloud).

1. **Project ref:** open the project in the Supabase dashboard; the ref is the part of the browser URL after
   `/project/` (`https://supabase.com/dashboard/project/<PROJECT-REF>`).
2. **Database password:** the one you set when creating the project. If you do not have it: **Database Settings**
   → reset the database password (this changes the `postgres` password only).
3. Log in and link (the CLI opens the browser and then asks for the database password):
   ```bash
   npx supabase login
   npx supabase link --project-ref <PROJECT-REF>
   ```
4. Preview, then apply:
   ```bash
   npx supabase db push --dry-run   # must list exactly the migrations not yet applied
   npx supabase db push
   npx supabase migration list      # Local and Remote columns must match
   ```
5. Verify in the dashboard: left sidebar → **SQL Editor** → new query → run:
   ```sql
   select (select count(*) from pg_tables where schemaname = 'public'
             and tablename in ('jobs', 'job_events', 'office_workers', 'usage_limits')) as queue_tables,  -- 4
          (select count(*) from pg_proc where proname like 'office\_%') as worker_functions,              -- 11
          (select rolcanlogin from pg_roles where rolname = 'office_worker') as group_can_login,          -- false
          (select bool_and(rowsecurity) from pg_tables where schemaname = 'public') as rls_everywhere;    -- true
   ```

## Step 2 — Create `office_worker_prod1` with minimal permissions

All permissions come from membership in `office_worker` (created by the migration): it can only call the
`office_*` functions and reach a user's agents, projects, tasks, conversations, activity, and usage while it holds
a lease on one of that user's jobs. No superuser, no `BYPASSRLS`, no access to `auth`, Storage, files, or profiles,
no deletes.

1. **SQL Editor** → new query (create the role **without** a password here: the editor keeps query history):
   ```sql
   create role office_worker_prod1 login in role office_worker;
   alter role office_worker_prod1 connection limit 10;
   alter role office_worker_prod1 set statement_timeout = '60s';
   ```
2. Generate the password on your computer (hex avoids URL-encoding problems):
   ```bash
   openssl rand -hex 32
   ```
   Keep it only in your password manager until step 3.
3. Set it with `psql`, which sends only a hash and never shows it: dashboard → **Connect** (top of the page) →
   **Session pooler** → copy the connection string (user `postgres.<PROJECT-REF>`), then:
   ```bash
   psql "<SESSION-POOLER-URI-WITH-YOUR-DB-PASSWORD>"
   \password office_worker_prod1
   \q
   ```
4. Check the role in the **SQL Editor**:
   ```sql
   select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolconnlimit,
          pg_has_role('office_worker_prod1', 'office_worker', 'member') as is_worker
     from pg_roles where rolname = 'office_worker_prod1';
   -- expected: f, f, f, f, 10, t
   ```
5. Optional, recommended: **Database Settings** → **Network Restrictions** → allow only your worker host's IP
   and your own IP (restrictions apply to direct and pooler connections, not to the HTTPS APIs the web app uses).

## Step 3 — Configure the secrets safely

Only the worker needs `WORKER_DATABASE_URL` and `ANTHROPIC_API_KEY`. In Supabase mode the web server never calls
the AI: it learns which providers are available from the workers (names only), so do **not** set the AI key on the
web server.

1. **CA certificate:** **Database Settings** → **SSL Configuration** → **Download certificate**. Copy it to the
   server as `/etc/ai-office/supabase-ca.crt` (step 4). Optionally enable "Enforce SSL on incoming connections"
   (brief database restart).
2. **`WORKER_DATABASE_URL`:** dashboard → **Connect** → **Session pooler** (IPv4, port 5432). Take the host from
   there and build:
   ```
   postgresql://office_worker_prod1.<PROJECT-REF>:<GENERATED-PASSWORD>@<POOLER-HOST>:5432/postgres?sslmode=verify-full&sslrootcert=/etc/ai-office/supabase-ca.crt
   ```
   The pooler username is `<role>.<PROJECT-REF>`. Custom roles through the session pooler were verified locally with
   Supavisor. Use the direct connection (`db.<PROJECT-REF>.supabase.co`) only if the host has IPv6 or you bought
   the IPv4 add-on; then the username is just `office_worker_prod1`.
3. **`ANTHROPIC_API_KEY`:** Claude Console → **API Keys** → create a key used only by this worker (for example
   "ai-office-worker-prod"). If you can, create it in a dedicated workspace with a monthly spend limit, which caps
   cost independently of the app's own limits.
4. Both values go only into `/etc/ai-office/worker.env` on the server (step 4), owned by root, readable by the
   worker group, edited with `sudoedit`. Never `echo` them in a shell (history), commit them, or send them in chat.
5. Web server: keep only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`,
   and the same `OFFICE_DEFAULT_*`/`ANTHROPIC_MODEL` values as the worker (they drive the budget pre-checks).

## Step 4 — Install and start the worker [server]

```bash
node -v                                   # v20.9+ (install Node.js 24 LTS from nodejs.org if missing)
sudo useradd --system --home /opt/ai-virtual-office --shell /usr/sbin/nologin aioffice
sudo git clone https://github.com/fabianolopesbarbosa123-max/vibe-coding-toolkit.git /opt/ai-virtual-office
#   (private repository: use a read-only deploy key or a fine-grained token, not your personal password)
cd /opt/ai-virtual-office && sudo git checkout claude/quirky-keller-2hnqji
cd apps/ai-virtual-office && sudo npm ci
sudo chown -R root:aioffice /opt/ai-virtual-office && sudo chmod -R o-rwx /opt/ai-virtual-office

sudo install -d -m 0750 -o root -g aioffice /etc/ai-office
sudo install -m 0644 -o root -g aioffice <downloaded-ca.crt> /etc/ai-office/supabase-ca.crt
sudo install -m 0640 -o root -g aioffice deploy/worker.env.example /etc/ai-office/worker.env
sudoedit /etc/ai-office/worker.env       # fill WORKER_DATABASE_URL and ANTHROPIC_API_KEY
```

First run in the foreground to see errors:

```bash
sudo -u aioffice node --env-file=/etc/ai-office/worker.env node_modules/tsx/dist/cli.mjs --conditions=react-server src/worker/main.ts
# expected: "worker started (concurrency 2, lease 60s, providers: anthropic)"; stop with Ctrl+C
```

`--env-file` does not override variables already set in the shell. If you exported `ANTHROPIC_*` or
`WORKER_*` earlier in that shell, unset them first. systemd starts the service with a clean environment.

Then as a service:

```bash
sudo cp deploy/ai-office-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ai-office-worker
systemctl status ai-office-worker         # active (running)
journalctl -u ai-office-worker -f         # live log
```

Updating: `cd /opt/ai-virtual-office && sudo git pull && cd apps/ai-virtual-office && sudo npm ci && sudo systemctl restart ai-office-worker`
(apply new migrations first). The restart returns running jobs to the queue.

## Step 5 — Real end-to-end test

1. In the app, create two **test** accounts at `/signup` (A and B), confirm both e-mails, and log in once with
   each (this creates their agents).
2. On your computer, create `apps/ai-virtual-office/.env.validation` (git-ignored) with:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
   VALIDATION_USER_A_EMAIL=...
   VALIDATION_USER_A_PASSWORD=...
   VALIDATION_USER_B_EMAIL=...
   VALIDATION_USER_B_PASSWORD=...
   # optional, only if Network Restrictions allow your IP; enables the privilege checks:
   WORKER_DATABASE_URL=...
   ```
3. Run (worker running):
   ```bash
   node --env-file=.env.validation scripts/validate-engine.mjs
   ```
   It makes **one real Claude call** with a minimal prompt, then checks logs, usage and cost, isolation between A
   and B, duplicate refusal, cancellation, a permanent failure without retry or spend, and cleans up. It prints no
   secrets; send the output for review if you want.
4. Persistence: `sudo systemctl stop ai-office-worker` **[server]**, then run
   `node --env-file=.env.validation scripts/validate-engine.mjs --persistence`; when it says the job is queued,
   `sudo systemctl start ai-office-worker` **[server]**. The job must complete after the worker starts.
5. In the UI as user A: **Tarefas** → create a task → **Executar** → **Execuções** shows *Na fila → Executando →
   Concluída*; **Logs** shows each step and the AI call.
6. Delete `.env.validation` when done.

## Step 6 — Failure handling in production (optional, one more real call)

- Crash recovery: start a task in the UI, and while it shows *Executando*, run
  `sudo systemctl kill -s SIGKILL ai-office-worker` **[server]**. systemd restarts the worker; after the 60 s lease
  the job shows "O worker parou de responder." and then *tentativa 2/3* → *Concluída*.
- Graceful restart: `sudo systemctl restart ai-office-worker` during a run → the job returns to *Na fila* with
  "Worker encerrado; a execução será retomada." and completes.

Useful SQL (dashboard **SQL Editor**, admin view of all users):

```sql
select status, count(*) from public.jobs group by status;
select name, last_seen, providers from public.office_workers;
select at, level, message from public.job_events where job_id = '<JOB-ID>' order by at;
```

## Rollback and rotation

- Stop processing: `sudo systemctl stop ai-office-worker`; jobs stay queued.
- Rotate the worker password: `\password office_worker_prod1` in psql, update `/etc/ai-office/worker.env`, restart.
- Revoke a worker: `alter role office_worker_prod1 nologin;` (running jobs are recovered by other workers after
  their lease expires).
