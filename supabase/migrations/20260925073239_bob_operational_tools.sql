begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- A scheduled Task keeps one identity/status even when it spans build days.
create table bob.event_tasks (
  project_id text not null references bob.projects(id) on delete cascade,
  event_id text not null references bob.events(id) on delete cascade,
  task_id text not null references bob.tasks(id) on delete cascade,
  primary key(event_id,task_id)
);
create index event_tasks_project on bob.event_tasks(project_id,event_id);
create index event_tasks_task on bob.event_tasks(task_id);
alter table bob.event_tasks enable row level security;
revoke all on bob.event_tasks from public,anon,authenticated;
grant select on bob.event_tasks to authenticated;
create policy project_read on bob.event_tasks for select to authenticated using(bob_private.has_project_access(project_id));

create function bob.read_project_work(p_project text,p_input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' set join_collapse_limit=1 set from_collapse_limit=1 as $$
declare resource text:=p_input->>'resource'; rid text:=p_input->>'record_id'; cursor_id text:=p_input->>'after_id'; rows jsonb; page jsonb; more boolean;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_input-array['resource','record_id','after_id']<>'{}'
  or (select count(*) from jsonb_object_keys(p_input))<>3 or coalesce(resource,'') not in ('task_work','stock','requirement','shopping','build_day')
  or coalesce(length(rid),0)>200 or coalesce(length(cursor_id),0)>200 then raise exception 'invalid_read' using errcode='22023'; end if;
 if resource='task_work' then
  select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object(
   'readiness',(select to_jsonb(r) from bob.current_task_readiness r where r.project_id=p_project and r.task_id=t.id),
   'dependencies',coalesce((select jsonb_agg(d) from bob.task_dependency_status d where d.project_id=p_project and d.task_id=t.id),'[]'),
   'needs',coalesce((select jsonb_agg(n order by n.id) from bob.task_needs n where n.project_id=p_project and n.task_id=t.id),'[]'),
   'materials',coalesce((select jsonb_agg(m) from bob.task_material_readiness m where m.project_id=p_project and m.task_id=t.id),'[]')
  ) order by t.id),'[]') into rows from (select id,project_id,name,status,updated_at from bob.tasks
   where project_id=p_project and (rid is null or id=rid) and (cursor_id is null or id>cursor_id) order by id limit 26) t;
 elsif resource='stock' then
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') into rows from (select * from bob.current_stock_items
   where project_id=p_project and (rid is null or id::text=rid) and (cursor_id is null or id::text>cursor_id) order by id::text limit 26) s;
 elsif resource='requirement' then
  select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
   'stock_allocations',coalesce((select jsonb_agg(jsonb_build_object('id',s.stock_id,'revision',s.stock_revision,'quantity',s.quantity)) from bob.material_requirement_stock s where s.project_id=p_project and s.requirement_id=r.id and s.requirement_revision=r.revision),'[]'),
   'component_allocations',coalesce((select jsonb_agg(jsonb_build_object('id',c.component_id,'revision',c.component_revision,'quantity',c.quantity)) from bob.material_requirement_components c where c.project_id=p_project and c.requirement_id=r.id and c.requirement_revision=r.revision),'[]')
  ) order by r.id),'[]') into rows from (select * from bob.current_material_requirements
   where project_id=p_project and (rid is null or id::text=rid) and (cursor_id is null or id::text>cursor_id) order by id::text limit 26) r;
 elsif resource='shopping' then
  select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') into rows from (select * from bob.materials
   where project_id=p_project and (rid is null or id=rid) and (cursor_id is null or id>cursor_id) order by id limit 26) m;
 else
  select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('task_ids',coalesce((select jsonb_agg(t.task_id order by t.task_id) from bob.event_tasks t where t.project_id=p_project and t.event_id=e.id),'[]')) order by e.id),'[]')
  into rows from (select * from bob.events where project_id=p_project and (rid is null or id=rid) and (cursor_id is null or id>cursor_id) order by id limit 26) e;
 end if;
 more:=jsonb_array_length(rows)>25;
 select coalesce(jsonb_agg(value order by ordinality),'[]') into page from jsonb_array_elements(rows) with ordinality where ordinality<=25;
 if octet_length(page::text)>500000 then raise exception 'record_too_large' using errcode='22023'; end if;
 return jsonb_build_object('projectId',p_project,'resource',resource,'records',page,'truncated',more,'next_cursor',case when more then page->24->>'id' else null end);
