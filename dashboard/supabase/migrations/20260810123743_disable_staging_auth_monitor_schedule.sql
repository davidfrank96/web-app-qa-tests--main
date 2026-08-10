-- First hosted deployment keeps the staging authentication monitor available
-- for controlled execution, but prevents automatic scheduling until Google and
-- Apple authentication checks are separately certified.
update public.monitoring_definitions
set
  enabled = false,
  updated_at = greatest(updated_at, '2026-08-10T00:00:00.000Z'::timestamptz)
where id = '9e678cef-036a-46b9-a6ca-f25ad880e92a'
  and campaign_id = 'monitor_inssa_auth_staging'
  and environment = 'staging';
