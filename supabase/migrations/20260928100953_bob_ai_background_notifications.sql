-- Bob is the first optional receiver. Existing in-flight jobs keep their original transport.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table bob_private.bob_jobs add column async_models boolean not null default false,
 add column waiting_ai_job uuid;
alter table bob.bob_threads add column last_read_seq bigint not null default 0 check(last_read_seq>=0);
-- Existing history predates notifications; only new outcomes should ping on rollout.
update bob.bob_threads t set last_read_seq=coalesce((select max(seq) from bob.bob_messages m where m.thread_id=t.id and ((m.role='assistant' and m.delivery_state='completed') or (m.role='user' and m.delivery_state='failed'))),0);
create table bob.bob_delegation_notices (
 thread_id uuid not null references bob.bob_threads(id) on delete cascade, turn_id uuid not null,
 text text not null, created_at timestamptz not null default clock_timestamp(), primary key(thread_id,turn_id)
);
alter table bob.bob_delegation_notices enable row level security;
revoke all on bob.bob_delegation_notices from public,anon,authenticated;
grant select on bob.bob_delegation_notices to authenticated;
create policy own_notices on bob.bob_delegation_notices for select to authenticated using(exists(
 select 1 from bob.bob_threads t where t.id=thread_id and t.owner_user_id=(select auth.uid()) and bob_private.has_project_access(t.project_id)
));
create function bob_private.pin_ai_transport() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.async_models:=exists(select 1 from shared_private.ai_receivers where app='bob' and name='bob' and enabled);
 return new;
end $$;
create trigger pin_ai_transport before insert on bob_private.bob_jobs for each row execute function bob_private.pin_ai_transport();
create or replace function bob_private.bob_claim_job(p_job uuid,p_capability uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; token uuid:=gen_random_uuid(); g bigint; steps jsonb; message text; saved integer;
begin
  select * into j from bob_private.bob_jobs where id=p_job and capability=p_capability;
  if not found then raise exception 'job_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.project_id || ':' || j.actor_id::text,0));
  select * into j from bob_private.bob_jobs where id=p_job for update;
  if j.waiting_ai_job is not null or j.status not in ('queued','running') or (j.status='running' and j.lease_until>clock_timestamp()) then
    return jsonb_build_object('status','inactive'); end if;
  select count(*) into saved from bob_private.bob_job_steps where job_id=j.id;
  if j.expires_at<=clock_timestamp() or j.total_claims>=60 then
    return bob_private.bob_finish_job(j.id,j.claim_token,'background_expired'); end if;
  -- attempts = consecutive claims whose segment saved no checkpoint.
  if j.attempts>=5 and saved<=j.last_claim_steps then
    return bob_private.bob_finish_job(j.id,j.claim_token,'background_stalled'); end if;
  if exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=j.turn_id and role='assistant' and delivery_state='completed') then
    return bob_private.bob_finish_job(j.id,j.claim_token,null); end if;
  update bob_private.bob_thread_provider_state set generation=generation+1,lock_started_at=clock_timestamp(),updated_at=clock_timestamp()
    where thread_id=j.thread_id and in_flight_turn_id=j.turn_id returning generation into g;
  if not found then return bob_private.bob_finish_job(j.id,j.claim_token,'turn_not_claimed'); end if;
  update bob_private.bob_jobs set status='running',claim_token=token,lease_until=clock_timestamp()+interval '150 seconds',
    generation=g,attempts=case when saved>j.last_claim_steps then 1 else attempts+1 end,last_claim_steps=saved,
    total_claims=total_claims+1,updated_at=clock_timestamp() where id=j.id returning * into j;
  select text into message from bob.bob_messages where thread_id=j.thread_id and turn_id=j.turn_id and role='user';
  select coalesce(jsonb_agg(jsonb_build_object('key',key,'fingerprint',fingerprint,'value',value) order by key),'[]'::jsonb)
    into steps from bob_private.bob_job_steps where job_id=j.id;
  return jsonb_build_object('status','claimed','id',j.id,'claimToken',token,'projectId',j.project_id,'userId',j.actor_id,
    'threadId',j.thread_id,'clientTurnId',j.turn_id,'generation',g,'credential',j.credential,'message',message,
    'expiresAt',j.expires_at,'entries',steps,'asyncModels',j.async_models);
end $$;

