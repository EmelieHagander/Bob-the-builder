-- An immutable catalog pin chooses the durable execution policy. Existing jobs
-- retain their recorded policy; JWT expiry pauses new work, never grants authority.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table bob_private.bob_jobs
 add column work_allowance_version smallint not null default 0 check(work_allowance_version in (0,1)),
 add column ai_catalog_manifest_id uuid references shared.ai_catalog_manifests(id),
 add constraint bob_jobs_work_pin check(work_allowance_version=0 or ai_catalog_manifest_id is not null);
alter table bob_private.bob_jobs drop constraint bob_jobs_status_check;
alter table bob_private.bob_jobs add constraint bob_jobs_status_check check(status in ('queued','running','paused','cancelled','completed','failed'));

create function bob_private.bob_job_unlimited_work(p_job uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select work_allowance_version=1 from bob_private.bob_jobs where id=p_job),false)
$$;
revoke all on function bob_private.bob_job_unlimited_work(uuid) from public,anon,authenticated,service_role;

-- Preserve a paused turn beyond the legacy five-minute dead-isolate reset.
alter function bob.bob_claim_turn(text,uuid,uuid,text) rename to bob_claim_turn_before_work_allowance;
revoke all on function bob.bob_claim_turn_before_work_allowance(text,uuid,uuid,text) from public,anon,authenticated,service_role;
create function bob.bob_claim_turn(p_project text,p_user uuid,p_turn uuid,p_message text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare held bob_private.bob_jobs;
begin
 perform bob_private.bob_assert_server_actor(p_project,p_user);
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||p_user::text,0));
 select j.* into held from bob_private.bob_jobs j
 join bob_private.bob_thread_provider_state s on s.thread_id=j.thread_id and s.in_flight_turn_id=j.turn_id
 where j.project_id=p_project and j.actor_id=p_user and j.work_allowance_version=1 and j.status in ('queued','running','paused')
 order by j.created_at desc limit 1;
 if found then
  return jsonb_build_object('mode','server','status',case when held.turn_id=p_turn then 'in_flight' else 'thread_busy' end,'thread_id',held.thread_id);
 end if;
 return bob.bob_claim_turn_before_work_allowance(p_project,p_user,p_turn,p_message);
end $$;
revoke all on function bob.bob_claim_turn(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function bob.bob_claim_turn(text,uuid,uuid,text) to service_role;

create function bob_private.bob_pause_job(p_job uuid,p_claim uuid,p_expires timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; g bigint;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found then raise exception 'job_not_claimed' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(j.project_id||':'||j.actor_id::text,0));
 select * into j from bob_private.bob_jobs where id=p_job for update;
 if j.work_allowance_version<>1 or j.status not in ('queued','running') or j.claim_token is distinct from p_claim then
  raise exception 'job_not_claimed' using errcode='40001'; end if;
 -- A polling client may already have supplied a newer ordinary JWT. Release
 -- this worker so its successor uses that credential instead of pausing it.
 if p_expires is not null and j.expires_at>p_expires and j.expires_at>clock_timestamp()+interval '30 seconds' then
  update bob_private.bob_jobs set status='queued',claim_token=null,lease_until=null,dispatched_at=null,updated_at=clock_timestamp() where id=p_job;
  return jsonb_build_object('status','queued');
 end if;
 update bob_private.bob_thread_provider_state set generation=generation+1,lock_started_at=clock_timestamp(),updated_at=clock_timestamp()
 where thread_id=j.thread_id and in_flight_turn_id=j.turn_id returning generation into g;
 update bob_private.bob_jobs set status='paused',error_code='authentication_expired',credential=null,claim_token=null,lease_until=null,
  generation=coalesce(g,generation),dispatched_at=null,updated_at=clock_timestamp() where id=p_job;
 return jsonb_build_object('status','paused');
end $$;
revoke all on function bob_private.bob_pause_job(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function bob_private.bob_pause_job(uuid,uuid,timestamptz) to service_role;
create function bob.bob_pause_job(p_job uuid,p_claim uuid,p_expires timestamptz default null)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_pause_job(p_job,p_claim,p_expires) $$;
revoke all on function bob.bob_pause_job(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function bob.bob_pause_job(uuid,uuid,timestamptz) to service_role;

create function bob.bob_jobs_to_renew(p_project text,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform bob_private.bob_assert_server_actor(p_project,p_user);
 return coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'turn_id',j.turn_id)) from bob_private.bob_jobs j
  join bob_private.bob_thread_provider_state s on s.thread_id=j.thread_id and s.in_flight_turn_id=j.turn_id
  where j.project_id=p_project and j.actor_id=p_user and j.work_allowance_version=1 and j.status in ('queued','running','paused')),'[]'::jsonb);
