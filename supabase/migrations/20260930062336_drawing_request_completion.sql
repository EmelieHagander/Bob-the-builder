-- P2: durable gap identity and request-wide accounting. Private prose remains
-- thread-owned; shared links expose existing domain records, never the assessment.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob_private.project_drawing_requests add column intent_hash text;
create index drawing_request_intent on bob_private.project_drawing_requests(project_id,owner_user_id,intent_hash);

create function bob.resolve_drawing_request(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_id uuid,p_scope jsonb,p_intent text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; result jsonb;
begin
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if p_intent is null or p_intent !~ '^[a-f0-9]{64}$' then raise exception 'invalid_drawing_intent'; end if;
 select * into r from bob_private.project_drawing_requests
 where project_id=p_project and owner_user_id=auth.uid() and scope=p_scope and (intent_hash=p_intent or (status not in ('saved','cancelled') and coalesce(p_scope->>'step_id',p_scope->>'artifact_id') is not null))
 order by created_at,id limit 1 for update;
 if found then return jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'reused',r.id<>p_id); end if;
 result:=bob_private.create_drawing_request(p_project,p_thread,p_turn,p_generation,p_id,p_scope);
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if r.intent_hash is not null and r.intent_hash<>p_intent then raise exception 'drawing_intent_changed'; end if;
 update bob_private.project_drawing_requests set intent_hash=p_intent where id=p_id;
 return result||jsonb_build_object('reused',false);
end $$;
revoke all on function bob.resolve_drawing_request(text,uuid,uuid,bigint,uuid,jsonb,text) from public,anon,service_role;
grant execute on function bob.resolve_drawing_request(text,uuid,uuid,bigint,uuid,jsonb,text) to authenticated;

create table bob_private.drawing_gaps (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references bob_private.project_drawing_requests(id) on delete cascade,
 project_id text not null references bob.projects(id) on delete cascade,
 requirement_key text not null check(length(requirement_key) between 1 and 80),
 action text not null check(action in ('measurement','owner_decision','bob_decision','none')),
 blocking boolean not null,
 observed_revision integer not null,
 task_id text references bob.tasks(id) on delete set null,
 step_id uuid,
 foreign key(project_id,step_id) references bob.project_plan_step_identities(project_id,step_id) on delete set null (step_id),
 unique(request_id,requirement_key)
);
create index drawing_gaps_task on bob_private.drawing_gaps(task_id);
create index drawing_gaps_step on bob_private.drawing_gaps(step_id);
alter table bob_private.drawing_gaps enable row level security;
revoke all on bob_private.drawing_gaps from public,anon,authenticated,service_role;

create table bob_private.drawing_budgets (
 request_id uuid primary key references bob_private.project_drawing_requests(id) on delete cascade,
 call_limit integer not null default 24 check(call_limit between 0 and 240),
 usd_limit numeric not null default 1 check(usd_limit>=0 and usd_limit<=10),
 calls integer not null default 0 check(calls>=0),
 spent_usd numeric not null default 0 check(spent_usd>=0),
 unpriced boolean not null default false,
 legacy_untracked boolean not null default false,
 revision integer not null default 1
);
-- Historical request charges cannot be safely inferred from thread totals.
-- Preserve that uncertainty and require an explicit prospective allocation.
insert into bob_private.drawing_budgets(request_id,call_limit,usd_limit,legacy_untracked)
 select id,0,0,true from bob_private.project_drawing_requests;
create table bob_private.drawing_model_calls (
 request_id uuid not null references bob_private.project_drawing_requests(id) on delete cascade,
 key text not null check(length(key)=64),
 execution_id uuid not null,
 thread_id uuid references bob.bob_threads(id) on delete set null,
 completed boolean not null default false,
 cost_usd numeric check(cost_usd>=0),
 primary key(request_id,key)
);
-- Provider output is private working memory and is erased with its thread.
create table bob_private.drawing_model_results (
 request_id uuid not null,
 key text not null,
 thread_id uuid not null references bob.bob_threads(id) on delete cascade,
 response jsonb not null check(octet_length(response::text)<=300000),
 primary key(request_id,key),
 foreign key(request_id,key) references bob_private.drawing_model_calls(request_id,key) on delete cascade
);
create index drawing_model_calls_thread on bob_private.drawing_model_calls(thread_id);
create index drawing_model_results_thread on bob_private.drawing_model_results(thread_id);
create table bob_private.drawing_budget_grants (
 request_id uuid not null references bob_private.project_drawing_requests(id) on delete cascade,
 grant_id uuid not null,
 expected integer not null,
 primary key(request_id,grant_id)
);
alter table bob_private.drawing_budgets enable row level security;
alter table bob_private.drawing_model_calls enable row level security;
alter table bob_private.drawing_model_results enable row level security;
alter table bob_private.drawing_budget_grants enable row level security;
revoke all on bob_private.drawing_budgets,bob_private.drawing_model_calls,bob_private.drawing_model_results,bob_private.drawing_budget_grants from public,anon,authenticated,service_role;

