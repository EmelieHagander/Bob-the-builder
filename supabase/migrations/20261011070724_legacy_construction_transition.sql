-- C: capture an exact legacy drawing without changing its saved history.
-- UTC fallback: the pinned Supabase CLI aborted on --version.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.artifact_construction_origins(
 project_id text not null,
 drawing_artifact_id uuid not null,
 drawing_revision integer not null,
 construction_artifact_id uuid not null,
 construction_revision integer not null,
 primary key(drawing_artifact_id,drawing_revision),
 foreign key(drawing_artifact_id,drawing_revision) references bob.artifact_cad_revisions(artifact_id,artifact_revision) on delete cascade,
 foreign key(drawing_artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade,
 foreign key(project_id,construction_artifact_id,construction_revision) references bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision)
);
create index construction_origin_source_idx on bob.artifact_construction_origins(project_id,construction_artifact_id,construction_revision);
create index construction_origin_project_idx on bob.artifact_construction_origins(drawing_artifact_id,project_id);
alter table bob.artifact_construction_origins enable row level security;
revoke all on bob.artifact_construction_origins from public,anon,authenticated,service_role;
grant select on bob.artifact_construction_origins to authenticated;
create policy project_read on bob.artifact_construction_origins for select to authenticated using(bob_private.has_project_access(project_id));