create or replace function bob_private.bob_dispatch_jobs()
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; j bob_private.bob_jobs; dispatched integer:=0;
begin
  for candidate in select id,project_id,actor_id from bob_private.bob_jobs
    where status in ('queued','running') order by created_at limit 20 loop
    -- Same actor lock as claim/reset/write; never hold a job lock first.
    if not pg_try_advisory_xact_lock(hashtextextended(candidate.project_id || ':' || candidate.actor_id::text,0)) then continue; end if;
    select * into j from bob_private.bob_jobs where id=candidate.id for update;
    if not found or j.status not in ('queued','running') then continue; end if;
    if j.expires_at<=clock_timestamp() or (j.total_claims>=60 and (j.lease_until is null or j.lease_until<=clock_timestamp())) then
      perform bob_private.bob_finish_job(j.id,j.claim_token,'background_expired'); continue;
    end if;
    -- Keep old clients and reset fencing aligned with the actual live job.
    update bob_private.bob_thread_provider_state set lock_started_at=clock_timestamp()
      where thread_id=j.thread_id and in_flight_turn_id=j.turn_id;
    if j.waiting_ai_job is null and (j.status='queued' or j.lease_until<=clock_timestamp()) and
      (j.dispatched_at is null or j.dispatched_at<clock_timestamp()-interval '30 seconds') then
      perform net.http_post(url:=j.worker_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || j.capability::text),
        body:=jsonb_build_object('jobId',j.id),timeout_milliseconds:=5000);
      update bob_private.bob_jobs set dispatched_at=clock_timestamp() where id=j.id;
      dispatched:=dispatched+1;
    end if;
  end loop;
  -- Terminal credential and step cleanup happens immediately in finish_job.
  delete from bob_private.bob_jobs where status in ('completed','failed') and updated_at<clock_timestamp()-interval '7 days';
  return dispatched;
end $$;


create function bob_private.bob_ai_ready(p_ai_job uuid,p_context jsonb,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs;
begin
 select * into j from bob_private.bob_jobs where id=(p_context->>'jobId')::uuid;
 if not found then return; end if;
 perform pg_advisory_xact_lock(hashtextextended(j.project_id || ':' || j.actor_id::text,0));
 update bob_private.bob_jobs set waiting_ai_job=null,status='queued',lease_until=null,claim_token=null,dispatched_at=null,attempts=0,updated_at=clock_timestamp()
 where id=j.id and status in ('queued','running') and waiting_ai_job=p_ai_job;
 perform bob_private.bob_dispatch_jobs();
end $$;
insert into shared_private.ai_receivers(app,name,handler_schema,handler_name) values('bob','bob','bob_private','bob_ai_ready');

create function bob.bob_wait_for_ai(p_job uuid,p_claim uuid,p_ai_job uuid) returns void
language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; a shared_private.ai_jobs;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found then raise exception 'job_denied'; end if;
 perform pg_advisory_xact_lock(hashtextextended(j.project_id || ':' || j.actor_id::text,0));
 select * into j from bob_private.bob_jobs where id=p_job for update;
 if j.status<>'running' or j.claim_token is distinct from p_claim or not j.async_models then raise exception 'job_not_claimed'; end if;
 -- Read shared state without a row lock. Publication holds that row while waking
 -- Bob; the per-actor lock serializes wake/wait so neither ordering loses a wake.
 select * into a from shared_private.ai_jobs where id=p_ai_job;
 if not found or a.app<>'bob' or a.receiver<>'bob' or a.context->>'jobId' is distinct from p_job::text then raise exception 'ai_job_denied'; end if;
 update bob_private.bob_jobs set status='queued',waiting_ai_job=case when a.status in ('submitting','pending') then a.id else null end,
 lease_until=null,claim_token=null,dispatched_at=null,attempts=0,updated_at=clock_timestamp() where id=p_job;
 if a.response_id is not null and a.context->>'role'='cad-designer' then
   insert into bob.bob_delegation_notices(thread_id,turn_id,text) values(j.thread_id,j.turn_id,
    'Jag har skickat ritningen till designern. Jag återkommer här när resultatet är granskat.') on conflict do nothing;
 end if;
end $$;

create function bob.bob_chat_inbox(p_project text) returns jsonb language plpgsql security definer set search_path='' as $$
declare t bob.bob_threads; latest bigint;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select * into t from bob.bob_threads where project_id=p_project and owner_user_id=auth.uid() and status='active';
 if not found then return null; end if;
 select coalesce(max(seq),0) into latest from bob.bob_messages where thread_id=t.id and ((role='assistant' and delivery_state='completed') or (role='user' and delivery_state='failed'));
 return jsonb_build_object('threadId',t.id,'latestSeq',latest,'readSeq',t.last_read_seq,'unread',latest>t.last_read_seq);
end $$;
create function bob.bob_mark_chat_read(p_project text,p_thread uuid,p_seq bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 update bob.bob_threads t set last_read_seq=greatest(last_read_seq,p_seq)
 where id=p_thread and project_id=p_project and owner_user_id=auth.uid() and status='active' and p_seq>=0
 and p_seq<=coalesce((select max(seq) from bob.bob_messages where thread_id=t.id and ((role='assistant' and delivery_state='completed') or (role='user' and delivery_state='failed'))),0);
 if not found then raise exception 'invalid_read_receipt'; end if;
end $$;
revoke all on function bob_private.pin_ai_transport(),bob_private.bob_ai_ready(uuid,jsonb,text),bob.bob_wait_for_ai(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function bob.bob_wait_for_ai(uuid,uuid,uuid) to service_role;
revoke all on function bob.bob_chat_inbox(text),bob.bob_mark_chat_read(text,uuid,bigint) from public,anon;
grant execute on function bob.bob_chat_inbox(text),bob.bob_mark_chat_read(text,uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
