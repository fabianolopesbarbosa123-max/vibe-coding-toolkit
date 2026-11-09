-- AI Virtual Office initial schema. Review before applying to a known, authorized project.
-- The app uses the service-role key on the server; RLS stays enabled with no public policies,
-- so the anon key cannot read or write these tables. Per-user policies arrive with Supabase Auth.

create table if not exists public.agents (
  id text primary key,
  name text not null check (char_length(name) between 1 and 40),
  role text not null,
  title text not null,
  room text not null,
  color text not null,
  provider text not null check (provider in ('anthropic', 'openai')),
  model text,
  instructions text not null,
  status text not null default 'idle' check (status in ('idle', 'working', 'meeting', 'done', 'error')),
  current_task_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id text primary key,
  name text not null,
  request text not null,
  status text not null check (status in ('planning', 'ready', 'running', 'completed', 'failed')),
  summary text,
  result text,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id text primary key,
  project_id text references public.projects (id) on delete cascade,
  title text not null,
  description text not null,
  agent_id text not null references public.agents (id),
  priority text not null check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  "order" integer not null default 0,
  result text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index if not exists tasks_project_order_idx on public.tasks (project_id, "order");

create table if not exists public.activity_events (
  id text primary key,
  at timestamptz not null default now(),
  level text not null check (level in ('info', 'success', 'warning', 'error')),
  message text not null,
  agent_id text,
  task_id text,
  project_id text
);
create index if not exists activity_events_at_idx on public.activity_events (at desc);

create table if not exists public.usage_records (
  id text primary key,
  at timestamptz not null default now(),
  agent_id text not null,
  task_id text,
  provider text not null,
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cost_usd numeric(12, 6)
);
create index if not exists usage_records_at_idx on public.usage_records (at desc);

alter table public.agents enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.activity_events enable row level security;
alter table public.usage_records enable row level security;
