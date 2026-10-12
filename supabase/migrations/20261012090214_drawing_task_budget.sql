-- Owner mandate 2026-10-12: the guard bounds one real owner message/task,
-- including its CAD review/repair loop. A distinct claimed owner message gets
-- a fresh $3 / 24-call period. Worker segments, events and request IDs do not.
-- The installed CLI crashes before migration creation; filename uses actual UTC.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob_private.drawing_budgets
 add column period bigint not null default 1 check(period>0),
 add column turn_id uuid,
 add column legacy_request_scope boolean not null default false;
update bob_private.drawing_budgets b set turn_id=r.origin_turn_id,legacy_request_scope=true
 from bob_private.project_drawing_requests r where r.id=b.request_id;
alter table bob_private.drawing_model_calls
 add column budget_period bigint not null default 1 check(budget_period>0);

-- Archived counters include legacy request-wide charges; do not pretend those
-- historical calls came from one message. New periods have exact turn ownership.
create table bob_private.drawing_budget_periods (
 request_id uuid not null references bob_private.project_drawing_requests(id) on delete cascade,
 period bigint not null check(period>0),
 turn_id uuid,
 legacy_request_scope boolean not null,
 call_limit integer not null check(call_limit between 0 and 240),
 usd_limit numeric not null check(usd_limit between 0 and 10),
 calls integer not null check(calls>=0),
 spent_usd numeric not null check(spent_usd>=0),
 unpriced boolean not null,
 legacy_untracked boolean not null,
 revision integer not null check(revision>0),
 primary key(request_id,period)
);
create index drawing_budget_periods_turn on bob_private.drawing_budget_periods(turn_id,request_id);
create index drawing_budgets_turn on bob_private.drawing_budgets(turn_id,request_id);
alter table bob_private.drawing_budget_periods enable row level security;
revoke all on bob_private.drawing_budget_periods from public,anon,authenticated,service_role;