end $$;
revoke all on function bob.read_project_work(text,jsonb) from public,anon;
grant execute on function bob.read_project_work(text,jsonb) to authenticated;

create function bob_private.bob_project_write_v12(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; f jsonb:=d->'fields'; resource text:=d->>'resource'; action text:=d->>'action'; rid text:=p_payload->>'record_id';
 quote text:=p_payload->>'request_quote'; msg text; op text; existing bob_private.bob_write_receipts; expected integer; saved jsonb; rec jsonb; result jsonb; ds text;
 item uuid; evt bob.events; before_row jsonb; task text:=d->>'task_id';
begin
 if p_payload->>'kind' is distinct from 'operational' then return bob_private.bob_project_write_v11(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or octet_length(p_payload::text)>32000
  or jsonb_typeof(d) is distinct from 'object' or d-array['resource','action','fields','task_id']<>'{}' or jsonb_typeof(f) is distinct from 'object'
  or coalesce(resource,'') not in ('task_work','stock','requirement','cad_requirement','build_day')
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or coalesce(length(quote),0) not between 1 and 500
  or coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$'
  or (resource<>'build_day' and p_payload->'expected_updated_at' is distinct from 'null'::jsonb) then raise exception 'invalid_write' using errcode='22023'; end if;
 expected:=(p_payload->>'expected_revision')::integer;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(quote in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 op:='operational:'||resource||':'||coalesce(action,'')||':'||coalesce(task,'')||':'||coalesce(rid,lower(btrim(coalesce(f->>'name',f->>'label',f->>'title',f->>'prerequisite_task_id','review'))));
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if; return existing.receipt; end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 if resource='task_work' then
  if task is null or (action in ('add_dependency','add_need','confirm_readiness') and (rid is not null or expected<>0))
    or (action not in ('add_dependency','add_need','confirm_readiness') and rid is null) then raise exception 'invalid_write' using errcode='22023'; end if;
  item:=case when action='confirm_readiness' then null else coalesce(rid::uuid,gen_random_uuid()) end;
  saved:=bob.work_plan_command(p_project,task,action,item,expected,f);
  rec:=(bob.read_project_work(p_project,jsonb_build_object('resource','task_work','record_id',task,'after_id',null)))->'records'->0;
  rec:=rec||jsonb_build_object('changed_item',saved); ds:='tasks';
 elsif resource in ('stock','requirement','cad_requirement') then
  if coalesce(action,'') not in ('create','revise','archive','restore','publish') or (resource='stock' and action='publish')
    or (action='create' and (rid is not null or expected<>0)) or (action<>'create' and (rid is null or expected<1)) then raise exception 'invalid_write' using errcode='22023'; end if;
  item:=coalesce(rid::uuid,gen_random_uuid());
  if resource='cad_requirement' then
   if action not in ('create','revise') then raise exception 'invalid_cad_requirement'; end if;
   saved:=bob_private.material_requirement_cad_command(p_project,action,item,expected,f); ds:='requirements';
  elsif resource='stock' then saved:=bob.stock_command(p_project,action,item,expected,f); ds:='stock';
  else saved:=bob.material_requirement_command(p_project,action,item,expected,f); ds:='requirements'; end if;
  rec:=(bob.read_project_work(p_project,jsonb_build_object('resource',case when resource='cad_requirement' then 'requirement' else resource end,'record_id',item::text,'after_id',null)))->'records'->0;
  rec:=rec||jsonb_build_object('shopping',case when action='publish' then saved else null end);
 else
  if coalesce(action,'') not in ('create','revise') or expected<>0 or (action='create')<>(rid is null)
   or f-array['title','day','time','place','food','task_ids']<>'{}' or (select count(*) from jsonb_object_keys(f))<>6
   or coalesce(length(btrim(f->>'title')),0) not between 1 and 200 or jsonb_typeof(f->'task_ids') is distinct from 'array' or jsonb_array_length(f->'task_ids')>100
   or exists(select 1 from jsonb_each(f) where key<>'task_ids' and (jsonb_typeof(value)<>'string' or length(value#>>'{}')>1000))
   then raise exception 'invalid_build_day' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(f->'task_ids') x where not exists(select 1 from bob.tasks t where t.id=x and t.project_id=p_project)) then raise exception 'project_denied' using errcode='42501'; end if;
  if rid is null then
   if p_payload->'expected_updated_at' is distinct from 'null'::jsonb then raise exception 'invalid_write' using errcode='22023'; end if;
   rid:='e_'||replace(gen_random_uuid()::text,'-','');
   insert into bob.events(id,project_id,slug,title,day,time,place,food) values(rid,p_project,rid,btrim(f->>'title'),f->>'day',f->>'time',f->>'place',f->>'food');
  else
   select * into evt from bob.events where id=rid and project_id=p_project for update;
   if not found then raise exception 'project_denied' using errcode='42501'; end if;
   if evt.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then raise exception 'record_changed' using errcode='40001'; end if;
   before_row:=to_jsonb(evt);
   update bob.events set title=btrim(f->>'title'),day=f->>'day',time=f->>'time',place=f->>'place',food=f->>'food' where id=rid;
  end if;
  delete from bob.event_tasks where project_id=p_project and event_id=rid;
  insert into bob.event_tasks select p_project,rid,value from jsonb_array_elements_text(f->'task_ids') on conflict do nothing;
  rec:=(bob.read_project_work(p_project,jsonb_build_object('resource','build_day','record_id',rid,'after_id',null)))->'records'->0; ds:='events';
 end if;
 if rec->>'id' is null then raise exception 'readback_unavailable'; end if;
 result:=jsonb_build_object('projectId',p_project,'dataset',ds,'recordId',rec->>'id','revision',rec->'revision','label',coalesce(rec->>'name',rec->>'title'),
  'operation',case when action='create' then 'created' else 'updated' end,'savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
end $$;
create function bob.bob_project_write_v12(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_project_write_v12(p_project,p_thread,p_turn,p_generation,p_payload) $$;
revoke all on function bob_private.bob_project_write_v12(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v12(text,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function bob_private.bob_project_write_v12(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v12(text,uuid,uuid,bigint,jsonb) to authenticated;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('read_project_work','Read task readiness, stock, material requirements, Shopping and scheduled build days.','Read exact records before changing them. Follow next_cursor. Stock quantities and deliveries remain recorded observations, not inferred availability.',1,false,array['planning','build'],true),
 ('manage_task_readiness','Manage task dependencies, tool/information needs and readiness.','Use read_project_work(task_work). Keep real blockers open; readiness confirmation cannot override blockers. Instructions/checkpoints are not Plan Steps.',1,false,array['planning','build'],true),
 ('manage_project_material','Manage material stock, requirements, allocations and explicit Shopping handoff.','Read current resources and target first. Full revisions preserve existing allocations. Publish only reviewed current requirements; creating a Shopping entry is not buying anything.',1,false,array['planning','build'],true),
 ('save_project_build_day','Create or revise build days with scheduled project Tasks.','Read existing event details and preserve their task IDs on revision. Never invent attendee availability or change RSVP through scheduling.',1,false,array['planning','build'],true);
commit;
