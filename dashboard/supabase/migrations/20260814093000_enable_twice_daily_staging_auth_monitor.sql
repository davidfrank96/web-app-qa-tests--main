insert into public.monitoring_definitions (
  id, name, product, campaign_id, environment, trigger_type, enabled, severity,
  schedule, schedule_config, notification_policy, retry_policy, timeout_ms,
  evidence_policy, run_policy, schema_version, created_at, updated_at
)
values
  (
    '9e678cef-036a-46b9-a6ca-f25ad880e92a',
    'INSSA Authentication Monitoring - Staging Midday',
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
    clock_timestamp()
  ),
  (
    '3080f13e-022a-44a1-bbbb-b905468ca18a',
    'INSSA Authentication Monitoring - Staging Evening',
    'INSSA',
    'monitor_inssa_auth_staging',
    'staging',
    'schedule',
    true,
    'critical',
    null,
    '{"frequency":"daily","hour":18,"minute":0,"timezone":"Europe/Dublin"}'::jsonb,
    'critical',
    '{"backoffMs":60000,"maxAttempts":2}'::jsonb,
    120000,
    'always',
    'one_active_run',
    1,
    clock_timestamp(),
    clock_timestamp()
  )
on conflict (id) do update
set
  name = excluded.name,
  product = excluded.product,
  campaign_id = excluded.campaign_id,
  environment = excluded.environment,
  trigger_type = excluded.trigger_type,
  enabled = excluded.enabled,
  severity = excluded.severity,
  schedule = excluded.schedule,
  schedule_config = excluded.schedule_config,
  notification_policy = excluded.notification_policy,
  retry_policy = excluded.retry_policy,
  timeout_ms = excluded.timeout_ms,
  evidence_policy = excluded.evidence_policy,
  run_policy = excluded.run_policy,
  schema_version = excluded.schema_version,
  updated_at = clock_timestamp();

update public.monitoring_definitions
set enabled = false
where id in (
  'ab90fa94-369f-4835-8942-465a50fd1dc6',
  'e663f90b-b4c8-42e8-b1c4-23403312fa49'
);
