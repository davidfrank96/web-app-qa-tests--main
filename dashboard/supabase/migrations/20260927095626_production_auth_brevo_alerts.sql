-- Reuse the durable outbox. All delivery/incident functions are service-role only.
alter table public.monitoring_definitions add column schedule_not_before timestamptz;
update public.monitoring_definitions set enabled=false,
 schedule_config=jsonb_set(schedule_config,'{minute}','15'), updated_at=now()
where environment='production' and campaign_id='monitor_inssa_auth_production'
 and id in ('ab90fa94-369f-4835-8942-465a50fd1dc6','e663f90b-b4c8-42e8-b1c4-23403312fa49');

alter table public.notification_outbox drop constraint notification_outbox_event_type_check;
alter table public.notification_outbox add constraint notification_outbox_event_type_check check(event_type in (
 'run_queued','run_started','run_completed','run_failed','worker_restarted','worker_lease_expired',
 'job_recovery','evidence_upload_failed','execution_failed','production_auth_failed','production_auth_recovered','production_auth_test','production_auth_observation'));
alter table public.notification_outbox add column next_attempt_at timestamptz not null default now(),
 add column delivery_lease_until timestamptz, add column delivery_token uuid, add column first_attempt_at timestamptz;
create index notification_brevo_due_idx on public.notification_outbox(next_attempt_at)
 where event_type in ('production_auth_failed','production_auth_recovered','production_auth_test','production_auth_observation') and status in ('pending','failed','processing');

create table public.production_auth_alert_state (
 id boolean primary key default true check(id), incident_id uuid, incident_open boolean not null default false,
 alerted boolean not null default false, last_run_at timestamptz, last_run_id uuid references public.campaign_runs(id) on delete set null
);
alter table public.production_auth_alert_state enable row level security;
revoke all on public.production_auth_alert_state from public,anon,authenticated;
grant all on public.production_auth_alert_state to service_role;
insert into public.production_auth_alert_state(id) values(true);

create function public.enqueue_production_auth_alert(p_kind text,p_run uuid,p_incident uuid,p_classification text)
returns void language plpgsql security invoker set search_path='' as $$
declare r public.campaign_runs;
begin
 if p_kind not in ('production_auth_failed','production_auth_recovered') then raise exception 'Unsupported alert kind'; end if;
 select * into strict r from public.campaign_runs where id=p_run and campaign_key='monitor_inssa_auth_production';
 insert into public.notification_outbox(id,created_at,run_id,campaign_id,product,environment,event_type,severity,title,message,payload,correlation_id,deduplication_key)
 values(gen_random_uuid(),now(),r.id,r.campaign_key,'INSSA','production',p_kind,
 case when p_kind='production_auth_failed' then 'critical' else 'informational' end,
 case when p_kind='production_auth_failed' then 'Production authentication failure' else 'Production authentication restored' end,
 'Production username/password monitoring result. Open the authenticated QA run for diagnostics.',
 jsonb_build_object('incidentId',p_incident,'classification',p_classification,'detectedAt',r.completed_at,'durationMs',r.duration_ms),
 r.id::text,'production-auth:'||p_incident::text||':'||case when p_kind='production_auth_recovered' then 'recovery' else r.id::text end)
 on conflict(deduplication_key) do nothing;
end $$;

