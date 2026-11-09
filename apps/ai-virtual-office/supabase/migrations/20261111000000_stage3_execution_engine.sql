-- Stage 3, phase 1: persistent execution queue with per-user identity.
--
-- Users enqueue jobs with their own JWT (RLS). Workers connect to Postgres with a dedicated login
-- role that is a member of "office_worker" (created by the operator, see docs/execution-engine.md).
-- Workers never use the service-role key: they change jobs only through the security-definer
-- functions below, and they can touch a user's data only while holding a live lease on one of that
-- user's jobs (checked with session_user, which a session cannot change).

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'office_worker') then
    create role office_worker nologin;
  end if;
end $$;
grant usage on schema public to office_worker;

-- Jobs ------------------------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('task_run', 'project_run', 'orchestrate')),
  status text not null default 'queued'
    check (status in ('pending', 'queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  project_id uuid,
  task_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 1 check (max_attempts between 1 and 5),
  timeout_seconds integer not null default 600 check (timeout_seconds between 30 and 3600),
  next_run_at timestamptz not null default now(),
  locked_by text,
  lease_until timestamptz,
  cancel_requested boolean not null default false,
  last_error text check (char_length(last_error) <= 1000),
  result jsonb check (result is null or pg_column_size(result) <= 16384),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  attempt_started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (project_id, owner_id) references public.projects (id, owner_id) on delete cascade,
  foreign key (task_id, owner_id) references public.tasks (id, owner_id) on delete cascade,
  check ((kind = 'task_run') = (task_id is not null)),
  check (kind = 'task_run' or project_id is not null)
);
create index jobs_owner_created_idx on public.jobs (owner_id, created_at desc);
create index jobs_claim_idx on public.jobs (next_run_at, created_at) where status = 'queued';
create index jobs_running_idx on public.jobs (owner_id) where status in ('running', 'waiting_approval');
-- One active job per task and per project run, so double clicks or two devices cannot double-run.
create unique index jobs_one_active_task on public.jobs (task_id)
  where kind = 'task_run' and status in ('pending', 'queued', 'running', 'waiting_approval');
create unique index jobs_one_active_project on public.jobs (project_id)
  where kind in ('project_run', 'orchestrate') and status in ('pending', 'queued', 'running', 'waiting_approval');

create table public.job_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null,
  at timestamptz not null default now(),
  level text not null check (level in ('info', 'success', 'warning', 'error')),
  message text not null check (char_length(message) <= 2000),
  data jsonb check (data is null or pg_column_size(data) <= 16384),
  foreign key (job_id, owner_id) references public.jobs (id, owner_id) on delete cascade
);
create index job_events_job_idx on public.job_events (job_id, at);

-- Worker presence (only exposed to users as a yes/no) --------------------------------------------
create table public.office_workers (
  name text primary key,
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
alter table public.office_workers enable row level security;
revoke all on public.office_workers from anon, authenticated, office_worker;

-- Server-side job policy: limits are set here, whatever the client sent -------------------------
create function public.jobs_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.jobs j where j.owner_id = new.owner_id and j.status in ('pending', 'queued')) >= 50 then
    raise exception 'queue limit reached' using errcode = 'P0001', hint = 'At most 50 waiting jobs per user.';
  end if;
  new.status := 'queued';
  new.attempts := 0;
  new.max_attempts := case new.kind when 'task_run' then 3 when 'project_run' then 2 else 1 end;
  new.timeout_seconds := case new.kind when 'task_run' then 600 else 1800 end;
  new.next_run_at := now();
  new.locked_by := null; new.lease_until := null; new.cancel_requested := false;
  new.last_error := null; new.result := null;
  new.started_at := null; new.attempt_started_at := null; new.finished_at := null;
  new.created_at := now(); new.updated_at := now();
  return new;
end;
$$;
create trigger jobs_before_insert before insert on public.jobs for each row execute function public.jobs_before_insert();

