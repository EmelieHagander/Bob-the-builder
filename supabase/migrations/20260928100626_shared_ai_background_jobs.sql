-- Optional cross-app Responses jobs. No browser access, arbitrary callback URLs or prompts in the queue.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create schema if not exists shared_private;
revoke all on schema shared_private from public,anon,authenticated;
grant usage on schema shared_private,shared to service_role;
create table shared_private.ai_receivers (
 app text not null, name text not null, handler_schema text not null, handler_name text not null,
 enabled boolean not null default false, primary key(app,name),
 check(app ~ '^[a-z][a-z0-9_]{0,39}$'), check(name ~ '^[a-z][a-z0-9_]{0,63}$')
);
create table shared_private.ai_runtime (
 singleton boolean primary key default true check(singleton), worker_url text,
 check(worker_url is null or worker_url ~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/ai-background-worker$')
);
insert into shared_private.ai_runtime(singleton) values(true);
create table shared_private.ai_jobs (
 id uuid primary key default gen_random_uuid(), app text not null, operation_key text not null,
 fingerprint text not null, receiver text not null, context jsonb not null, accounting jsonb not null,
 status text not null default 'submitting' check(status in ('submitting','pending','completed','failed','expired','cancelled')),
 response_id text unique, response jsonb, cancel_pending boolean not null default false, capability uuid not null default gen_random_uuid(),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 next_check_at timestamptz not null default clock_timestamp()+interval '30 seconds', lease_until timestamptz,
 finished_at timestamptz, notified_at timestamptz,
 unique(app,operation_key), foreign key(app,receiver) references shared_private.ai_receivers(app,name),
 check(length(operation_key) between 1 and 240), check(fingerprint ~ '^[a-f0-9]{64}$'),
 check(jsonb_typeof(context)='object' and octet_length(context::text)<=4000),
 check(jsonb_typeof(accounting)='object' and octet_length(accounting::text)<=4000)
);
create index ai_jobs_due on shared_private.ai_jobs(next_check_at) where status in ('submitting','pending');
create table shared_private.ai_events (
 id uuid primary key default gen_random_uuid(), event_id text not null unique, response_id text not null,
 capability uuid not null default gen_random_uuid(), created_at timestamptz not null default clock_timestamp(),
 next_check_at timestamptz not null default clock_timestamp(), lease_until timestamptz, finished_at timestamptz,
 check(length(event_id) between 1 and 200), check(response_id ~ '^resp_[a-zA-Z0-9_-]{1,200}$')
);
alter table shared_private.ai_receivers enable row level security;
alter table shared_private.ai_runtime enable row level security;
alter table shared_private.ai_jobs enable row level security;
alter table shared_private.ai_events enable row level security;
revoke all on shared_private.ai_receivers,shared_private.ai_runtime,shared_private.ai_jobs,shared_private.ai_events from public,anon,authenticated;
-- Administration deliberately owns recipient registration. The service cannot retarget receivers.
grant select,insert,update,delete on shared_private.ai_jobs,shared_private.ai_events to service_role;
grant select on shared_private.ai_receivers,shared_private.ai_runtime to service_role;
alter table shared.ai_usage_events add column background_job_id uuid;
create unique index ai_usage_background_once on shared.ai_usage_events(background_job_id);

create function shared_private.ai_wake(p_job uuid) returns void language plpgsql security definer set search_path='' as $$
declare j shared_private.ai_jobs; r shared_private.ai_receivers;
begin
 select * into j from shared_private.ai_jobs where id=p_job for update;
 if not found then return; end if;
 if j.notified_at is not null or j.status not in ('completed','failed','expired','cancelled') then return; end if;
 select * into r from shared_private.ai_receivers where app=j.app and name=j.receiver;
 if not found then return; end if;
 execute format('select %I.%I($1,$2,$3)',r.handler_schema,r.handler_name) using j.id,j.context,j.status;
 update shared_private.ai_jobs set notified_at=clock_timestamp() where id=j.id;
end $$;

create function shared.ai_job_reserve(p_app text,p_key text,p_fingerprint text,p_receiver text,p_context jsonb,p_expires timestamptz,p_accounting jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j shared_private.ai_jobs; fresh boolean;
begin
 select * into j from shared_private.ai_jobs where app=p_app and operation_key=p_key;
 fresh:=false;
 if not found then
  if not exists(select 1 from shared_private.ai_receivers where app=p_app and name=p_receiver and enabled)
    or not exists(select 1 from shared_private.ai_runtime where worker_url is not null) then raise exception 'ai_background_not_configured'; end if;
  if p_expires<=clock_timestamp() or p_expires>clock_timestamp()+interval '24 hours' then raise exception 'invalid_job_deadline'; end if;
  insert into shared_private.ai_jobs(app,operation_key,fingerprint,receiver,context,expires_at,accounting)
  values(p_app,p_key,p_fingerprint,p_receiver,p_context,p_expires,p_accounting) on conflict(app,operation_key) do nothing returning * into j;
  fresh:=found;
  if not fresh then select * into j from shared_private.ai_jobs where app=p_app and operation_key=p_key; end if;
 end if;
 if j.fingerprint is distinct from p_fingerprint or j.receiver is distinct from p_receiver or j.context is distinct from p_context
   or j.expires_at is distinct from p_expires then raise exception 'ai_operation_changed'; end if;
 return jsonb_build_object('id',j.id,'status',j.status,'submit',fresh,'response_id',j.response_id,'response',j.response,'accounting',j.accounting);
end $$;

create function shared.ai_job_accept(p_job uuid,p_response jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare j shared_private.ai_jobs; rid text:=p_response->>'id'; state text:=p_response->>'status'; a jsonb; u jsonb;
 input_n integer; output_n integer; cached_n integer; cost numeric;
begin
 if p_job is null then return false; end if;
 select * into j from shared_private.ai_jobs where id=p_job for update;
 if not found then return false; end if;
 if p_response#>>'{metadata,ai_job_id}' is distinct from p_job::text
   or coalesce(rid,'')!~'^resp_[a-zA-Z0-9_-]{1,200}$'
   or state is null or state not in ('queued','in_progress','completed','failed','cancelled','incomplete')
   or (j.response_id is not null and j.response_id<>rid) then raise exception 'ai_response_mismatch'; end if;
 if j.response_id is null then update shared_private.ai_jobs set response_id=rid,cancel_pending=status in ('cancelled','expired') where id=j.id; end if;
 if j.finished_at is not null and (j.status not in ('expired','cancelled') or exists(select 1 from shared.ai_usage_events where background_job_id=j.id)) then return true; end if;
 if state in ('queued','in_progress') then
   update shared_private.ai_jobs set status=case when status='submitting' then 'pending' else status end,
    next_check_at=clock_timestamp()+interval '30 seconds' where id=j.id;
   return true;
 end if;
 a:=j.accounting;u:=coalesce(p_response->'usage','{}');
 input_n:=greatest(0,coalesce((u->>'input_tokens')::integer,0));output_n:=greatest(0,coalesce((u->>'output_tokens')::integer,0));
 cached_n:=least(input_n,greatest(0,coalesce((u#>>'{input_tokens_details,cached_tokens}')::integer,0)));
 cost:=round(((input_n-cached_n)*(a->>'input_price_per_1m')::numeric+cached_n*(a->>'cached_price_per_1m')::numeric+output_n*(a->>'output_price_per_1m')::numeric)/1000000,6);
 insert into shared.ai_usage_events(app,user_id,module,ai_function,model,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,input_price_per_1m,output_price_per_1m,cost_usd,success,background_job_id)
 values(j.app,(a->>'user_id')::uuid,a->>'module',a->>'ai_function',a->>'model',input_n,cached_n,output_n,
 greatest(0,coalesce((u#>>'{output_tokens_details,reasoning_tokens}')::integer,0)),input_n+output_n,
 (a->>'input_price_per_1m')::numeric,(a->>'output_price_per_1m')::numeric,cost,state='completed',j.id)
 on conflict(background_job_id) do nothing;
 -- Late output is accounted for, but cannot revive a cancelled/expired app operation.
 if j.status in ('expired','cancelled') or j.expires_at<=clock_timestamp() then
   update shared_private.ai_jobs set status=case when status='cancelled' then status else 'expired' end,response=null,cancel_pending=false,finished_at=clock_timestamp() where id=j.id;
 else
   update shared_private.ai_jobs set status=case when state='completed' then 'completed' else 'failed' end,response=p_response,finished_at=clock_timestamp() where id=j.id;
 end if;
 update shared_private.ai_jobs set next_check_at=clock_timestamp() where id=j.id;
 return true;
end $$;

create function shared.ai_job_reject(p_job uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update shared_private.ai_jobs set status='failed',finished_at=clock_timestamp() where id=p_job and status='submitting' and response_id is null;
 update shared_private.ai_jobs set next_check_at=clock_timestamp() where id=p_job;
end $$;
revoke all on function shared.ai_job_reject(uuid) from public,anon,authenticated;
grant execute on function shared.ai_job_reject(uuid) to service_role;

create function shared.ai_job_cancel(p_app text,p_key text) returns void language plpgsql security definer set search_path='' as $$
begin
 update shared_private.ai_jobs set status='cancelled',finished_at=clock_timestamp(),cancel_pending=response_id is not null,next_check_at=clock_timestamp()
 where app=p_app and operation_key=p_key and status in ('submitting','pending');
end $$;
revoke all on function shared.ai_job_cancel(text,text) from public,anon,authenticated;
grant execute on function shared.ai_job_cancel(text,text) to service_role;

-- Durable completion outbox: a broken app callback cannot roll back the provider
-- result or its accounting. The scheduler retries delivery independently.
create function shared.ai_job_deliver(p_job uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform shared_private.ai_wake(p_job); end $$;
revoke all on function shared.ai_job_deliver(uuid) from public,anon,authenticated;
grant execute on function shared.ai_job_deliver(uuid) to service_role;

create function shared.ai_work_claim(p_kind text,p_id uuid,p_capability uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j shared_private.ai_jobs; e shared_private.ai_events;
begin
 if p_kind='job' then
   select * into j from shared_private.ai_jobs where id=p_id and capability=p_capability for update;
   if not found then raise exception 'ai_work_denied' using errcode='42501'; end if;
   if (j.status not in ('submitting','pending') and not j.cancel_pending) or j.lease_until>clock_timestamp() then return null; end if;
   if j.expires_at<=clock_timestamp() or j.cancel_pending then
     update shared_private.ai_jobs set status=case when status='cancelled' then status else 'expired' end,
       finished_at=coalesce(finished_at,clock_timestamp()),cancel_pending=response_id is not null and expires_at>clock_timestamp()-interval '1 hour',
       lease_until=clock_timestamp()+interval '40 seconds',next_check_at=clock_timestamp()+interval '1 minute' where id=j.id;
     return jsonb_build_object('response_id',case when j.expires_at>clock_timestamp()-interval '1 hour' then j.response_id else null end,'cancel',true);
   end if;
   update shared_private.ai_jobs set lease_until=clock_timestamp()+interval '40 seconds',next_check_at=clock_timestamp()+interval '1 minute' where id=j.id;
   return jsonb_build_object('response_id',j.response_id);
 elsif p_kind='event' then
   select * into e from shared_private.ai_events where id=p_id and capability=p_capability for update;
   if not found then raise exception 'ai_work_denied' using errcode='42501'; end if;
   if e.finished_at is not null or e.lease_until>clock_timestamp() then return null; end if;
   update shared_private.ai_events set lease_until=clock_timestamp()+interval '40 seconds',next_check_at=clock_timestamp()+interval '1 minute' where id=e.id;
   return jsonb_build_object('response_id',e.response_id);
 end if;
 raise exception 'invalid_work_kind';
end $$;
create function shared.ai_work_finish(p_kind text,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_kind='event' then update shared_private.ai_events set finished_at=clock_timestamp(),lease_until=null where id=p_id;
 elsif p_kind='job' then update shared_private.ai_jobs set lease_until=null,next_check_at=clock_timestamp()+interval '1 minute' where id=p_id; end if;
end $$;

create function shared_private.ai_dispatch() returns integer language plpgsql security definer set search_path='' as $$
declare endpoint text; item record; dispatched integer:=0;
begin
 for item in select id from shared_private.ai_jobs where status in ('completed','failed','expired','cancelled') and notified_at is null and next_check_at<=clock_timestamp() limit 40 loop
  begin
   update shared_private.ai_jobs set next_check_at=clock_timestamp()+interval '1 minute' where id=item.id;
   perform shared_private.ai_wake(item.id);
  exception when others then
   update shared_private.ai_jobs set next_check_at=clock_timestamp()+interval '1 minute' where id=item.id;
  end;
 end loop;
 -- Retention also runs while dispatch is disabled. Preserve opaque routing and
 -- price metadata until tombstone expiry so a delayed callback can still settle.
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
create function shared.ai_event_receive(p_event text,p_response text) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into shared_private.ai_events(event_id,response_id) values(p_event,p_response) on conflict(event_id) do nothing;
 perform shared_private.ai_dispatch();
end $$;
-- Explicit service-only API; no browser/model can select another app or receiver.
revoke all on function shared.ai_job_reserve(text,text,text,text,jsonb,timestamptz,jsonb),shared.ai_job_accept(uuid,jsonb),shared.ai_work_claim(text,uuid,uuid),shared.ai_work_finish(text,uuid),shared.ai_event_receive(text,text) from public,anon,authenticated;
grant execute on function shared.ai_job_reserve(text,text,text,text,jsonb,timestamptz,jsonb),shared.ai_job_accept(uuid,jsonb),shared.ai_work_claim(text,uuid,uuid),shared.ai_work_finish(text,uuid),shared.ai_event_receive(text,text) to service_role;
revoke all on function shared_private.ai_wake(uuid),shared_private.ai_dispatch() from public,anon,authenticated;
grant execute on function shared_private.ai_dispatch() to service_role;
do $$ begin
 if to_regnamespace('cron') is not null then perform cron.schedule('shared-ai-background','* * * * *','select shared_private.ai_dispatch()'); end if;
end $$;
notify pgrst,'reload schema';
commit;
