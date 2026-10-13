-- B: bounded input changes reuse construction compilation, claims and receipts.
-- The installed CLI crashed on --version; timestamp is actual UTC fallback.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob.prepare_construction_parameter_change(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; command jsonb; existing bob_private.bob_write_receipts;
 draft jsonb; change jsonb; node jsonb; ids text[]:='{}'; msg text;
begin
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>512000
  or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}' or (select count(*) from jsonb_object_keys(p_payload))<>6
  or p_payload->>'kind' is distinct from 'construction_parameters' or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or coalesce(p_payload->>'record_id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(p_payload->>'expected_revision','')!~'^[1-9][0-9]{0,8}$'
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(btrim(p_payload->>'request_quote')) not between 1 and 500
  or jsonb_typeof(d) is distinct from 'object' or d-array['key','change_note','changes','computed']<>'{}' or (select count(*) from jsonb_object_keys(d))<>4
  or coalesce(d->>'key','')!~'^[A-Za-z0-9_-]{1,80}$' or jsonb_typeof(d->'change_note') is distinct from 'string' or char_length(btrim(d->>'change_note')) not between 1 and 1000
  or jsonb_typeof(d->'changes') is distinct from 'array' or jsonb_array_length(d->'changes') not between 1 and 128
  then raise exception 'invalid_parameter_change' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 command:=jsonb_set(p_payload,'{data,computed}','null'::jsonb);
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='construction_parameters:'||(d->>'key');
 if found then
  if existing.payload is distinct from command then raise exception 'operation_reused' using errcode='PT409'; end if;
  return jsonb_build_object('status','saved','receipt',existing.receipt);
 end if;
 draft:=bob.read_construction_draft(p_project,(p_payload->>'record_id')::uuid,null,null);
 if draft->>'status' is distinct from 'ok' then raise exception 'not_a_construction_draft' using errcode='22023'; end if;
 if draft->'revision' is distinct from p_payload->'expected_revision' or draft->'archived' is distinct from 'false'::jsonb then raise exception 'construction_changed' using errcode='PT409'; end if;
 for change in select value from jsonb_array_elements(d->'changes') loop
  if jsonb_typeof(change) is distinct from 'object' or coalesce(change->>'id','')!~'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$' or change->>'id'=any(ids)
   then raise exception 'invalid_parameter_change_identity' using errcode='22023'; end if;
  ids:=array_append(ids,change->>'id');
  select n into node from jsonb_array_elements(draft->'parameters'->'nodes') n where n->>'id'=change->>'id';
  if node is null or node->>'role'='derived' then raise exception 'invalid_parameter_change_identity' using errcode='22023'; end if;
  if change->>'role'='source' then
   if node->>'role'<>'source' or change-array['id','role','source']<>'{}' or (select count(*) from jsonb_object_keys(change))<>3
    or change->'source'->>'kind' is distinct from node->'source'->>'kind' or change->'source'->>'id' is distinct from node->'source'->>'id'
    then raise exception 'invalid_parameter_change_source_identity' using errcode='22023'; end if;
  elsif change->>'role' in ('decision','estimate','unknown') then
   if change->>'role'<>'unknown' and change->>'role' is distinct from node->>'role'
    or change->'unit' is distinct from node->'normalized'->'unit' then raise exception 'invalid_parameter_change_role_or_unit' using errcode='22023'; end if;
  else raise exception 'invalid_parameter_change_role' using errcode='22023'; end if;
 end loop;
 return jsonb_build_object('status','ready','draft',draft);
end $$;
revoke all on function bob.prepare_construction_parameter_change(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob.prepare_construction_parameter_change(text,uuid,uuid,bigint,jsonb) to authenticated;

-- Copy only existing controlling numeric fields. Compare the entire result to
-- reject a topology/view/identity/material mutation hidden in compiled geometry.
create function bob_private.check_parameter_change_recipe(original jsonb,computed jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare expected jsonb:=original; target record; path text[]; idx bigint;
begin
 for target in select * from bob_private.cad_numeric_parameters(computed) loop
  if not exists(select 1 from bob_private.cad_numeric_parameters(original) o where o.parameter_path=target.parameter_path and o.parameter_unit=target.parameter_unit)
   then raise exception 'parameter_change_topology' using errcode='22023'; end if;
  path:=string_to_array(target.parameter_path,'/');
  select ordinality-1 into idx from jsonb_array_elements(original->path[1]) with ordinality a(value,ordinality) where value->>'id'=path[2];
  if idx is null then raise exception 'parameter_change_topology' using errcode='22023'; end if;
  path[2]:=idx::text;
  expected:=jsonb_set(expected,path,to_jsonb(target.parameter_value),false);
 end loop;
 if expected is distinct from computed then raise exception 'parameter_change_topology' using errcode='22023'; end if;
end $$;
revoke all on function bob_private.check_parameter_change_recipe(jsonb,jsonb) from public,anon,authenticated,service_role;

alter function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_parameter_changes;
revoke all on function bob_private.bob_project_write_before_parameter_changes(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v14(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prepared jsonb; draft jsonb; d jsonb:=p_payload->'data'; g jsonb:=d->'computed'->'parameters'; old jsonb; inputs jsonb; expected_inputs jsonb; payload jsonb; result jsonb;
begin
 if p_payload->>'kind' is distinct from 'construction_parameters' then return bob_private.bob_project_write_before_parameter_changes(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 prepared:=bob.prepare_construction_parameter_change(p_project,p_thread,p_turn,p_generation,p_payload);
 if prepared->>'status'='saved' then return prepared->'receipt'; end if;
 draft:=prepared->'draft';old:=draft->'parameters';
 if jsonb_typeof(d->'computed') is distinct from 'object' or (d->'computed')-array['recipe','parameters']<>'{}' or (select count(*) from jsonb_object_keys(d->'computed'))<>2
  or jsonb_typeof(g) is distinct from 'object' or jsonb_typeof(g->'nodes') is distinct from 'array'
  or jsonb_typeof(g->'frames') is distinct from 'array' then raise exception 'parameter_change_compilation_required' using errcode='22023'; end if;
 if g-array['nodes','frames'] is distinct from old-array['nodes','frames']
  or (select jsonb_agg(f-array['source_version','translation_mm','rotation_degrees','axes']) from jsonb_array_elements(g->'frames') f)
   is distinct from (select jsonb_agg(f-array['source_version','translation_mm','rotation_degrees','axes']) from jsonb_array_elements(old->'frames') f)
  then raise exception 'parameter_change_topology' using errcode='22023'; end if;
 select jsonb_agg(n-array['normalized','sources'] order by n->>'id') into inputs from jsonb_array_elements(g->'nodes') n;
 select jsonb_agg(coalesce(c,n-array['normalized','sources']) order by n->>'id') into expected_inputs from jsonb_array_elements(old->'nodes') n
  left join jsonb_array_elements(d->'changes') c on c->>'id'=n->>'id';
 if inputs is distinct from expected_inputs or exists(select 1 from jsonb_array_elements(g->'nodes') n join jsonb_array_elements(old->'nodes') o on o->>'id'=n->>'id' where n->'normalized'->'unit' is distinct from o->'normalized'->'unit')
  then raise exception 'parameter_change_topology' using errcode='22023'; end if;
 perform bob_private.check_parameter_change_recipe(draft->'recipe',d->'computed'->'recipe');
 payload:=p_payload||jsonb_build_object('kind','construction','data',jsonb_build_object(
  'key',d->'key','change_note',d->'change_note','title',draft->'title','description',draft->'description','area_id',draft->'area_id','target_revision',draft->'target_revision',
  'recipe',d->'computed'->'recipe','parameters',g,'materials',draft->'materials','joints',draft->'joints','open_questions',draft->'open_questions'));
 -- Existing readiness, source/head locks, formula recomputation, immutable
 -- revision and write-budget enforcement remain at the actual commit boundary.
 result:=bob_private.bob_project_write_before_parameter_changes(p_project,p_thread,p_turn,p_generation,payload);
 update bob_private.bob_write_receipts set operation_key='construction_parameters:'||(d->>'key'),payload=jsonb_set(p_payload,'{data,computed}','null'::jsonb)
  where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key='construction:'||(d->>'key');
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) to authenticated;

-- Typed exact lineage supplements the existing save-time geometry/source
-- guards. Rows derive only from validated persisted pins, including history.
alter table bob.artifact_construction_revisions add constraint construction_project_revision_unique unique(project_id,artifact_id,artifact_revision);
create table bob.artifact_construction_drawings(
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
create index construction_drawing_source_idx on bob.artifact_construction_drawings(project_id,construction_artifact_id,construction_revision);
create index construction_drawing_project_idx on bob.artifact_construction_drawings(drawing_artifact_id,project_id);
alter table bob.artifact_construction_drawings enable row level security;
revoke all on bob.artifact_construction_drawings from public,anon,authenticated,service_role;
grant select on bob.artifact_construction_drawings to authenticated;
create policy project_read on bob.artifact_construction_drawings for select to authenticated using(bob_private.has_project_access(project_id));
insert into bob.artifact_construction_drawings
 select project_id,artifact_id,artifact_revision,(manifest->'bob_construction'->>'artifact_id')::uuid,(manifest->'bob_construction'->>'revision')::integer
 from bob.artifact_cad_revisions where manifest?'bob_construction';
create function bob_private.pin_construction_drawing() returns trigger language plpgsql security invoker set search_path='' as $$
declare pin jsonb:=new.manifest->'bob_construction'; prior bob.artifact_construction_drawings;
begin
 select * into prior from bob.artifact_construction_drawings where drawing_artifact_id=new.artifact_id and drawing_revision=new.artifact_revision;
 if found then
  if prior.project_id is distinct from new.project_id or pin->>'artifact_id' is distinct from prior.construction_artifact_id::text or pin->>'revision' is distinct from prior.construction_revision::text
   then raise exception 'construction_reference_immutable' using errcode='22023'; end if;
 elsif pin is not null then
  insert into bob.artifact_construction_drawings values(new.project_id,new.artifact_id,new.artifact_revision,(pin->>'artifact_id')::uuid,(pin->>'revision')::integer);
 end if;
 return new;
end $$;
revoke all on function bob_private.pin_construction_drawing() from public,anon,authenticated,service_role;
create trigger pin_construction_drawing after insert or update of manifest on bob.artifact_cad_revisions for each row execute function bob_private.pin_construction_drawing();

alter function bob.read_cad_artifact(text,uuid,integer) rename to read_cad_artifact_before_typed_construction;
alter function bob.read_cad_artifact_before_typed_construction(text,uuid,integer) set schema bob_private;
revoke all on function bob_private.read_cad_artifact_before_typed_construction(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.read_cad_artifact_before_typed_construction(text,uuid,integer) to authenticated;
create function bob.read_cad_artifact(p_project text,p_artifact uuid,p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare answer jsonb; source jsonb;
begin
 answer:=bob_private.read_cad_artifact_before_typed_construction(p_project,p_artifact,p_revision);
 if answer is null then return null; end if;
 select jsonb_build_object('project_id',project_id,'artifact_id',construction_artifact_id,'revision',construction_revision) into source
  from bob.artifact_construction_drawings where project_id=p_project and drawing_artifact_id=p_artifact and drawing_revision=(answer->>'revision')::integer;
 if answer->'manifest'?'bob_construction' and source is null then raise exception 'construction_reference_unavailable' using errcode='22023'; end if;
 return answer||jsonb_build_object('construction_source',source);
end $$;
revoke all on function bob.read_cad_artifact(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.read_cad_artifact(text,uuid,integer) to authenticated;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('change_construction_parameters','Change saved construction input nodes; server recomputes dependencies and retains exact version history.',
 'Read the existing construction and parameter IDs. Supply only same-role/unit input changes, or an updated revision of the same source measurement. Reuse key only for exact retry. The server preserves formulas, geometry topology, materials and joints. Check the receipt revision and pass it as construction_revision to design_project_cad; no drawing is saved by this command.',1,false,array[]::text[],true);
notify pgrst,'reload schema';
commit;