end $$;
revoke all on function bob.bob_jobs_to_renew(text,uuid) from public,anon,authenticated;
grant execute on function bob.bob_jobs_to_renew(text,uuid) to service_role;

create function bob.bob_renew_job(p_project text,p_user uuid,p_job uuid,p_credential jsonb,p_expires timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs;
begin
 perform bob_private.bob_assert_server_actor(p_project,p_user);
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||p_user::text,0));
 select * into j from bob_private.bob_jobs where id=p_job and project_id=p_project and actor_id=p_user for update;
 if not found or j.work_allowance_version<>1 or j.status not in ('queued','running','paused') then return false; end if;
 if not exists(select 1 from bob_private.bob_thread_provider_state where thread_id=j.thread_id and in_flight_turn_id=j.turn_id and generation=j.generation) then return false; end if;
 if p_expires is null or p_expires<=clock_timestamp()+interval '30 seconds' or jsonb_typeof(p_credential) is distinct from 'object' then raise exception 'invalid_authority'; end if;
 -- Re-presenting the same nearly expired JWT must not create a claim loop.
 if p_expires<=j.expires_at then return false; end if;
 update bob_private.bob_jobs set credential=p_credential,expires_at=p_expires,
  status=case when status='paused' then 'queued' else status end,error_code=null,
  dispatched_at=case when status='paused' then null else dispatched_at end,
  waiting_ai_job=case when waiting_ai_job is not null and not exists(select 1 from shared_private.ai_jobs a where a.id=waiting_ai_job and a.status in ('pending','submitting')) then null else waiting_ai_job end,
  updated_at=clock_timestamp() where id=p_job;
 update bob_private.bob_thread_provider_state set lock_started_at=clock_timestamp() where thread_id=j.thread_id and in_flight_turn_id=j.turn_id;
 return true;
end $$;
revoke all on function bob.bob_renew_job(text,uuid,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function bob.bob_renew_job(text,uuid,uuid,jsonb,timestamptz) to service_role;

-- All enqueue API versions converge here, before their screen/image adapters.
alter function bob_private.bob_enqueue_job_before_screen(text,uuid,uuid,text,jsonb,timestamptz,text) rename to bob_enqueue_job_before_work_allowance;
create function bob_private.bob_enqueue_job_before_screen(p_project text,p_user uuid,p_turn uuid,p_message text,p_credential jsonb,p_expires timestamptz,p_worker_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; result jsonb; catalog jsonb; unlimited boolean:=false;
begin
 perform bob_private.bob_assert_server_actor(p_project,p_user);
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||p_user::text,0));
 select * into j from bob_private.bob_jobs where project_id=p_project and actor_id=p_user and turn_id=p_turn and drawing_request_id is null for update;
 if found and (j.status='cancelled' or j.work_allowance_version=1 and j.status in ('queued','running','paused')) then
  if not exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=p_turn and role='user' and text=p_message) then raise exception 'turn_reused' using errcode='22023'; end if;
  if j.status='cancelled' then return jsonb_build_object('status','cancelled','jobId',j.id); end if;
  perform bob.bob_renew_job(p_project,p_user,j.id,p_credential,p_expires);
  return jsonb_build_object('status','accepted','jobId',j.id,'expiresAt',(select expires_at from bob_private.bob_jobs where id=j.id));
 end if;
 -- Existing legacy jobs must never be repinned after publication. Failed jobs
 -- can be explicitly retried as new jobs under the now-active contract.
 if j.id is null or j.status='failed' then
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
  unlimited:=exists(select 1 from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key='agent-contract.ask-bob' and v.metadata->'work_allowance_version'='1'::jsonb);
  if unlimited then catalog:=shared.resolve_ai_catalog('bob'); end if;
 end if;
 result:=bob_private.bob_enqueue_job_before_work_allowance(p_project,p_user,p_turn,p_message,p_credential,p_expires,p_worker_url);
 if unlimited and result->>'status'='accepted' then
  update bob_private.bob_jobs set work_allowance_version=1,ai_catalog_manifest_id=(catalog->>'manifest_id')::uuid,expires_at=p_expires
  where id=(result->>'jobId')::uuid;
  result:=result||jsonb_build_object('expiresAt',p_expires);
 end if;
 return result;
