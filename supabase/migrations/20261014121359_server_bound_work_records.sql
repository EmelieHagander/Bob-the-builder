-- Install core, deploy both runtimes, then publish the separate tool catalog.
begin;
create function bob.read_bob_work_snapshot(p_project text,p_resource text,p_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare rec jsonb; relations jsonb:='{}';scope_label text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 case p_resource
 when 'project' then select to_jsonb(r) into rec from bob.projects r where r.id=p_project and r.id=p_id;
 when 'areas' then select to_jsonb(r) into rec from bob.areas r where r.project_id=p_project and r.id=p_id;
 when 'tasks' then
  select to_jsonb(r) into rec from bob.tasks r where r.project_id=p_project and r.id=p_id;
  select jsonb_build_object('people',coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.id),'[]')) into relations
   from bob.task_assignees a join bob.people p on p.id=a.person_id and p.project_id=p_project where a.task_id=p_id;
  relations:=relations||jsonb_build_object(
   'needs',coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from bob.task_needs n where n.project_id=p_project and n.task_id=p_id),'[]'),
   'dependencies',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from bob.task_dependency_status d where d.project_id=p_project and d.task_id=p_id),'[]'),
   'instructions',coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from bob.task_steps i where i.project_id=p_project and i.task_id=p_id),'[]'),
   'readiness',(select to_jsonb(r) from bob.current_task_readiness r where r.project_id=p_project and r.task_id=p_id));
 when 'measurements' then select to_jsonb(r) into rec from bob.current_measurements r where r.project_id=p_project and r.id::text=p_id;
 when 'build_days' then
  select to_jsonb(r) into rec from bob.events r where r.project_id=p_project and r.id=p_id;
  select jsonb_build_object('tasks',coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.id),'[]')) into relations
   from bob.event_tasks a join bob.tasks t on t.id=a.task_id and t.project_id=p_project where a.project_id=p_project and a.event_id=p_id;
 when 'people' then select to_jsonb(r) into rec from bob.people r where r.project_id=p_project and r.id=p_id;
 when 'plan_steps' then select to_jsonb(r)||jsonb_build_object('id',r.step_id) into rec from bob.project_plan_steps r join bob.project_plans h on h.project_id=r.project_id and h.current_revision=r.plan_revision where r.project_id=p_project and r.step_id::text=p_id;
 when 'components' then select to_jsonb(r) into rec from bob.current_components r where r.project_id=p_project and r.id::text=p_id;
 when 'shopping' then select to_jsonb(r) into rec from bob.materials r where r.project_id=p_project and r.id=p_id;
 else raise exception 'invalid_work_resource' using errcode='22023';end case;
 if rec is null then return null;end if;
 select 'Project: '||name into scope_label from bob.projects where id=p_project;
 if rec->>'area_id' is not null then select scope_label||' / Area: '||name into scope_label from bob.areas where project_id=p_project and id=rec->>'area_id';end if;
 if rec->>'primary_step_id' is not null then select scope_label||' / Step: '||s.title into scope_label from bob.project_plan_steps s join bob.project_plans h on h.project_id=s.project_id and h.current_revision=s.plan_revision where s.project_id=p_project and s.step_id::text=rec->>'primary_step_id';end if;
 if rec->>'component_id' is not null then select coalesce(scope_label,'Project')||' / Component: '||name into scope_label from bob.current_components where project_id=p_project and id::text=rec->>'component_id';end if;
 return jsonb_build_object('project_id',p_project,'resource',p_resource,'key',p_id,'scope_label',coalesce(scope_label,'Project'),'record',rec,'relations',relations);