-- State machine: every status change must be an allowed transition ------------------------------
create function public.jobs_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_id <> old.owner_id or new.kind <> old.kind
     or new.project_id is distinct from old.project_id or new.task_id is distinct from old.task_id then
    raise exception 'job identity is immutable' using errcode = 'P0001';
  end if;
  if old.cancel_requested and not new.cancel_requested then
    raise exception 'cancellation cannot be withdrawn' using errcode = 'P0001';
  end if;
  -- Waiting jobs are cancelled at once; running jobs are stopped by their worker.
  if new.cancel_requested and not old.cancel_requested and old.status in ('pending', 'queued') then
    new.status := 'cancelled';
    new.finished_at := now();
  end if;
  if new.status <> old.status and not (
       (old.status = 'pending' and new.status in ('queued', 'cancelled'))
    or (old.status = 'queued' and new.status in ('running', 'cancelled'))
    or (old.status = 'running' and new.status in ('completed', 'failed', 'cancelled', 'queued', 'waiting_approval'))
    or (old.status = 'waiting_approval' and new.status in ('running', 'cancelled', 'failed'))
  ) then
    raise exception 'invalid job transition % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger jobs_before_update before update on public.jobs for each row execute function public.jobs_before_update();

-- Every status change and cancellation request is logged ----------------------------------------
create function public.jobs_log_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.job_events (owner_id, job_id, level, message) values (new.owner_id, new.id, 'info', 'Execução enfileirada.');
  elsif new.status <> old.status then
    insert into public.job_events (owner_id, job_id, level, message, data)
    values (new.owner_id, new.id,
      case new.status when 'completed' then 'success' when 'failed' then 'error' when 'cancelled' then 'warning' else 'info' end,
      'Estado: ' || old.status || ' → ' || new.status,
      jsonb_build_object('attempt', new.attempts, 'error', new.last_error));
  elsif new.cancel_requested and not old.cancel_requested then
    insert into public.job_events (owner_id, job_id, level, message) values (new.owner_id, new.id, 'warning', 'Cancelamento solicitado.');
  end if;
  return null;
end;
$$;
revoke execute on function public.jobs_log_changes() from public, anon, authenticated;
create trigger jobs_log_changes after insert or update on public.jobs for each row execute function public.jobs_log_changes();

-- A project cannot be deleted while it has active jobs ------------------------------------------
create function public.projects_block_active_jobs() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.jobs j where j.project_id = old.id and j.status in ('pending', 'queued', 'running', 'waiting_approval'))
     or exists (select 1 from public.jobs j join public.tasks t on t.id = j.task_id
                where t.project_id = old.id and j.status in ('pending', 'queued', 'running', 'waiting_approval')) then
    raise exception 'project has active jobs' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
create trigger projects_block_active_jobs before delete on public.projects for each row execute function public.projects_block_active_jobs();

-- User access ----------------------------------------------------------------------------------
alter table public.jobs enable row level security;
alter table public.job_events enable row level security;
revoke all on public.jobs, public.job_events from anon, authenticated;
grant select, insert on public.jobs to authenticated;
grant update (cancel_requested) on public.jobs to authenticated;
grant select on public.job_events to authenticated;
create policy "own jobs: read" on public.jobs for select to authenticated using (owner_id = (select auth.uid()));
create policy "own jobs: enqueue" on public.jobs for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own jobs: cancel" on public.jobs for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own job events: read" on public.job_events for select to authenticated using (owner_id = (select auth.uid()));

create function public.office_worker_online() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.office_workers w where w.last_seen > now() - interval '30 seconds');
$$;
revoke execute on function public.office_worker_online() from public, anon;
grant execute on function public.office_worker_online() to authenticated;

-- Worker access: only the data of owners whose job this login currently holds ------------------
create function public.office_holds_lease(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.jobs j
     where j.owner_id = p_owner and j.locked_by = session_user
       and j.status in ('running', 'waiting_approval') and j.lease_until > now()
  );
$$;
revoke execute on function public.office_holds_lease(uuid) from public, anon, authenticated;
grant execute on function public.office_holds_lease(uuid) to office_worker;

do $$
declare t text;
begin
  foreach t in array array['agents', 'projects', 'tasks', 'agent_conversations', 'agent_messages', 'activity_events', 'usage_records'] loop
    execute format('create policy "worker: read leased owner" on public.%I for select to office_worker using (public.office_holds_lease(owner_id))', t);
    execute format('create policy "worker: insert leased owner" on public.%I for insert to office_worker with check (public.office_holds_lease(owner_id))', t);
  end loop;
  foreach t in array array['agents', 'projects', 'tasks'] loop
    execute format('create policy "worker: update leased owner" on public.%I for update to office_worker using (public.office_holds_lease(owner_id)) with check (public.office_holds_lease(owner_id))', t);
  end loop;
end $$;
create policy "worker: read leased limits" on public.usage_limits for select to office_worker using (public.office_holds_lease(user_id));
create policy "worker: read leased settings" on public.user_settings for select to office_worker using (public.office_holds_lease(user_id));

