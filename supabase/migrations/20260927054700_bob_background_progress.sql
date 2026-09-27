-- Background turns count stalls, not hops. A worker segment that saved at least one
-- journal checkpoint made progress; only consecutive segments without progress stop
-- a job. The 20-minute wall, the caller-token expiry and a hard claim ceiling stay.
-- Workers publish a content-free progress marker the owner's browser can show.
-- Execution diagnostics gain per-tool rows and the reason a turn ended.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob_private.bob_jobs
  add column progress jsonb check(progress is null or (jsonb_typeof(progress)='object' and octet_length(progress::text)<=600)),
  add column last_claim_steps integer not null default 0 check(last_claim_steps>=0),
  add column total_claims integer not null default 0 check(total_claims>=0);

create or replace function bob_private.bob_claim_job(p_job uuid,p_capability uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; token uuid:=gen_random_uuid(); g bigint; steps jsonb; message text; saved integer;
begin
  select * into j from bob_private.bob_jobs where id=p_job and capability=p_capability;
  if not found then raise exception 'job_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.project_id || ':' || j.actor_id::text,0));
  select * into j from bob_private.bob_jobs where id=p_job for update;
  if j.status not in ('queued','running') or (j.status='running' and j.lease_until>clock_timestamp()) then
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
    'expiresAt',j.expires_at,'entries',steps);
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
    if (j.status='queued' or j.lease_until<=clock_timestamp()) and
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