-- Material labels are retained in the immutable CAD origin. Only explicit
-- catalog pins populate the construction; labels never become guessed IDs.
create function bob_private.legacy_construction_recipe(p_recipe jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_set(p_recipe,'{definitions}',(select jsonb_agg(d||jsonb_build_object('material_ref',null)) from jsonb_array_elements(p_recipe->'definitions') d))
$$;
revoke all on function bob_private.legacy_construction_recipe(jsonb) from public,anon,authenticated,service_role;

create function bob.prepare_legacy_construction_transition(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; existing bob_private.bob_write_receipts; head bob.artifacts;
 cad bob.artifact_cad_revisions; prior bob.artifact_revisions; origin bob.artifact_construction_origins;
 readiness jsonb; draft jsonb; recipe jsonb; parameters jsonb; msg text; gaps jsonb:='[]'; reasons text[];
begin
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>512000
  or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}' or (select count(*) from jsonb_object_keys(p_payload))<>6
  or p_payload->>'kind' is distinct from 'legacy_construction' or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or coalesce(p_payload->>'record_id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(p_payload->>'expected_revision','')!~'^[1-9][0-9]{0,8}$'
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(btrim(p_payload->>'request_quote')) not between 1 and 500
  or jsonb_typeof(d) is distinct from 'object' or d-array['key','target_revision','change_note','construction_id','construction_revision','materials','joints','open_questions']<>'{}' or (select count(*) from jsonb_object_keys(d))<>8
  or coalesce(d->>'key','')!~'^[A-Za-z0-9_-]{1,80}$' or jsonb_typeof(d->'change_note') is distinct from 'string' or char_length(btrim(d->>'change_note')) not between 1 and 1000
  or coalesce(d->>'target_revision','')!~'^[1-9][0-9]{0,8}$'
  or (d->'construction_id' is distinct from 'null'::jsonb and (coalesce(d->>'construction_id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(d->>'construction_revision','')!~'^[1-9][0-9]{0,8}$'))
  or (d->'construction_id'='null'::jsonb and d->'construction_revision' is distinct from 'null'::jsonb)
  or (d->'construction_id'<>'null'::jsonb and (d->'materials' is distinct from 'null'::jsonb or d->'joints' is distinct from 'null'::jsonb or d->'open_questions' is distinct from 'null'::jsonb))
  or (d->'construction_id'='null'::jsonb and (jsonb_typeof(d->'materials') not in ('null','array') or jsonb_typeof(d->'joints') not in ('null','array') or jsonb_typeof(d->'open_questions') not in ('null','array')))
  then raise exception 'invalid_legacy_transition' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='legacy_construction:'||(d->>'key');
 if found then
  if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='PT409'; end if;
  return jsonb_build_object('status','saved','receipt',existing.receipt);
 end if;
 select * into head from bob.artifacts where project_id=p_project and id=(p_payload->>'record_id')::uuid for share;
 if not found then raise exception 'project_denied' using errcode='42501'; end if;
 if head.current_revision<>(p_payload->>'expected_revision')::integer then raise exception 'legacy_drawing_changed' using errcode='PT409'; end if;
 select * into prior from bob.artifact_revisions where project_id=p_project and artifact_id=head.id and revision=head.current_revision;
 select * into cad from bob.artifact_cad_revisions where project_id=p_project and artifact_id=head.id and artifact_revision=head.current_revision;
 if not found or prior.archived or cad.manifest?'bob_construction' then raise exception 'not_a_legacy_drawing' using errcode='22023'; end if;
 select * into origin from bob.artifact_construction_origins where project_id=p_project and drawing_artifact_id=head.id and drawing_revision=head.current_revision;
 if found then
  if d->>'construction_id' is not null and d->>'construction_id' is distinct from origin.construction_artifact_id::text then raise exception 'legacy_construction_identity_changed' using errcode='PT409'; end if;
  draft:=bob.read_construction_draft(p_project,origin.construction_artifact_id,null,null);
  return jsonb_build_object('status','already_prepared','projectId',p_project,'drawing_artifact_id',head.id,'drawing_revision',head.current_revision,
   'construction_source',jsonb_build_object('project_id',p_project,'artifact_id',origin.construction_artifact_id,'revision',draft->'revision'),'draft',draft);
 end if;
 readiness:=bob.read_design_readiness(p_project,head.area_id,(d->>'target_revision')::integer,'construction');
 if readiness->>'status' is distinct from 'ready' then return jsonb_build_object('status',coalesce(readiness->>'status','unavailable'),'readiness',readiness,'issues',readiness->'issues'); end if;
 -- Changing the selected design purpose is allowed. A changed/missing physical
 -- source, parent drawing or image is never disguised as an intake gap.
 select source_reasons into reasons from bob_private.artifact_source_assessment(p_project,head.id,head.current_revision);
 if reasons is null then raise exception 'legacy_sources_unavailable' using errcode='22023'; end if;
 if exists(select 1 from unnest(reasons) reason where reason<>'target_changed') then
  return jsonb_build_object('status',case when 'source_unavailable'=any(reasons) then 'unavailable' else 'conflict' end,'reason','legacy_sources_changed','source_reasons',reasons);
 end if;
 recipe:=bob_private.legacy_construction_recipe(cad.recipe); parameters:=cad.manifest->'bob_parameters';
 if d->>'construction_id' is not null then
  perform 1 from bob.artifacts where project_id=p_project and id=(d->>'construction_id')::uuid for share;
  draft:=bob.read_construction_draft(p_project,(d->>'construction_id')::uuid,(d->>'construction_revision')::integer,null);
  if draft->>'status' is distinct from 'ok' then raise exception 'construction_source_unavailable' using errcode='22023'; end if;
  if draft->'revision' is distinct from d->'construction_revision' or draft->'current_revision' is distinct from d->'construction_revision' or draft->'archived' is distinct from 'false'::jsonb or draft->>'source_state' is distinct from 'current'
   then raise exception 'construction_source_changed' using errcode='PT409'; end if;
  if draft->>'area_id' is distinct from head.area_id or draft->'target_revision' is distinct from d->'target_revision'
   or (draft->'recipe')-'views' is distinct from recipe-'views' or (parameters is not null and draft->'parameters' is distinct from parameters)
   then raise exception 'legacy_construction_mismatch' using errcode='22023'; end if;
  parameters:=draft->'parameters';
 else
  if jsonb_typeof(parameters) is distinct from 'object' then gaps:=gaps||jsonb_build_array(jsonb_build_object('code','parameter_graph_required','action','Establish a valid matching construction checkpoint; legacy dimensions alone do not establish parameter roles or dependencies.')); end if;
  if parameters is not null and exists(select 1 from jsonb_array_elements(parameters->'frames') f where f->>'kind'='image') then gaps:=gaps||jsonb_build_array(jsonb_build_object('code','image_frame_evidence_required','action','Resolve the canonical image-frame carrier; no hashes or orientation are invented.')); end if;
  if d->'materials'='null'::jsonb or d->'materials'='[]'::jsonb then gaps:=gaps||jsonb_build_array(jsonb_build_object('code','material_pins_required','definition_ids',(select jsonb_agg(x->'id') from jsonb_array_elements(recipe->'definitions') x))); end if;
  if d->'joints'='null'::jsonb or jsonb_array_length(recipe->'instances')>1 and d->'joints'='[]'::jsonb then gaps:=gaps||jsonb_build_array(jsonb_build_object('code','joint_evidence_required','instance_ids',(select jsonb_agg(x->'id') from jsonb_array_elements(recipe->'instances') x))); end if;
  if d->'open_questions'='null'::jsonb then gaps:=gaps||jsonb_build_array(jsonb_build_object('code','open_questions_required')); end if;
 end if;
 if parameters is not null and exists(select 1 from bob.artifact_measurements pin where pin.project_id=p_project and pin.artifact_id=head.id and pin.artifact_revision=head.current_revision
  and not exists(select 1 from jsonb_array_elements(parameters->'nodes') n where n->>'role'='source' and n->'source'->>'kind'='project_measurement' and n->'source'->>'id'=pin.measurement_id::text and n->'source'->>'revision'=pin.measurement_revision::text)) then
  gaps:=gaps||jsonb_build_array(jsonb_build_object('code','legacy_measurement_bindings_required','action','Preserve every legacy measurement pin in an explicitly sourced matching construction graph.'));
 end if;
 if jsonb_array_length(gaps)>0 then return jsonb_build_object('status','needs_data','issues',gaps,'legacy',jsonb_build_object('artifact_id',head.id,'revision',head.current_revision,'recipe',recipe,'parameters',parameters),'saved',false); end if;
 return jsonb_build_object('status','ready','legacy',jsonb_build_object('artifact_id',head.id,'revision',head.current_revision,'area_id',head.area_id,
  'title',left(prior.title,175)||' — construction','description',left(prior.description,5100),'recipe',recipe,'parameters',parameters),'draft',draft);
end $$;
revoke all on function bob.prepare_legacy_construction_transition(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.prepare_legacy_construction_transition(text,uuid,uuid,bigint,jsonb) to authenticated;

alter function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_legacy_transition;
revoke all on function bob_private.bob_project_write_before_legacy_transition(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v14(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; prepared jsonb; legacy jsonb; draft jsonb; payload jsonb; result jsonb; rec jsonb; aid uuid; revision integer;
begin
 if p_payload->>'kind' is distinct from 'legacy_construction' then return bob_private.bob_project_write_before_legacy_transition(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 prepared:=bob.prepare_legacy_construction_transition(p_project,p_thread,p_turn,p_generation,p_payload);
 if prepared->>'status'='saved' then return prepared->'receipt'; end if;
 if prepared->>'status'='already_prepared' then raise exception 'legacy_transition_already_prepared' using errcode='PT409'; end if;
 if prepared->>'status' is distinct from 'ready' then raise exception 'legacy_transition_not_ready' using errcode='22023',detail=prepared::text; end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 if exists(select 1 from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='construction:'||(d->>'key')) then raise exception 'operation_reused' using errcode='PT409'; end if;
 legacy:=prepared->'legacy';draft:=prepared->'draft';
 if d->>'construction_id' is null then
  payload:=jsonb_build_object('kind','construction','record_id',null,'expected_revision',0,'expected_updated_at',null,'request_quote',p_payload->'request_quote',
   'data',jsonb_build_object('key',d->'key','title',legacy->'title','description','Recovered from legacy drawing '||(legacy->>'artifact_id')||' revision '||(legacy->>'revision')||'. '||coalesce(legacy->>'description',''),
    'area_id',legacy->'area_id','target_revision',d->'target_revision','change_note',d->'change_note','recipe',legacy->'recipe','parameters',legacy->'parameters','materials',d->'materials','joints',d->'joints',
    'open_questions',d->'open_questions'||jsonb_build_array('Legacy geometry is retained as design evidence; the supplied material and joint choices do not establish historical facts or fabrication approval.')));
  result:=bob_private.bob_project_write_before_legacy_transition(p_project,p_thread,p_turn,p_generation,payload);
  aid:=(result->>'recordId')::uuid;revision:=(result->>'revision')::integer;
 else
  aid:=(d->>'construction_id')::uuid;revision:=(d->>'construction_revision')::integer;
  -- A matching canonical checkpoint is reused without a new construction revision.
  select to_jsonb(a)||jsonb_build_object('construction_status','draft','rendered',false,'reviewed',false) into rec from bob.current_artifacts a where a.project_id=p_project and a.id=aid;
  result:=jsonb_build_object('projectId',p_project,'dataset','artifacts','recordId',aid,'revision',revision,'areaId',legacy->'area_id','label',rec->>'title','operation','reused','savedAt',clock_timestamp(),'record',rec);
  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,'construction:'||(d->>'key'),p_payload,null,result);
 end if;
 insert into bob.artifact_construction_origins values(p_project,(legacy->>'artifact_id')::uuid,(legacy->>'revision')::integer,aid,revision);
 result:=result||jsonb_build_object('legacy_drawing',jsonb_build_object('project_id',p_project,'artifact_id',legacy->'artifact_id','revision',legacy->'revision'));
 update bob_private.bob_write_receipts set operation_key='legacy_construction:'||(d->>'key'),payload=p_payload,receipt=result
  where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='construction:'||(d->>'key');
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) to authenticated;

-- Only this explicit transition may first attach a legacy identity to K3.
-- Later numeric corrections may change dimensions; topology and stable IDs
-- from the captured baseline must survive the first checked publication.
create function bob_private.validate_legacy_construction_transition() returns trigger
language plpgsql security invoker set search_path='' as $$
declare prior bob.artifact_cad_revisions; origin bob.artifact_construction_origins; baseline jsonb; current_recipe jsonb;
begin
 select * into prior from bob.artifact_cad_revisions where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=new.artifact_revision-1;
 if not found or prior.manifest?'bob_construction' or not new.manifest?'bob_construction' then return new; end if;
 select * into origin from bob.artifact_construction_origins where project_id=new.project_id and drawing_artifact_id=new.artifact_id and drawing_revision=prior.artifact_revision;
 if not found then raise exception 'legacy_construction_transition_required' using errcode='22023'; end if;
 if new.manifest->'bob_construction'->>'artifact_id' is distinct from origin.construction_artifact_id::text then raise exception 'legacy_construction_identity_changed' using errcode='22023'; end if;
 select recipe into baseline from bob.artifact_construction_revisions where project_id=origin.project_id and artifact_id=origin.construction_artifact_id and artifact_revision=origin.construction_revision;
 select recipe into current_recipe from bob.artifact_construction_revisions where project_id=origin.project_id and artifact_id=origin.construction_artifact_id and artifact_revision=(new.manifest->'bob_construction'->>'revision')::integer;
 perform bob_private.check_parameter_change_recipe(baseline-'views',current_recipe-'views');
 return new;
end $$;
revoke all on function bob_private.validate_legacy_construction_transition() from public,anon,authenticated,service_role;
create trigger validate_legacy_construction_transition before insert on bob.artifact_cad_revisions for each row execute function bob_private.validate_legacy_construction_transition();

alter function bob.read_cad_artifact(text,uuid,integer) rename to read_cad_artifact_before_legacy_transition;
alter function bob.read_cad_artifact_before_legacy_transition(text,uuid,integer) set schema bob_private;
revoke all on function bob_private.read_cad_artifact_before_legacy_transition(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.read_cad_artifact_before_legacy_transition(text,uuid,integer) to authenticated;
create function bob.read_cad_artifact(p_project text,p_artifact uuid,p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare answer jsonb; transition jsonb;
begin
 answer:=bob_private.read_cad_artifact_before_legacy_transition(p_project,p_artifact,p_revision);
 if answer is null then return null; end if;
 select jsonb_build_object('project_id',o.project_id,'artifact_id',o.construction_artifact_id,'revision',o.construction_revision,'drawing_artifact_id',o.drawing_artifact_id,'drawing_revision',o.drawing_revision,'archived',r.archived) into transition
  from bob.artifact_construction_origins o join bob.artifact_revisions r on r.project_id=o.project_id and r.artifact_id=o.drawing_artifact_id and r.revision=o.drawing_revision
  where o.project_id=p_project and o.drawing_artifact_id=p_artifact and o.drawing_revision=(answer->>'revision')::integer;
 return answer||jsonb_build_object('construction_transition',transition);
end $$;
revoke all on function bob.read_cad_artifact(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.read_cad_artifact(text,uuid,integer) to authenticated;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('transition_legacy_drawing','Prepare an exact older drawing for construction-driven correction without rewriting its history.',
 'Read the legacy drawing and current design intent. Server copies its saved geometry and graph. Supply exact catalog material pins and typed joint choices, or reuse a matching existing construction. Null evidence returns all gaps; do not invent pins, joints or parameter roles. Check the saved construction receipt/readback, correct its input IDs and render the original drawing Artifact ID with exact construction_revision. This preparation does not deliver a drawing.',1,false,array[]::text[],true);
notify pgrst,'reload schema';
commit;