create function bob_private.begin_drawing_budget_period(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; b bob_private.drawing_budgets;
begin
 -- Also serializes all drawing requests belonging to this actor/project task.
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found or r.project_id<>p_project or r.owner_user_id is distinct from p_user or r.thread_id is distinct from p_thread then
  raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if r.status in ('cancelled','paused','saved') then return false; end if;
 perform bob_private.assert_drawing_recovery_current(r);
 insert into bob_private.drawing_budgets(request_id,turn_id) values(p_id,p_turn) on conflict do nothing;
 select * into b from bob_private.drawing_budgets where request_id=p_id for update;
 if b.turn_id=p_turn then return false; end if;
 -- An automatic continuation keeps its original owner turn. Only a real new
 -- owner instruction may open a period; archived turns cannot be reopened.
 if not exists(select 1 from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user')
  or exists(select 1 from bob_private.drawing_budget_periods where request_id=p_id and turn_id=p_turn) then
  raise exception 'drawing_budget_period_closed'; end if;
 insert into bob_private.drawing_budget_periods
  select request_id,period,turn_id,legacy_request_scope,call_limit,usd_limit,calls,spent_usd,unpriced,legacy_untracked,revision
  from bob_private.drawing_budgets where request_id=p_id;
 update bob_private.drawing_budgets set period=period+1,turn_id=p_turn,legacy_request_scope=false,
  call_limit=24,usd_limit=3,calls=0,spent_usd=0,unpriced=false,legacy_untracked=false,revision=revision+1 where request_id=p_id;
 -- Opening a new task releases only its cost stop. Geometry, dependencies,
 -- requirements and all quality recovery gates remain the same saved packet.
 update bob_private.drawing_requests set payload=jsonb_set(payload,'{retry,fingerprint}','""'::jsonb),revision=revision+1
  where id=p_id and payload#>>'{retry,outcome,reason}'='turn_budget_exhausted';
 if found then update bob_private.project_drawing_requests set revision=revision+1 where id=p_id; end if;
 return true;
end $$;
revoke all on function bob_private.begin_drawing_budget_period(text,uuid,uuid,uuid,bigint,uuid)
 from public,anon,authenticated,service_role;

create or replace function bob.bob_drawing_budget(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_id uuid,p_execution uuid,p_key text,p_operation text,p_response jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; b bob_private.drawing_budgets; c bob_private.drawing_model_calls; result jsonb; cost numeric; unknown_cost boolean; provider shared_private.ai_jobs; pending integer; diagnostics jsonb; task_calls integer; task_spent numeric; task_unpriced boolean; task_call_limit integer; task_usd_limit numeric;
begin
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found or r.project_id<>p_project or r.owner_user_id is distinct from p_user or r.thread_id is distinct from p_thread then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if r.status in ('cancelled','paused','saved') then raise exception 'drawing_request_inactive' using errcode='40001'; end if;
 perform bob_private.assert_drawing_recovery_current(r);
 if p_execution is null or p_key is null or p_key !~ '^[a-f0-9]{64}$' then raise exception 'invalid_budget_call'; end if;
 if p_operation='reserve' then perform bob_private.begin_drawing_budget_period(p_project,p_user,p_thread,p_turn,p_generation,p_id); end if;
 select * into b from bob_private.drawing_budgets where request_id=p_id for update;
 select * into c from bob_private.drawing_model_calls where request_id=p_id and key=p_key for update;
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
  and (m.request_id=p_id or coalesce(a.turn_id,h.turn_id)=p_turn);
 diagnostics:=jsonb_build_object('scope',case when b.legacy_request_scope then 'drawing_request' else 'task' end,'calls',task_calls,'call_limit',task_call_limit,
  'spent_usd',task_spent,'usd_limit',task_usd_limit,'pending_calls',pending,'unpriced',task_unpriced);

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
  if task_calls>=task_call_limit or task_spent>=task_usd_limit or task_unpriced or pending>0 then
   return jsonb_build_object('status','budget_exhausted','budget_stop',diagnostics||jsonb_build_object('reasons',
    to_jsonb(array_remove(array[
     case when task_calls>=task_call_limit then 'call_limit' end,
     case when task_spent>=task_usd_limit then 'usd_limit' end,
     case when task_unpriced then 'unpriced_usage' end,
     case when pending>0 then 'pending_outcome' end
    ],null))));
  end if;
  insert into bob_private.drawing_model_calls(request_id,key,execution_id,thread_id,budget_period) values(p_id,p_key,p_execution,p_thread,b.period);
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


create or replace function bob.bob_drawing_request_before_conflict_response(p_project text, p_user uuid, p_thread uuid, p_turn uuid, p_generation bigint, p_operation text, p_id uuid DEFAULT NULL::uuid, p_expected integer DEFAULT 0, p_status text DEFAULT NULL::text, p_payload jsonb DEFAULT NULL::jsonb, p_write_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
as $$
declare result jsonb; j bob_private.bob_jobs; renewed boolean;
begin
 result:=bob.bob_drawing_request_before_events(p_project,p_user,p_thread,p_turn,p_generation,p_operation,p_id,p_expected,p_status,p_payload,p_write_key);
 if p_operation in ('load','save') and jsonb_typeof(result)='object'
  and exists(select 1 from bob_private.project_drawing_requests where id=p_id
   and project_id=p_project and owner_user_id=p_user and thread_id=p_thread and status not in ('saved','cancelled','paused')) then
  renewed:=bob_private.begin_drawing_budget_period(p_project,p_user,p_thread,p_turn,p_generation,p_id);
  if renewed and p_operation='load' then
   result:=bob.bob_drawing_request_before_events(p_project,p_user,p_thread,p_turn,p_generation,'load',p_id,0,null,null,null);
  end if;
 end if;
 if p_operation='save' and exists(select 1 from bob_private.project_drawing_requests where id=p_id) then
  select * into j from bob_private.bob_jobs where project_id=p_project and actor_id=p_user and thread_id=p_thread and turn_id=p_turn and status in ('queued','running') order by drawing_request_id nulls first limit 1;
  delete from bob_private.drawing_authorities a using bob_private.project_drawing_requests r where a.request_id=r.id and r.id=p_id and r.origin_turn_id is distinct from p_turn;
  update bob_private.project_drawing_requests set origin_turn_id=p_turn,
   observed_event=greatest(observed_event,case when j.drawing_request_id is not null then j.drawing_event_revision else coalesce((select revision from bob_private.drawing_project_events where project_id=p_project),0) end) where id=p_id;
  if j.credential is not null and j.drawing_request_id is null then
   insert into bob_private.drawing_authorities values(p_id,p_thread,j.credential,j.expires_at,j.worker_url)
   on conflict(request_id) do update set thread_id=excluded.thread_id,credential=excluded.credential,expires_at=excluded.expires_at,worker_url=excluded.worker_url;
  end if;
 end if;
 return result;
end $$;

revoke all on function bob.bob_drawing_request_before_conflict_response(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text)
 from public,anon,authenticated,service_role;

create or replace function bob_private.reconcile_drawing_costs() returns void language plpgsql security definer set search_path='' as $$
declare pending record; cost numeric; known boolean;
begin
 for pending in select c.*,r.project_id,r.owner_user_id from bob_private.drawing_model_calls c join bob_private.project_drawing_requests r on r.id=c.request_id
 where not c.completed and not exists(select 1 from bob_private.bob_jobs j where j.id=c.execution_id and j.status in ('queued','running') and j.expires_at>clock_timestamp())
 and exists(select 1 from shared_private.ai_jobs a where a.app='bob' and a.fingerprint=c.key and a.context->>'jobId'=c.execution_id::text
  and (exists(select 1 from shared.ai_usage_events u where u.background_job_id=a.id) or a.status='failed' and a.response_id is null)) limit 40 loop
  if not pg_try_advisory_xact_lock(hashtextextended(pending.project_id||':'||pending.owner_user_id::text,0)) then continue; end if;
  perform 1 from bob_private.project_drawing_requests where id=pending.request_id for update;
  perform 1 from bob_private.drawing_budgets where request_id=pending.request_id for update;
  perform 1 from bob_private.drawing_model_calls where request_id=pending.request_id and key=pending.key and not completed for update;
  if not found then continue; end if;
  select u.cost_usd into cost from shared_private.ai_jobs a join shared.ai_usage_events u on u.background_job_id=a.id
  where a.app='bob' and a.fingerprint=pending.key and a.context->>'jobId'=pending.execution_id::text order by a.created_at limit 1;
  known:=found;
  if not known and exists(select 1 from shared_private.ai_jobs a where a.app='bob' and a.fingerprint=pending.key
   and a.context->>'jobId'=pending.execution_id::text and a.status='failed' and a.response_id is null) then cost:=0;known:=true; end if;
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


create or replace function bob_private.drawing_request_work_before_screen(p_project text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; result jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select * into r from bob_private.project_drawing_requests where id=p_id and project_id=p_project;
 if not found then return null; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'requirement_key',g.requirement_key,'action',g.action,
  'blocking',g.blocking,'observed_revision',g.observed_revision,'task_id',g.task_id,'task_name',(select name from bob.tasks where id=g.task_id),'step_id',g.step_id) order by g.id),'[]') into result
 from bob_private.drawing_gaps g where g.request_id=p_id;
 return jsonb_build_object('request',bob_private.drawing_request_projection(r),'gaps',result,
  'can_manage',r.owner_user_id=auth.uid(),
  'resume_state',case when r.status in ('saved','cancelled','paused') then r.status
   when exists(select 1 from bob_private.bob_jobs where drawing_request_id=r.id and status in ('queued','running')) then 'running'
   when not exists(select 1 from bob_private.drawing_authorities where request_id=r.id and expires_at>clock_timestamp()) then 'authorization_needed'
   else 'waiting_for_change' end,
  'budget',(select jsonb_build_object('scope',case when b.legacy_request_scope then 'drawing_request' else 'task' end,'legacy_untracked',t.legacy_untracked,'revision',b.revision,
   'call_limit',t.call_limit,'calls',t.calls,'usd_limit',t.usd_limit,'spent_usd',t.spent_usd,
   'outcome_unknown',t.unpriced or exists(select 1 from bob_private.drawing_model_calls c
    join bob_private.project_drawing_requests q on q.id=c.request_id
    left join bob_private.drawing_budgets a on a.request_id=c.request_id and a.period=c.budget_period
    left join bob_private.drawing_budget_periods h on h.request_id=c.request_id and h.period=c.budget_period
    where not c.completed and q.project_id=p_project and q.owner_user_id=r.owner_user_id
     and (c.request_id=p_id or coalesce(a.turn_id,h.turn_id)=b.turn_id)))
   from bob_private.drawing_budgets b cross join lateral (
    select sum(x.calls) calls,sum(x.spent_usd) spent_usd,bool_or(x.unpriced) unpriced,
     bool_or(x.legacy_untracked) legacy_untracked,max(x.call_limit) call_limit,max(x.usd_limit) usd_limit
    from (
     select request_id,period,turn_id,calls,spent_usd,unpriced,legacy_untracked,call_limit,usd_limit from bob_private.drawing_budgets
     union all select request_id,period,turn_id,calls,spent_usd,unpriced,legacy_untracked,call_limit,usd_limit from bob_private.drawing_budget_periods
    ) x join bob_private.project_drawing_requests q on q.id=x.request_id
    where q.project_id=p_project and q.owner_user_id=r.owner_user_id
     and (x.turn_id=b.turn_id or b.turn_id is null and x.request_id=p_id and x.period=b.period)
   ) t where b.request_id=p_id));
end $$;
revoke all on function bob_private.drawing_request_work_before_screen(text,uuid) from public,anon,service_role;
grant execute on function bob_private.drawing_request_work_before_screen(text,uuid) to authenticated;


create or replace function bob.grant_drawing_budget(p_project text,p_id uuid,p_expected integer,p_grant uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; b bob_private.drawing_budgets; task_calls integer; task_spent numeric; task_usd numeric; task_cap integer; task_unknown boolean;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||auth.uid()::text,0));
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found or r.project_id<>p_project or r.owner_user_id is distinct from auth.uid() then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if r.status in ('saved','cancelled') then raise exception 'drawing_request_inactive'; end if;
 select * into b from bob_private.drawing_budgets where request_id=p_id for update;
 if not found or p_grant is null then raise exception 'budget_unavailable'; end if;
 if exists(select 1 from bob_private.drawing_budget_grants where request_id=p_id and grant_id=p_grant and expected=p_expected) then return jsonb_build_object('revision',b.revision); end if;
 if b.revision is distinct from p_expected then raise exception 'budget_changed' using errcode='40001'; end if;
 select coalesce(sum(x.calls),b.calls),coalesce(sum(x.spent_usd),b.spent_usd),
  coalesce(max(x.usd_limit),b.usd_limit),coalesce(max(x.call_limit),b.call_limit),coalesce(bool_or(x.unpriced),b.unpriced)
 into task_calls,task_spent,task_usd,task_cap,task_unknown
 from (
  select request_id,period,turn_id,calls,spent_usd,usd_limit,call_limit,unpriced from bob_private.drawing_budgets
  union all select request_id,period,turn_id,calls,spent_usd,usd_limit,call_limit,unpriced from bob_private.drawing_budget_periods
 ) x join bob_private.project_drawing_requests q on q.id=x.request_id
 where q.project_id=p_project and q.owner_user_id=auth.uid()
  and (x.turn_id=b.turn_id or b.turn_id is null and x.request_id=p_id and x.period=b.period);
 if task_unknown or exists(select 1 from bob_private.drawing_model_calls c
  join bob_private.project_drawing_requests q on q.id=c.request_id
  left join bob_private.drawing_budgets a on a.request_id=c.request_id and a.period=c.budget_period
  left join bob_private.drawing_budget_periods h on h.request_id=c.request_id and h.period=c.budget_period
  where not c.completed and q.project_id=p_project and q.owner_user_id=auth.uid()
   and (c.request_id=p_id or coalesce(a.turn_id,h.turn_id)=b.turn_id)) then raise exception 'budget_outcome_unknown'; end if;
 if task_calls<task_cap and task_spent<task_usd then raise exception 'budget_remaining'; end if;
 -- A deliberately clicked owner grant remains possible. Bob never calls it
 -- automatically, and the next message resets these extra limits as well.
 update bob_private.drawing_budgets set call_limit=task_cap+24,usd_limit=task_usd+1,revision=revision+1 where request_id=p_id returning * into b;
 insert into bob_private.drawing_budget_grants values(p_id,p_grant,p_expected);
 -- Only a cost stop is released by a budget grant; unchanged quality failures
 -- still need changed input or a concrete technical repair.
 update bob_private.drawing_requests set payload=jsonb_set(payload,'{retry,fingerprint}','""'::jsonb),revision=revision+1
 where id=p_id and payload#>>'{retry,outcome,reason}'='turn_budget_exhausted';
 if found then update bob_private.project_drawing_requests set revision=revision+1 where id=p_id; end if;
 insert into bob_private.drawing_project_events(project_id) values(p_project)
 on conflict(project_id) do update set revision=bob_private.drawing_project_events.revision+1;
 return jsonb_build_object('revision',b.revision);
end $$;
revoke all on function bob.grant_drawing_budget(text,uuid,integer,uuid) from public,anon,service_role;
grant execute on function bob.grant_drawing_budget(text,uuid,integer,uuid) to authenticated;

-- The projection contains only stable operational identities and existing links.

commit;
