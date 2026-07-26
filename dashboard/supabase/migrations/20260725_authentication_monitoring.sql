insert into public.monitoring_definitions (
  id, name, product, campaign_id, environment, trigger_type, enabled, severity,
  schedule, schedule_config, notification_policy, retry_policy, timeout_ms,
  evidence_policy, run_policy, schema_version, created_at, updated_at
)
values
  (
    '9e678cef-036a-46b9-a6ca-f25ad880e92a',
    'INSSA Authentication Monitoring - Staging',
    'INSSA',
    'monitor_inssa_auth_staging',
    'staging',
    'schedule',
    true,
    'critical',
    null,
    '{"frequency":"daily","hour":12,"minute":0,"timezone":"Europe/Dublin"}'::jsonb,
    'critical',
    '{"backoffMs":60000,"maxAttempts":2}'::jsonb,
    120000,
    'always',
    'one_active_run',
    1,
    '2026-07-21T00:00:00.000Z',
    '2026-07-21T00:00:00.000Z'
  ),
  (
    'ab90fa94-369f-4835-8942-465a50fd1dc6',
    'INSSA Authentication Monitoring - Production Midday',
    'INSSA',
    'monitor_inssa_auth_production',
    'production',
    'schedule',
    false,
    'critical',
    null,
    '{"frequency":"daily","hour":12,"minute":0,"timezone":"Europe/Dublin"}'::jsonb,
    'critical',
    '{"backoffMs":60000,"maxAttempts":2}'::jsonb,
    120000,
    'always',
    'one_active_run',
    1,
    '2026-07-21T00:00:00.000Z',
    '2026-07-21T00:00:00.000Z'
  ),
  (
    'e663f90b-b4c8-42e8-b1c4-23403312fa49',
    'INSSA Authentication Monitoring - Production Evening',
    'INSSA',
    'monitor_inssa_auth_production',
    'production',
    'schedule',
    false,
    'critical',
    null,
    '{"frequency":"daily","hour":18,"minute":0,"timezone":"Europe/Dublin"}'::jsonb,
    'critical',
    '{"backoffMs":60000,"maxAttempts":2}'::jsonb,
    120000,
    'always',
    'one_active_run',
    1,
    '2026-07-21T00:00:00.000Z',
    '2026-07-21T00:00:00.000Z'
  )
on conflict (id) do update
set
  schedule_config = excluded.schedule_config,
  updated_at = excluded.updated_at;
