create table if not exists public.auth_rate_limits (
  scope_hash text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('password', 'magic-link')),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null,
  schema_version integer not null default 1 check (schema_version = 1),
  primary key (scope_hash, action)
);

create index if not exists auth_rate_limits_updated_idx on public.auth_rate_limits (updated_at);
create index if not exists auth_rate_limits_blocked_idx on public.auth_rate_limits (blocked_until) where blocked_until is not null;

alter table public.auth_rate_limits enable row level security;
revoke all on table public.auth_rate_limits from public, anon, authenticated;
grant all on table public.auth_rate_limits to service_role;

create or replace function public.consume_auth_rate_limit(
  p_scope_hash text,
  p_action text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_block_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  current_record public.auth_rate_limits%rowtype;
  current_time timestamptz := clock_timestamp();
  next_count integer;
begin
  if p_scope_hash !~ '^[0-9a-f]{64}$' or p_action not in ('password', 'magic-link') or
     p_max_attempts < 1 or p_window_seconds < 1 or p_block_seconds < 1 then
    raise exception 'Invalid authentication rate-limit parameters.';
  end if;

  insert into public.auth_rate_limits (
    scope_hash, action, window_started_at, attempt_count, blocked_until, updated_at
  ) values (
    p_scope_hash, p_action, current_time, 0, null, current_time
  ) on conflict (scope_hash, action) do nothing;

  select * into current_record
  from public.auth_rate_limits
  where scope_hash = p_scope_hash and action = p_action
  for update;

  if current_record.blocked_until is not null and current_record.blocked_until > current_time then
    return query select false, greatest(1, ceil(extract(epoch from current_record.blocked_until - current_time))::integer);
    return;
  end if;

  if current_record.window_started_at + make_interval(secs => p_window_seconds) <= current_time then
    next_count := 1;
    current_record.window_started_at := current_time;
  else
    next_count := current_record.attempt_count + 1;
  end if;

  update public.auth_rate_limits
  set
    attempt_count = next_count,
    blocked_until = case when next_count > p_max_attempts then current_time + make_interval(secs => p_block_seconds) else null end,
    updated_at = current_time,
    window_started_at = current_record.window_started_at
  where scope_hash = p_scope_hash and action = p_action;

  if next_count > p_max_attempts then
    return query select false, p_block_seconds;
  else
    return query select true, 0;
  end if;
end;
$$;

revoke all on function public.consume_auth_rate_limit(text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text, text, integer, integer, integer) to service_role;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