create function public.record_production_auth_result(p_run uuid,p_passed boolean,p_classification text)
returns void language plpgsql security invoker set search_path='' as $$
declare r public.campaign_runs; s public.production_auth_alert_state; first_failure boolean;
begin
 if p_passed is null or p_classification is null or (p_passed and p_classification<>'NONE') or (not p_passed and p_classification='NONE') then raise exception 'Invalid result decision'; end if;
 if p_classification not in ('NONE','PRODUCTION_UNREACHABLE','LOGIN_PAGE_UNAVAILABLE','AUTHENTICATION_REJECTED','SESSION_NOT_ESTABLISHED','AUTHENTICATED_STATE_NOT_REACHED','TIMEOUT','MONITOR_INFRASTRUCTURE_FAILURE','UNKNOWN_AUTH_FAILURE') then raise exception 'Invalid classification'; end if;
 select * into strict r from public.campaign_runs where id=p_run and campaign_key='monitor_inssa_auth_production'
 and status in ('passed','passed_with_warnings','failed','failed_startup','timed_out','cancelled') and completed_at is not null;
 if p_passed and r.status not in ('passed','passed_with_warnings') then raise exception 'Failed run cannot recover an incident'; end if;
 select * into strict s from public.production_auth_alert_state where id for update;
 if s.last_run_at is not null and (r.completed_at < s.last_run_at or r.id=s.last_run_id) then return; end if;
 if not p_passed then
   first_failure := not s.incident_open;
   if first_failure then s.incident_id:=gen_random_uuid(); s.alerted:=false; end if;
   s.incident_open:=true;
   if first_failure or r.requested_by like 'scheduler:%' then
     perform public.enqueue_production_auth_alert('production_auth_failed',r.id,s.incident_id,p_classification);
   end if;
 elsif s.incident_open then
   s.incident_open:=false;
   -- Do not send an obsolete failure that has never been attempted after recovery.
   update public.notification_outbox set status='dead_letter',error_message='Superseded by authentication recovery'
   where event_type='production_auth_failed' and payload->>'incidentId'=s.incident_id::text and status in ('pending','failed') and attempt_count=0;
   if s.alerted then perform public.enqueue_production_auth_alert('production_auth_recovered',r.id,s.incident_id,'NONE'); end if;
 end if;
 update public.production_auth_alert_state set incident_id=s.incident_id,incident_open=s.incident_open,alerted=s.alerted,last_run_at=r.completed_at,last_run_id=r.id where id;
end $$;

