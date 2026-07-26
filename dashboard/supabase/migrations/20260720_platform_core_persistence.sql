create table if not exists public.campaign_runs (
  id uuid primary key,
  campaign_key text not null,
  status text not null check (status in (
    'queued',
    'starting',
    'running',
    'indexing_artifacts',
    'passed',
    'passed_with_warnings',
    'failed',
    'failed_startup',
    'cancelled',
    'timed_out'
  )),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  exit_code integer,
  requested_by text not null,
  command_snapshot jsonb not null,
  schema_version integer not null default 1 check (schema_version = 1)
);

create table if not exists public.run_logs (
  id uuid primary key,
  run_id uuid not null references public.campaign_runs(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  stream text not null check (stream in ('stdout', 'stderr', 'system')),
  message text not null,
  created_at timestamptz not null,
  schema_version integer not null default 1 check (schema_version = 1),
  unique (run_id, sequence)
);

create table if not exists public.artifacts (
  id uuid primary key,
  run_id uuid not null references public.campaign_runs(id) on delete cascade,
  artifact_type text not null,
  file_path text not null,
  file_size bigint not null check (file_size >= 0),
  content_type text not null,
  created_at timestamptz not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  sensitive boolean not null default false,
  render_inline boolean not null default false,
  schema_version integer not null default 1 check (schema_version = 1),
  unique (run_id, file_path)
);

create table if not exists public.audit_events (
  id uuid primary key,
  run_id uuid references public.campaign_runs(id) on delete set null,
  event_type text not null check (event_type in (
    'login',
    'logout',
    'run_requested',
    'run_completed',
    'run_failed',
    'run_denied',
    'role_violation_attempt',
    'unauthorized_access_attempt'
  )),
  actor_user_id text,
  actor_email text,
  role text,
  campaign_key text,
  status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  schema_version integer not null default 1 check (schema_version = 1)
);

create table if not exists public.evidence_bundles (
  id uuid primary key,
  run_id uuid not null references public.campaign_runs(id) on delete cascade,
  campaign_key text not null,
  title text not null,
  product text not null,
  environment text not null,
  bundle_type text not null check (bundle_type in (
    'artifact-validation',
    'healthcheck',
    'lifecycle',
    'mixed',
    'playwright',
    'report',
    'security',
    'siem'
  )),
  status text not null check (status = 'indexed'),
  retention_class text not null check (retention_class in (
    'cleanup-evidence',
    'default',
    'security-evidence',
    'short-lived',
    'siem-metadata'
  )),
  root_path text not null,
  source_artifact_id uuid references public.artifacts(id) on delete set null,
  item_count integer not null check (item_count >= 0),
  total_bytes bigint not null check (total_bytes >= 0),
  checksum_manifest jsonb not null default '{}'::jsonb,
  sensitive boolean not null default false,
  storage_backend text not null check (storage_backend in ('local-filesystem', 'supabase-storage')),
  storage_prefix text,
  upload_status text not null check (upload_status in ('local_only', 'uploaded', 'failed')),
  uploaded_at timestamptz,
  upload_error text,
  created_at timestamptz not null,
  indexed_at timestamptz not null,
  schema_version integer not null default 1 check (schema_version = 1)
);

create table if not exists public.evidence_items (
  id uuid primary key,
  bundle_id uuid not null references public.evidence_bundles(id) on delete cascade,
  run_id uuid not null references public.campaign_runs(id) on delete cascade,
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  campaign_key text not null,
  item_type text not null,
  file_name text not null,
  relative_path text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  sensitive boolean not null default false,
  render_inline boolean not null default false,
  retention_class text not null check (retention_class in (
    'cleanup-evidence',
    'default',
    'security-evidence',
    'short-lived',
    'siem-metadata'
  )),
  storage_backend text not null check (storage_backend in ('local-filesystem', 'supabase-storage')),
  storage_key text not null,
  upload_status text not null check (upload_status in ('local_only', 'uploaded', 'failed')),
  uploaded_at timestamptz,
  upload_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  schema_version integer not null default 1 check (schema_version = 1),
  unique (bundle_id, relative_path)
);

create index if not exists campaign_runs_created_at_idx on public.campaign_runs (created_at desc);
create index if not exists campaign_runs_status_idx on public.campaign_runs (status, created_at desc);
create index if not exists campaign_runs_campaign_idx on public.campaign_runs (campaign_key, created_at desc);
create index if not exists artifacts_run_type_idx on public.artifacts (run_id, artifact_type);
create index if not exists audit_events_created_at_idx on public.audit_events (created_at desc);
create index if not exists audit_events_type_idx on public.audit_events (event_type, created_at desc);
create index if not exists audit_events_run_idx on public.audit_events (run_id, created_at desc);
create index if not exists evidence_bundles_run_idx on public.evidence_bundles (run_id, created_at desc);
create index if not exists evidence_bundles_upload_idx on public.evidence_bundles (upload_status, created_at desc);
create index if not exists evidence_items_run_idx on public.evidence_items (run_id, created_at desc);
create index if not exists evidence_items_artifact_idx on public.evidence_items (artifact_id);
create index if not exists evidence_items_type_idx on public.evidence_items (item_type, created_at desc);

alter table public.campaign_runs enable row level security;
alter table public.run_logs enable row level security;
alter table public.artifacts enable row level security;
alter table public.audit_events enable row level security;
alter table public.evidence_bundles enable row level security;
alter table public.evidence_items enable row level security;

revoke all on table public.campaign_runs from public, anon, authenticated;
revoke all on table public.run_logs from public, anon, authenticated;
revoke all on table public.artifacts from public, anon, authenticated;
revoke all on table public.audit_events from public, anon, authenticated;
revoke all on table public.evidence_bundles from public, anon, authenticated;
revoke all on table public.evidence_items from public, anon, authenticated;

grant all on table public.campaign_runs to service_role;
grant all on table public.run_logs to service_role;
grant all on table public.artifacts to service_role;
grant all on table public.audit_events to service_role;
grant all on table public.evidence_bundles to service_role;
grant all on table public.evidence_items to service_role;