create function bob.bob_drawing_budget(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_id uuid,p_execution uuid,p_key text,p_operation text,p_response jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; b bob_private.drawing_budgets; c bob_private.drawing_model_calls; result jsonb; cost numeric; unknown_cost boolean; provider shared_private.ai_jobs;
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
 if p_operation='reserve' then
  if found then
   if c.completed then
    select response into result from bob_private.drawing_model_results where request_id=p_id and key=p_key and thread_id=p_thread;
    if result is null and c.thread_id=p_thread then
     select * into provider from shared_private.ai_jobs where app='bob' and fingerprint=p_key and context->>'jobId'=c.execution_id::text and response is not null order by created_at limit 1;
     if found then return jsonb_build_object('status','recover','execution_id',c.execution_id,'recovery',jsonb_build_object('key',provider.operation_key,'context',provider.context,'expiresAt',provider.expires_at)); end if;
    end if;
    return jsonb_build_object('status',case when result is null then 'context_cleared' else 'completed' end,'response',result);
   end if;
   return jsonb_build_object('status',case when c.execution_id=p_execution and exists(select 1 from bob_private.bob_jobs where id=p_execution and async_models and status in ('queued','running') and expires_at>clock_timestamp()) then 'reserved' else 'outcome_unknown' end);
  end if;
  if b.calls>=b.call_limit or b.spent_usd>=b.usd_limit or b.unpriced
   or exists(select 1 from bob_private.drawing_model_calls where request_id=p_id and not completed) then
   return jsonb_build_object('status','budget_exhausted');
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

-- This is an explicit budget allocation, not a replacement work instruction.
create function bob.grant_drawing_budget(p_project text,p_id uuid,p_expected integer,p_grant uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; b bob_private.drawing_budgets;
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
 if b.unpriced or exists(select 1 from bob_private.drawing_model_calls where request_id=p_id and not completed) then raise exception 'budget_outcome_unknown'; end if;
 if b.calls<b.call_limit and b.spent_usd<b.usd_limit then raise exception 'budget_remaining'; end if;
 update bob_private.drawing_budgets set call_limit=call_limit+24,usd_limit=usd_limit+1,revision=revision+1 where request_id=p_id returning * into b;
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
create function bob.drawing_request_work(p_project text,p_id uuid)
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
  'budget',(select jsonb_build_object('legacy_untracked',legacy_untracked,'revision',revision,'call_limit',call_limit,'calls',calls,'usd_limit',usd_limit,'spent_usd',spent_usd,
   'outcome_unknown',unpriced or exists(select 1 from bob_private.drawing_model_calls where request_id=p_id and not completed)) from bob_private.drawing_budgets where request_id=p_id));
end $$;
revoke all on function bob.drawing_request_work(text,uuid) from public,anon,service_role;
grant execute on function bob.drawing_request_work(text,uuid) to authenticated;

create function bob.link_drawing_gap(p_project text,p_id uuid,p_expected integer,p_gap uuid,p_task text,p_step uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; g bob_private.drawing_gaps;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||auth.uid()::text,0));
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found or r.project_id<>p_project or r.owner_user_id is distinct from auth.uid() then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if r.revision is distinct from p_expected or r.status in ('saved','cancelled') then raise exception 'drawing_request_changed' using errcode='40001'; end if;
 select * into g from bob_private.drawing_gaps where id=p_gap and request_id=p_id for update;
 if not found then raise exception 'drawing_gap_missing'; end if;
 if p_task is not null then
  perform 1 from bob.tasks where id=p_task and project_id=p_project for key share;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
 end if;
 if p_step is not null then
  perform 1 from bob.project_plan_step_identities where step_id=p_step and project_id=p_project for key share;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
 end if;
 -- First link wins; repeated deliveries cannot replace someone else's link.
 if (g.task_id is not null and g.task_id is distinct from p_task) or (g.step_id is not null and g.step_id is distinct from p_step) then raise exception 'drawing_gap_already_linked' using errcode='40001'; end if;
 update bob_private.drawing_gaps set task_id=p_task,step_id=p_step where id=p_gap;
 return jsonb_build_object('id',p_gap,'task_id',p_task,'step_id',p_step);
end $$;
revoke all on function bob.link_drawing_gap(text,uuid,integer,uuid,text,uuid) from public,anon,service_role;
grant execute on function bob.link_drawing_gap(text,uuid,integer,uuid,text,uuid) to authenticated;

