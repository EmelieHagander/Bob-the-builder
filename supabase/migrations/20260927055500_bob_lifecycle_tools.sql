-- Bob keeps the project tidy as it changes: archive/restore Areas, delete Tasks,
-- build days and Shopping items that no longer belong, detach images, move the
-- project or an Area between phases and set the build window. Same claimed-turn
-- ledger, request quote, write budget, before-state receipts and project scope as
-- every earlier writer; the authority matches what a project member can do in the UI.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.bob_project_write_v13(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; action text:=d->>'action'; rid text:=p_payload->>'record_id';
 quote text:=p_payload->>'request_quote'; msg text; op text; existing bob_private.bob_write_receipts;
 expected timestamptz; before_row jsonb; rec jsonb; ds text; result jsonb; operation text:='updated';
 t bob.tasks; e bob.events; m bob.materials; pr bob.projects; link uuid; kind text:=d->>'target_kind'; target text:=d->>'target_id';
begin
 if p_payload->>'kind' is distinct from 'lifecycle' then return bob_private.bob_project_write_v12(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or octet_length(p_payload::text)>8000
  or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(p_payload->'record_id') is distinct from 'string' or coalesce(length(rid),0) not between 1 and 200
  or p_payload->'expected_revision' is distinct from 'null'::jsonb
  or coalesce(action,'') not in ('archive_area','restore_area','delete_task','delete_build_day','delete_shopping_item','detach_image','set_project_phase','set_area_phase','set_schedule')
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or coalesce(length(quote),0) not between 1 and 500 then
  raise exception 'invalid_write' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(quote in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 op:='lifecycle:'||action||':'||rid||case when action='detach_image' then ':'||coalesce(kind,'')||':'||coalesce(target,'')
  when action in ('set_project_phase','set_area_phase') then ':'||coalesce(d->>'phase','')
  when action='set_schedule' then ':'||coalesce(d->>'start_date','none')||':'||coalesce(d->>'end_date','none') else '' end;
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if; return existing.receipt; end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=32 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 if action in ('archive_area','restore_area') then
  if d-array['action']<>'{}' or jsonb_typeof(p_payload->'expected_updated_at') is distinct from 'string' then raise exception 'invalid_write' using errcode='22023'; end if;
  select to_jsonb(a) into before_row from bob.areas a where a.id=rid and a.project_id=p_project;
  if before_row is null then raise exception 'project_denied' using errcode='42501'; end if;
  rec:=bob_private.area_lifecycle_command(p_project,rid,case when action='archive_area' then 'archive' else 'restore' end,(p_payload->>'expected_updated_at')::timestamptz);
  ds:='areas';
 elsif action='delete_task' then
  if d-array['action']<>'{}' or jsonb_typeof(p_payload->'expected_updated_at') is distinct from 'string' then raise exception 'invalid_write' using errcode='22023'; end if;
  select * into t from bob.tasks where id=rid and project_id=p_project for update;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  if t.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then raise exception 'record_changed' using errcode='40001'; end if;
  if t.status='done' then raise exception 'Completed Tasks are project history and are kept.' using errcode='22023'; end if;
  before_row:=jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'area_id',t.area_id,'primary_step_id',t.primary_step_id,'instructions',t.instructions,'updated_at',t.updated_at);
  delete from bob.tasks where id=rid and project_id=p_project;
  rec:=jsonb_build_object('id',t.id,'name',t.name,'status',t.status); ds:='tasks'; operation:='deleted';
 elsif action='delete_build_day' then
  if d-array['action']<>'{}' or jsonb_typeof(p_payload->'expected_updated_at') is distinct from 'string' then raise exception 'invalid_write' using errcode='22023'; end if;
  select * into e from bob.events where id=rid and project_id=p_project for update;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  if e.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then raise exception 'record_changed' using errcode='40001'; end if;
  before_row:=to_jsonb(e)||jsonb_build_object('task_ids',coalesce((select jsonb_agg(x.task_id order by x.task_id) from bob.event_tasks x where x.event_id=rid),'[]'::jsonb));
  delete from bob.events where id=rid and project_id=p_project;
  rec:=jsonb_build_object('id',e.id,'title',e.title,'day',e.day); ds:='events'; operation:='deleted';
 elsif action='delete_shopping_item' then
  if d-array['action']<>'{}' or p_payload->'expected_updated_at' is distinct from 'null'::jsonb then raise exception 'invalid_write' using errcode='22023'; end if;
  select * into m from bob.materials where id=rid and project_id=p_project for update;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  before_row:=to_jsonb(m);
  delete from bob.materials where id=rid and project_id=p_project;
  rec:=jsonb_build_object('id',m.id,'name',m.name,'status',m.status); ds:='materials'; operation:='deleted';
 elsif action='detach_image' then
  if d-array['action','target_kind','target_id']<>'{}' or coalesce(kind,'') not in ('area','task','step','plan_step')
   or coalesce(length(target),0) not between 1 and 200 or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
   or rid!~'^[0-9a-fA-F-]{36}$' then raise exception 'invalid_write' using errcode='22023'; end if;
  select l.id into link from bob.media_links l where l.project_id=p_project and l.media_id=rid::uuid and case kind
   when 'area' then l.area_id=target when 'task' then l.task_id=target when 'step' then l.step_id::text=target else l.plan_step_id::text=target end;
  if link is null then raise exception 'Image attachment unavailable' using errcode='22023'; end if;
  before_row:=jsonb_build_object('link_id',link,'target_kind',kind,'target_id',target);
  rec:=bob_private.media_command(p_project,'unlink',rid::uuid,jsonb_build_object('link_id',link));
  rec:=jsonb_build_object('id',rec->>'id','title',rec->>'title','detached_from',jsonb_build_object('target_kind',kind,'target_id',target)); ds:='media';
 elsif action in ('set_project_phase','set_area_phase') then
  if d-array['action','phase','reason']<>'{}' or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
   or (action='set_project_phase' and rid<>p_project) or coalesce(d->>'phase','') not in ('concept','design','planning','build','complete')
   or coalesce(length(btrim(d->>'reason')),0) not between 1 and 1000 then raise exception 'invalid_write' using errcode='22023'; end if;
  if action='set_project_phase' then
   select jsonb_build_object('id',id,'name',name,'phase',phase) into before_row from bob.projects where id=p_project;
   perform bob_private.phase_command(p_project,'project',null,d->>'phase',d->>'reason');
   select jsonb_build_object('id',id,'name',name,'phase',phase,'updated_at',updated_at) into rec from bob.projects where id=p_project; ds:='project';
  else
   select jsonb_build_object('id',id,'name',name,'phase',phase) into before_row from bob.areas where id=rid and project_id=p_project;
   if before_row is null then raise exception 'project_denied' using errcode='42501'; end if;
   perform bob_private.phase_command(p_project,'area',rid,d->>'phase',d->>'reason');
   select jsonb_build_object('id',id,'name',name,'phase',phase,'updated_at',updated_at) into rec from bob.areas where id=rid and project_id=p_project; ds:='areas';
  end if;
 else
  if rid<>p_project or d-array['action','start_date','end_date']<>'{}' or not (d ? 'start_date' and d ? 'end_date') or jsonb_typeof(p_payload->'expected_updated_at') is distinct from 'string'
   or (d->'start_date'='null'::jsonb)<>(d->'end_date'='null'::jsonb)
   or (d->'start_date'<>'null'::jsonb and (coalesce(d->>'start_date','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(d->>'end_date','')!~'^\d{4}-\d{2}-\d{2}$'
     or (d->>'start_date')::date>(d->>'end_date')::date)) then raise exception 'invalid_write' using errcode='22023'; end if;
  select * into pr from bob.projects where id=p_project for update;
  if pr.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then raise exception 'record_changed' using errcode='40001'; end if;
  before_row:=jsonb_build_object('id',pr.id,'start_date',pr.start_date,'end_date',pr.end_date,'updated_at',pr.updated_at);
  update bob.projects set start_date=(d->>'start_date')::date,end_date=(d->>'end_date')::date where id=p_project;
  select jsonb_build_object('id',id,'name',name,'start_date',start_date,'end_date',end_date,'updated_at',updated_at) into rec from bob.projects where id=p_project; ds:='project';
 end if;
 if rec->>'id' is null then raise exception 'readback_unavailable'; end if;
 result:=jsonb_build_object('projectId',p_project,'dataset',ds,'recordId',rec->>'id','label',left(coalesce(rec->>'name',rec->>'title',rec->>'id'),300),
  'operation',operation,'savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
end $$;
create function bob.bob_project_write_v13(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_project_write_v13(p_project,p_thread,p_turn,p_generation,p_payload) $$;
revoke all on function bob_private.bob_project_write_v13(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v13(text,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function bob_private.bob_project_write_v13(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v13(text,uuid,uuid,bigint,jsonb) to authenticated;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('archive_project_area','Archive an Area that is finished or no longer used, or restore an archived Area.','Archiving keeps the Area, its history and completed work, and takes it out of active planning. Unfinished Tasks must be moved or finished first, and a pending plan proposal that uses the Area must be resolved; the server refuses otherwise. Read the Area and pass its current updated_at.',1,false,'{}',true),
 ('delete_project_task','Delete a Task that no longer belongs to the project.','Deletes the Task with its checkpoints, assignments, dependencies, needs, build-day scheduling and image attachments. Completed Tasks are project history and are kept. Prefer revising a Task over deleting and recreating it. Read the Task and pass its current updated_at.',1,false,'{}',true),
 ('delete_project_build_day','Delete a build day that will not happen.','Removes the day, its sign-ups and its scheduled Task links; the Tasks themselves stay. Mention it to the owner when people had signed up. Read the build day with read_project_work(build_day) and pass its current updated_at.',1,false,'{}',true),
 ('delete_shopping_item','Remove an item from the Shopping list.','For items no longer needed or added by mistake. A linked material requirement stays and only loses its Shopping link. Read Shopping with read_project_work(shopping) first.',1,false,'{}',true),
 ('detach_project_image','Detach an image from an Area, Task, instruction step or plan Step.','The image stays in the project library; only this attachment goes. Use the exact image ID and the target_kind and target_id it is attached to.',1,false,'{}',true),
 ('set_project_phase','Move the project or one Area to another lifecycle phase: concept, design, planning, build or complete.','Give a short reason; it is kept in the phase history. Completing the project requires every Area to be complete. Phase is lifecycle, not a work Step.',1,false,'{}',true),
 ('update_project_schedule','Set or clear the project''s build window.','Give both dates as YYYY-MM-DD with start not after end, or both null to clear the window. Read the project and pass its current updated_at.',1,false,'{}',true);

notify pgrst,'reload schema';
commit;