grant select, insert, update on public.agents, public.projects, public.tasks to office_worker;
grant select, insert on public.agent_conversations, public.agent_messages, public.activity_events, public.usage_records to office_worker;
grant select on public.usage_limits, public.user_settings to office_worker;

-- Worker functions -----------------------------------------------------------------------------
create function public.office_assert_worker() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not pg_has_role(session_user, 'office_worker', 'member') then
    raise exception 'not a worker' using errcode = '42501';
  end if;
end;
$$;

/** Claims the next runnable job, honoring each owner's concurrency limit under a per-owner lock. */
create function public.office_claim_job(p_default_max_concurrent integer, p_lease_seconds integer)
returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
  claimed public.jobs;
  running integer;
  cap integer;
begin
  perform public.office_assert_worker();
  insert into public.office_workers (name) values (session_user)
    on conflict (name) do update set last_seen = now();
  for candidate in
    select j.id, j.owner_id from public.jobs j
     where j.status = 'queued' and j.next_run_at <= now() and not j.cancel_requested
     order by j.next_run_at, j.created_at
     limit 25
  loop
    perform pg_advisory_xact_lock(hashtextextended(candidate.owner_id::text, 0));
    select count(*) into running from public.jobs r
     where r.owner_id = candidate.owner_id and r.status in ('running', 'waiting_approval');
    select coalesce(l.max_concurrent_runs, p_default_max_concurrent) into cap
      from (select 1) one left join public.usage_limits l on l.user_id = candidate.owner_id;
    if cap is null or running < cap then
      update public.jobs j
         set status = 'running', locked_by = session_user, attempts = j.attempts + 1,
             lease_until = now() + make_interval(secs => p_lease_seconds),
             started_at = coalesce(j.started_at, now()), attempt_started_at = now()
       where j.id = candidate.id and j.status = 'queued' and not j.cancel_requested
      returning j.* into claimed;
      if found then
        return next claimed;
        return;
      end if;
    end if;
  end loop;
  return;
end;
$$;

