-- Workers report which AI providers they are configured for (names only, never keys), so the web
-- server can decide availability without holding AI keys itself.

alter table public.office_workers
  add column providers text[] not null default '{}' check (providers <@ array['anthropic', 'openai']::text[]);

create function public.office_worker_register(p_providers text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.office_assert_worker();
  insert into public.office_workers (name, providers) values (session_user, coalesce(p_providers, '{}'))
  on conflict (name) do update set providers = excluded.providers, last_seen = now();
end;
$$;
revoke execute on function public.office_worker_register(text[]) from public, anon, authenticated;
grant execute on function public.office_worker_register(text[]) to office_worker;

/** Providers offered by workers seen in the last 24 hours (short restarts do not block enqueueing). */
create function public.office_available_providers() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct provider order by provider), '{}')
    from public.office_workers w, unnest(w.providers) as provider
   where w.last_seen > now() - interval '24 hours';
$$;
revoke execute on function public.office_available_providers() from public, anon;
grant execute on function public.office_available_providers() to authenticated;