end $$;
revoke all on function bob_private.bob_enqueue_job_before_screen(text,uuid,uuid,text,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function bob_private.bob_enqueue_job_before_screen(text,uuid,uuid,text,jsonb,timestamptz,text) to service_role;

-- A follow-up drawing segment inherits the origin turn's immutable policy.
create function bob_private.bob_inherit_work_allowance() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.drawing_request_id is not null then
  select j.work_allowance_version,j.ai_catalog_manifest_id into new.work_allowance_version,new.ai_catalog_manifest_id
  from bob_private.bob_jobs j where j.project_id=new.project_id and j.actor_id=new.actor_id and j.thread_id=new.thread_id
   and j.turn_id=new.turn_id and j.drawing_request_id is null and j.work_allowance_version=1 order by j.created_at desc limit 1;
  new.work_allowance_version:=coalesce(new.work_allowance_version,0);
 end if;
 return new;
end $$;
revoke all on function bob_private.bob_inherit_work_allowance() from public,anon,authenticated,service_role;
create trigger bob_job_inherit_work_allowance before insert on bob_private.bob_jobs for each row execute function bob_private.bob_inherit_work_allowance();
create or replace function bob_private.bob_claim_job_before_screen(p_job uuid,p_capability uuid)
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
  if j.work_allowance_version=1 and j.expires_at<=clock_timestamp() then
    return bob_private.bob_pause_job(j.id,j.claim_token); end if;
  if j.work_allowance_version=0 and (j.expires_at<=clock_timestamp() or j.total_claims>=60) then
    return bob_private.bob_finish_job(j.id,j.claim_token,'background_expired'); end if;
  -- attempts = consecutive claims whose segment saved no checkpoint.
  if j.attempts>=5 and saved<=j.last_claim_steps then
    return bob_private.bob_finish_job(j.id,j.claim_token,'background_stalled'); end if;
  if j.drawing_request_id is null and exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=j.turn_id and role='assistant' and delivery_state='completed') then
    return bob_private.bob_finish_job(j.id,j.claim_token,null); end if;
  update bob_private.bob_thread_provider_state set generation=generation+1,lock_started_at=clock_timestamp(),updated_at=clock_timestamp()
    where thread_id=j.thread_id and in_flight_turn_id=j.turn_id returning generation into g;
  if not found then return bob_private.bob_finish_job(j.id,j.claim_token,'turn_not_claimed'); end if;
  update bob_private.bob_jobs set status='running',claim_token=token,lease_until=clock_timestamp()+interval '150 seconds',
    generation=g,attempts=case when saved>j.last_claim_steps then 1 else attempts+1 end,last_claim_steps=saved,
    total_claims=total_claims+1,updated_at=clock_timestamp() where id=j.id returning * into j;
  select text into message from bob.bob_messages where thread_id=j.thread_id and turn_id=j.turn_id and role='user';
  steps:='[]'::jsonb;
  if j.work_allowance_version=0 then
  select coalesce(jsonb_agg(jsonb_build_object('key',key,'fingerprint',fingerprint,'value',value) order by key),'[]'::jsonb)
    into steps from bob_private.bob_job_steps where job_id=j.id;
  end if;
  return jsonb_build_object('status','claimed','id',j.id,'claimToken',token,'projectId',j.project_id,'userId',j.actor_id,
    'threadId',j.thread_id,'clientTurnId',j.turn_id,'generation',g,'credential',j.credential,'message',message,
    'expiresAt',j.expires_at,'entries',steps,'asyncModels',j.async_models,'drawingRequestId',j.drawing_request_id)
    || case when j.work_allowance_version=1 then jsonb_build_object('workAllowanceVersion',1,'catalogManifestId',j.ai_catalog_manifest_id,'pagedJournal',true) else '{}'::jsonb end;
end $$;

