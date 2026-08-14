update public.monitoring_definitions
set
  timeout_ms = 360000,
  updated_at = clock_timestamp()
where id in (
  '9e678cef-036a-46b9-a6ca-f25ad880e92a',
  '3080f13e-022a-44a1-bbbb-b905468ca18a',
  'ab90fa94-369f-4835-8942-465a50fd1dc6',
  'e663f90b-b4c8-42e8-b1c4-23403312fa49'
);
