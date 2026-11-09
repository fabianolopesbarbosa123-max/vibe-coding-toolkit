-- Stage 2 hardening: per-user AI budgets, storage/metadata consistency, and stale-work recovery.

-- Usage: link each call to its project (no FK, so cost history survives project deletion) -----
alter table public.usage_records add column project_id uuid;
create index usage_records_owner_project_idx on public.usage_records (owner_id, project_id);

-- Per-user limits set by the operator (Supabase SQL editor / service role). Users can only read. -
create table public.usage_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  monthly_budget_usd numeric(12, 4) check (monthly_budget_usd >= 0),
  monthly_token_limit bigint check (monthly_token_limit >= 0),
  daily_request_limit integer check (daily_request_limit >= 0),
  max_concurrent_runs integer check (max_concurrent_runs >= 1),
  note text check (char_length(note) <= 200),
  updated_at timestamptz not null default now()
);
alter table public.usage_limits enable row level security;
revoke all on public.usage_limits from anon, authenticated;
grant select on public.usage_limits to authenticated;
create policy "own limits: read" on public.usage_limits for select to authenticated using (user_id = (select auth.uid()));
create trigger usage_limits_touch before update on public.usage_limits for each row execute function public.touch_updated_at();

-- User-controlled budget preferences (can only tighten the operator's limits) -----------------
alter table public.user_settings
  add column budget_alert_percent integer not null default 80 check (budget_alert_percent between 1 and 100),
  add column personal_monthly_budget_usd numeric(12, 4) check (personal_monthly_budget_usd >= 0);

-- Usage totals for the caller (RLS applies: security invoker) ----------------------------------
create function public.usage_summary(p_month_start timestamptz, p_day_start timestamptz)
returns table (month_cost_usd numeric, month_tokens bigint, month_requests integer, day_requests integer, unpriced_requests integer)
language sql stable security invoker set search_path = '' as $$
  select
    coalesce(sum(cost_usd) filter (where at >= p_month_start), 0),
    coalesce(sum(input_tokens + output_tokens) filter (where at >= p_month_start), 0)::bigint,
    (count(*) filter (where at >= p_month_start))::integer,
    (count(*) filter (where at >= p_day_start))::integer,
    (count(*) filter (where at >= p_month_start and cost_usd is null))::integer
  from public.usage_records
  where owner_id = (select auth.uid());
$$;

-- Activity timestamps used to detect work abandoned by an interrupted server or expired session -
alter table public.projects add column updated_at timestamptz not null default now();
alter table public.tasks add column updated_at timestamptz not null default now();
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();

create function public.recover_stale_work(p_stale_after interval)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  changed integer := 0;
  n integer;
begin
  update public.tasks
     set status = 'failed', error = 'Interrompida: a execução parou de responder. Tente novamente.', completed_at = now()
   where owner_id = me and status = 'running' and updated_at < now() - p_stale_after;
  get diagnostics n = row_count; changed := changed + n;

  update public.projects p
     set status = 'failed'
   where p.owner_id = me and p.status in ('planning', 'running')
     and greatest(p.updated_at, coalesce((select max(t.updated_at) from public.tasks t where t.project_id = p.id), p.updated_at)) < now() - p_stale_after
     and not exists (select 1 from public.tasks t where t.project_id = p.id and t.status = 'running');
  get diagnostics n = row_count; changed := changed + n;

  update public.agents a
     set status = 'idle', current_task_id = null
   where a.owner_id = me
     and ((a.status = 'working' and not exists (select 1 from public.tasks t where t.agent_id = a.id and t.status = 'running'))
       or (a.status = 'meeting' and not exists (select 1 from public.projects p where p.owner_id = me and p.status = 'planning')));
  get diagnostics n = row_count; changed := changed + n;
  return changed;
end;
$$;

-- Storage <-> metadata consistency --------------------------------------------------------------
-- 1) An object may only be uploaded after its metadata row exists (no object without a row).
drop policy "office files: upload own" on storage.objects;
create policy "office files: upload registered" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'office-files'
    and (storage.foldername(objects.name))[1] = (select auth.uid())::text
    -- Qualified: public.files also has a "name" column.
    and exists (select 1 from public.files f where f.storage_path = objects.name and f.owner_id = (select auth.uid()))
  );

-- 2) A metadata row may only be deleted after its object is gone (no orphan objects).
drop policy "own rows: delete" on public.files;
create policy "own rows: delete after object removal" on public.files for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and not exists (select 1 from storage.objects o where o.bucket_id = 'office-files' and o.name = files.storage_path)
  );

-- 3) storage_path is immutable for users; only the name and project can change.
revoke update on public.files from authenticated;
grant update (name, project_id) on public.files to authenticated;

-- 4) A project with files cannot be deleted until its files are removed (the API does both, in order).
alter table public.files drop constraint files_project_id_owner_id_fkey;
alter table public.files add constraint files_project_id_owner_id_fkey
  foreign key (project_id, owner_id) references public.projects (id, owner_id) on delete restrict;

-- 5) The bucket enforces the same types the app accepts, even for direct API uploads.
update storage.buckets
   set allowed_mime_types = array['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp']
 where id = 'office-files';
