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
  v_now timestamptz := clock_timestamp();
  next_count integer;
begin
  if p_scope_hash !~ '^[0-9a-f]{64}$' or p_action not in ('password', 'magic-link') or
     p_max_attempts < 1 or p_window_seconds < 1 or p_block_seconds < 1 then
    raise exception 'Invalid authentication rate-limit parameters.';
  end if;

  insert into public.auth_rate_limits (
    scope_hash, action, window_started_at, attempt_count, blocked_until, updated_at
  ) values (
    p_scope_hash, p_action, v_now, 0, null, v_now
  ) on conflict (scope_hash, action) do nothing;

  select * into current_record
  from public.auth_rate_limits
  where scope_hash = p_scope_hash and action = p_action
  for update;

  if current_record.blocked_until is not null and current_record.blocked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from current_record.blocked_until - v_now))::integer);
    return;
  end if;

  if current_record.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    next_count := 1;
    current_record.window_started_at := v_now;
  else
    next_count := current_record.attempt_count + 1;
  end if;

  update public.auth_rate_limits
  set
    attempt_count = next_count,
    blocked_until = case when next_count > p_max_attempts then v_now + make_interval(secs => p_block_seconds) else null end,
    updated_at = v_now,
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
