-- Wave 3: metadata-only planning. No evidence mutation or deletion function exists.
create table public.retention_policies (
  id text primary key,
  mode text not null check (mode = 'dry_run_only'),
  effective_at timestamptz not null,
  routine_days integer not null check (routine_days >= 30),
  failure_days integer not null check (failure_days >= 90),
  security_days integer not null check (security_days >= 90),
  post_cleanup_days integer not null check (post_cleanup_days >= 30),
  created_at timestamptz not null default now(),
  created_by text not null,
  description text not null
);
insert into public.retention_policies
  (id, mode, effective_at, routine_days, failure_days, security_days, post_cleanup_days, created_by, description)
values ('evidence-retention-v1', 'dry_run_only', '2026-09-14T00:00:00Z', 30, 90, 90, 30,
  'migration:wave-3', 'Whole bundles; strongest rule wins. Unresolved cleanup and active holds indefinite. Unknown state requires review. SIEM metadata preserved. Audit events, cleanup ledger, monitoring definitions, logs and outbox are outside retention. No deletion authorized.');

create table public.retention_holds (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'run', 'bundle', 'item', 'cleanup')),
  run_id uuid references public.campaign_runs(id) on delete restrict,
  bundle_id uuid references public.evidence_bundles(id) on delete restrict,
  item_id uuid references public.evidence_items(id) on delete restrict,
  cleanup_ledger_id text references public.cleanup_ledger(id) on delete restrict,
  reason text not null check (length(btrim(reason)) > 0),
  hold_type text not null check (hold_type in ('manual', 'security_review', 'incident', 'cleanup', 'compliance')),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by text,
  status text not null default 'active' check (status in ('active', 'released')),
  constraint retention_hold_scope check (
    (scope = 'global' and num_nonnulls(run_id, bundle_id, item_id, cleanup_ledger_id) = 0) or
    (num_nonnulls(run_id, bundle_id, item_id, cleanup_ledger_id) = 1 and
      ((scope = 'run' and run_id is not null) or (scope = 'bundle' and bundle_id is not null) or
       (scope = 'item' and item_id is not null) or (scope = 'cleanup' and cleanup_ledger_id is not null)))
  ),
  constraint retention_hold_release check (
    (status = 'active' and released_at is null and released_by is null) or
    (status = 'released' and released_at is not null and released_at >= created_at and released_by is not null and length(btrim(released_by)) > 0)
  )
);
create index retention_holds_run_idx on public.retention_holds(run_id);
create index retention_holds_bundle_idx on public.retention_holds(bundle_id);
create index retention_holds_item_idx on public.retention_holds(item_id);
create index retention_holds_cleanup_idx on public.retention_holds(cleanup_ledger_id);
alter table public.retention_policies enable row level security;
alter table public.retention_holds enable row level security;
revoke all on public.retention_policies, public.retention_holds from public, anon, authenticated, service_role;
-- Policies are immutable to the application. Holds are released, never removed or rewritten.
grant select on public.retention_policies to service_role;
grant select, insert on public.retention_holds to service_role;
grant update (status, released_at, released_by) on public.retention_holds to service_role;

create function public.retention_hold_preserve_release()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.status = 'released' then raise exception 'Released retention holds are immutable; create a new hold'; end if;
  return new;
end;
$$;
revoke all on function public.retention_hold_preserve_release() from public, anon, authenticated;
create trigger retention_hold_preserve_release before update on public.retention_holds
  for each row execute function public.retention_hold_preserve_release();

-- Explicit resource allowlist: no logs, audit events, notifications or monitoring definitions.
create view public.retention_source_rows with (security_invoker = true) as
  select 'policies'::text as resource, t.id::text as id, to_jsonb(t) as data from public.retention_policies t
  union all select 'holds', t.id::text, to_jsonb(t) from public.retention_holds t
  union all select 'runs', t.id::text, to_jsonb(t) - 'requested_by' from public.campaign_runs t
  union all select 'bundles', t.id::text, to_jsonb(t) from public.evidence_bundles t
  union all select 'items', t.id::text, to_jsonb(t) from public.evidence_items t
  union all select 'cleanup', t.id::text, to_jsonb(t) from public.cleanup_ledger t
  union all select 'objects', t.id::text, jsonb_build_object(
    'id', t.id, 'name', t.name, 'size_bytes', t.metadata->'size', 'created_at', t.created_at, 'updated_at', t.updated_at)
    from storage.objects t where t.bucket_id = 'inssa-evidence';
revoke all on public.retention_source_rows from public, anon, authenticated, service_role;
grant select on public.retention_source_rows to service_role;

-- JSON envelopes avoid PostgREST's 1,000-row response cap. Every GET is a read-only transaction.
create function public.retention_read_page(p_resource text, p_offset integer default 0, p_limit integer default 500)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_resource not in ('policies', 'holds', 'runs', 'bundles', 'items', 'cleanup', 'objects') or
     p_resource is null or p_offset is null or p_limit is null or p_offset < 0 or p_limit < 1 or p_limit > 500 then
    raise exception 'Invalid retention read page';
  end if;
  select coalesce(jsonb_agg(page.data order by page.id), '[]'::jsonb) into result from (
    select id, data from public.retention_source_rows where resource = p_resource order by id limit p_limit offset p_offset
  ) page;
  return jsonb_build_object('rows', result);
end;
$$;
create function public.retention_read_manifest()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('revision', md5(coalesce(string_agg(resource || ':' || digest, ',' order by resource), '')),
    'counts', coalesce(jsonb_object_agg(resource, count), '{}'::jsonb)) from (
    select resource, count(*) as count, md5(string_agg(id || ':' || md5(data::text), ',' order by id)) as digest
    from public.retention_source_rows group by resource
  ) resources;
$$;
revoke all on function public.retention_read_page(text, integer, integer), public.retention_read_manifest() from public, anon, authenticated;
grant execute on function public.retention_read_page(text, integer, integer), public.retention_read_manifest() to service_role;