/** Extends the lease; returns whether the user asked to cancel. Fails if the lease was lost. */
create function public.office_heartbeat_job(p_job uuid, p_lease_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare cancel boolean;
begin
  perform public.office_assert_worker();
  update public.office_workers set last_seen = now() where name = session_user;
  update public.jobs set lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_job and locked_by = session_user and status in ('running', 'waiting_approval')
  returning cancel_requested into cancel;
  if not found then
    raise exception 'lease lost' using errcode = 'P0002';
  end if;
  return cancel;
end;
$$;

create function public.office_finish_job(p_job uuid, p_status text, p_result jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.office_assert_worker();
  if p_status not in ('completed', 'cancelled') then
    raise exception 'use office_fail_job for failures' using errcode = '22023';
  end if;
  -- A successful retry clears the previous attempt's error; the history stays in job_events.
  update public.jobs set status = p_status, result = p_result, finished_at = now(), locked_by = null, lease_until = null,
         last_error = case when p_status = 'completed' then null else last_error end
   where id = p_job and locked_by = session_user and status = 'running';
  if not found then raise exception 'lease lost' using errcode = 'P0002'; end if;
end;
$$;

/** Retries transient failures with exponential backoff (30 s, 60 s, ... max 10 min); otherwise fails. */
create function public.office_fail_job(p_job uuid, p_error text, p_retryable boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare outcome text;
begin
  perform public.office_assert_worker();
  update public.jobs j
     set status = case when p_retryable and j.attempts < j.max_attempts and not j.cancel_requested then 'queued' else 'failed' end,
         next_run_at = now() + make_interval(secs => least(600, 30 * power(2, greatest(j.attempts - 1, 0)))::integer),
         last_error = left(p_error, 1000),
         finished_at = case when p_retryable and j.attempts < j.max_attempts and not j.cancel_requested then null else now() end,
         locked_by = null, lease_until = null
   where j.id = p_job and j.locked_by = session_user and j.status = 'running'
  returning j.status into outcome;
  if not found then raise exception 'lease lost' using errcode = 'P0002'; end if;
  return outcome;
end;
$$;

create function public.office_log_job(p_job uuid, p_level text, p_message text, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.office_assert_worker();
  insert into public.job_events (owner_id, job_id, level, message, data)
  select j.owner_id, j.id, p_level, left(p_message, 2000), p_data from public.jobs j
   where j.id = p_job and j.locked_by = session_user;
  if not found then raise exception 'lease lost' using errcode = 'P0002'; end if;
end;
$$;

/**
 * Requeues or fails jobs whose worker vanished (lease expired) or that exceeded their timeout,
 * and releases what that worker left half-done (running tasks, busy projects and agents), so the
 * retry or the user can run it again.
 */
create function public.office_reap_jobs() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform public.office_assert_worker();
  create temporary table if not exists reaped_jobs (id uuid, owner_id uuid, kind text, task_id uuid, project_id uuid) on commit drop;
  delete from reaped_jobs;
  with expired as (
    update public.jobs j
       set status = case when j.cancel_requested then 'cancelled'
                         when j.attempts < j.max_attempts and j.attempt_started_at + make_interval(secs => j.timeout_seconds) > now() then 'queued'
                         else 'failed' end,
           last_error = case when j.attempt_started_at + make_interval(secs => j.timeout_seconds) <= now()
                             then 'Tempo limite da execução excedido.' else 'O worker parou de responder.' end,
           next_run_at = now() + interval '30 seconds',
           finished_at = case when not j.cancel_requested and j.attempts < j.max_attempts
                               and j.attempt_started_at + make_interval(secs => j.timeout_seconds) > now() then null else now() end,
           locked_by = null, lease_until = null
     where j.status = 'running'
       and (j.lease_until < now() or j.attempt_started_at + make_interval(secs => j.timeout_seconds + 60) < now())
    returning j.id, j.owner_id, j.kind, j.task_id, j.project_id
  )
  insert into reaped_jobs select * from expired;
  get diagnostics n = row_count;
  if n = 0 then return 0; end if;

  update public.agents a set status = 'idle', current_task_id = null
    from public.tasks t, reaped_jobs r
   where a.current_task_id = t.id and t.status = 'running' and t.owner_id = r.owner_id
     and (t.id = r.task_id or (r.kind <> 'task_run' and t.project_id = r.project_id));
  update public.tasks t set status = 'failed', error = 'Interrompida: o worker parou de responder.', completed_at = now()
    from reaped_jobs r
   where t.status = 'running' and t.owner_id = r.owner_id
     and (t.id = r.task_id or (r.kind <> 'task_run' and t.project_id = r.project_id));
  update public.agents a set status = 'idle'
    from public.projects p, reaped_jobs r
   where r.kind = 'orchestrate' and p.id = r.project_id and p.status = 'planning'
     and a.owner_id = r.owner_id and a.status = 'meeting';
  update public.projects p set status = 'failed'
    from reaped_jobs r
   where r.kind <> 'task_run' and p.id = r.project_id and p.status in ('planning', 'running');
  return n;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'office_assert_worker()', 'office_claim_job(integer, integer)', 'office_heartbeat_job(uuid, integer)',
    'office_finish_job(uuid, text, jsonb)', 'office_fail_job(uuid, text, boolean)', 'office_log_job(uuid, text, text, jsonb)',
    'office_reap_jobs()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to office_worker', f);
  end loop;
end $$;

-- Realtime ---------------------------------------------------------------------------------------
alter publication supabase_realtime add table public.jobs, public.job_events;

-- Work owned by an active job is supervised by the queue (leases, timeouts), not by the
-- Stage 2 stale-work recovery.
create or replace function public.recover_stale_work(p_stale_after interval)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  changed integer := 0;
  n integer;
begin
  update public.tasks t
     set status = 'failed', error = 'Interrompida: a execução parou de responder. Tente novamente.', completed_at = now()
   where t.owner_id = me and t.status = 'running' and t.updated_at < now() - p_stale_after
     and not exists (select 1 from public.jobs j where j.owner_id = me and j.status in ('pending', 'queued', 'running', 'waiting_approval')
                       and (j.task_id = t.id or j.project_id = t.project_id));
  get diagnostics n = row_count; changed := changed + n;

  update public.projects p
     set status = 'failed'
   where p.owner_id = me and p.status in ('planning', 'running')
     and greatest(p.updated_at, coalesce((select max(t.updated_at) from public.tasks t where t.project_id = p.id), p.updated_at)) < now() - p_stale_after
     and not exists (select 1 from public.tasks t where t.project_id = p.id and t.status = 'running')
     and not exists (select 1 from public.jobs j where j.project_id = p.id and j.status in ('pending', 'queued', 'running', 'waiting_approval'));
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