create or replace function bob_private.bob_dispatch_jobs()
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; j bob_private.bob_jobs; dispatched integer:=0;
begin
  perform bob_private.reconcile_drawing_costs();
  perform bob_private.queue_drawing_events();
  for candidate in select id,project_id,actor_id from bob_private.bob_jobs
    where status in ('queued','running') order by created_at limit 20 loop
    -- Same actor lock as claim/reset/write; never hold a job lock first.
    if not pg_try_advisory_xact_lock(hashtextextended(candidate.project_id || ':' || candidate.actor_id::text,0)) then continue; end if;
    select * into j from bob_private.bob_jobs where id=candidate.id for update;
    if not found or j.status not in ('queued','running') then continue; end if;
    if j.work_allowance_version=1 and j.expires_at<=clock_timestamp() then
      perform bob_private.bob_pause_job(j.id,j.claim_token); continue;
    end if;
    if j.work_allowance_version=0 and (j.expires_at<=clock_timestamp() or (j.total_claims>=60 and (j.lease_until is null or j.lease_until<=clock_timestamp()))) then
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
  delete from bob_private.bob_jobs terminal where terminal.status in ('completed','failed','cancelled') and terminal.updated_at<clock_timestamp()-interval '7 days'
    and not (terminal.work_allowance_version=1 and terminal.drawing_request_id is null and exists(select 1 from bob_private.project_drawing_requests r
      where r.project_id=terminal.project_id and r.owner_user_id=terminal.actor_id and r.thread_id=terminal.thread_id and r.origin_turn_id=terminal.turn_id and r.status not in ('saved','cancelled')));
  return dispatched;
end $$;

