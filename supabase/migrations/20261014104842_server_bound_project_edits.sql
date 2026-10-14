-- Caller-scoped complete snapshots for server-bound content edits. Install this
-- core before the runtimes; activate the catalog only after both runtimes ship.
begin;
create function bob.read_bob_edit_context(p_project text,p_resource text,p_query text default null,p_after text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_resource is null or p_resource not in ('project_description','selected_solutions','solutions') or length(p_query)>200 or length(p_after)>250 then raise exception 'invalid_edit_context' using errcode='22023'; end if;
 if p_resource='project_description' then
  select jsonb_build_array(jsonb_build_object('project_id',p_project,'resource',p_resource,'key',p.id,'scope_label',p.name,
   'record',jsonb_build_object('id',p.id,'description',p.description,'updated_at',p.updated_at),'measurements','[]'::jsonb,'target',null)) into result from bob.projects p where p.id=p_project;
 else
  with candidates as (
   select s.id,s.area_id,s.project_id,s.current_revision revision,s.id::text key,null::jsonb target
    from bob.solutions s where p_resource='solutions' and s.project_id=p_project
   union all
   select s.id,s.area_id,s.project_id,t.solution_revision,t.scope_key,to_jsonb(t)
    from bob.current_target t join bob.solutions s on s.id=t.solution_id and s.project_id=t.project_id
    where p_resource='selected_solutions' and t.project_id=p_project
  ), records as (
   select c.*,h.current_revision head_revision,r.title,r.archived,to_jsonb(r)||jsonb_build_object('id',c.id,'area_id',c.area_id) record,
    case when a.id is null then 'Project: '||p.name else 'Area: '||a.name end scope_label
   from candidates c join bob.solution_revisions r on r.project_id=c.project_id and r.solution_id=c.id and r.revision=c.revision
   join bob.solutions h on h.id=c.id and h.project_id=c.project_id
   join bob.projects p on p.id=c.project_id left join bob.areas a on a.id=case when c.target is null then c.area_id else c.target->>'area_id' end and a.project_id=c.project_id
  ), page as (
   select * from records where not archived and (p_query is null or title ilike '%'||p_query||'%') and (p_after is null or key>p_after) order by key limit 3
  ) select coalesce(jsonb_agg(jsonb_build_object('project_id',p_project,'resource',p_resource,'key',key,'scope_label',scope_label,'record',record,'head_revision',head_revision,
    'measurement_evidence',coalesce((select jsonb_agg(jsonb_build_object('subject',r.subject,'value',r.value,'unit',r.unit,'truth',r.truth,'source',r.source,'notes',r.notes) order by m.measurement_id) from bob.solution_measurements m join bob.measurement_revisions r on r.project_id=m.project_id and r.measurement_id=m.measurement_id and r.revision=m.measurement_revision where m.project_id=p_project and m.solution_id=page.id and m.solution_revision=page.revision),'[]'::jsonb),
    'target',case when target is null then null else jsonb_build_object('area_id',target->'area_id','revision',target->'revision','solution_id',target->'solution_id','solution_revision',target->'solution_revision') end,
    'measurements',coalesce((select jsonb_agg(jsonb_build_object('id',m.measurement_id,'revision',m.measurement_revision) order by m.measurement_id) from bob.solution_measurements m where m.project_id=p_project and m.solution_id=page.id and m.solution_revision=page.revision),'[]'::jsonb)
   ) order by key),'[]'::jsonb) into result from page;
 end if;
 return coalesce(result,'[]'::jsonb);
end $$;
revoke all on function bob.read_bob_edit_context(text,text,text,text) from public,anon,service_role;
grant execute on function bob.read_bob_edit_context(text,text,text,text) to authenticated;

create function bob_private.bob_project_write_v17(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; pin jsonb; target bob.current_target; domain jsonb; selection jsonb; result jsonb; selected_receipt jsonb;
 saved bob_private.bob_write_receipts; op text; message text;
begin
 if p_payload->>'kind' is distinct from 'bound_solution' then return bob_private.bob_project_write_v16(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 select text into message from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if jsonb_typeof(p_payload)<>'object' or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}'::jsonb
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or p_payload->>'record_id' is null or coalesce(p_payload->>'expected_revision','')!~'^[1-9][0-9]{0,8}$' or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or jsonb_typeof(d)<>'object' or d-array['solution','target']::text[]<>'{}'::jsonb or not(d?'target')
  or jsonb_typeof(d->'solution')<>'object' or octet_length(p_payload::text)>78000
  or message is null or coalesce(length(p_payload->>'request_quote'),0) not between 1 and 500 or position(p_payload->>'request_quote' in message)=0 then
  raise exception 'invalid_bound_edit' using errcode='22023';
 end if;
 op:='bound_solution:'||(p_payload->>'record_id')||':'||(p_payload->>'expected_revision');
 select * into saved from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if saved.payload is distinct from p_payload then raise exception 'record_changed' using errcode='40001'; end if;
  return saved.receipt;
 end if;
 -- All solution and target commands share this lock. Validate both pins before
 -- appending either history; a rejected selection rolls the whole RPC back.
 perform 1 from bob.projects where id=p_project for no key update;
 if not exists(select 1 from bob.solutions s where s.id=(p_payload->>'record_id')::uuid and s.project_id=p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if not exists(select 1 from bob.current_solutions s where s.id=(p_payload->>'record_id')::uuid and s.project_id=p_project and s.revision=(p_payload->>'expected_revision')::integer and not s.archived) then raise exception 'record_changed' using errcode='40001'; end if;
 pin:=d->'target';
 if pin<>'null'::jsonb then
  if jsonb_typeof(pin)<>'object' or pin-array['area_id','revision','solution_id','solution_revision']::text[]<>'{}'::jsonb
   or not(pin?&array['area_id','revision','solution_id','solution_revision']) then raise exception 'invalid_target_binding' using errcode='22023'; end if;
  select * into target from bob.current_target where project_id=p_project and area_id is not distinct from (pin->>'area_id');
  if not found or target.revision is distinct from (pin->>'revision')::integer or target.solution_id::text is distinct from pin->>'solution_id'
   or target.solution_revision is distinct from (pin->>'solution_revision')::integer or pin->>'solution_id' is distinct from p_payload->>'record_id'
   or pin->'solution_revision' is distinct from p_payload->'expected_revision' then raise exception 'target_changed' using errcode='40001'; end if;
 end if;
 domain:=p_payload||jsonb_build_object('kind','solution','data',d->'solution');
 result:=bob_private.bob_project_write_v16(p_project,p_thread,p_turn,p_generation,domain);
 if pin<>'null'::jsonb then
  selection:=p_payload||jsonb_build_object('kind','target','expected_revision',pin->'revision','data',jsonb_build_object('solution_revision',result->'revision','area_id',pin->'area_id','reason',d#>>'{solution,change_note}'));
  selected_receipt:=bob_private.bob_project_write_v16(p_project,p_thread,p_turn,p_generation,selection);
  update bob_private.bob_write_receipts set operation_key='bound_target:'||op,payload=p_payload
   where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and payload=selection and receipt=selected_receipt;
  if not found then raise exception 'bound_selection_receipt_missing' using errcode='22023'; end if;
 end if;
 result:=result||jsonb_build_object('related_receipts',case when selected_receipt is null then '[]'::jsonb else jsonb_build_array(selected_receipt) end);
 update bob_private.bob_write_receipts set operation_key=op,payload=p_payload,receipt=result
  where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and payload=domain;
 if not found then raise exception 'bound_edit_receipt_missing' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v17(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v17(text,uuid,uuid,bigint,jsonb) to authenticated;
create function bob.bob_project_write_v17(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_project_write_v17(p_project,p_thread,p_turn,p_generation,p_payload) $$;
revoke all on function bob.bob_project_write_v17(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.bob_project_write_v17(text,uuid,uuid,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