-- Content-free progress: stage, tool name, step and saved-change count only.
create function bob_private.bob_job_progress(p_job uuid,p_claim uuid,p_progress jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if jsonb_typeof(p_progress) is distinct from 'object' or p_progress-array['stage','tool','step','saved']<>'{}'
    or coalesce(p_progress->>'stage','') not in ('thinking','tool','finishing')
    or (p_progress ? 'tool' and coalesce(p_progress->>'tool','')!~'^[a-z][a-z0-9_]{0,63}$')
    or jsonb_typeof(p_progress->'step') is distinct from 'number' or jsonb_typeof(p_progress->'saved') is distinct from 'number'
    or coalesce(p_progress->>'step','')!~'^[0-9]{1,3}$' or coalesce(p_progress->>'saved','')!~'^[0-9]{1,3}$'
    or (p_progress ? 'tool' and jsonb_typeof(p_progress->'tool') is distinct from 'string') then
    raise exception 'invalid_progress' using errcode='22023'; end if;
  update bob_private.bob_jobs set progress=p_progress||jsonb_build_object('at',clock_timestamp())
    where id=p_job and status='running' and claim_token=p_claim;
  return found;
end $$;
create function bob.bob_job_progress(p_job uuid,p_claim uuid,p_progress jsonb) returns boolean
  language sql security invoker set search_path='' as $$ select bob_private.bob_job_progress(p_job,p_claim,p_progress) $$;
revoke all on function bob_private.bob_job_progress(uuid,uuid,jsonb),bob.bob_job_progress(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function bob_private.bob_job_progress(uuid,uuid,jsonb),bob.bob_job_progress(uuid,uuid,jsonb) to service_role;

-- The browser receives status and progress only, after the same caller/project checks as chat.
create or replace function bob_private.bob_job_status(p_project text,p_turn uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select * into j from bob_private.bob_jobs where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn;
  if not found then return null; end if;
  return jsonb_build_object('status',case when j.status in ('queued','running') and j.expires_at<=clock_timestamp() then 'failed' else j.status end,
    'expiresAt',j.expires_at,'error',j.error_code,
    'progress',case when j.status in ('queued','running') then j.progress else null end);
end $$;

-- Per-tool diagnostics and the reason a turn ended. Still content-free.
alter table bob.execution_events drop constraint if exists execution_events_kind_check;
alter table bob.execution_events add constraint execution_events_kind_check check(kind in ('model','delivery','tool'));
alter table bob.execution_events drop constraint if exists execution_events_role_check;
alter table bob.execution_events add constraint execution_events_role_check check(role in ('bob','tool','ask-bob','cad-designer','cad-reviewer','context-summary','plan-compiler','plan-reviewer','bob-tool-discovery','bob-work-intent','bob-delivery-language','other'));
alter table bob.execution_events drop constraint if exists execution_events_status_check;
alter table bob.execution_events add constraint execution_events_status_check check(status ~ '^[a-z][a-z0-9_]{0,39}$');

-- Continuity: the records Bob consulted in his previous reply, as pointers only.
create or replace function bob.bob_load_context(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  recent jsonb; current_message jsonb; older jsonb:='[]'::jsonb;
  cutoff bigint; folded bigint; through_seq bigint; memo text; r record; chars int:=0;
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  insert into bob_private.bob_thread_summary(thread_id) values(p_thread) on conflict do nothing;
  select last_folded_seq,summary into folded,memo from bob_private.bob_thread_summary where thread_id=p_thread;
  select jsonb_build_object('seq',seq,'role',role,'text',text,'state',delivery_state) into current_message
    from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  select coalesce(jsonb_agg(item order by seq),'[]'::jsonb),min(seq) into recent,cutoff from (
    select seq,jsonb_build_object('seq',seq,'role',role,'text',text,'state',delivery_state) item
    from bob.bob_messages where thread_id=p_thread and not(turn_id=p_turn and role='user')
    order by seq desc limit 4
  ) t;
  recent:=recent||jsonb_build_array(current_message);
  cutoff:=coalesce(cutoff,(current_message->>'seq')::bigint);
  through_seq:=folded;
  for r in select seq,role,text,delivery_state from bob.bob_messages
    where thread_id=p_thread and seq>folded and seq<cutoff and not(turn_id=p_turn and role='user')
    order by seq limit 16 loop
    -- Never cut a message in half, even for a legacy long answer. One row is at
    -- most 100k characters by the transcript constraint; later rows stay bounded.
    exit when chars>0 and chars+char_length(r.text)>60000;
    older:=older||jsonb_build_array(jsonb_build_object('seq',r.seq,'role',r.role,'text',r.text,'state',r.delivery_state));
    chars:=chars+char_length(r.text); through_seq:=r.seq;
  end loop;
  return jsonb_build_object('projectId',p_project,'threadId',p_thread,'generation',p_generation,
    'recentWrites',coalesce((select jsonb_agg(x.item order by x.created_at) from (
      select w.receipt - 'record' as item,w.created_at
      from bob_private.bob_write_receipts w
      where w.project_id=p_project and w.actor_id=p_user and w.turn_id<>p_turn
        and exists(select 1 from bob.bob_messages m where m.thread_id=p_thread and m.turn_id=w.turn_id)
      order by w.created_at desc,w.operation_key limit 16
    ) x),'[]'::jsonb),
    'recentSources',coalesce((select jsonb_agg(jsonb_build_object('dataset',s->>'dataset','recordId',s->>'recordId','label',left(s->>'label',200)))
      from (select m.evidence from bob.bob_messages m where m.thread_id=p_thread and m.role='assistant' and m.delivery_state='completed'
        and m.turn_id<>p_turn order by m.seq desc limit 1) last_reply,
      lateral (select value s from jsonb_array_elements(case when jsonb_typeof(last_reply.evidence->'sources')='array' then last_reply.evidence->'sources' else '[]'::jsonb end) limit 24) src
      where s->>'dataset' is not null and s->>'recordId' is not null and s->>'label' is not null),'[]'::jsonb),
    'summary',memo,'lastFoldedSeq',folded,'recent',recent,'older',older,'foldThroughSeq',through_seq,
    'hasMore',exists(select 1 from bob.bob_messages where thread_id=p_thread and seq>through_seq and seq<cutoff and not(turn_id=p_turn and role='user')));
end $$;
revoke all on function bob.bob_load_context(text,uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function bob.bob_load_context(text,uuid,uuid,uuid,bigint) to service_role;

notify pgrst,'reload schema';
commit;