create function public.claim_brevo_notification(p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare n public.notification_outbox;
begin
 -- Serialize claiming, not network delivery. A persisted lease spans the HTTP request.
 perform pg_catalog.pg_advisory_xact_lock(270926,1);
 update public.notification_outbox set status='dead_letter',error_message='Delivery retry budget exhausted',delivery_token=null,delivery_lease_until=null
 where event_type in ('production_auth_failed','production_auth_recovered','production_auth_test','production_auth_observation')
 and status in ('pending','failed','processing') and (delivery_lease_until is null or delivery_lease_until<=now())
 and (attempt_count>=3 or first_attempt_at<now()-interval '25 minutes');
 if exists(select 1 from public.notification_outbox where event_type in ('production_auth_failed','production_auth_recovered','production_auth_test','production_auth_observation') and status='processing' and delivery_lease_until>now()) then return null; end if;
 select * into n from public.notification_outbox where environment='production'
 and event_type in ('production_auth_failed','production_auth_recovered','production_auth_test','production_auth_observation')
 and ((status in ('pending','failed') and next_attempt_at<=now()) or (status='processing' and delivery_lease_until<=now()))
 order by created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 update public.notification_outbox set status='processing',attempt_count=attempt_count+1,last_attempt_at=now(),
 first_attempt_at=coalesce(first_attempt_at,now()),delivery_token=p_token,delivery_lease_until=now()+interval '60 seconds',provider=case when event_type='production_auth_observation' then 'internal' else 'brevo' end
 where id=n.id returning * into n;
 return to_jsonb(n);
end $$;

create function public.finish_brevo_notification(p_id uuid,p_token uuid,p_message_id text,p_error text,p_permanent boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare n public.notification_outbox; s public.production_auth_alert_state;
begin
 -- Same lock ordering as recording an auth result avoids delivery/recovery races.
 select * into strict s from public.production_auth_alert_state where id for update;
 select * into n from public.notification_outbox where id=p_id and status='processing' and delivery_token=p_token for update;
 if not found then raise exception 'Notification ownership lost'; end if;
 update public.notification_outbox set status=case when p_message_id is not null then 'delivered' when p_permanent or attempt_count>=3 then 'dead_letter' else 'failed' end,
 delivered_at=case when p_message_id is not null then now() else null end,provider_message_id=p_message_id,
 error_message=case when p_error is null then null else left(p_error,100) end,
 next_attempt_at=now()+make_interval(mins=>5*attempt_count),delivery_token=null,delivery_lease_until=null where id=p_id;
 if p_message_id is not null and n.event_type='production_auth_failed' and n.payload->>'incidentId'=s.incident_id::text then
   update public.production_auth_alert_state set alerted=true where id;
   if not s.incident_open then perform public.enqueue_production_auth_alert('production_auth_recovered',s.last_run_id,s.incident_id,'NONE'); end if;
 end if;
end $$;

revoke all on function public.enqueue_production_auth_alert(text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.record_production_auth_result(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.claim_brevo_notification(uuid) from public,anon,authenticated;
revoke all on function public.finish_brevo_notification(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_production_auth_alert(text,uuid,uuid,text), public.record_production_auth_result(uuid,boolean,text), public.claim_brevo_notification(uuid), public.finish_brevo_notification(uuid,uuid,text,text,boolean) to service_role;

-- Persist notification intent in the same transaction as the production terminal result.
create function public.queue_production_auth_observation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.campaign_key='monitor_inssa_auth_production' and new.completed_at is not null
 and new.status in ('passed','passed_with_warnings','failed','failed_startup','timed_out','cancelled') then
  insert into public.notification_outbox(id,created_at,run_id,campaign_id,product,environment,event_type,severity,title,message,correlation_id,deduplication_key)
  values(gen_random_uuid(),now(),new.id,new.campaign_key,'INSSA','production','production_auth_observation','informational',
   'Production authentication result ready','Evaluate the terminal password result for alerting.',new.id::text,'production-auth-observation:'||new.id::text)
  on conflict(deduplication_key) do nothing;
 end if;
 return new;
end $$;
revoke all on function public.queue_production_auth_observation() from public,anon,authenticated;
grant execute on function public.queue_production_auth_observation() to service_role;
create trigger production_auth_terminal_observation after insert or update of status,completed_at on public.campaign_runs
 for each row execute function public.queue_production_auth_observation();

-- Service-only activation is gated by an actual manual PASS; enabling never backfills.
create function public.activate_production_auth_schedules(p_run uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.campaign_runs; result jsonb; boundary timestamptz:=clock_timestamp();
begin
 select * into strict r from public.campaign_runs where id=p_run and campaign_key='monitor_inssa_auth_production'
 and status='passed' and completed_at is not null and requested_by not like 'scheduler:%';
 if not exists(select 1 from public.evidence_bundles where run_id=r.id and upload_status='uploaded') then
   raise exception 'Uploaded evidence required';
 end if;
 if (select count(*) from public.monitoring_definitions where environment='production' and campaign_id=r.campaign_key
 and id in ('ab90fa94-369f-4835-8942-465a50fd1dc6','e663f90b-b4c8-42e8-b1c4-23403312fa49'))<>2 then raise exception 'Existing production definitions required'; end if;
 update public.monitoring_definitions set enabled=true,schedule_not_before=boundary,updated_at=boundary
 where environment='production' and campaign_id=r.campaign_key and not enabled
 and schedule_config->>'timezone'='Europe/Dublin' and schedule_config->>'minute'='15'
 and id in ('ab90fa94-369f-4835-8942-465a50fd1dc6','e663f90b-b4c8-42e8-b1c4-23403312fa49');
 select jsonb_agg(jsonb_build_object('id',id,'enabled',enabled,'schedule',schedule_config,'notBefore',schedule_not_before)) into result
 from public.monitoring_definitions where id in ('ab90fa94-369f-4835-8942-465a50fd1dc6','e663f90b-b4c8-42e8-b1c4-23403312fa49');
 return result;
end $$;
revoke all on function public.activate_production_auth_schedules(uuid) from public,anon,authenticated;
grant execute on function public.activate_production_auth_schedules(uuid) to service_role;

create function public.production_auth_delivery_health() returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('pending',count(*) filter(where status in ('pending','processing')),
 'failed',count(*) filter(where status='failed'),'deadLetter',count(*) filter(where status='dead_letter'),
 'lastDeliveredAt',max(delivered_at)) from public.notification_outbox
 where event_type in ('production_auth_failed','production_auth_recovered','production_auth_test')
 and error_message is distinct from 'Superseded by authentication recovery';
$$;
revoke all on function public.production_auth_delivery_health() from public,anon,authenticated;
grant execute on function public.production_auth_delivery_health() to service_role;
