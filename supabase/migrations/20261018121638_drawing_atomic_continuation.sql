-- The installed Supabase CLI aborts before migration creation; actual UTC filename.
-- One successful save owns packet, accounting period and continuation authority.
-- Reads never adopt an instruction. Unknown legacy routes fail explicitly.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob_private.project_drawing_requests drop constraint project_drawing_requests_reason_check;
alter table bob_private.project_drawing_requests add constraint project_drawing_requests_reason_check
 check(reason in ('context_missing','context_cleared','owner_cancelled','background_failed','background_expired','drawing_continuation_mismatch'));

create or replace function bob.bob_drawing_request(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_operation text,p_id uuid default null,p_expected integer default 0,p_status text default null,p_payload jsonb default null,p_write_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 r bob_private.project_drawing_requests; packet bob_private.drawing_requests;
 b bob_private.drawing_budgets; j bob_private.bob_jobs;
 result jsonb; input jsonb; old_input jsonb; job_count integer;
begin
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 if p_operation='list' then
  select coalesce(jsonb_agg(item order by stamp desc),'[]') into result from (
   select updated_at stamp,bob_private.drawing_request_projection(q) item from bob_private.project_drawing_requests q
   where project_id=p_project and owner_user_id=p_user and status not in ('saved','cancelled') order by updated_at desc limit 12) s;
  return result;
 end if;
 if p_operation not in ('load','save') or p_operation is null then raise exception 'invalid_operation'; end if;
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found then
  if exists(select 1 from bob_private.drawing_requests where id=p_id and thread_id=p_thread) then
   raise exception 'drawing_request_legacy_unsupported' using errcode='22023';
  end if;
  if p_operation='load' then return null; end if;
  raise exception 'drawing_request_denied' using errcode='42501';
 end if;
 if r.project_id<>p_project or r.owner_user_id is distinct from p_user then
  if p_operation='load' then return null; end if;
  raise exception 'drawing_request_denied' using errcode='42501';
 end if;
 if p_operation='load' then
  if r.status in ('saved','cancelled','paused') then
   return jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'reason',r.reason,'receipt',r.saved_receipt,
    'payload',jsonb_build_object('brief','{}'::jsonb,'owner_request',null,'reference_refs','[]'::jsonb));
  end if;
  if r.thread_id is distinct from p_thread then return null; end if;
  if exists(select 1 from bob_private.bob_jobs where project_id=p_project and actor_id=p_user and thread_id=p_thread
   and turn_id=p_turn and generation=p_generation and status='running' and drawing_request_id is not null
   and (drawing_request_id is distinct from p_id or r.origin_turn_id is distinct from p_turn
    or not exists(select 1 from bob_private.drawing_budgets where request_id=p_id and turn_id=p_turn))) then
   raise exception 'drawing_continuation_mismatch' using errcode='PT409';
  end if;
  select * into packet from bob_private.drawing_requests where id=p_id and thread_id=p_thread;
  if not found then
   if r.revision=0 then return null; end if;
   raise exception 'drawing_packet_mismatch' using errcode='PT409';
  end if;
  if packet.revision<>r.revision then raise exception 'drawing_packet_mismatch' using errcode='PT409'; end if;
  return jsonb_build_object('id',packet.id,'revision',packet.revision,'status',packet.status,'payload',packet.payload,'receipt',packet.saved_receipt);
 end if;
 if r.status='cancelled' then raise exception 'drawing_request_cancelled' using errcode='40001'; end if;
 if r.status='saved' then raise exception 'drawing_request_complete' using errcode='40001'; end if;
 if r.thread_id is distinct from p_thread or (r.status='paused' and r.revision<>0) then raise exception 'drawing_context_cleared' using errcode='40001'; end if;
 perform bob_private.assert_drawing_recovery_current(r);
 if r.recovery_plan_revision is not null then
  p_payload:=p_payload||jsonb_build_object('restoration',jsonb_build_object('plan_revision',r.recovery_plan_revision,'step_id',r.recovery_step_id));
 end if;
 if p_status='saved' then raise exception 'drawing_completion_requires_receipt' using errcode='22023'; end if;
 if p_write_key is null or length(p_write_key)>200 then raise exception 'invalid_write_key'; end if;
 input:=jsonb_build_object('id',p_id,'expected',p_expected,'status',p_status,'payload',p_payload,'turn_id',p_turn);
 select w.result,w.input into result,old_input from bob_private.drawing_request_writes w where w.thread_id=p_thread and w.write_key=p_write_key;
 if found then
  if old_input->>'turn_id' is distinct from p_turn::text then raise exception 'drawing_write_turn_changed' using errcode='PT409'; end if;
  if old_input is distinct from input then raise exception 'write_key_conflict'; end if;
  return result;
 end if;
 if r.revision is distinct from p_expected then raise exception 'revision_conflict' using errcode='40001'; end if;
 if p_payload is null or jsonb_typeof(p_payload->'brief') is distinct from 'object' or jsonb_typeof(p_payload->'reference_refs') is distinct from 'array' then raise exception 'invalid_drawing_request'; end if;
 if jsonb_build_object('area_id',p_payload->'brief'->'area_id','component_id',p_payload->'brief'->'component_id','step_id',p_payload->'brief'->'step_id','artifact_id',p_payload->'brief'->'artifact_id') is distinct from r.scope then
  raise exception 'drawing_scope_changed' using errcode='40001';
 end if;
 if p_payload::text ~ '(data:image/|base64,|[?&](token|signature|X-Amz-Signature)=|"image_url"\s*:|"previews"\s*:|"files"\s*:)' then raise exception 'drawing_request_pixels_forbidden'; end if;

 -- Never select an arbitrary job/credential. Direct service claims remain valid
 -- for synchronous saves, but only an exact running job can supply authority.
 select count(*) into job_count from bob_private.bob_jobs where project_id=p_project and actor_id=p_user
  and thread_id=p_thread and turn_id=p_turn and generation=p_generation and status='running';
 if job_count>1 then raise exception 'drawing_execution_ambiguous' using errcode='PT409'; end if;
 select * into j from bob_private.bob_jobs where project_id=p_project and actor_id=p_user
  and thread_id=p_thread and turn_id=p_turn and generation=p_generation and status='running';
 if job_count=0 and exists(select 1 from bob_private.bob_jobs where project_id=p_project and actor_id=p_user and thread_id=p_thread and turn_id=p_turn and status in ('queued','running')) then
  raise exception 'drawing_execution_mismatch' using errcode='PT409';
 end if;
 select * into b from bob_private.drawing_budgets where request_id=p_id for update;
 if j.drawing_request_id is not null and (j.drawing_request_id<>p_id or r.origin_turn_id is distinct from p_turn or b.turn_id is distinct from p_turn) then
  raise exception 'drawing_continuation_mismatch' using errcode='PT409';
 end if;
 if not exists(select 1 from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user')
  or exists(select 1 from bob_private.drawing_budget_periods where request_id=p_id and turn_id=p_turn) then
  raise exception 'drawing_budget_period_closed' using errcode='PT409';
 end if;
 if b.request_id is null then
  insert into bob_private.drawing_budgets(request_id,turn_id) values(p_id,p_turn);
 elsif b.turn_id is distinct from p_turn then
  insert into bob_private.drawing_budget_periods
   select request_id,period,turn_id,legacy_request_scope,call_limit,usd_limit,calls,spent_usd,unpriced,legacy_untracked,revision
   from bob_private.drawing_budgets where request_id=p_id;
  update bob_private.drawing_budgets set period=period+1,turn_id=p_turn,legacy_request_scope=false,
   call_limit=24,usd_limit=3,calls=0,spent_usd=0,unpriced=false,legacy_untracked=false,revision=revision+1 where request_id=p_id;
  -- Release only a former cost stop, inside this same packet revision.
  if p_payload#>>'{retry,outcome,reason}'='turn_budget_exhausted' then p_payload:=jsonb_set(p_payload,'{retry,fingerprint}','""'); end if;
 end if;
 if r.revision=0 then
  insert into bob_private.drawing_requests(id,thread_id,status,payload) values(p_id,p_thread,p_status,p_payload) returning * into packet;
 else
  update bob_private.drawing_requests set revision=revision+1,status=p_status,payload=p_payload,updated_at=clock_timestamp()
   where id=p_id and thread_id=p_thread and revision=p_expected returning * into packet;
  if not found then raise exception 'drawing_packet_mismatch' using errcode='PT409'; end if;
 end if;
 if r.origin_turn_id is distinct from p_turn then delete from bob_private.drawing_authorities where request_id=p_id; end if;
 update bob_private.project_drawing_requests set revision=packet.revision,status=packet.status,reason=null,origin_turn_id=p_turn,
  observed_event=greatest(observed_event,case when j.drawing_request_id is not null then j.drawing_event_revision
   else coalesce((select revision from bob_private.drawing_project_events where project_id=p_project),0) end),updated_at=clock_timestamp() where id=p_id;
 if j.credential is not null and j.drawing_request_id is null then
  insert into bob_private.drawing_authorities values(p_id,p_thread,j.credential,j.expires_at,j.worker_url)
   on conflict(request_id) do update set thread_id=excluded.thread_id,credential=excluded.credential,expires_at=excluded.expires_at,worker_url=excluded.worker_url;
 end if;
 result:=jsonb_build_object('id',packet.id,'revision',packet.revision,'status',packet.status,'payload',packet.payload);
 insert into bob_private.drawing_request_writes values(p_thread,p_write_key,input,result);
 return result;
exception when serialization_failure then
 if sqlerrm=any(array['drawing_scope_changed','revision_conflict','drawing_request_changed','drawing_request_cancelled',
  'drawing_context_cleared','drawing_request_complete','drawing_requirements_changed']) then raise sqlstate 'PT409' using message=sqlerrm; end if;
 raise;
end $$;
revoke all on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) to service_role;

