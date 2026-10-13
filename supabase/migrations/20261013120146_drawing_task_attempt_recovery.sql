-- A new explicit task may replace a terminal uncertain attempt, never erase its bill.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table bob_private.drawing_model_calls add column input_key text check(input_key ~ '^[a-f0-9]{64}$');
alter table bob_private.drawing_model_calls add column uncertain_prior_key text check(uncertain_prior_key ~ '^[a-f0-9]{64}$');
create unique index drawing_model_calls_period_input on bob_private.drawing_model_calls(request_id,budget_period,(coalesce(input_key,key)));
create or replace function bob.bob_drawing_budget(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_id uuid,p_execution uuid,p_key text,p_operation text,p_response jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior_unknown boolean:=false; dispatch_key text; prior bob_private.drawing_model_calls; r bob_private.project_drawing_requests; b bob_private.drawing_budgets; c bob_private.drawing_model_calls; result jsonb; cost numeric; unknown_cost boolean; provider shared_private.ai_jobs; pending integer; diagnostics jsonb; task_calls integer; task_spent numeric; task_unpriced boolean; task_call_limit integer; task_usd_limit numeric;
begin
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found or r.project_id<>p_project or r.owner_user_id is distinct from p_user or r.thread_id is distinct from p_thread then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if r.status in ('cancelled','paused','saved') then raise exception 'drawing_request_inactive' using errcode='40001'; end if;
 perform bob_private.assert_drawing_recovery_current(r);
 if p_execution is null or p_key is null or p_key !~ '^[a-f0-9]{64}$' then raise exception 'invalid_budget_call'; end if;
 if p_operation='reserve' then perform bob_private.begin_drawing_budget_period(p_project,p_user,p_thread,p_turn,p_generation,p_id); end if;
 select * into b from bob_private.drawing_budgets where request_id=p_id for update;
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
 end if;
 -- One task includes every drawing request used by this real owner message.
 -- The claim's actor/project lock prevents concurrent requests evading the cap.
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
  'spent_usd',task_spent,'usd_limit',task_usd_limit,'pending_calls',pending,'unpriced',task_unpriced);

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
  if task_calls>=task_call_limit or task_spent>=task_usd_limit or task_unpriced or pending>0 then
   return jsonb_build_object('status','budget_exhausted','budget_stop',diagnostics||jsonb_build_object('reasons',
    to_jsonb(array_remove(array[
     case when task_calls>=task_call_limit then 'call_limit' end,
     case when task_spent>=task_usd_limit then 'usd_limit' end,
     case when task_unpriced then 'unpriced_usage' end,
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
    insert into bob_private.drawing_model_results values(p_id,c.key,p_thread,p_response);
   elsif result is distinct from p_response then raise exception 'budget_receipt_changed'; end if;
   return jsonb_build_object('status','completed');
  end if;
  if jsonb_typeof(p_response) is distinct from 'object' or jsonb_typeof(p_response->'success') is distinct from 'boolean'
   or octet_length(p_response::text)>300000 then raise exception 'invalid_budget_receipt'; end if;
  cost:=case when jsonb_typeof(p_response->'estimatedCostUsd')='number' then (p_response->>'estimatedCostUsd')::numeric else null end;
  if cost<0 or cost>100 then raise exception 'invalid_budget_cost'; end if;
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
create or replace function bob_private.reconcile_drawing_costs() returns void language plpgsql security definer set search_path='' as $$
declare pending record; cost numeric; known boolean;
begin
 for pending in select c.*,r.project_id,r.owner_user_id from bob_private.drawing_model_calls c join bob_private.project_drawing_requests r on r.id=c.request_id
 where not c.completed and not exists(select 1 from bob_private.bob_jobs j where j.id=c.execution_id and j.status in ('queued','running') and j.expires_at>clock_timestamp())
 and exists(select 1 from shared_private.ai_jobs a where a.app='bob' and a.fingerprint in (c.key,coalesce(c.input_key,c.key)) and a.context->>'jobId'=c.execution_id::text
  and (exists(select 1 from shared.ai_usage_events u where u.background_job_id=a.id) or (a.status='failed' or a.submission_state='prepared' and a.status in ('expired','cancelled')) and a.response_id is null)) limit 40 loop
  if not pg_try_advisory_xact_lock(hashtextextended(pending.project_id||':'||pending.owner_user_id::text,0)) then continue; end if;
  perform 1 from bob_private.project_drawing_requests where id=pending.request_id for update;
  perform 1 from bob_private.drawing_budgets where request_id=pending.request_id for update;
  perform 1 from bob_private.drawing_model_calls where request_id=pending.request_id and key=pending.key and not completed for update;
  if not found then continue; end if;
  select u.cost_usd into cost from shared_private.ai_jobs a join shared.ai_usage_events u on u.background_job_id=a.id
  where a.app='bob' and a.fingerprint in (pending.key,coalesce(pending.input_key,pending.key)) and a.context->>'jobId'=pending.execution_id::text order by a.created_at limit 1;
  known:=found;
  if not known and exists(select 1 from shared_private.ai_jobs a where a.app='bob' and a.fingerprint in (pending.key,coalesce(pending.input_key,pending.key))
   and a.context->>'jobId'=pending.execution_id::text and (a.status='failed' or a.submission_state='prepared' and a.status in ('expired','cancelled')) and a.response_id is null) then cost:=0;known:=true; end if;
  if known then
   update bob_private.drawing_model_calls set completed=true,cost_usd=cost where request_id=pending.request_id and key=pending.key;
   update bob_private.drawing_budgets set spent_usd=spent_usd+coalesce(cost,0),unpriced=unpriced or cost is null
    where request_id=pending.request_id and period=pending.budget_period;
   if not found then
    update bob_private.drawing_budget_periods set spent_usd=spent_usd+coalesce(cost,0),unpriced=unpriced or cost is null
     where request_id=pending.request_id and period=pending.budget_period;
    if not found then raise exception 'budget_period_missing'; end if;
   end if;
   -- A newly known receipt is real technical progress. Release only the retry
   -- fingerprint; retain its outcome and exact draft for phase recovery.
   update bob_private.drawing_requests d set payload=jsonb_set(d.payload,'{retry,fingerprint}','""'::jsonb),revision=d.revision+1
   where d.id=pending.request_id and d.payload ? 'retry' and exists(select 1 from bob_private.project_drawing_requests r where r.id=d.id and r.status not in ('saved','cancelled','paused'));
   if found then update bob_private.project_drawing_requests set revision=revision+1 where id=pending.request_id; end if;
   insert into bob_private.drawing_project_events(project_id) values(pending.project_id) on conflict(project_id) do update set revision=bob_private.drawing_project_events.revision+1;
  end if;
 end loop;
end $$;
revoke all on function bob_private.reconcile_drawing_costs() from public,anon,authenticated,service_role;
create or replace function bob_private.record_failed_drawing_job(p_job uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; r bob_private.project_drawing_requests; d bob_private.drawing_requests;
 code text; seq bigint; uncertain boolean; detail jsonb; notice text;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found or j.drawing_request_id is null or j.status<>'failed' or j.error_code is null then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(j.project_id||':'||j.actor_id::text,0));
 select * into j from bob_private.bob_jobs where id=p_job for update;
 if not found or j.status<>'failed' then return false; end if;
 select * into r from bob_private.project_drawing_requests where id=j.drawing_request_id for update;
 -- Older failures cannot override a newer mandate, attempt, reset or delivery.
 if not found or r.project_id<>j.project_id or r.owner_user_id<>j.actor_id or r.thread_id is distinct from j.thread_id
  or r.origin_turn_id is distinct from j.turn_id or r.observed_event<>j.drawing_event_revision
  or r.status in ('saved','paused','cancelled')
  or exists(select 1 from bob_private.bob_jobs newer where newer.drawing_request_id=r.id and newer.id<>j.id
   and (newer.status in ('queued','running') or newer.created_at>j.created_at)) then return false; end if;
 select * into d from bob_private.drawing_requests where id=r.id and thread_id=j.thread_id for update;
 if not found or d.revision<>r.revision or d.status='saved' or d.payload#>>'{execution_failure,job_id}'=j.id::text then return false; end if;
 code:=case when j.error_code='background_expired' then 'background_expired' else 'background_failed' end;
 uncertain:=exists(select 1 from shared_private.ai_jobs a where a.id=j.waiting_ai_job and a.response_id is null and a.status in ('submitting','expired') and a.submission_state is distinct from 'prepared');
 detail:=jsonb_build_object('job_id',j.id,'ai_job_id',j.waiting_ai_job,'code',code,'receipt_missing',uncertain,'observed_at',j.updated_at);
 update bob_private.drawing_requests set status='retrieval_failed',revision=revision+1,updated_at=clock_timestamp(),
  payload=jsonb_set(payload,'{execution_failure}',detail) where id=r.id returning * into d;
 update bob_private.project_drawing_requests set status='retrieval_failed',reason=code,revision=d.revision,updated_at=d.updated_at where id=r.id;
 insert into bob.execution_events(run_id,turn_id,event_key,kind,role,status,duration_ms,counts)
 values(j.id,j.turn_id,'background_failure','delivery','bob','failed',
  least(86400000,greatest(0,floor(extract(epoch from (j.updated_at-j.created_at))*1000)))::bigint,
  jsonb_build_object('end_reason',code,'job_id',j.id,'drawing_request_id',r.id,'ai_job_id',j.waiting_ai_job,'receipt_missing',uncertain))
 on conflict(run_id,event_key) do nothing;
 -- The private answer is added once under the event-job ID. The original
 -- owner message and earlier answer remain intact. No explanatory AI call.
 if exists(select 1 from bob.people where project_id=j.project_id and auth_user_id=j.actor_id)
  and exists(select 1 from bob.bob_threads where id=j.thread_id and project_id=j.project_id and owner_user_id=j.actor_id and status='active')
  and not exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=j.id and role='assistant') then
  notice:=case when uncertain then
   'AI-anropet fick inget kvitto innan väntetiden tog slut. Ritningsarbetet är stoppat och det sparade underlaget är bevarat. Ingen ny ritning har bekräftats som sparad. Anropets utfall behöver kontrolleras innan samma arbete skickas igen.'
   else 'Ritningsarbetet stoppades av ett tekniskt fel. Det sparade underlaget och tidigare ritningsversioner är bevarade. Ingen ny ritning har bekräftats som sparad.' end;
  update bob.bob_threads set next_seq=next_seq+1,updated_at=clock_timestamp() where id=j.thread_id returning next_seq-1 into seq;
  insert into bob.bob_messages(thread_id,seq,turn_id,role,text,evidence)
  values(j.thread_id,seq,j.id,'assistant',notice,jsonb_build_object('kind','ai_assessment','references','[]'::jsonb,'sources','[]'::jsonb,'partial',true,'writes','[]'::jsonb));
 end if;
 return true;
end $$;
revoke all on function bob_private.record_failed_drawing_job(uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