-- Assessment publication is deliberately limited to keys and operational state.
create function bob_private.sync_drawing_gaps() returns trigger language plpgsql security definer set search_path='' as $$
declare c jsonb;
begin
 if not exists(select 1 from bob_private.project_drawing_requests where id=new.id) then return new; end if;
 if jsonb_typeof(new.payload#>'{assessment,checks}')='array' then
  -- A complete replacement assessment retires vanished needs but keeps stable
  -- IDs and work links should a later assessment find the same need again.
  update bob_private.drawing_gaps set blocking=false,action='none',observed_revision=new.revision
  where request_id=new.id and not exists(select 1 from jsonb_array_elements((new.payload#>'{assessment,checks}')||coalesce(new.payload#>'{assessment,additional_needs}','[]')) needed where needed->>'id'=requirement_key);
  for c in select value from jsonb_array_elements((new.payload#>'{assessment,checks}')||coalesce(new.payload#>'{assessment,additional_needs}','[]')) loop
   if c->>'id' ~ '^[a-zA-Z0-9_-]{1,40}$' and c->>'action' in ('measurement','owner_decision','bob_decision','none') and jsonb_typeof(c->'blocking')='boolean' then
    insert into bob_private.drawing_gaps(request_id,project_id,requirement_key,action,blocking,observed_revision)
    values(new.id,(select project_id from bob_private.project_drawing_requests where id=new.id),c->>'id',c->>'action',(c->>'blocking')::boolean,new.revision)
    on conflict(request_id,requirement_key) do update set action=excluded.action,blocking=excluded.blocking,observed_revision=excluded.observed_revision;
   end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function bob_private.sync_drawing_gaps() from public,anon,authenticated,service_role;
create trigger sync_drawing_gaps after insert or update on bob_private.drawing_requests for each row execute function bob_private.sync_drawing_gaps();

-- Audited event executions continue a REAL originating instruction. They do not
-- insert a user message, mint a JWT or write domain records as service_role.
alter table bob_private.project_drawing_requests add column origin_turn_id uuid,
 add column observed_event bigint not null default 0;
create table bob_private.drawing_project_events (
 project_id text primary key references bob.projects(id) on delete cascade,
 revision bigint not null default 1
);
create table bob_private.drawing_authorities (
 request_id uuid primary key references bob_private.project_drawing_requests(id) on delete cascade,
 thread_id uuid not null references bob.bob_threads(id) on delete cascade,
 credential jsonb not null,
 expires_at timestamptz not null,
 worker_url text not null
);
create index drawing_authorities_thread on bob_private.drawing_authorities(thread_id);
create table bob_private.drawing_attempts (
 id uuid primary key,
 request_id uuid not null references bob_private.project_drawing_requests(id) on delete cascade,
 event_revision bigint not null,
 request_revision integer not null,
 status text not null default 'queued' check(status in ('queued','completed','failed')),
 error_code text,
 created_at timestamptz not null default clock_timestamp()
);
create index drawing_attempts_request on bob_private.drawing_attempts(request_id,created_at);
alter table bob_private.drawing_project_events enable row level security;
alter table bob_private.drawing_authorities enable row level security;
alter table bob_private.drawing_attempts enable row level security;
revoke all on bob_private.drawing_project_events,bob_private.drawing_authorities,bob_private.drawing_attempts from public,anon,authenticated,service_role;
alter table bob_private.bob_jobs add column drawing_request_id uuid references bob_private.project_drawing_requests(id) on delete cascade,
 add column drawing_event_revision bigint not null default 0;
alter table bob_private.bob_jobs drop constraint bob_jobs_project_id_actor_id_turn_id_key;
create unique index bob_jobs_chat_turn on bob_private.bob_jobs(project_id,actor_id,turn_id) where drawing_request_id is null;
create unique index bob_jobs_drawing_active on bob_private.bob_jobs(drawing_request_id) where drawing_request_id is not null and status in ('queued','running');

create function bob_private.signal_drawing_change() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; project text;
begin
 if tg_op='UPDATE' and (to_jsonb(old)-array['updated_at','created_at'])=(to_jsonb(new)-array['updated_at','created_at']) then return new; end if;
 if item->>'project_id' is not null then
  if not exists(select 1 from bob.projects where id=item->>'project_id') then return case when tg_op='DELETE' then old else new end; end if;
  insert into bob_private.drawing_project_events(project_id) values(item->>'project_id')
  on conflict(project_id) do update set revision=bob_private.drawing_project_events.revision+1;
 elsif tg_table_name='projects' then
  if tg_op='DELETE' then return old; end if;
  insert into bob_private.drawing_project_events(project_id) values(item->>'id')
  on conflict(project_id) do update set revision=bob_private.drawing_project_events.revision+1;
 end if;
 if tg_table_name in ('buildings','building_spaces','space_measurements','building_elements','spatial_relationships','building_members') then
  -- Physical truth is Bob-owned but may be shared by multiple explicit scopes.
  for project in select distinct s.project_id from bob.project_physical_scope s
   where s.building_id::text=coalesce(item->>'building_id',case when tg_table_name='buildings' then item->>'id' end)
    or s.space_id::text=coalesce(item->>'space_id',case when tg_table_name='building_spaces' then item->>'id' end)
    or s.element_id::text=coalesce(item->>'element_id',case when tg_table_name='building_elements' then item->>'id' end)
   union select distinct a.project_id from bob.area_physical_targets a
   where a.building_id::text=item->>'building_id' or a.space_id::text=item->>'space_id' loop
   insert into bob_private.drawing_project_events(project_id) values(project)
   on conflict(project_id) do update set revision=bob_private.drawing_project_events.revision+1;
  end loop;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function bob_private.signal_drawing_change() from public,anon,authenticated,service_role;
do $$ declare name text; begin
 foreach name in array array['projects','tasks','measurements','existing_components','project_targets','project_plans','project_plan_evidence','project_plan_step_tasks','material_requirements','stock_items','artifacts','project_physical_scope','area_physical_targets','buildings','building_spaces','space_measurements','building_elements','spatial_relationships'] loop
  execute format('create trigger drawing_source_changed after insert or update or delete on bob.%I for each row execute function bob_private.signal_drawing_change()',name);
 end loop;
end $$;

-- Public-to-owning-user only; used by the authenticated edge boundary to bind
-- renewed ordinary access tokens to the original real instruction.
create function bob.drawing_resume_bindings(p_project text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'turn_id',r.origin_turn_id)),'[]') into result
 from bob_private.project_drawing_requests r where project_id=p_project and owner_user_id=auth.uid()
 and origin_turn_id is not null and thread_id is not null and status not in ('saved','cancelled','paused');
 return result;
end $$;
revoke all on function bob.drawing_resume_bindings(text) from public,anon,service_role;
grant execute on function bob.drawing_resume_bindings(text) to authenticated;

create function bob.bob_renew_drawing_authority(p_project text,p_user uuid,p_id uuid,p_turn uuid,p_credential jsonb,p_expires timestamptz,p_worker_url text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests;
begin
 perform bob_private.bob_assert_server_actor(p_project,p_user);
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||p_user::text,0));
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found or r.project_id<>p_project or r.owner_user_id is distinct from p_user or r.origin_turn_id is distinct from p_turn
  or r.thread_id is null or r.status in ('saved','cancelled','paused') then return false; end if;
 if p_expires is null or p_expires<=clock_timestamp()+interval '30 seconds' or p_expires>clock_timestamp()+interval '20 minutes 5 seconds'
  or p_worker_url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/bob-worker$' or jsonb_typeof(p_credential) is distinct from 'object' then raise exception 'invalid_authority'; end if;
 insert into bob_private.drawing_authorities values(p_id,r.thread_id,p_credential,p_expires,p_worker_url)
 on conflict(request_id) do update set thread_id=excluded.thread_id,credential=excluded.credential,expires_at=excluded.expires_at,worker_url=excluded.worker_url;
 return true;
end $$;
revoke all on function bob.bob_renew_drawing_authority(text,uuid,uuid,uuid,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function bob.bob_renew_drawing_authority(text,uuid,uuid,uuid,jsonb,timestamptz,text) to service_role;

-- Reconcile late provider accounting without re-dispatching a paid call. Raw
-- provider output is consumed only through the normal parser under renewed Auth.
create function bob_private.reconcile_drawing_costs() returns void language plpgsql security definer set search_path='' as $$
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
   update bob_private.drawing_budgets set spent_usd=spent_usd+coalesce(cost,0),unpriced=unpriced or cost is null where request_id=pending.request_id;
   insert into bob_private.drawing_project_events(project_id) values(pending.project_id) on conflict(project_id) do update set revision=bob_private.drawing_project_events.revision+1;
  end if;
 end loop;
end $$;
revoke all on function bob_private.reconcile_drawing_costs() from public,anon,authenticated,service_role;

create function bob_private.queue_drawing_events() returns void language plpgsql security definer set search_path='' as $$
declare candidate record; r bob_private.project_drawing_requests; a bob_private.drawing_authorities; s bob_private.bob_thread_provider_state; j bob_private.bob_jobs; epoch bigint;
begin
 for candidate in select q.id,q.project_id,q.owner_user_id from bob_private.project_drawing_requests q
 join bob_private.drawing_project_events e on e.project_id=q.project_id and e.revision>q.observed_event
 where q.status in ('collecting','ready_to_design','needs_data','retrieval_failed','draft','reviewed') and q.thread_id is not null and q.origin_turn_id is not null
 and exists(select 1 from bob_private.drawing_authorities authority_row where authority_row.request_id=q.id and authority_row.thread_id=q.thread_id and authority_row.expires_at>clock_timestamp()+interval '30 seconds')
 and exists(select 1 from bob.people p where p.project_id=q.project_id and p.auth_user_id=q.owner_user_id)
 and exists(select 1 from bob_private.bob_thread_provider_state state_row where state_row.thread_id=q.thread_id and state_row.in_flight_turn_id is null)
 and not exists(select 1 from bob_private.drawing_budgets b where b.request_id=q.id and (b.unpriced or b.calls>=b.call_limit or b.spent_usd>=b.usd_limit))
 and not exists(select 1 from bob_private.drawing_model_calls c where c.request_id=q.id and not c.completed)
 order by q.updated_at limit 20 loop
  if not pg_try_advisory_xact_lock(hashtextextended(candidate.project_id||':'||candidate.owner_user_id::text,0)) then continue; end if;
  select * into r from bob_private.project_drawing_requests where id=candidate.id for update;
  if r.status not in ('collecting','ready_to_design','needs_data','retrieval_failed','draft','reviewed') or r.thread_id is null then continue; end if;
  if not exists(select 1 from bob.people where project_id=r.project_id and auth_user_id=r.owner_user_id) then
   delete from bob_private.drawing_authorities where request_id=r.id;continue;
  end if;
  select * into a from bob_private.drawing_authorities where request_id=r.id and thread_id=r.thread_id;
  if not found or a.expires_at<=clock_timestamp()+interval '30 seconds' then continue; end if;
  if exists(select 1 from bob_private.drawing_budgets where request_id=r.id and (unpriced or calls>=call_limit or spent_usd>=usd_limit))
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

create function bob_private.drawing_event_claim(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from bob_private.bob_jobs j join bob_private.project_drawing_requests r on r.id=j.drawing_request_id
 where j.project_id=p_project and j.actor_id=p_user and j.thread_id=p_thread and j.turn_id=p_turn and j.generation=p_generation
 and j.status='running' and j.lease_until>clock_timestamp() and j.expires_at>clock_timestamp()
 and r.thread_id=p_thread and r.owner_user_id=p_user and r.status not in ('paused','cancelled'))
$$;
revoke all on function bob_private.drawing_event_claim(text,uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;

alter function bob_private.bob_finish_job(uuid,uuid,text) rename to bob_finish_chat_job;
revoke all on function bob_private.bob_finish_chat_job(uuid,uuid,text) from public,anon,authenticated,service_role;
create function bob_private.bob_finish_job(p_job uuid,p_claim uuid,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs; r bob_private.project_drawing_requests; seq bigint; notice text;
begin
 select * into j from bob_private.bob_jobs where id=p_job;
 if not found or j.drawing_request_id is null then return bob_private.bob_finish_chat_job(p_job,p_claim,p_error); end if;
 perform pg_advisory_xact_lock(hashtextextended(j.project_id||':'||j.actor_id::text,0));
 select * into j from bob_private.bob_jobs where id=p_job for update;
 if j.status not in ('queued','running') or j.claim_token is distinct from p_claim then raise exception 'job_not_claimed' using errcode='40001'; end if;
 select * into r from bob_private.project_drawing_requests where id=j.drawing_request_id;
 update bob_private.bob_thread_provider_state set generation=generation+1,in_flight_turn_id=null,lock_started_at=null,updated_at=clock_timestamp()
 where thread_id=j.thread_id and in_flight_turn_id=j.turn_id and generation=j.generation;
 update bob_private.bob_jobs set status=case when p_error is null then 'completed' else 'failed' end,error_code=p_error,credential=null,claim_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
 update bob_private.drawing_attempts set status=case when p_error is null then 'completed' else 'failed' end,error_code=p_error where id=j.id;
 delete from bob_private.bob_job_steps where job_id=j.id;
 if p_error is null and r.revision>(select request_revision from bob_private.drawing_attempts where id=j.id)
  and exists(select 1 from bob.people where project_id=j.project_id and auth_user_id=j.actor_id) then
  notice:=case when r.status='saved' then 'Ritningen är sparad efter kompletteringen.' else 'Jag har läst det ändrade underlaget. Ritningsuppdraget väntar fortfarande på komplettering; se uppdragets status och länkade uppgifter.' end;
  update bob.bob_threads set next_seq=next_seq+1 where id=j.thread_id returning next_seq-1 into seq;
  insert into bob.bob_messages(thread_id,seq,turn_id,role,text,evidence) values(j.thread_id,seq,j.id,'assistant',notice,
   jsonb_build_object('kind','ai_assessment','references','[]'::jsonb,'sources','[]'::jsonb,'partial',r.status<>'saved','writes',case when r.saved_receipt is null then '[]'::jsonb else jsonb_build_array(r.saved_receipt) end));
 end if;
 return jsonb_build_object('status',case when p_error is null then 'completed' else 'failed' end);
end $$;
revoke all on function bob_private.bob_finish_job(uuid,uuid,text) from public,anon,authenticated;
grant execute on function bob_private.bob_finish_job(uuid,uuid,text) to service_role;

-- Pin the actual originating instruction and its existing short-lived credential
-- when a chat execution checkpoints this request. Never store refresh tokens.
alter function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) rename to bob_drawing_request_before_events;
revoke all on function bob.bob_drawing_request_before_events(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) from public,anon,authenticated,service_role;
create function bob.bob_drawing_request(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_operation text,p_id uuid default null,p_expected integer default 0,p_status text default null,p_payload jsonb default null,p_write_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; j bob_private.bob_jobs;
begin
 result:=bob.bob_drawing_request_before_events(p_project,p_user,p_thread,p_turn,p_generation,p_operation,p_id,p_expected,p_status,p_payload,p_write_key);
 if p_operation='save' and exists(select 1 from bob_private.project_drawing_requests where id=p_id) then
  select * into j from bob_private.bob_jobs where project_id=p_project and actor_id=p_user and thread_id=p_thread and turn_id=p_turn and status in ('queued','running') order by drawing_request_id nulls first limit 1;
  delete from bob_private.drawing_authorities a using bob_private.project_drawing_requests r where a.request_id=r.id and r.id=p_id and r.origin_turn_id is distinct from p_turn;
  update bob_private.project_drawing_requests set origin_turn_id=p_turn,
   observed_event=greatest(observed_event,case when j.drawing_request_id is not null then j.drawing_event_revision else coalesce(j.drawing_event_revision,(select revision from bob_private.drawing_project_events where project_id=p_project),0) end) where id=p_id;
  if j.credential is not null and j.drawing_request_id is null then
   insert into bob_private.drawing_authorities values(p_id,p_thread,j.credential,j.expires_at,j.worker_url)
   on conflict(request_id) do update set thread_id=excluded.thread_id,credential=excluded.credential,expires_at=excluded.expires_at,worker_url=excluded.worker_url;
  end if;
 end if;
 return result;
end $$;
revoke all on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function bob.bob_drawing_request(text,uuid,uuid,uuid,bigint,text,uuid,integer,text,jsonb,text) to service_role;

create or replace function bob_private.bob_assert_write_claim(p_project text,p_thread uuid,p_turn uuid,p_generation bigint)
returns void language plpgsql security definer set search_path='' as $$
declare t bob.bob_threads; s bob_private.bob_thread_provider_state;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project || ':' || auth.uid()::text,0));
  select * into t from bob.bob_threads where id=p_thread and project_id=p_project
    and owner_user_id=auth.uid() and status='active' for update;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  select * into s from bob_private.bob_thread_provider_state where thread_id=t.id for update;
  if not found or s.in_flight_turn_id is distinct from p_turn
    or s.generation is distinct from p_generation
    or s.lock_started_at < clock_timestamp()-interval '5 minutes'
    or (not bob_private.drawing_event_claim(p_project,auth.uid(),p_thread,p_turn,p_generation) and not exists(select 1 from bob.bob_messages where thread_id=t.id and turn_id=p_turn
      and role='user' and delivery_state='pending')) then
    raise exception 'turn_not_claimed' using errcode='40001';
  end if;
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
end $$;

create or replace function bob_private.bob_assert_context_claim(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint)
returns void language plpgsql security definer set search_path='' as $$
declare s bob_private.bob_thread_provider_state;
begin
  perform bob_private.bob_assert_server_actor(p_project,p_user);
  perform pg_advisory_xact_lock(hashtextextended(p_project||':'||p_user::text,0));
  perform 1 from bob.bob_threads where id=p_thread and project_id=p_project and owner_user_id=p_user and status='active' for update;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  select * into s from bob_private.bob_thread_provider_state where thread_id=p_thread for update;
  if not found or s.generation is distinct from p_generation or s.in_flight_turn_id is distinct from p_turn
    or s.lock_started_at < clock_timestamp()-interval '5 minutes'
    or (not bob_private.drawing_event_claim(p_project,p_user,p_thread,p_turn,p_generation) and not exists(select 1 from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user' and delivery_state='pending')) then
    raise exception 'turn_not_claimed' using errcode='40001';
  end if;
  perform bob_private.bob_assert_server_actor(p_project,p_user);
end $$;

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
  if j.drawing_request_id is null and exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=j.turn_id and role='assistant' and delivery_state='completed') then
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
    'expiresAt',j.expires_at,'entries',steps,'asyncModels',j.async_models,'drawingRequestId',j.drawing_request_id);
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

create or replace function bob_private.bob_enqueue_job(p_project text,p_user uuid,p_turn uuid,p_message text,p_credential jsonb,p_expires timestamptz,p_worker_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb; j bob_private.bob_jobs;
begin
  perform bob_private.bob_assert_server_actor(p_project,p_user);
  perform pg_advisory_xact_lock(hashtextextended(p_project || ':' || p_user::text,0));
  select * into j from bob_private.bob_jobs where project_id=p_project and actor_id=p_user and turn_id=p_turn and drawing_request_id is null for update;
  if found then
    if not exists(select 1 from bob.bob_messages where thread_id=j.thread_id and turn_id=p_turn and role='user' and text=p_message) then
      raise exception 'turn_reused' using errcode='22023';
    end if;
    if j.status in ('queued','running') and j.expires_at<=clock_timestamp() then
      perform bob_private.bob_finish_job(j.id,j.claim_token,'background_expired');
      select * into j from bob_private.bob_jobs where id=j.id;
    end if;
    if j.status in ('queued','running') then
      return jsonb_build_object('status','accepted','jobId',j.id,'expiresAt',j.expires_at);
    end if;
    -- An explicit retry uses the same turn and the ordinary write-recovery path.
    if j.status='failed' then delete from bob_private.bob_jobs where id=j.id; end if;
  end if;
  c:=bob.bob_claim_turn(p_project,p_user,p_turn,p_message);
  if c->>'mode'='local_only' or c->>'status'<>'claimed' then return c; end if;
  if to_regnamespace('cron') is null or to_regnamespace('net') is null then raise exception 'background_not_configured'; end if;
  if p_expires<=clock_timestamp()+interval '30 seconds' or p_worker_url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/bob-worker$'
    or jsonb_typeof(p_credential)<>'object' then raise exception 'invalid_job' using errcode='22023'; end if;
  insert into bob_private.bob_jobs(project_id,actor_id,thread_id,turn_id,generation,credential,worker_url,expires_at)
    values(p_project,p_user,(c->>'thread_id')::uuid,p_turn,(c->>'generation')::bigint,p_credential,p_worker_url,
      least(p_expires,clock_timestamp()+interval '20 minutes')) returning * into j;
  return jsonb_build_object('status','accepted','jobId',j.id,'expiresAt',j.expires_at);
end $$;

create or replace function bob_private.bob_job_status(p_project text,p_turn uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j bob_private.bob_jobs;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select * into j from bob_private.bob_jobs where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and drawing_request_id is null;
  if not found then return null; end if;
  return jsonb_build_object('status',case when j.status in ('queued','running') and j.expires_at<=clock_timestamp() then 'failed' else j.status end,
    'expiresAt',j.expires_at,'error',j.error_code,
    'progress',case when j.status in ('queued','running') then j.progress else null end);
end $$;

create or replace function bob_private.pin_ai_transport() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.async_models:=exists(select 1 from shared_private.ai_receivers where app='bob' and name='bob' and enabled);
 if new.drawing_request_id is null then new.drawing_event_revision:=coalesce((select revision from bob_private.drawing_project_events where project_id=new.project_id),0); end if;
 return new;
end $$;

create function bob.drawing_work_list(p_project text,p_after uuid default null,p_task text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; cursor_id uuid;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(bob.drawing_request_work(p_project,r.id) order by r.id),'[]') into result
 from (select q.id from bob_private.project_drawing_requests q where project_id=p_project and (p_after is null or q.id>p_after)
 and (p_task is null or exists(select 1 from bob_private.drawing_gaps g where g.request_id=q.id and g.task_id=p_task)) order by q.id limit 20) r;
 if jsonb_array_length(result)=20 then cursor_id:=(result->19#>>'{request,id}')::uuid; end if;
 return jsonb_build_object('items',result,'next_cursor',cursor_id);
end $$;
revoke all on function bob.drawing_work_list(text,uuid,text) from public,anon,service_role;
grant execute on function bob.drawing_work_list(text,uuid,text) to authenticated;

-- Atomic follow-up creation can only copy ALREADY SHARED canonical requirement
-- text. A private-only need remains a chat complement or links an existing Task.
create table bob_private.drawing_requirement_tasks (
 project_id text not null references bob.projects(id) on delete cascade,
 requirement_id uuid not null,
 task_id text not null references bob.tasks(id) on delete cascade,
 primary key(project_id,requirement_id)
);
create index drawing_requirement_tasks_task on bob_private.drawing_requirement_tasks(task_id);
alter table bob_private.drawing_requirement_tasks enable row level security;
revoke all on bob_private.drawing_requirement_tasks from public,anon,authenticated,service_role;
create function bob.ensure_drawing_gap_task(p_project text,p_id uuid,p_expected integer,p_gap uuid,p_requirement uuid,p_plan_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r bob_private.project_drawing_requests; g bob_private.drawing_gaps; q bob.project_plan_requirements; task text; saved jsonb; packet jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||auth.uid()::text,0));
 select * into r from bob_private.project_drawing_requests where id=p_id for update;
 if not found or r.project_id<>p_project or r.owner_user_id is distinct from auth.uid() then raise exception 'drawing_request_denied' using errcode='42501'; end if;
 if r.revision is distinct from p_expected or r.status in ('saved','cancelled','paused') then raise exception 'drawing_request_changed' using errcode='40001'; end if;
 select * into g from bob_private.drawing_gaps where id=p_gap and request_id=p_id for update;
 if not found then raise exception 'drawing_gap_missing'; end if;
 if g.task_id is not null then return jsonb_build_object('id',g.id,'task_id',g.task_id,'step_id',g.step_id,'reused',true); end if;
 -- Match the canonical task ownership lock order, then fence the selected plan.
 perform 1 from bob.projects where id=p_project for no key update;
 perform 1 from bob.project_plans where project_id=p_project and current_revision=p_plan_revision for share;
 if not found then raise exception 'drawing_requirements_changed' using errcode='40001'; end if;
 select * into q from bob.project_plan_requirements where project_id=p_project and plan_revision=p_plan_revision and requirement_id=p_requirement;
 if not found or (r.scope->>'step_id' is not null and r.scope->>'step_id'<>q.step_id::text) then raise exception 'drawing_scope_changed'; end if;
 select payload into packet from bob_private.drawing_requests where id=p_id and thread_id=r.thread_id;
 if not exists(select 1 from jsonb_array_elements(packet#>'{brief,handoff,requirements}') item
  where item->>'id'=g.requirement_key and item->>'basis'='project_record' and item->>'source_ref'=p_requirement::text) then raise exception 'canonical_requirement_required'; end if;
 select task_id into task from bob_private.drawing_requirement_tasks where project_id=p_project and requirement_id=p_requirement;
 if task is null then
  saved:=bob_private.create_work_task(p_project,q.step_id,null,q.title,'novice','');task:=saved->>'id';
  update bob.tasks set instructions=q.description where id=task;
  insert into bob_private.drawing_requirement_tasks values(p_project,p_requirement,task);
 end if;
 update bob_private.drawing_gaps set task_id=task,step_id=q.step_id where id=p_gap;
 return jsonb_build_object('id',p_gap,'task_id',task,'step_id',q.step_id,'reused',saved is null);
end $$;
revoke all on function bob.ensure_drawing_gap_task(text,uuid,integer,uuid,uuid,integer) from public,anon,service_role;
grant execute on function bob.ensure_drawing_gap_task(text,uuid,integer,uuid,uuid,integer) to authenticated;

create table bob_private.drawing_project_runtime (
 project_id text primary key references bob.projects(id) on delete cascade,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$')
);
alter table bob_private.drawing_project_runtime enable row level security;
revoke all on bob_private.drawing_project_runtime from public,anon,authenticated,service_role;
create function bob.bob_observe_drawing_runtime(p_project text,p_user uuid,p_fingerprint text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform bob_private.bob_assert_server_actor(p_project,p_user);
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||p_user::text,0));
 insert into bob_private.drawing_project_runtime values(p_project,p_fingerprint)
 on conflict(project_id) do update set fingerprint=excluded.fingerprint where bob_private.drawing_project_runtime.fingerprint<>excluded.fingerprint;
 if found then
  insert into bob_private.drawing_project_events(project_id) values(p_project)
  on conflict(project_id) do update set revision=bob_private.drawing_project_events.revision+1;
 end if;
end $$;
revoke all on function bob.bob_observe_drawing_runtime(text,uuid,text) from public,anon,authenticated;
grant execute on function bob.bob_observe_drawing_runtime(text,uuid,text) to service_role;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('ensure_drawing_gap_task','Reuse or create a Task for a canonical drawing requirement.','Read stable request/gap IDs and the current Plan revision first. The gap must reference an already shared canonical requirement. Reuses the requirement Task atomically across repeated calls and requests; never copies private collector text.',1,false,'{}',true),
 ('read_drawing_request_work','Read durable drawing gaps, Task/Step links and request budget.','Read before creating follow-up Tasks. Reuse stable gaps and existing links. Task completion does not replace source measurements. Private assessment text is not published.',1,false,'{}',true),
 ('link_drawing_gap','Link a drawing gap to existing project work.','Read the request revision and stable gap ID first. Use exact existing Task and Step IDs. Repeated linking is idempotent; existing links cannot be silently replaced. Do not publish private collector prose.',1,false,'{}',true);
notify pgrst,'reload schema';
commit;
