-- Coherent Construction work. The installed CLI crashes before migration new;
-- the filename uses the actual UTC timestamp from that failed invocation.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- The same editable snapshot as read_bob_edit_context, selected by exact scope
-- instead of scanning unrelated pages. No new source of project truth.
create function bob.read_bob_selected_edit_context(p_project text,p_area text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select jsonb_build_array(jsonb_build_object('project_id',p_project,'resource','selected_solutions','key',t.scope_key,
  'scope_label',case when a.id is null then 'Project: '||p.name else 'Area: '||a.name end,
  'record',to_jsonb(r)||jsonb_build_object('id',s.id,'area_id',s.area_id),'head_revision',s.current_revision,
  'target',jsonb_build_object('area_id',t.area_id,'revision',t.revision,'solution_id',t.solution_id,'solution_revision',t.solution_revision),
  'measurements',coalesce((select jsonb_agg(jsonb_build_object('id',m.measurement_id,'revision',m.measurement_revision) order by m.measurement_id)
   from bob.solution_measurements m where m.project_id=p_project and m.solution_id=s.id and m.solution_revision=r.revision),'[]'::jsonb),
  'measurement_evidence',coalesce((select jsonb_agg(jsonb_build_object('subject',mr.subject,'value',mr.value,'unit',mr.unit,'truth',mr.truth,'source',mr.source,'notes',mr.notes) order by m.measurement_id)
   from bob.solution_measurements m join bob.measurement_revisions mr on mr.project_id=m.project_id and mr.measurement_id=m.measurement_id and mr.revision=m.measurement_revision
   where m.project_id=p_project and m.solution_id=s.id and m.solution_revision=r.revision),'[]'::jsonb))) into result
 from bob.current_target t join bob.solutions s on s.id=t.solution_id and s.project_id=t.project_id
 join bob.solution_revisions r on r.project_id=s.project_id and r.solution_id=s.id and r.revision=t.solution_revision
 join bob.projects p on p.id=t.project_id left join bob.areas a on a.project_id=t.project_id and a.id=t.area_id
 where t.project_id=p_project and t.area_id is not distinct from p_area and not r.archived;
 return coalesce(result,'[]'::jsonb);
end $$;
revoke all on function bob.read_bob_selected_edit_context(text,text) from public,anon,service_role;
grant execute on function bob.read_bob_selected_edit_context(text,text) to authenticated;

-- Bounded part edits gain the same explicit source reconciliation as numeric
-- changes. Old payloads retain their exact shape, pins and receipt semantics.
do $part_source_refresh$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('bob.prepare_construction_edit(text,uuid,uuid,bigint,jsonb)'::regprocedure);
 old:='draft jsonb; next_data jsonb;';
 if position(old in definition)=0 then raise exception 'construction_edit_declaration_anchor_missing'; end if;
 definition:=replace(definition,old,'draft jsonb; readiness jsonb; next_data jsonb;');
 old:=$old$d-array['key','change_note','changes','computed']<>'{}' or (select count(*) from jsonb_object_keys(d))<>4$old$;
 replacement:=$new$d-array['key','change_note','changes','computed','target_revision']<>'{}'
  or (select count(*) from jsonb_object_keys(d))<>4+(case when d?'target_revision' then 1 else 0 end)
  or (d?'target_revision' and d->'target_revision'<>'null'::jsonb and
   (jsonb_typeof(d->'target_revision') is distinct from 'number' or coalesce(d->>'target_revision','')!~'^[1-9][0-9]{0,8}$'))$new$;
 if position(old in definition)=0 then raise exception 'construction_edit_shape_anchor_missing'; end if;
 definition:=replace(definition,old,replacement);
 old:=$old$or draft->>'source_state' is distinct from 'current' then raise exception 'construction_changed' using errcode='PT409'; end if;$old$;
 replacement:=$new$or (d->>'target_revision' is null and draft->>'source_state' is distinct from 'current') then raise exception 'construction_changed' using errcode='PT409'; end if;
 if d->>'target_revision' is not null then
  readiness:=bob.read_construction_readiness(p_project,draft->>'area_id',(d->>'target_revision')::integer,draft->'form_refinement');
  if readiness->>'status' is distinct from 'ready' then
   return jsonb_build_object('status',coalesce(readiness->>'status','unavailable'),'reason','construction_source_refresh_blocked','issues',readiness->'issues');
  end if;
 end if;$new$;
 if position(old in definition)=0 then raise exception 'construction_edit_source_anchor_missing'; end if;
 definition:=replace(definition,old,replacement); execute definition;
 definition:=pg_get_functiondef('bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb)'::regprocedure);
 old:=$old$'target_revision',draft->'target_revision'$old$;
 if position(old in definition)=0 then raise exception 'construction_edit_writer_target_anchor_missing'; end if;
 definition:=replace(definition,old,$new$'target_revision',coalesce(nullif(d->'target_revision','null'::jsonb),draft->'target_revision')$new$);
 execute definition;
end $part_source_refresh$;

-- Preparation performs no domain writes. It checks the full operation key
-- before current heads, allowing exact recovery after later legitimate work.
-- Definer is confined to the existing claimed-user/private receipt boundary.
create function bob.prepare_construction_work(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; c jsonb:=d->'construction'; s jsonb:=d->'solution'; command jsonb;
 saved bob_private.bob_write_receipts; draft jsonb; target bob.current_target; prepared jsonb; msg text;
begin
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>1100000
  or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}' or (select count(*) from jsonb_object_keys(p_payload))<>6
  or p_payload->>'kind' is distinct from 'construction_work' or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or jsonb_typeof(d) is distinct from 'object' or d-array['key','construction','solution']<>'{}' or (select count(*) from jsonb_object_keys(d))<>3
  or coalesce(d->>'key','')!~'^[A-Za-z0-9_-]{1,80}$'
  or jsonb_typeof(c) is distinct from 'object' or coalesce(c->>'kind','') not in ('construction_parameters','construction_edit')
  or c->'record_id' is distinct from p_payload->'record_id' or c->'expected_revision' is distinct from p_payload->'expected_revision'
  or c->'request_quote' is distinct from p_payload->'request_quote' or c#>'{data,key}' is distinct from d->'key'
  or c#>'{data,target_revision}' is distinct from 'null'::jsonb
  or jsonb_typeof(s) is distinct from 'object' or s->>'kind' is distinct from 'bound_solution'
  or s->'request_quote' is distinct from p_payload->'request_quote' or jsonb_typeof(s#>'{data,target}') is distinct from 'object'
  then raise exception 'invalid_construction_work' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or jsonb_typeof(p_payload->'request_quote') is distinct from 'string'
  or char_length(btrim(p_payload->>'request_quote')) not between 1 and 500 or position(p_payload->>'request_quote' in msg)=0
  then raise exception 'request_quote_required' using errcode='22023'; end if;
 command:=jsonb_set(p_payload,'{data,construction,data,computed}','null'::jsonb);
 select * into saved from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='construction_work:'||(d->>'key');
 if found then
  if saved.payload is distinct from command then raise exception 'operation_reused' using errcode='PT409'; end if;
  return jsonb_build_object('status','saved','receipt',saved.receipt);
 end if;
 draft:=bob.read_construction_draft(p_project,(p_payload->>'record_id')::uuid,null,null);
 if draft->>'status' is distinct from 'ok' or draft->'revision' is distinct from p_payload->'expected_revision'
  or draft->'archived' is distinct from 'false'::jsonb or draft->>'source_state' is distinct from 'current'
  then raise exception 'construction_changed' using errcode='PT409'; end if;
 select * into target from bob.current_target where project_id=p_project and area_id is not distinct from (draft->>'area_id');
 if not found and draft->>'area_id' is not null then select * into target from bob.current_target where project_id=p_project and area_id is null; end if;
 if target.solution_id is null or s->>'record_id' is distinct from target.solution_id::text
  or s->'expected_revision' is distinct from to_jsonb(target.solution_revision)
  or s#>'{data,target}' is distinct from jsonb_build_object('area_id',target.area_id,'revision',target.revision,'solution_id',target.solution_id,'solution_revision',target.solution_revision)
  or draft->'target_revision' is distinct from to_jsonb(target.revision)
  then raise exception 'construction_solution_changed' using errcode='PT409'; end if;
 -- Validate the Construction against the existing sources before the Solution
 -- changes. The commit below revalidates it against the new selected revision.
 c:=jsonb_set(c,'{data,target_revision}',to_jsonb(target.revision));
 prepared:=case when c->>'kind'='construction_parameters'
  then bob.prepare_construction_parameter_change(p_project,p_thread,p_turn,p_generation,c)
  else bob.prepare_construction_edit(p_project,p_thread,p_turn,p_generation,c) end;
 if prepared->>'status'='saved' then raise exception 'operation_reused' using errcode='PT409'; end if;
 return prepared;
end $$;
revoke all on function bob.prepare_construction_work(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.prepare_construction_work(text,uuid,uuid,bigint,jsonb) to authenticated;

create function bob_private.commit_construction_work(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prepared jsonb; solution jsonb; selection jsonb; c jsonb; result jsonb; command jsonb;
begin
 prepared:=bob.prepare_construction_work(p_project,p_thread,p_turn,p_generation,p_payload);
 if prepared->>'status'='saved' then return prepared->'receipt'; end if;
 if prepared->>'status' is distinct from 'ready' then raise exception 'construction_work_not_ready' using errcode='22023'; end if;
 solution:=bob_private.bob_project_write_v17(p_project,p_thread,p_turn,p_generation,p_payload#>'{data,solution}');
 if jsonb_array_length(solution->'related_receipts') is distinct from 1 then raise exception 'construction_work_selection_missing' using errcode='22023'; end if;
 selection:=solution->'related_receipts'->0;
 if selection->>'dataset' is distinct from 'target' then raise exception 'construction_work_selection_missing' using errcode='22023'; end if;
 c:=jsonb_set(p_payload#>'{data,construction}','{data,target_revision}',selection->'revision');
 result:=bob_private.bob_project_write_v16(p_project,p_thread,p_turn,p_generation,c);
 result:=result||jsonb_build_object('related_receipts',jsonb_build_array(solution-'related_receipts',selection));
 command:=jsonb_set(p_payload,'{data,construction,data,computed}','null'::jsonb);
 update bob_private.bob_write_receipts set operation_key='construction_work:'||(p_payload#>>'{data,key}'),payload=command,receipt=result
  where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn
   and operation_key=(c->>'kind')||':'||(c#>>'{data,key}');
 if not found then raise exception 'construction_work_receipt_missing' using errcode='22023'; end if;
 return result;
end $$;
revoke all on function bob_private.commit_construction_work(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.commit_construction_work(text,uuid,uuid,bigint,jsonb) to authenticated;
create function bob.commit_construction_work(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 return bob_private.commit_construction_work(p_project,p_thread,p_turn,p_generation,p_payload);
exception when serialization_failure or deadlock_detected then
 raise sqlstate 'PT409' using message=sqlerrm;
end $$;
revoke all on function bob.commit_construction_work(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.commit_construction_work(text,uuid,uuid,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