end $$;
revoke all on function bob.read_bob_work_snapshot(text,text,text) from public,anon,service_role;
grant execute on function bob.read_bob_work_snapshot(text,text,text) to authenticated;
create function bob.read_bob_work_context(p_project text,p_resource text,p_query text default null,p_after text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if p_resource is null or p_resource not in ('project','areas','tasks','measurements','build_days','people','plan_steps','components','shopping') or length(p_query)>200 or length(p_after)>200 then raise exception 'invalid_work_context' using errcode='22023';end if;
 with candidates as (
  select id::text,name label from bob.projects where p_resource='project' and id=p_project
  union all select id,name from bob.areas where p_resource='areas' and project_id=p_project
  union all select id,name from bob.tasks where p_resource='tasks' and project_id=p_project
  union all select id::text,subject from bob.current_measurements where p_resource='measurements' and project_id=p_project
  union all select id,title from bob.events where p_resource='build_days' and project_id=p_project
  union all select id,name from bob.people where p_resource='people' and project_id=p_project
  union all select s.step_id::text,s.title from bob.project_plan_steps s join bob.project_plans h on h.project_id=s.project_id and h.current_revision=s.plan_revision where p_resource='plan_steps' and s.project_id=p_project
  union all select id::text,name from bob.current_components where p_resource='components' and project_id=p_project
  union all select id,name from bob.materials where p_resource='shopping' and project_id=p_project
 ), page as (select id from candidates where (p_query is null or label ilike '%'||p_query||'%') and (p_after is null or id>p_after) order by id limit 3)
 select coalesce(jsonb_agg(bob.read_bob_work_snapshot(p_project,p_resource,id) order by id),'[]') into result from page;
 return result;
end $$;
revoke all on function bob.read_bob_work_context(text,text,text,text) from public,anon,service_role;
grant execute on function bob.read_bob_work_context(text,text,text,text) to authenticated;

-- Direct UI/volunteer relation writes must serialize with full-set replacements.
-- Locking the parent also covers insertion into an empty relation set.
create function bob_private.lock_work_relation_parent() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='task_assignees' then
  if tg_op<>'INSERT' then perform 1 from bob.tasks where id=old.task_id for update;end if;
  if tg_op<>'DELETE' then perform 1 from bob.tasks where id=new.task_id for update;end if;
 else
  if tg_op<>'INSERT' then perform 1 from bob.events where id=old.event_id for update;end if;
  if tg_op<>'DELETE' then perform 1 from bob.events where id=new.event_id for update;end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function bob_private.lock_work_relation_parent() from public,anon,authenticated,service_role;
create trigger work_relation_parent before insert or update or delete on bob.task_assignees for each row execute function bob_private.lock_work_relation_parent();
create trigger work_relation_parent before insert or update or delete on bob.event_tasks for each row execute function bob_private.lock_work_relation_parent();

create function bob_private.bob_project_write_v19(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data';domain jsonb:=d->'domain';pins jsonb:=d->'pins';pin jsonb;actual jsonb;op text;result jsonb;msg text;prior_keys text[];saved bob_private.bob_write_receipts;
begin
 if p_payload->>'kind' is distinct from 'bound_work' then return bob_private.bob_project_write_v18(p_project,p_thread,p_turn,p_generation,p_payload);end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}' or (select count(*) from jsonb_object_keys(p_payload))<>6
  or jsonb_typeof(d) is distinct from 'object' or d-array['pins','domain']::text[]<>'{}' or jsonb_typeof(pins) is distinct from 'array' or jsonb_array_length(pins) not between 1 and 3
  or jsonb_typeof(domain) is distinct from 'object' or domain->>'kind' is null or domain->>'kind' not in ('area','task','measurement','measurement_state','task_work','operational','lifecycle')
  or domain-'kind'-'data' is distinct from p_payload-'kind'-'data' or octet_length(p_payload::text)>180000
  or coalesce(length(p_payload->>'request_quote'),0) not between 1 and 500 or msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'invalid_bound_work' using errcode='22023';end if;
 if domain->>'kind'='operational' and coalesce(domain#>>'{data,resource}','') not in ('build_day','task_work') then raise exception 'invalid_bound_work' using errcode='22023';end if;
 if domain->>'kind'='lifecycle' and coalesce(domain#>>'{data,action}','') not in ('archive_area','restore_area','delete_task','delete_build_day','delete_shopping_item','set_project_phase','set_area_phase','set_schedule') then raise exception 'invalid_bound_work' using errcode='22023';end if;
 perform 1 from bob.projects where id=p_project for no key update;
 if domain->>'kind'='operational' and domain#>>'{data,resource}'='task_work' then
  op:='bound_work:readiness:'||jsonb_build_array(domain#>>'{data,task_id}',domain#>>'{data,action}',domain->>'record_id',md5(pins::text),
   case when domain#>>'{data,action}'='add_need' then lower(btrim(domain#>>'{data,fields,label}'))
    when domain#>>'{data,action}'='add_dependency' then jsonb_build_array(domain#>>'{data,fields,prerequisite_task_id}',domain#>>'{data,fields,prerequisite_step_id}')::text else md5(pins::text) end)::text;
 elsif domain->>'record_id' is null then
  op:='bound_work:new:'||jsonb_build_array(domain->>'kind',pins->0->>'resource',pins->0->>'key',lower(btrim(coalesce(domain#>>'{data,name}',domain#>>'{data,subject}',domain#>>'{data,fields,title}'))))::text;
 else
  op:='bound_work:'||jsonb_build_array(domain->>'kind',domain->>'record_id',md5(pins::text))::text;
 end if;
 select * into saved from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then if saved.payload is distinct from p_payload then raise exception 'record_changed' using errcode='40001';end if;return saved.receipt;end if;
 for pin in select value from jsonb_array_elements(pins) order by value->>'resource',value->>'key' loop
  if pin->>'project_id' is distinct from p_project or pin->>'key' is null or pin->>'key' is distinct from pin#>>'{record,id}' then raise exception 'invalid_work_pin' using errcode='22023';end if;
  case pin->>'resource'
  when 'project' then perform 1 from bob.projects where id=p_project and id=pin->>'key' for update;
  when 'areas' then perform 1 from bob.areas where project_id=p_project and id=pin->>'key' for update;
  when 'tasks' then
   perform 1 from bob.tasks where project_id=p_project and id=pin->>'key' for update;
   perform 1 from bob.task_steps where project_id=p_project and task_id=pin->>'key' order by id for share;
  when 'measurements' then perform 1 from bob.measurements where project_id=p_project and id::text=pin->>'key' for update;
  when 'build_days' then perform 1 from bob.events where project_id=p_project and id=pin->>'key' for update;
  when 'people' then perform 1 from bob.people where project_id=p_project and id=pin->>'key' for share;
  when 'plan_steps' then perform 1 from bob.project_plans where project_id=p_project for share;
  when 'components' then perform 1 from bob.existing_components where project_id=p_project and id::text=pin->>'key' for share;
  when 'shopping' then perform 1 from bob.materials where project_id=p_project and id=pin->>'key' for update;
  else raise exception 'invalid_work_pin' using errcode='22023';end case;
  actual:=bob.read_bob_work_snapshot(p_project,pin->>'resource',pin->>'key');
  if actual is null or actual is distinct from pin then raise exception 'record_changed' using errcode='40001';end if;
 end loop;
 -- Every existing destination must be among the exact locked snapshots.
 if not (domain->>'kind'='operational' and domain#>>'{data,resource}'='task_work') and domain->>'record_id' is not null and not exists(select 1 from jsonb_array_elements(pins) p where p->>'key'=domain->>'record_id' and p->>'resource'=case domain->>'kind'
  when 'area' then 'areas' when 'task' then 'tasks' when 'task_work' then 'tasks' when 'measurement' then 'measurements' when 'measurement_state' then 'measurements' when 'operational' then 'build_days'
  else case domain#>>'{data,action}' when 'archive_area' then 'areas' when 'restore_area' then 'areas' when 'set_area_phase' then 'areas' when 'delete_task' then 'tasks' when 'delete_build_day' then 'build_days' when 'delete_shopping_item' then 'shopping' else 'project' end end)
 then raise exception 'unbound_work_target' using errcode='22023';end if;
 if domain->>'kind'='operational' and domain#>>'{data,resource}'='task_work' then
  pin:=pins->0;
  if pin->>'resource' is distinct from 'tasks' or pin->>'key' is distinct from domain#>>'{data,task_id}' then raise exception 'unbound_work_target' using errcode='22023';end if;
  if domain->>'record_id' is not null and not exists(select 1 from jsonb_array_elements(case when domain#>>'{data,action}'='remove_dependency' then pin#>'{relations,dependencies}' else pin#>'{relations,needs}' end) n where n->>'id'=domain->>'record_id') then raise exception 'unbound_readiness_item' using errcode='22023';end if;
  if domain#>>'{data,action}'='add_dependency' and not exists(select 1 from jsonb_array_elements(pins) p where p->>'resource'='tasks' and p->>'key'=domain#>>'{data,fields,prerequisite_task_id}' and (domain#>>'{data,fields,prerequisite_step_id}' is null or exists(select 1 from jsonb_array_elements(p#>'{relations,instructions}') i where i->>'id'=domain#>>'{data,fields,prerequisite_step_id}'))) then raise exception 'unbound_prerequisite' using errcode='22023';end if;
 elsif domain->>'record_id' is null then
  pin:=pins->0;
  if domain->>'kind'='task' then
   if (pin->>'resource'='areas' and pin->>'key'=domain#>>'{data,area_id}' and domain#>>'{data,step_id}' is null
    or pin->>'resource'='plan_steps' and pin->>'key'=domain#>>'{data,step_id}') is not true then raise exception 'unbound_work_scope' using errcode='22023';end if;
  elsif domain->>'kind'='measurement' then
   if (pin->>'resource'='project' and domain#>>'{data,area_id}' is null and domain#>>'{data,component_id}' is null
    or pin->>'resource'='areas' and pin->>'key'=domain#>>'{data,area_id}' and domain#>>'{data,component_id}' is null
    or pin->>'resource'='components' and pin->>'key'=domain#>>'{data,component_id}') is not true then raise exception 'unbound_work_scope' using errcode='22023';end if;
  elsif domain->>'kind' in ('area','operational') then
   if pin->>'resource' is distinct from 'project' then raise exception 'unbound_work_scope' using errcode='22023';end if;
  else raise exception 'invalid_bound_create' using errcode='22023';end if;
  if pin#>>'{record,archived_at}' is not null or pin#>>'{record,archived}'='true' then raise exception 'scope_changed' using errcode='40001';end if;
 end if;
 select coalesce(array_agg(operation_key),'{}') into prior_keys from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn;
 result:=bob_private.bob_project_write_v18(p_project,p_thread,p_turn,p_generation,domain);
 update bob_private.bob_write_receipts set operation_key=op,payload=p_payload where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and payload=domain and not(operation_key=any(prior_keys));
 if not found then raise exception 'bound_work_receipt_missing' using errcode='40001';end if;
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v19(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v19(text,uuid,uuid,bigint,jsonb) to authenticated;
create function bob.bob_project_write_v19(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$select bob_private.bob_project_write_v19(p_project,p_thread,p_turn,p_generation,p_payload)$$;
revoke all on function bob.bob_project_write_v19(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.bob_project_write_v19(text,uuid,uuid,bigint,jsonb) to authenticated;
commit;
