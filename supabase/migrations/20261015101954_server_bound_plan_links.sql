-- CLI migration new aborted in its native Bun runtime; filename uses observed UTC.
-- Install core, deploy both Bob runtimes, then activate the separate catalog.
begin;
create function bob.read_bob_plan_link_snapshot(p_project text,p_resource text,p_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare head jsonb;rec jsonb;links jsonb:='[]';label text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 select to_jsonb(h) into head from bob.project_plans h where project_id=p_project and current_revision is not null;
 if head is null then return null;end if;
 select name into label from bob.projects where id=p_project;
 case p_resource
 when 'plan' then
  select to_jsonb(r)||jsonb_build_object('id',p_project,'focus_title',s.title) into rec
   from bob.project_plan_revisions r left join bob.project_plan_steps s on s.project_id=p_project and s.plan_revision=r.revision and s.step_id::text=head->>'focus_step_id'
   where r.project_id=p_project and r.revision=(head->>'current_revision')::integer and p_id=p_project;
 when 'steps' then
  select to_jsonb(s)||jsonb_build_object('id',s.step_id,'area_name',a.name) into rec
   from bob.project_plan_steps s left join bob.areas a on a.project_id=s.project_id and a.id=s.area_id
   where s.project_id=p_project and s.plan_revision=(head->>'current_revision')::integer and s.step_id::text=p_id;
 when 'tasks' then
  select to_jsonb(t)||jsonb_build_object('area_name',a.name,'primary_step_title',s.title) into rec
   from bob.tasks t left join bob.areas a on a.project_id=t.project_id and a.id=t.area_id
   left join bob.project_plan_steps s on s.project_id=t.project_id and s.plan_revision=(head->>'current_revision')::integer and s.step_id=t.primary_step_id
   where t.project_id=p_project and t.id=p_id;
  select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('step_title',s.title,'task_name',rec->>'name','primary',l.step_id::text=rec->>'primary_step_id') order by l.step_id),'[]') into links
   from bob.project_plan_step_tasks l join bob.project_plan_steps s on s.project_id=l.project_id and s.step_id=l.step_id and s.plan_revision=(head->>'current_revision')::integer
   where l.project_id=p_project and l.task_id=p_id;
 else raise exception 'invalid_plan_link_resource' using errcode='22023';end case;
 if rec is null then return null;end if;
 return jsonb_build_object('project_id',p_project,'resource',p_resource,'key',p_id,'scope_label','Project: '||label,'head',head,'record',rec,'links',links);
end $$;
revoke all on function bob.read_bob_plan_link_snapshot(text,text,text) from public,anon,service_role;
grant execute on function bob.read_bob_plan_link_snapshot(text,text,text) to authenticated;

