-- Install before both runtimes; activate the separate catalog publication last.
begin;
create function bob.read_bob_solution_context(p_project text,p_resource text,p_query text default null,p_after text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 if p_resource is null or p_resource not in ('solutions','selected_solutions','scopes','measurements','images') or length(p_query)>200 or length(p_after)>250 then raise exception 'invalid_solution_context' using errcode='22023';end if;
 if p_resource in ('solutions','selected_solutions') then return bob.read_bob_edit_context(p_project,p_resource,p_query,p_after);end if;
 if p_resource='scopes' then
  with scopes as (
   select 'project'::text key,null::text area_id,p.name,'Project: '||p.name label from bob.projects p where p.id=p_project
   union all select 'area:'||a.id,a.id,a.name,'Area: '||a.name from bob.areas a where a.project_id=p_project and a.archived_at is null
  ), page as (
   select s.*,t.revision,t.solution_id,t.solution_revision,r.title selected_title from scopes s
    left join bob.current_target t on t.project_id=p_project and t.area_id is not distinct from s.area_id
    left join bob.solution_revisions r on r.project_id=p_project and r.solution_id=t.solution_id and r.revision=t.solution_revision
   where (p_query is null or s.name ilike '%'||p_query||'%') and (p_after is null or s.key>p_after) order by s.key limit 3
  ) select coalesce(jsonb_agg(jsonb_build_object('project_id',p_project,'resource',p_resource,'key',key,'scope_label',label,
   'record',jsonb_build_object('id',key,'name',name,'area_id',area_id,'selected_title',selected_title),
   'target',case when revision is null then null else jsonb_build_object('area_id',area_id,'revision',revision,'solution_id',solution_id,'solution_revision',solution_revision) end) order by key),'[]') into result from page;
 elsif p_resource='measurements' then
  select coalesce(jsonb_agg(jsonb_build_object('project_id',p_project,'resource',p_resource,'key',m.id,'scope_label',m.subject,'record',to_jsonb(m)) order by m.id),'[]') into result
   from (select * from bob.current_measurements where project_id=p_project and not archived and (p_query is null or subject ilike '%'||p_query||'%') and (p_after is null or id::text>p_after) order by id limit 3) m;
 else
  select coalesce(jsonb_agg(jsonb_build_object('project_id',p_project,'resource',p_resource,'key',m.id,'scope_label',m.title,
   'record',jsonb_build_object('id',m.id,'title',m.title,'purpose',m.purpose,'width',m.width,'height',m.height,'updated_at',m.updated_at)) order by m.id),'[]') into result
   from (select * from bob.media_assets where project_id=p_project and state='ready' and (p_query is null or title ilike '%'||p_query||'%') and (p_after is null or id::text>p_after) order by id limit 3) m;
 end if;
 return result;
end $$;
revoke all on function bob.read_bob_solution_context(text,text,text,text) from public,anon,service_role;
grant execute on function bob.read_bob_solution_context(text,text,text,text) to authenticated;

create function bob_private.bob_project_write_v18(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kind text:=p_payload->>'kind';d jsonb:=p_payload->'data';op text;msg text;domain jsonb;result jsonb;pin jsonb;area text;saved bob_private.bob_write_receipts;
begin
 if kind is null or kind not in ('bound_solution_create','bound_solution_target','bound_solution_evidence') then return bob_private.bob_project_write_v17(p_project,p_thread,p_turn,p_generation,p_payload);end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501';end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or jsonb_typeof(d) is distinct from 'object' or octet_length(p_payload::text)>80000
  or p_payload->'expected_updated_at' is distinct from 'null'::jsonb or coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$'
  or msg is null or coalesce(length(p_payload->>'request_quote'),0) not between 1 and 500 or position(p_payload->>'request_quote' in msg)=0 then raise exception 'invalid_bound_action' using errcode='22023';end if;
 if kind='bound_solution_create' then
  if p_payload->'record_id' is distinct from 'null'::jsonb or p_payload->'expected_revision' is distinct from '0'::jsonb
   or d-array['base','solution']::text[]<>'{}' or not(d?&array['base','solution']) or jsonb_typeof(d->'solution') is distinct from 'object' then raise exception 'invalid_bound_create' using errcode='22023';end if;
  op:=kind||':'||jsonb_build_array(d#>>'{solution,area_id}',lower(btrim(d#>>'{solution,title}')))::text;
 elsif kind='bound_solution_target' then
  if p_payload->>'record_id' is null or d-array['solution_revision','area_id','reason']::text[]<>'{}' or not(d?&array['solution_revision','area_id','reason']) then raise exception 'invalid_bound_target' using errcode='22023';end if;
  op:=kind||':'||jsonb_build_array(d->>'area_id',p_payload->>'expected_revision')::text;
 else
  if p_payload->>'record_id' is null or d-array['sources','solution','target']::text[]<>'{}' or not(d?&array['sources','solution','target'])
   or jsonb_typeof(d->'sources') is distinct from 'array' or jsonb_array_length(d->'sources')>20 then raise exception 'invalid_bound_sources' using errcode='22023';end if;
  op:=kind||':'||(p_payload->>'record_id')||':'||(p_payload->>'expected_revision');
 end if;
 if op is null then raise exception 'invalid_bound_action' using errcode='22023';end if;
 perform 1 from bob.projects where id=p_project for no key update;
 -- Recover exactly committed work before checking whether its source moved later.
 select * into saved from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if saved.payload is distinct from p_payload then raise exception 'record_changed' using errcode='40001';end if;
  return saved.receipt;
 end if;
 if kind in ('bound_solution_create','bound_solution_target') then
  area:=case when kind='bound_solution_create' then d#>>'{solution,area_id}' else d->>'area_id' end;
  if area is not null then
   perform 1 from bob.areas a where a.id=area and a.project_id=p_project and a.archived_at is null for share;
   if not found then raise exception 'scope_changed' using errcode='40001';end if;
  end if;
 end if;
 if kind='bound_solution_create' then
  pin:=d->'base';
  if pin<>'null'::jsonb then
   if jsonb_typeof(pin) is distinct from 'object' or pin-array['id','revision']::text[]<>'{}' or not(pin?&array['id','revision']) then raise exception 'invalid_base' using errcode='22023';end if;
   if not exists(select 1 from bob.current_solutions s where s.project_id=p_project and s.id::text=pin->>'id' and s.revision::text=pin->>'revision' and not s.archived) then raise exception 'source_changed' using errcode='40001';end if;
  end if;
  domain:=p_payload||jsonb_build_object('kind','solution','data',d->'solution');
 elsif kind='bound_solution_target' then
  if not exists(select 1 from bob.current_solutions s where s.project_id=p_project and s.id::text=p_payload->>'record_id' and s.revision::text=d->>'solution_revision' and not s.archived) then raise exception 'source_changed' using errcode='40001';end if;
  if coalesce((select t.revision from bob.current_target t where t.project_id=p_project and t.area_id is not distinct from (d->>'area_id')),0)
   is distinct from (p_payload->>'expected_revision')::integer then raise exception 'target_changed' using errcode='40001';end if;
  domain:=p_payload||jsonb_build_object('kind','target');
 else
  -- A receipt owned by the content editor is not this action's retry. Check the
  -- read head before delegation so an identical inner payload cannot move that
  -- other action's ledger entry and invalidate its future exact retry.
  if not exists(select 1 from bob.current_solutions s where s.project_id=p_project and s.id::text=p_payload->>'record_id'
   and s.revision::text=p_payload->>'expected_revision' and not s.archived) then raise exception 'record_changed' using errcode='40001';end if;
  for pin in select value from jsonb_array_elements(d->'sources') loop
   if pin->>'resource'='measurements' then
    if pin-array['resource','id','revision']::text[]<>'{}' or not(pin?&array['resource','id','revision']) then raise exception 'invalid_source_pin' using errcode='22023';end if;
    perform 1 from bob.measurements h join bob.measurement_revisions r on r.project_id=h.project_id and r.measurement_id=h.id and r.revision=h.current_revision
     where h.project_id=p_project and h.id::text=pin->>'id' and h.current_revision::text=pin->>'revision' and not r.archived for share of h;
    if not found then raise exception 'source_changed' using errcode='40001';end if;
   elsif pin->>'resource'='images' then
    -- Media commands lock this row, independently of the project writer.
    perform 1 from bob.media_assets m where m.project_id=p_project and m.id::text=pin->>'id' and m.state='ready' and m.updated_at=(pin->>'updated_at')::timestamptz for share;
    if not found then raise exception 'source_changed' using errcode='40001';end if;
    if pin-array['resource','id','updated_at']::text[]<>'{}' or not(pin?&array['resource','id','updated_at']) then raise exception 'invalid_source_pin' using errcode='22023';end if;
   else raise exception 'invalid_source_pin' using errcode='22023';end if;
  end loop;
  domain:=p_payload||jsonb_build_object('kind','bound_solution','data',d-'sources');
 end if;
 result:=bob_private.bob_project_write_v17(p_project,p_thread,p_turn,p_generation,domain);
 -- Keep the canonical receipt and related target receipt, but isolate outer
 -- operation keys from subsequent intentional commands in this same turn.
 update bob_private.bob_write_receipts set operation_key=case when receipt=result then op else 'related:'||op end,payload=p_payload
  where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and payload=domain;
 if not found then raise exception 'bound_action_receipt_missing' using errcode='22023';end if;
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v18(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v18(text,uuid,uuid,bigint,jsonb) to authenticated;
create function bob.bob_project_write_v18(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$select bob_private.bob_project_write_v18(p_project,p_thread,p_turn,p_generation,p_payload)$$;
revoke all on function bob.bob_project_write_v18(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.bob_project_write_v18(text,uuid,uuid,bigint,jsonb) to authenticated;
commit;