create or replace function bob_private.bob_save_job_step(p_job uuid,p_claim uuid,p_key text,p_fingerprint text,p_value jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; old bob_private.bob_job_steps; bytes integer;
begin
  select * into j from bob_private.bob_jobs where id=p_job for update;
  if not found or j.status<>'running' or j.claim_token is distinct from p_claim or j.lease_until<=clock_timestamp() then
    raise exception 'job_not_claimed' using errcode='40001'; end if;
  select * into old from bob_private.bob_job_steps where job_id=p_job and key=p_key;
  if found then
    if old.fingerprint is distinct from p_fingerprint or old.value is distinct from p_value then raise exception 'checkpoint_conflict'; end if;
    return true;
  end if;
  bytes:=octet_length(p_value::text);
  if p_key is null or p_fingerprint is null or p_value is null or length(p_key)>160 or length(p_fingerprint)<>64 or bytes>24000000
    or (j.work_allowance_version=0 and ((select count(*) from bob_private.bob_job_steps where job_id=p_job)>=512
    or coalesce((select sum(value_bytes) from bob_private.bob_job_steps where job_id=p_job),0)+bytes>64000000)) then raise exception 'journal_limit'; end if;
  insert into bob_private.bob_job_steps(job_id,key,fingerprint,value) values(p_job,p_key,p_fingerprint,p_value);
  return true;
end $$;

-- Keyset pages bound transport payload, not the amount of work. One maximum
-- sized entry is still readable; subsequent entries stop near 2 MB per page.
create function bob.bob_job_steps_page(p_job uuid,p_claim uuid,p_after text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; result jsonb:='[]'::jsonb; row bob_private.bob_job_steps; bytes bigint:=0; cursor_key text;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found or j.status<>'running' or j.claim_token is distinct from p_claim or j.lease_until<=clock_timestamp() then raise exception 'job_not_claimed' using errcode='40001'; end if;
 for row in select * from bob_private.bob_job_steps where job_id=p_job and (p_after is null or key>p_after) order by key limit 100 loop
  if bytes>0 and bytes+row.value_bytes>2000000 then exit; end if;
  result:=result||jsonb_build_array(jsonb_build_object('key',row.key,'fingerprint',row.fingerprint,'value',row.value));
  bytes:=bytes+row.value_bytes; cursor_key:=row.key;
 end loop;
 return jsonb_build_object('entries',result,'next',case when exists(select 1 from bob_private.bob_job_steps where job_id=p_job and key>cursor_key) then cursor_key else null end);
end $$;
revoke all on function bob.bob_job_steps_page(uuid,uuid,text) from public,anon,authenticated;
grant execute on function bob.bob_job_steps_page(uuid,uuid,text) to service_role;

create function bob_private.bob_cancel_job(p_project text,p_job uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; pending record; receipts jsonb; seq bigint; request_ids uuid[];
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||auth.uid()::text,0));
 select * into j from bob_private.bob_jobs where id=p_job and project_id=p_project and actor_id=auth.uid() for update;
 if not found or j.status not in ('queued','running','paused','cancelled') then return jsonb_build_object('ok',false,'error','turn_not_in_flight'); end if;
 if j.status<>'cancelled' and exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=j.turn_id and role='assistant' and delivery_state='completed') then
  return jsonb_build_object('ok',false,'error','turn_not_in_flight');
 end if;
 if j.status<>'cancelled' then
  -- A resumed request can still carry its older origin until its first SAVE.
  -- Loading opens this exact claimed turn's period; dispatch records its job.
  select coalesce(array_agg(r.id),'{}'::uuid[]) into request_ids from bob_private.project_drawing_requests r
   where r.project_id=p_project and r.owner_user_id=auth.uid() and r.thread_id=j.thread_id and (r.origin_turn_id=j.turn_id or r.id=j.drawing_request_id
    or exists(select 1 from bob_private.drawing_budgets b where b.request_id=r.id and b.turn_id=j.turn_id)
    or exists(select 1 from bob_private.drawing_model_calls c join bob_private.bob_jobs work on work.id=c.execution_id
      where c.request_id=r.id and work.project_id=p_project and work.actor_id=auth.uid() and work.thread_id=j.thread_id and work.turn_id=j.turn_id));
  delete from bob_private.drawing_authorities a using bob_private.project_drawing_requests r
   where a.request_id=r.id and r.id=any(request_ids);
  update bob_private.project_drawing_requests set status='cancelled',reason='owner_cancelled',revision=revision+1,updated_at=clock_timestamp()
   where id=any(request_ids) and status not in ('saved','cancelled');
  update bob_private.bob_thread_provider_state set generation=generation+1,in_flight_turn_id=null,lock_started_at=null,previous_response_id=null,updated_at=clock_timestamp()
   where thread_id=j.thread_id and in_flight_turn_id=j.turn_id;
  select coalesce(jsonb_agg(receipt-'record'-'related_receipts' order by created_at,operation_key),'[]'::jsonb) into receipts
   from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=j.turn_id;
  update bob.bob_threads set next_seq=next_seq+1,updated_at=clock_timestamp() where id=j.thread_id returning next_seq-1 into seq;
  insert into bob.bob_messages(thread_id,seq,turn_id,role,text,evidence,delivery_state) values(j.thread_id,seq,j.turn_id,'assistant',
   'Stopped at your request. Changes already saved remain in the project. The request was not completed.',
   jsonb_build_object('kind','ai_assessment','partial',true,'sources','[]'::jsonb,'writes',receipts),'completed');
  update bob.bob_messages set delivery_state='completed',updated_at=clock_timestamp()
   where thread_id=j.thread_id and turn_id=j.turn_id and role='user' and delivery_state='pending';
  update bob_private.bob_jobs set status='cancelled',error_code='user_cancelled',credential=null,claim_token=null,lease_until=null,waiting_ai_job=null,updated_at=clock_timestamp() where project_id=p_project and actor_id=auth.uid() and thread_id=j.thread_id and turn_id=j.turn_id and status in ('queued','running','paused');
  for pending in select operation_key from shared_private.ai_jobs where app='bob' and context->>'jobId' in (select id::text from bob_private.bob_jobs where project_id=p_project and actor_id=auth.uid() and thread_id=j.thread_id and turn_id=j.turn_id) and status in ('pending','submitting') loop
   perform shared.ai_job_cancel('bob',pending.operation_key);
  end loop;
 end if;
 return jsonb_build_object('ok',true,'status','cancelled','projectId',p_project,'jobId',j.id);
end $$;
revoke all on function bob_private.bob_cancel_job(text,uuid) from public,anon,service_role;
grant execute on function bob_private.bob_cancel_job(text,uuid) to authenticated;
create function bob.bob_cancel_job(p_project text,p_job uuid) returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_cancel_job(p_project,p_job) $$;
revoke all on function bob.bob_cancel_job(text,uuid) from public,anon,service_role;
grant execute on function bob.bob_cancel_job(text,uuid) to authenticated;