create function bob.read_bob_plan_link_context(p_project text,p_resource text,p_query text default null,p_after text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if p_resource is null or p_resource not in ('plan','steps','tasks') or length(p_query)>200 or length(p_after)>200 then raise exception 'invalid_plan_link_context' using errcode='22023';end if;
 with candidates as (
  select p.id,p.name label from bob.projects p join bob.project_plans h on h.project_id=p.id where p_resource='plan' and p.id=p_project and h.current_revision is not null
  union all select s.step_id::text,s.title from bob.project_plan_steps s join bob.project_plans h on h.project_id=s.project_id and h.current_revision=s.plan_revision where p_resource='steps' and s.project_id=p_project
  union all select t.id,t.name from bob.tasks t join bob.project_plans h on h.project_id=t.project_id where p_resource='tasks' and t.project_id=p_project and h.current_revision is not null
 ), page as (select id from candidates where (p_query is null or label ilike '%'||p_query||'%') and (p_after is null or id>p_after) order by id limit 3)
 select coalesce(jsonb_agg(bob.read_bob_plan_link_snapshot(p_project,p_resource,id) order by id),'[]') into result from page;
 return result;
end $$;
revoke all on function bob.read_bob_plan_link_context(text,text,text,text) from public,anon,service_role;
grant execute on function bob.read_bob_plan_link_context(text,text,text,text) to authenticated;

-- Canonical plan commands already lock this head. Also serialize direct service
-- relation writes; no new member write grant is introduced.
create function bob_private.lock_plan_link_parent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from bob.project_plans where project_id in
  (case when tg_op<>'INSERT' then old.project_id end,case when tg_op<>'DELETE' then new.project_id end)
  order by project_id for update;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function bob_private.lock_plan_link_parent() from public,anon,authenticated,service_role;
create trigger bound_plan_link_parent before insert or update or delete on bob.project_plan_step_tasks for each row execute function bob_private.lock_plan_link_parent();

create function bob_private.bob_project_write_v20(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data';domain jsonb:=d->'domain';pins jsonb:=d->'pins';pin jsonb;actual jsonb;op text;result jsonb;msg text;prior_keys text[];saved bob_private.bob_write_receipts;
begin
 if p_payload->>'kind' is distinct from 'bound_plan_link' then return bob_private.bob_project_write_v19(p_project,p_thread,p_turn,p_generation,p_payload);end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}' or (select count(*) from jsonb_object_keys(p_payload))<>6
  or jsonb_typeof(d) is distinct from 'object' or d-array['pins','domain']::text[]<>'{}' or (select count(*) from jsonb_object_keys(d))<>2
  or jsonb_typeof(pins) is distinct from 'array' or jsonb_array_length(pins) not between 1 and 2
  or jsonb_typeof(domain) is distinct from 'object' or coalesce(domain->>'kind','') not in ('plan_focus','plan_task')
  or domain-'kind'-'data' is distinct from p_payload-'kind'-'data' or octet_length(p_payload::text)>180000
  or coalesce(length(p_payload->>'request_quote'),0) not between 1 and 500 or msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'invalid_bound_plan_link' using errcode='22023';end if;
 -- Keep plan -> task ordering used by the canonical command. Lock the selected
 -- Step/revision too so direct service edits cannot race snapshot validation.
 perform 1 from bob.project_plans where project_id=p_project for update;
 op:='bound_plan_link:'||jsonb_build_array(domain->>'kind',domain#>>'{data,action}',domain#>>'{data,step_id}',domain#>>'{data,task_id}',md5(pins::text))::text;
 select * into saved from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then if saved.payload is distinct from p_payload then raise exception 'record_changed' using errcode='40001';end if;return saved.receipt;end if;
 for pin in select value from jsonb_array_elements(pins) order by value->>'resource',value->>'key' loop
  if pin->>'project_id' is distinct from p_project or pin->>'key' is null or pin->>'key' is distinct from pin#>>'{record,id}' then raise exception 'invalid_plan_link_pin' using errcode='22023';end if;
  if pin->>'resource'='plan' then perform 1 from bob.project_plan_revisions where project_id=p_project and revision=(pin#>>'{head,current_revision}')::integer for update;end if;
  if pin->>'resource'='steps' then perform 1 from bob.project_plan_steps where project_id=p_project and plan_revision=(pin#>>'{head,current_revision}')::integer and step_id::text=pin->>'key' for update;end if;
  if pin->>'resource'='tasks' then perform 1 from bob.tasks where project_id=p_project and id=pin->>'key' for update;end if;
  actual:=bob.read_bob_plan_link_snapshot(p_project,pin->>'resource',pin->>'key');
  if actual is null or actual is distinct from pin then raise exception 'record_changed' using errcode='40001';end if;
  if pin#>'{head,current_revision}' is distinct from domain->'expected_revision' then raise exception 'record_changed' using errcode='40001';end if;
 end loop;
 if domain->>'kind'='plan_focus' then
  if jsonb_array_length(pins)<>1 or (case when domain#>>'{data,step_id}' is null then
    pins->0->>'resource'='plan' and pins->0->>'key'=p_project
   else pins->0->>'resource'='steps' and pins->0->>'key'=domain#>>'{data,step_id}' end) is not true then raise exception 'unbound_plan_focus' using errcode='22023';end if;
 else
  if jsonb_array_length(pins)<>2 or pins->0->>'resource' is distinct from 'steps' or pins->0->>'key' is distinct from domain#>>'{data,step_id}'
   or pins->1->>'resource' is distinct from 'tasks' or pins->1->>'key' is distinct from domain#>>'{data,task_id}' then raise exception 'unbound_plan_task' using errcode='22023';end if;
 end if;
 select coalesce(array_agg(operation_key),'{}') into prior_keys from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn;
 result:=bob_private.bob_project_write_v19(p_project,p_thread,p_turn,p_generation,domain);
 update bob_private.bob_write_receipts set operation_key=op,payload=p_payload where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and payload=domain and not(operation_key=any(prior_keys));
 if not found then raise exception 'bound_plan_link_receipt_missing' using errcode='40001';end if;
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v20(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v20(text,uuid,uuid,bigint,jsonb) to authenticated;
create function bob.bob_project_write_v20(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$select bob_private.bob_project_write_v20(p_project,p_thread,p_turn,p_generation,p_payload)$$;
revoke all on function bob.bob_project_write_v20(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.bob_project_write_v20(text,uuid,uuid,bigint,jsonb) to authenticated;
commit;