-- Reservations consume the saved owner binding; they never change it.
create or replace function bob.bob_drawing_budget(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_id uuid,p_execution uuid,p_key text,p_operation text,p_response jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare unlimited_work boolean; prior_unknown boolean:=false; dispatch_key text; prior bob_private.drawing_model_calls; r bob_private.project_drawing_requests; b bob_private.drawing_budgets; c bob_private.drawing_model_calls; result jsonb; cost numeric; unknown_cost boolean; provider shared_private.ai_jobs; pending integer; diagnostics jsonb; task_calls integer; task_spent numeric; task_unpriced boolean; task_call_limit integer; task_usd_limit numeric;
begin
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 select exists(select 1 from bob_private.bob_jobs j where j.id=p_execution and j.project_id=p_project
  and j.actor_id=p_user and j.thread_id=p_thread and j.turn_id=p_turn and j.generation=p_generation
  and bob_private.bob_job_unlimited_work(j.id)) into unlimited_work;
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found or r.project_id<>p_project or r.owner_user_id is distinct from p_user or r.thread_id is distinct from p_thread then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if r.status in ('cancelled','paused','saved') then raise exception 'drawing_request_inactive' using errcode='40001'; end if;
 perform bob_private.assert_drawing_recovery_current(r);
 if p_execution is null or p_key is null or p_key !~ '^[a-f0-9]{64}$' then raise exception 'invalid_budget_call'; end if;
 select * into b from bob_private.drawing_budgets where request_id=p_id for update;
 if p_operation='reserve' and (b.request_id is null or b.turn_id is distinct from p_turn or r.origin_turn_id is distinct from p_turn
  or exists(select 1 from bob_private.bob_jobs where id=p_execution and drawing_request_id is not null and drawing_request_id<>p_id)) then
  raise exception 'drawing_continuation_mismatch' using errcode='PT409';
 end if;
 if p_operation='reserve' then
  select * into c from bob_private.drawing_model_calls where request_id=p_id and (budget_period=b.period or execution_id=p_execution and not completed)
   and (key=p_key or coalesce(input_key,key)=p_key) order by key limit 1 for update;
  if not found then
   -- Reuse usable paid output, not a cost-only receipt or a prior failed attempt.
   select mc.* into c from bob_private.drawing_model_calls mc where mc.request_id=p_id and mc.thread_id=p_thread
    and (mc.key=p_key or coalesce(mc.input_key,mc.key)=p_key)
    and (exists(select 1 from bob_private.drawing_model_results mr where mr.request_id=p_id and mr.key=mc.key and mr.thread_id=p_thread and mr.response->>'success'='true')
     or (not exists(select 1 from bob_private.drawing_model_results mr where mr.request_id=p_id and mr.key=mc.key and mr.thread_id=p_thread) and exists(select 1 from shared_private.ai_jobs a where a.app='bob' and a.fingerprint in (mc.key,coalesce(mc.input_key,mc.key)) and a.context->>'jobId'=mc.execution_id::text and a.response->>'status'='completed')))
    order by mc.budget_period desc,mc.key limit 1 for update;
  end if;
 else
  select * into c from bob_private.drawing_model_calls where request_id=p_id and execution_id=p_execution
   and (key=p_key or input_key=p_key)
   order by (key=p_key) desc,budget_period desc limit 1 for update;
  -- A current task may be completing the exact earlier provider intent after
  -- recovery. Receipt validation follows that intent's pinned policy rather
  -- than requiring its old generation to equal the current claim generation.
  select exists(select 1 from bob_private.bob_jobs j where j.id=c.execution_id and j.project_id=p_project
   and j.actor_id=p_user and j.thread_id=p_thread and bob_private.bob_job_unlimited_work(j.id)) into unlimited_work;
 end if;
 -- One task includes every drawing request used by this real owner message.
 -- Historical allocation fields remain accounting metadata for unlimited work.
 select coalesce(sum(x.calls),0),coalesce(sum(x.spent_usd),0),coalesce(bool_or(x.unpriced),false),
  coalesce(max(x.call_limit),24),coalesce(max(x.usd_limit),3)
 into task_calls,task_spent,task_unpriced,task_call_limit,task_usd_limit
 from (
  select request_id,turn_id,calls,spent_usd,unpriced,call_limit,usd_limit from bob_private.drawing_budgets
  union all select request_id,turn_id,calls,spent_usd,unpriced,call_limit,usd_limit from bob_private.drawing_budget_periods
 ) x join bob_private.project_drawing_requests q on q.id=x.request_id
 where q.project_id=p_project and q.owner_user_id=p_user and x.turn_id=p_turn;
 select count(*) into pending from bob_private.drawing_model_calls m
 join bob_private.project_drawing_requests q on q.id=m.request_id
 left join bob_private.drawing_budgets a on a.request_id=m.request_id and a.period=m.budget_period
 left join bob_private.drawing_budget_periods h on h.request_id=m.request_id and h.period=m.budget_period
 where not m.completed and q.project_id=p_project and q.owner_user_id=p_user
  and (coalesce(a.turn_id,h.turn_id)=p_turn or m.execution_id=p_execution
   or exists(select 1 from bob_private.bob_jobs j where j.id=m.execution_id and j.status in ('queued','running') and j.expires_at>clock_timestamp())
   or exists(select 1 from shared_private.ai_jobs j where j.app='bob' and j.context->>'jobId'=m.execution_id::text and j.fingerprint in (m.key,coalesce(m.input_key,m.key)) and j.status in ('submitting','pending') and j.expires_at>clock_timestamp()));
 diagnostics:=jsonb_build_object('scope',case when b.legacy_request_scope then 'drawing_request' else 'task' end,'calls',task_calls,'call_limit',task_call_limit,
  'spent_usd',task_spent,'usd_limit',task_usd_limit,'pending_calls',pending,'unpriced',task_unpriced)
  ||case when unlimited_work then jsonb_build_object('unlimited_work',true) else '{}'::jsonb end;

 if p_operation='reserve' then
  if c.request_id is not null then
   if c.completed then
    select response into result from bob_private.drawing_model_results where request_id=p_id and key=c.key and thread_id=p_thread;
    if result is null and c.thread_id=p_thread then
     select * into provider from shared_private.ai_jobs where app='bob' and fingerprint in (c.key,coalesce(c.input_key,c.key)) and context->>'jobId'=c.execution_id::text and response is not null order by created_at limit 1;
     if found then return jsonb_build_object('status','recover','key',c.key,'prior_outcome_unknown',c.uncertain_prior_key is not null and c.budget_period=b.period,'execution_id',c.execution_id,'recovery',jsonb_build_object('key',provider.operation_key,'context',provider.context,'expiresAt',provider.expires_at,'fingerprint',provider.fingerprint)); end if;
    end if;
    return jsonb_build_object('status',case when result is null then 'context_cleared' else 'completed' end,'key',c.key,'prior_outcome_unknown',c.uncertain_prior_key is not null and c.budget_period=b.period,'response',result,'budget_stop',case when result is null then diagnostics||jsonb_build_object('reasons',jsonb_build_array('context_cleared')) else null end);
   end if;
   select * into provider from shared_private.ai_jobs where app='bob' and fingerprint in (c.key,coalesce(c.input_key,c.key))
    and context->>'jobId'=c.execution_id::text and response is not null order by created_at limit 1;
   if found then return jsonb_build_object('status','recover','key',c.key,'execution_id',c.execution_id,
    'prior_outcome_unknown',c.uncertain_prior_key is not null and c.budget_period=b.period,
    'recovery',jsonb_build_object('key',provider.operation_key,'context',provider.context,'expiresAt',provider.expires_at,'fingerprint',provider.fingerprint)); end if;
   if c.execution_id=p_execution and exists(select 1 from bob_private.bob_jobs where id=p_execution and async_models and status in ('queued','running') and expires_at>clock_timestamp()) then
    return jsonb_build_object('status','reserved','key',c.key,'prior_outcome_unknown',c.uncertain_prior_key is not null);
   end if;
   return jsonb_build_object('status','outcome_unknown','budget_stop',diagnostics||jsonb_build_object('reasons',jsonb_build_array('pending_outcome')));
  end if;
  if (not unlimited_work and (task_calls>=task_call_limit or task_spent>=task_usd_limit or task_unpriced)) or pending>0 then
   return jsonb_build_object('status','budget_exhausted','budget_stop',diagnostics||jsonb_build_object('reasons',
    to_jsonb(array_remove(array[
     case when not unlimited_work and task_calls>=task_call_limit then 'call_limit' end,
     case when not unlimited_work and task_spent>=task_usd_limit then 'usd_limit' end,
     case when not unlimited_work and task_unpriced then 'unpriced_usage' end,
     case when pending>0 then 'pending_outcome' end
    ],null))));
  end if;
  -- Only a genuine new owner period can reach here past a terminal old intent.
  -- Keep that old row uncompleted/unpriced; new work has a distinct attempt key.
  select mc.* into prior from bob_private.drawing_model_calls mc where mc.request_id=p_id and mc.budget_period<>b.period and not mc.completed
   and not exists(select 1 from shared_private.ai_jobs a where a.app='bob' and a.context->>'jobId'=mc.execution_id::text and a.fingerprint in (mc.key,coalesce(mc.input_key,mc.key))
    and (exists(select 1 from shared.ai_usage_events u where u.background_job_id=a.id and u.cost_usd is not null)
     or (a.status='failed' or a.submission_state='prepared' and a.status in ('expired','cancelled')) and a.response_id is null))
   order by mc.budget_period desc,mc.key limit 1;
  prior_unknown:=found;
  dispatch_key:=case when exists(select 1 from bob_private.drawing_model_calls where request_id=p_id and key=p_key)
   then encode(sha256(convert_to('bob-task-call:'||p_id::text||':'||p_turn::text||':'||p_key,'UTF8')),'hex') else p_key end;
  insert into bob_private.drawing_model_calls(request_id,key,input_key,uncertain_prior_key,execution_id,thread_id,budget_period)
   values(p_id,dispatch_key,case when dispatch_key<>p_key then p_key end,case when prior_unknown then prior.key end,p_execution,p_thread,b.period);
  update bob_private.drawing_budgets set calls=calls+1 where request_id=p_id;
  return jsonb_build_object('status','reserved','key',dispatch_key,'prior_outcome_unknown',prior_unknown);
 elsif p_operation='complete' then
  if c.request_id is null or c.execution_id<>p_execution then raise exception 'budget_call_not_reserved'; end if;
  if c.completed then
   select response into result from bob_private.drawing_model_results where request_id=p_id and key=c.key;
   if result is null and c.thread_id=p_thread and exists(select 1 from shared_private.ai_jobs where app='bob' and fingerprint in (c.key,coalesce(c.input_key,c.key)) and context->>'jobId'=c.execution_id::text and response is not null) then
    if octet_length(p_response::text)>(case when unlimited_work then 24000000 else 300000 end) then raise exception 'invalid_budget_receipt'; end if;
    insert into bob_private.drawing_model_results values(p_id,c.key,p_thread,p_response);
   elsif result is distinct from p_response then raise exception 'budget_receipt_changed'; end if;
   return jsonb_build_object('status','completed');
  end if;
  -- Match the durable journal's per-entry transport/storage bound for new
  -- work. This is not a generation allowance; provider output stays uncapped
  -- by Bob. Historical executions retain their exact receipt contract.
  if jsonb_typeof(p_response) is distinct from 'object' or jsonb_typeof(p_response->'success') is distinct from 'boolean'
   or octet_length(p_response::text)>(case when unlimited_work then 24000000 else 300000 end) then raise exception 'invalid_budget_receipt'; end if;
  cost:=case when jsonb_typeof(p_response->'estimatedCostUsd')='number' then (p_response->>'estimatedCostUsd')::numeric else null end;
  if cost<0 or (not unlimited_work and cost>100) then raise exception 'invalid_budget_cost'; end if;
  unknown_cost:=cost is null and (coalesce((p_response#>>'{usage,total_tokens}')::numeric,0)>0 or coalesce((p_response->>'success')::boolean,false));
  update bob_private.drawing_model_calls set completed=true,cost_usd=cost where request_id=p_id and key=c.key;
  insert into bob_private.drawing_model_results values(p_id,c.key,p_thread,p_response);
  if c.budget_period=b.period then
   update bob_private.drawing_budgets set spent_usd=spent_usd+coalesce(cost,0),unpriced=unpriced or unknown_cost where request_id=p_id;
  else
   update bob_private.drawing_budget_periods set spent_usd=spent_usd+coalesce(cost,0),unpriced=unpriced or unknown_cost
    where request_id=p_id and period=c.budget_period;
   if not found then raise exception 'budget_period_missing'; end if;
  end if;
  return jsonb_build_object('status','completed');
 end if;
 raise exception 'invalid_budget_operation';
end $$;
revoke all on function bob.bob_drawing_budget(text,uuid,uuid,uuid,bigint,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function bob.bob_drawing_budget(text,uuid,uuid,uuid,bigint,uuid,uuid,text,text,jsonb) to service_role;


create or replace function bob_private.queue_drawing_events() returns void language plpgsql security definer set search_path='' as $$
declare candidate record; r bob_private.project_drawing_requests; a bob_private.drawing_authorities; s bob_private.bob_thread_provider_state; j bob_private.bob_jobs; epoch bigint;
begin
 for candidate in select q.id,q.project_id,q.owner_user_id from bob_private.project_drawing_requests q
 join bob_private.drawing_project_events e on e.project_id=q.project_id and e.revision>q.observed_event
 where q.reason is distinct from 'drawing_continuation_mismatch'
 and q.status in ('collecting','ready_to_design','needs_data','retrieval_failed','draft','reviewed') and q.thread_id is not null and q.origin_turn_id is not null
 and exists(select 1 from bob_private.drawing_authorities authority_row where authority_row.request_id=q.id and authority_row.thread_id=q.thread_id and authority_row.expires_at>clock_timestamp()+interval '30 seconds')
 and exists(select 1 from bob.people p where p.project_id=q.project_id and p.auth_user_id=q.owner_user_id)
 and exists(select 1 from bob_private.bob_thread_provider_state state_row where state_row.thread_id=q.thread_id and state_row.in_flight_turn_id is null)
 and not exists(select 1 from bob_private.drawing_budgets b where b.request_id=q.id
  and not bob_private.bob_task_unlimited_work(q.project_id,q.owner_user_id,q.thread_id,q.origin_turn_id)
  and (b.unpriced or b.calls>=b.call_limit or b.spent_usd>=b.usd_limit))
 and not exists(select 1 from bob_private.drawing_model_calls c where c.request_id=q.id and not c.completed)
 order by q.updated_at limit 20 loop
  if not pg_try_advisory_xact_lock(hashtextextended(candidate.project_id||':'||candidate.owner_user_id::text,0)) then continue; end if;
  select * into r from bob_private.project_drawing_requests where id=candidate.id for update;
  if r.status not in ('collecting','ready_to_design','needs_data','retrieval_failed','draft','reviewed') or r.thread_id is null then continue; end if;
  if not exists(select 1 from bob_private.drawing_budgets where request_id=r.id and turn_id=r.origin_turn_id) then
   -- Preserve the conflicting identities and all receipts for diagnosis. A
   -- genuine claimed owner save must adopt the next instruction explicitly.
   update bob_private.project_drawing_requests set reason='drawing_continuation_mismatch' where id=r.id;
   continue;
  end if;
  if not exists(select 1 from bob.people where project_id=r.project_id and auth_user_id=r.owner_user_id) then
   delete from bob_private.drawing_authorities where request_id=r.id;continue;
  end if;
  select * into a from bob_private.drawing_authorities where request_id=r.id and thread_id=r.thread_id;
  if not found or a.expires_at<=clock_timestamp()+interval '30 seconds' then continue; end if;
  if exists(select 1 from bob_private.drawing_budgets where request_id=r.id
   and not bob_private.bob_task_unlimited_work(r.project_id,r.owner_user_id,r.thread_id,r.origin_turn_id)
   and (unpriced or calls>=call_limit or spent_usd>=usd_limit))
   or exists(select 1 from bob_private.drawing_model_calls where request_id=r.id and not completed) then continue; end if;
  select * into s from bob_private.bob_thread_provider_state where thread_id=r.thread_id for update;
  if not found or s.in_flight_turn_id is not null then continue; end if;
  if not exists(select 1 from bob.bob_messages where thread_id=r.thread_id and turn_id=r.origin_turn_id and role='user') then continue; end if;
  select revision into epoch from bob_private.drawing_project_events where project_id=r.project_id;
  update bob_private.bob_thread_provider_state set in_flight_turn_id=r.origin_turn_id,lock_started_at=clock_timestamp(),generation=generation+1 where thread_id=r.thread_id returning * into s;
  insert into bob_private.bob_jobs(project_id,actor_id,thread_id,turn_id,generation,credential,worker_url,expires_at,drawing_request_id,drawing_event_revision)
  values(r.project_id,r.owner_user_id,r.thread_id,r.origin_turn_id,s.generation,a.credential,a.worker_url,a.expires_at,r.id,epoch) returning * into j;
  insert into bob_private.drawing_attempts(id,request_id,event_revision,request_revision) values(j.id,r.id,epoch,r.revision);
  update bob_private.project_drawing_requests set observed_event=epoch where id=r.id;
 end loop;
 delete from bob_private.drawing_authorities where expires_at<=clock_timestamp();
end $$;
revoke all on function bob_private.queue_drawing_events() from public,anon,authenticated,service_role;



-- Retire the callable legacy chain, not migration history. No CAS/recovery fallback.
drop function bob.bob_drawing_request_before_conflict_response(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text);
drop function bob.bob_drawing_request_before_events(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text);
drop function bob.bob_drawing_request_before_restoration(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text);
drop function bob.bob_drawing_request_before_project_lifecycle(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text);
drop function bob.bob_drawing_request_before_recovery(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text);
drop function bob_private.begin_drawing_budget_period(text,uuid,uuid,uuid,bigint,uuid);

-- Quarantine proven mismatches without choosing a turn, source revision or
-- credential. Do not rewrite cost history, geometry or saved delivery receipts.
update bob_private.project_drawing_requests r set reason='drawing_continuation_mismatch'
 where r.status not in ('saved','cancelled','paused') and r.origin_turn_id is not null
 and exists(select 1 from bob_private.drawing_budgets b where b.request_id=r.id and b.turn_id is distinct from r.origin_turn_id);
commit;