create or replace function bob_private.bob_job_status(p_project text,p_turn uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; result jsonb; request_ids jsonb; complete boolean; active jsonb; state text; writes jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then
  raise exception 'project_denied' using errcode='42501';
 end if;
 select job.* into j from bob_private.bob_jobs job
 join bob.bob_threads t on t.id=job.thread_id and t.project_id=job.project_id
  and t.owner_user_id=auth.uid() and t.status='active'
 where job.project_id=p_project and job.actor_id=auth.uid() and job.turn_id=p_turn
  and job.drawing_request_id is null;
 if not found then return null; end if;
 state:=case when j.status in ('queued','running') and j.expires_at<=clock_timestamp() then case when j.work_allowance_version=1 then 'paused' else 'failed' end else j.status end;
 result:=jsonb_build_object(
  'jobId',j.id,'status',state,
  'expiresAt',j.expires_at,'error',case when state='paused' then 'authentication_expired' else j.error_code end,
  'progress',case when state in ('queued','running','paused') then j.progress else null end,
  'screen',(select s.screen from bob_private.bob_turn_screens s where s.thread_id=j.thread_id and s.turn_id=j.turn_id));

 -- All requests linked to this exact owner instruction must be proven saved.
 -- Use each request's latest event, rather than any later private reply or an
 -- older successful event whose current recovery has subsequently failed.
 select coalesce(jsonb_agg(r.id order by r.id),'[]'::jsonb),
  coalesce(bool_and(coalesce(
   r.status='saved' and r.saved_receipt->>'dataset'='artifacts'
   and r.saved_receipt->>'projectId'=p_project
   and event.status='completed'
   and exists(select 1 from bob.artifact_revisions a where a.project_id=p_project
    and a.artifact_id::text=r.saved_receipt->>'recordId'
    and a.revision::text=r.saved_receipt->>'revision')
   and exists(select 1 from bob.bob_messages m where m.thread_id=j.thread_id
    and m.turn_id=event.id and m.role='assistant' and m.delivery_state='completed'
    and m.evidence->'partial'='false'::jsonb
    and m.evidence->'writes' @> jsonb_build_array(r.saved_receipt)),false)),false),
  (jsonb_agg(jsonb_build_object('status',event.status,'expiresAt',event.expires_at,'progress',event.progress)
   order by event.created_at desc,event.id desc)
   filter(where event.status in ('queued','running') and event.expires_at>clock_timestamp()
    and r.status not in ('paused','cancelled')))->0
 into request_ids,complete,active
 from bob_private.project_drawing_requests r
 left join lateral (
  select work.id,work.status,work.expires_at,work.progress,work.created_at
  from bob_private.bob_jobs work where work.drawing_request_id=r.id
   and work.project_id=p_project and work.actor_id=auth.uid()
   and work.thread_id=j.thread_id and work.turn_id=p_turn
  order by work.created_at desc,work.id desc limit 1
 ) event on true
 where r.project_id=p_project and r.owner_user_id=auth.uid()
  and r.thread_id=j.thread_id and r.origin_turn_id=p_turn;

 if jsonb_array_length(request_ids)>0 and (complete or active is not null) then
  result:=result||jsonb_build_object('drawingRecovery',
   jsonb_build_object('scope','drawing','requestIds',request_ids)||
   case when complete then jsonb_build_object('status','completed','expiresAt',null,'progress',null) else active end);
 end if;
 if state='cancelled' then
  select coalesce(jsonb_agg(receipt-'record'-'related_receipts' order by created_at,operation_key),'[]'::jsonb) into writes
   from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn;
  result:=result||jsonb_build_object('writes',writes);
 end if;
 return result;
end $$;

create or replace function bob.bob_renew_drawing_authority(p_project text,p_user uuid,p_id uuid,p_turn uuid,p_credential jsonb,p_expires timestamptz,p_worker_url text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests;
begin
 perform bob_private.bob_assert_server_actor(p_project,p_user);
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||p_user::text,0));
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found or r.project_id<>p_project or r.owner_user_id is distinct from p_user or r.origin_turn_id is distinct from p_turn
  or r.thread_id is null or r.status in ('saved','cancelled','paused') then return false; end if;
 if p_expires is null or p_expires<=clock_timestamp()+interval '30 seconds' 
  or p_worker_url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/bob-worker$' or jsonb_typeof(p_credential) is distinct from 'object' then raise exception 'invalid_authority'; end if;
 if not exists(select 1 from bob_private.bob_jobs j where j.project_id=p_project and j.actor_id=p_user and j.thread_id=r.thread_id and j.turn_id=p_turn and j.work_allowance_version=1) then
  p_expires:=least(p_expires,clock_timestamp()+interval '20 minutes');
 end if;
 insert into bob_private.drawing_authorities values(p_id,r.thread_id,p_credential,p_expires,p_worker_url)
 on conflict(request_id) do update set thread_id=excluded.thread_id,credential=excluded.credential,expires_at=excluded.expires_at,worker_url=excluded.worker_url;
 return true;
end $$;
commit;
