create table if not exists public.cleanup_ledger (
  id text primary key,
  originating_run_id text not null,
  campaign_key text not null,
  product text not null check (product = 'INSSA'),
  environment text not null check (environment = 'staging'),
  object_type text not null check (object_type in ('time_capsule', 'media')),
  object_id text not null,
  object_path text not null,
  owner_account text,
  selected_recipient text,
  media_type text check (media_type is null or media_type in ('image', 'video')),
  resulting_state text,
  affected_users jsonb not null default '[]'::jsonb,
  dedicated_qa_account boolean not null default false,
  sensitive_values_excluded boolean not null default false,
  safely_accounted boolean not null default false,
  unexpected_data boolean not null default false,
  security_sensitive boolean not null default false,
  status text not null check (status in ('pending', 'deferred', 'completed', 'failed', 'cleanup_unavailable')),
  reason_code text,
  verification_methods jsonb not null default '[]'::jsonb,
  evidence_paths jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deferred_at timestamptz,
  resolved_at timestamptz,
  retention_until timestamptz not null,
  schema_version integer not null default 1 check (schema_version = 1),
  unique (originating_run_id, object_type, object_id)
);

create index if not exists cleanup_ledger_status_idx
  on public.cleanup_ledger (status, created_at);

create index if not exists cleanup_ledger_retention_idx
  on public.cleanup_ledger (retention_until)
  where status <> 'completed';

create index if not exists cleanup_ledger_run_idx
  on public.cleanup_ledger (originating_run_id);

alter table public.cleanup_ledger enable row level security;

revoke all on table public.cleanup_ledger from public, anon, authenticated;
grant all on table public.cleanup_ledger to service_role;

alter table public.audit_events
  drop constraint if exists audit_events_event_type_check;

alter table public.audit_events
  add constraint audit_events_event_type_check check (event_type in (
    'login',
    'logout',
    'run_requested',
    'run_queued',
    'run_started',
    'run_completed',
    'run_failed',
    'run_denied',
    'role_violation_attempt',
    'approval_opened',
    'approval_confirmed',
    'preflight_failed',
    'cleanup_acknowledged',
    'cleanup_deferred',
    'cleanup_investigation_required',
    'cleanup_verified',
    'unauthorized_access_attempt'
  ));
