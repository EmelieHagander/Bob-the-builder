-- K0: preserve allocation/authority/replay; report the actual blocked boundary.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function bob.bob_drawing_budget(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_id uuid,p_execution uuid,p_key text,p_operation text,p_response jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; b bob_private.drawing_budgets; c bob_private.drawing_model_calls; result jsonb; cost numeric; unknown_cost boolean; provider shared_private.ai_jobs; pending integer; diagnostics jsonb;
begin
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found or r.project_id<>p_project or r.owner_user_id is distinct from p_user or r.thread_id is distinct from p_thread then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if r.status in ('cancelled','paused','saved') then raise exception 'drawing_request_inactive' using errcode='40001'; end if;
 perform bob_private.assert_drawing_recovery_current(r);
 if p_execution is null or p_key is null or p_key !~ '^[a-f0-9]{64}$' then raise exception 'invalid_budget_call'; end if;
 insert into bob_private.drawing_budgets(request_id) values(p_id) on conflict do nothing;
 select * into b from bob_private.drawing_budgets where request_id=p_id for update;
 select * into c from bob_private.drawing_model_calls where request_id=p_id and key=p_key for update;
 -- Capture under the existing request/budget locks, without changing allocation.
 select count(*) into pending from bob_private.drawing_model_calls where request_id=p_id and not completed;
 diagnostics:=jsonb_build_object('scope','drawing_request','calls',b.calls,'call_limit',b.call_limit,
  'spent_usd',b.spent_usd,'usd_limit',b.usd_limit,'pending_calls',pending,'unpriced',b.unpriced);

 if p_operation='reserve' then
  if c.request_id is not null then
   if c.completed then
    select response into result from bob_private.drawing_model_results where request_id=p_id and key=p_key and thread_id=p_thread;
    if result is null and c.thread_id=p_thread then
     select * into provider from shared_private.ai_jobs where app='bob' and fingerprint=p_key and context->>'jobId'=c.execution_id::text and response is not null order by created_at limit 1;
     if found then return jsonb_build_object('status','recover','execution_id',c.execution_id,'recovery',jsonb_build_object('key',provider.operation_key,'context',provider.context,'expiresAt',provider.expires_at)); end if;
    end if;
    return jsonb_build_object('status',case when result is null then 'context_cleared' else 'completed' end,'response',result,'budget_stop',case when result is null then diagnostics||jsonb_build_object('reasons',jsonb_build_array('context_cleared')) else null end);
   end if;
   if c.execution_id=p_execution and exists(select 1 from bob_private.bob_jobs where id=p_execution and async_models and status in ('queued','running') and expires_at>clock_timestamp()) then
    return jsonb_build_object('status','reserved');
   end if;
   return jsonb_build_object('status','outcome_unknown','budget_stop',diagnostics||jsonb_build_object('reasons',jsonb_build_array('pending_outcome')));
  end if;
  if b.calls>=b.call_limit or b.spent_usd>=b.usd_limit or b.unpriced
   or exists(select 1 from bob_private.drawing_model_calls where request_id=p_id and not completed) then
   return jsonb_build_object('status','budget_exhausted','budget_stop',diagnostics||jsonb_build_object('reasons',
    to_jsonb(array_remove(array[
     case when b.calls>=b.call_limit then 'call_limit' end,
     case when b.spent_usd>=b.usd_limit then 'usd_limit' end,
     case when b.unpriced then 'unpriced_usage' end,
     case when pending>0 then 'pending_outcome' end
    ],null))));
  end if;
  insert into bob_private.drawing_model_calls(request_id,key,execution_id,thread_id) values(p_id,p_key,p_execution,p_thread);
  update bob_private.drawing_budgets set calls=calls+1 where request_id=p_id;
  return jsonb_build_object('status','reserved');
 elsif p_operation='complete' then
  if c.request_id is null or c.execution_id<>p_execution then raise exception 'budget_call_not_reserved'; end if;
  if c.completed then
   select response into result from bob_private.drawing_model_results where request_id=p_id and key=p_key;
   if result is null and c.thread_id=p_thread and exists(select 1 from shared_private.ai_jobs where app='bob' and fingerprint=p_key and context->>'jobId'=c.execution_id::text and response is not null) then
    insert into bob_private.drawing_model_results values(p_id,p_key,p_thread,p_response);
   elsif result is distinct from p_response then raise exception 'budget_receipt_changed'; end if;
   return jsonb_build_object('status','completed');
  end if;
  if jsonb_typeof(p_response) is distinct from 'object' or jsonb_typeof(p_response->'success') is distinct from 'boolean'
   or octet_length(p_response::text)>300000 then raise exception 'invalid_budget_receipt'; end if;
  cost:=case when jsonb_typeof(p_response->'estimatedCostUsd')='number' then (p_response->>'estimatedCostUsd')::numeric else null end;
  if cost<0 or cost>100 then raise exception 'invalid_budget_cost'; end if;
  unknown_cost:=cost is null and (coalesce((p_response#>>'{usage,total_tokens}')::numeric,0)>0 or coalesce((p_response->>'success')::boolean,false));
  update bob_private.drawing_model_calls set completed=true,cost_usd=cost where request_id=p_id and key=p_key;
  insert into bob_private.drawing_model_results values(p_id,p_key,p_thread,p_response);
  update bob_private.drawing_budgets set spent_usd=spent_usd+coalesce(cost,0),unpriced=unpriced or unknown_cost where request_id=p_id;
  return jsonb_build_object('status','completed');
 end if;
 raise exception 'invalid_budget_operation';
end $$;
revoke all on function bob.bob_drawing_budget(text,uuid,uuid,uuid,bigint,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function bob.bob_drawing_budget(text,uuid,uuid,uuid,bigint,uuid,uuid,text,text,jsonb) to service_role;

commit;
