-- Persistent content-free failures, separate from billable model usage.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table shared_private.ai_background_failures (
 id bigint generated always as identity primary key,
 job_id uuid references shared_private.ai_jobs(id) on delete cascade,
 event_id uuid references shared_private.ai_events(id) on delete cascade,
 phase text not null check(phase in ('reserve','prepare','submit','accept','reject','claim','retrieve','cancel','deliver','finish','expire','provider')),
 category text not null check(category in ('http','timeout','transport','storage','protocol','preparation','expired','unknown')),
 http_status integer check(http_status between 100 and 599),
 provider_request_id text check(provider_request_id ~ '^(req_[a-zA-Z0-9_-]{1,160}|[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$'),
 response_id text check(response_id ~ '^resp_[a-zA-Z0-9_-]{1,200}$'),
 transport_code text check(transport_code in ('ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','EPIPE','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET')),
 rpc_code text check(rpc_code ~ '^([0-9A-Z]{5}|PGRST[0-9]{3})$'),
 error_code text check(error_code in ('ai_response_mismatch','ai_operation_changed','ai_background_not_configured','invalid_job_deadline','ai_work_denied','project_denied','context_changed','unsupported_image','payload_too_large','invalid_ai_failure_diagnostic','receipt_missing','deadline_elapsed','model_output_limit','provider_failed')),
 elapsed_ms integer check(elapsed_ms between 0 and 86400000),
 observed_at timestamptz not null default clock_timestamp(),
 check((job_id is null)<>(event_id is null))
);
create index ai_background_failures_job on shared_private.ai_background_failures(job_id,id) where job_id is not null;
create index ai_background_failures_event on shared_private.ai_background_failures(event_id,id) where event_id is not null;
alter table shared_private.ai_background_failures enable row level security;
revoke all on shared_private.ai_background_failures from public,anon,authenticated,service_role;
grant select on shared_private.ai_background_failures to service_role;

create function shared.ai_work_record_failure(p_kind text,p_id uuid,p_failure jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_kind is null or p_kind not in ('job','event') or p_id is null
  or jsonb_typeof(p_failure) is distinct from 'object'
  or not p_failure ?& array['phase','category']
  or p_failure-array['phase','category','http_status','provider_request_id','response_id','transport_code','rpc_code','error_code','elapsed_ms']::text[]<>'{}'
  or exists(select 1 from jsonb_each(p_failure) item where
   (item.key in ('phase','category','provider_request_id','response_id','transport_code','rpc_code','error_code') and jsonb_typeof(item.value) not in ('string','null'))
   or (item.key in ('http_status','elapsed_ms') and jsonb_typeof(item.value) not in ('number','null')))
  or p_failure->>'phase' is null or p_failure->>'category' is null
  or (p_failure->>'http_status' is not null and p_failure->>'http_status' !~ '^[0-9]{3}$')
  or (p_failure->>'elapsed_ms' is not null and p_failure->>'elapsed_ms' !~ '^[0-9]{1,8}$')
  then raise exception 'invalid_ai_failure_diagnostic' using errcode='22023'; end if;
 if p_kind='job' then
  perform 1 from shared_private.ai_jobs where id=p_id for key share;
 else
  perform 1 from shared_private.ai_events where id=p_id for key share;
 end if;
 if not found then return false; end if;
 insert into shared_private.ai_background_failures(job_id,event_id,phase,category,http_status,provider_request_id,response_id,transport_code,rpc_code,error_code,elapsed_ms)
 values(case when p_kind='job' then p_id end,case when p_kind='event' then p_id end,
  p_failure->>'phase',p_failure->>'category',(p_failure->>'http_status')::integer,p_failure->>'provider_request_id',
  p_failure->>'response_id',p_failure->>'transport_code',p_failure->>'rpc_code',p_failure->>'error_code',(p_failure->>'elapsed_ms')::integer);
 return true;
end $$;
revoke all on function shared.ai_work_record_failure(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function shared.ai_work_record_failure(text,uuid,jsonb) to service_role;

-- Expiry can be decided by the scheduler after the original isolate is gone.
-- Record only the observed deadline/receipt state, never invent a network cause.
create function shared_private.ai_record_terminal_failure()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='expired' and old.status is distinct from new.status then
  insert into shared_private.ai_background_failures(job_id,phase,category,response_id,error_code,elapsed_ms)
  values(new.id,'expire','expired',new.response_id,case when new.response_id is null then 'receipt_missing' else 'deadline_elapsed' end,
   least(86400000,greatest(0,floor(extract(epoch from (clock_timestamp()-new.created_at))*1000)))::integer);
 elsif new.status='failed' and old.status is distinct from new.status and new.response is not null then
  insert into shared_private.ai_background_failures(job_id,phase,category,response_id,error_code)
  values(new.id,'provider','protocol',new.response_id,
   case when new.response#>>'{incomplete_details,reason}'='max_output_tokens' then 'model_output_limit' else 'provider_failed' end);
 end if;
 return new;
end $$;
revoke all on function shared_private.ai_record_terminal_failure() from public,anon,authenticated,service_role;
create trigger ai_terminal_failure after update of status on shared_private.ai_jobs
 for each row execute function shared_private.ai_record_terminal_failure();

-- The database outbox can fail before an Edge worker is involved. Keep its
-- original retry/accounting policy while recording the SQLSTATE, never SQLERRM.
create or replace function shared_private.ai_dispatch() returns integer language plpgsql security definer set search_path='' as $$
declare endpoint text; item record; dispatched integer:=0; failure_code text;
begin
 for item in select id from shared_private.ai_jobs where status in ('completed','failed','expired','cancelled') and notified_at is null and next_check_at<=clock_timestamp() limit 40 loop
  begin
   update shared_private.ai_jobs set next_check_at=clock_timestamp()+interval '1 minute' where id=item.id;
   perform shared_private.ai_wake(item.id);
  exception when others then
   get stacked diagnostics failure_code=returned_sqlstate;
   perform shared.ai_work_record_failure('job',item.id,jsonb_build_object('phase','deliver','category','storage','rpc_code',failure_code));
   update shared_private.ai_jobs set next_check_at=clock_timestamp()+interval '1 minute' where id=item.id;
  end;
 end loop;
 update shared_private.ai_jobs set response=null where finished_at<clock_timestamp()-interval '1 day' and response is not null;
 delete from shared_private.ai_jobs where finished_at<clock_timestamp()-interval '7 days';
 delete from shared_private.ai_events where created_at<clock_timestamp()-interval '7 days';
 select worker_url into endpoint from shared_private.ai_runtime where singleton;
 if endpoint is null or to_regnamespace('net') is null then return 0; end if;
 for item in
  select 'event' as kind,id,capability from shared_private.ai_events where finished_at is null and next_check_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp()) and created_at>clock_timestamp()-interval '1 day'
  union all
  select 'job',id,capability from shared_private.ai_jobs where (status in ('submitting','pending') or cancel_pending) and next_check_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp()) limit 40
 loop
  perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||item.capability::text),body:=jsonb_build_object('kind',item.kind,'id',item.id),timeout_milliseconds:=35000);
  if item.kind='job' then update shared_private.ai_jobs set next_check_at=clock_timestamp()+interval '1 minute' where id=item.id;
  else update shared_private.ai_events set next_check_at=clock_timestamp()+interval '1 minute' where id=item.id; end if;
  dispatched:=dispatched+1;
 end loop;
 return dispatched;
end $$;
revoke all on function shared_private.ai_dispatch() from public,anon,authenticated;
grant execute on function shared_private.ai_dispatch() to service_role;
notify pgrst,'reload schema';
commit;
