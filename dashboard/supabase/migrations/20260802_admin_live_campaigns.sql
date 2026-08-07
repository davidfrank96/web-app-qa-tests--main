alter table public.campaign_runs
  add column if not exists execution_context jsonb,
  add column if not exists cleanup jsonb;

alter table public.execution_jobs
  add column if not exists execution_context jsonb;

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
    'cleanup_verified',
    'unauthorized_access_attempt'
  ));
