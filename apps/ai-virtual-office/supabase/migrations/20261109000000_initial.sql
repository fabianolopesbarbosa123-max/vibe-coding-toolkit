-- AI Virtual Office schema (Stage 2: multi-user).
-- Every row belongs to one auth user (owner_id). RLS allows each user to reach only their rows;
-- composite foreign keys (id, owner_id) make cross-user references impossible at the database level.
-- The app talks to the database with the user's JWT; no service-role key is needed at runtime.

-- Profiles -------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Individual settings and preferences ---------------------------------------------------------
create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  auto_run boolean not null default true,
  reduced_motion boolean not null default false,
  default_provider text not null default 'anthropic' check (default_provider in ('anthropic', 'openai')),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object' and pg_column_size(preferences) <= 8192),
  updated_at timestamptz not null default now()
);

-- Profile and settings are created by the database when a user signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80));
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger user_settings_touch before update on public.user_settings for each row execute function public.touch_updated_at();

-- Agents ---------------------------------------------------------------------------------------
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  role text not null check (role in ('ceo', 'programmer', 'designer', 'marketing', 'researcher', 'analyst', 'support', 'custom')),
  title text not null check (char_length(title) between 1 and 60),
  room text not null check (room in ('planning', 'programming', 'research', 'marketing', 'meeting', 'support', 'monitoring')),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  provider text not null check (provider in ('anthropic', 'openai')),
  model text check (model is null or char_length(model) <= 80),
  instructions text not null check (char_length(instructions) between 1 and 4000),
  status text not null default 'idle' check (status in ('idle', 'working', 'meeting', 'done', 'error')),
  current_task_id uuid,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index agents_owner_idx on public.agents (owner_id, created_at);

-- Projects -------------------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  request text not null check (char_length(request) between 1 and 4000),
  status text not null check (status in ('planning', 'ready', 'running', 'completed', 'failed')),
  summary text,
  result text,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index projects_owner_idx on public.projects (owner_id, created_at);

-- Tasks ----------------------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid,
  agent_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) between 1 and 4000),
  priority text not null check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  "order" integer not null default 0,
  result text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (id, owner_id),
  foreign key (project_id, owner_id) references public.projects (id, owner_id) on delete cascade,
  foreign key (agent_id, owner_id) references public.agents (id, owner_id)
);
create index tasks_owner_idx on public.tasks (owner_id, created_at);
create index tasks_project_order_idx on public.tasks (project_id, "order");

-- Conversations with AI agents (one per planning, task run, or summary) -----------------------
create table public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  agent_id uuid not null,
  project_id uuid,
  task_id uuid,
  kind text not null check (kind in ('planning', 'task', 'summary')),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (agent_id, owner_id) references public.agents (id, owner_id) on delete cascade,
  foreign key (project_id, owner_id) references public.projects (id, owner_id) on delete cascade,
  foreign key (task_id, owner_id) references public.tasks (id, owner_id) on delete cascade
);
create index agent_conversations_owner_idx on public.agent_conversations (owner_id, created_at);

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('system', 'user', 'assistant')),
  content text not null check (char_length(content) <= 200000),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, owner_id) references public.agent_conversations (id, owner_id) on delete cascade
);
create index agent_messages_conversation_idx on public.agent_messages (conversation_id, created_at);

-- Activity history and API usage (append-only) -------------------------------------------------
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  level text not null check (level in ('info', 'success', 'warning', 'error')),
  message text not null check (char_length(message) <= 1000),
  agent_id uuid,
  task_id uuid,
  project_id uuid
);
create index activity_events_owner_at_idx on public.activity_events (owner_id, at desc);

create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  agent_id uuid not null,
  task_id uuid,
  provider text not null check (provider in ('anthropic', 'openai')),
  model text not null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cost_usd numeric(12, 6)
);
create index usage_records_owner_at_idx on public.usage_records (owner_id, at desc);

-- Files: metadata here, bytes in the private "office-files" bucket under "<owner_id>/..." -------
create table public.files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid,
  name text not null check (char_length(name) between 1 and 200),
  storage_path text not null unique,
  mime_type text not null check (char_length(mime_type) <= 120),
  size_bytes bigint not null check (size_bytes between 0 and 10485760),
  created_at timestamptz not null default now(),
  foreign key (project_id, owner_id) references public.projects (id, owner_id) on delete cascade,
  check (split_part(storage_path, '/', 1) = owner_id::text)
);
create index files_owner_idx on public.files (owner_id, created_at);

-- Row Level Security ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.agents enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.agent_conversations enable row level security;
alter table public.agent_messages enable row level security;
alter table public.activity_events enable row level security;
alter table public.usage_records enable row level security;
alter table public.files enable row level security;

revoke all on all tables in schema public from anon;

create policy "own profile: read" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "own settings: read" on public.user_settings for select to authenticated using (user_id = (select auth.uid()));
create policy "own settings: update" on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Full CRUD on owned rows for working tables.
do $$
declare t text;
begin
  foreach t in array array['agents', 'projects', 'tasks', 'agent_conversations', 'agent_messages', 'files'] loop
    execute format('create policy "own rows: read" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows: insert" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows: update" on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows: delete" on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t);
  end loop;
  -- History and usage are append-only for users.
  foreach t in array array['activity_events', 'usage_records'] loop
    execute format('create policy "own rows: read" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows: insert" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t);
  end loop;
end;
$$;

revoke update, delete on public.activity_events, public.usage_records from authenticated;
revoke insert, delete on public.profiles, public.user_settings from authenticated;
-- Ownership cannot be moved to another user: every update policy re-checks owner_id = auth.uid().

-- Storage --------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('office-files', 'office-files', false, 10485760)
on conflict (id) do nothing;

create policy "office files: read own" on storage.objects for select to authenticated
  using (bucket_id = 'office-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "office files: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'office-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "office files: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'office-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Realtime: changes are delivered only to subscribers whose RLS allows the row ---------------
alter publication supabase_realtime add table
  public.agents, public.projects, public.tasks, public.activity_events, public.usage_records, public.files;
