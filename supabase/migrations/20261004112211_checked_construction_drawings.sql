-- K3: a drawing pins the existing construction; no second geometry model.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.validate_cad_construction_source() returns trigger
language plpgsql security invoker set search_path='' as $$
declare pin jsonb:=new.manifest->'bob_construction'; prior bob.artifact_cad_revisions;
 source bob.artifact_construction_revisions; head bob.artifacts; state text; old_archived boolean; new_archived boolean;
begin
 select * into prior from bob.artifact_cad_revisions where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=new.artifact_revision-1;
 if found and to_jsonb(prior)-'artifact_revision'=to_jsonb(new)-'artifact_revision' then
  select archived into old_archived from bob.artifact_revisions where artifact_id=new.artifact_id and revision=new.artifact_revision-1;
  select archived into new_archived from bob.artifact_revisions where artifact_id=new.artifact_id and revision=new.artifact_revision;
  if old_archived is distinct from new_archived then return new; end if;
 end if;
 if pin is null then
  if prior.manifest?'bob_construction' then raise exception 'construction_pin_required' using errcode='22023'; end if;
  return new;
 end if;
 if jsonb_typeof(pin) is distinct from 'object' or pin-array['version','project_id','artifact_id','revision','check']<>'{}'
  or (select count(*) from jsonb_object_keys(pin))<>5 or pin->'version' is distinct from '1'::jsonb or pin->>'project_id' is distinct from new.project_id
  or coalesce(pin->>'artifact_id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or coalesce(pin->>'revision','')!~'^[1-9][0-9]{0,8}$'
  or pin->'check'->>'status' is distinct from 'checked' or pin->'check'->>'checker_version' is distinct from 'orthogonal-butt-v1'
  or pin->'check'->>'artifact_id' is distinct from pin->>'artifact_id' or pin->'check'->'revision' is distinct from pin->'revision'
  or pin->'check'->'concept_ready' is distinct from 'true'::jsonb or pin->'check'->'fabrication_ready' is distinct from 'false'::jsonb
  or pin->'check'->'issue_count' is distinct from '0'::jsonb or pin->'check'->'issues' is distinct from '[]'::jsonb
  then raise exception 'invalid_construction_check' using errcode='22023'; end if;
 if prior.manifest?'bob_construction' and prior.manifest->'bob_construction'->>'artifact_id' is distinct from pin->>'artifact_id'
  then raise exception 'construction_identity_changed' using errcode='22023'; end if;
 select * into head from bob.artifacts where project_id=new.project_id and id=(pin->>'artifact_id')::uuid for share;
 if not found or head.current_revision<>(pin->>'revision')::integer then raise exception 'construction_source_changed' using errcode='PT409'; end if;
 if exists(select 1 from bob.artifact_revisions where artifact_id=head.id and revision=head.current_revision and archived)
  then raise exception 'construction_source_changed' using errcode='PT409'; end if;
 select * into source from bob.artifact_construction_revisions where project_id=new.project_id and artifact_id=head.id and artifact_revision=head.current_revision;
 if not found then raise exception 'construction_source_unavailable' using errcode='22023'; end if;
 perform 1 from bob.catalog_items where project_id=new.project_id and id in (
  select (m->>'material_id')::uuid from jsonb_array_elements(source.materials) m union
  select (m->>'part_id')::uuid from jsonb_array_elements(source.materials) m where m->>'part_id' is not null) order by id for share;
 select source_state into state from bob_private.artifact_source_assessment(new.project_id,head.id,head.current_revision);
 if state is distinct from 'current' then raise exception 'construction_source_changed' using errcode='PT409'; end if;
 if new.source_artifact_id is not null or new.source_revision is not null or new.part_ids<>'[]'::jsonb
  or new.recipe-'views' is distinct from source.recipe-'views' or new.manifest->'bob_parameters' is distinct from source.parameters
  then raise exception 'drawing_must_reuse_construction' using errcode='22023'; end if;
 if exists(select 1 from bob.artifacts a join bob.artifact_revisions r on r.artifact_id=a.id and r.revision=new.artifact_revision
  join bob.artifact_revisions s on s.artifact_id=head.id and s.revision=head.current_revision
  where a.id=new.artifact_id and (a.area_id is distinct from head.area_id or r.target_revision is distinct from s.target_revision
   or r.solution_id is distinct from s.solution_id or r.solution_revision is distinct from s.solution_revision))
  then raise exception 'construction_scope_changed' using errcode='PT409'; end if;
 if new.manifest->'annotations'->'version' is distinct from '1'::jsonb or new.manifest->'annotations'->>'coverage' is distinct from 'complete'
  or new.manifest->'drawing_source' is distinct from jsonb_build_object('artifact_id',pin->'artifact_id','revision',pin->'revision')
  then raise exception 'construction_annotations_required' using errcode='22023'; end if;
 return new;
end $$;
revoke all on function bob_private.validate_cad_construction_source() from public,anon,authenticated,service_role;
create trigger validate_cad_construction_source before insert on bob.artifact_cad_revisions for each row execute function bob_private.validate_cad_construction_source();

alter function bob_private.artifact_source_assessment(text,uuid,integer) rename to artifact_source_assessment_before_construction_drawings;
create function bob_private.artifact_source_assessment(p_project text,p_artifact uuid,p_revision integer)
returns table(source_state text,source_reasons text[]) language plpgsql stable security invoker set search_path='' as $$
declare base_state text; reasons text[]; pin jsonb; head bob.artifacts; construction_state text;
begin
 select s.source_state,s.source_reasons into base_state,reasons from bob_private.artifact_source_assessment_before_construction_drawings(p_project,p_artifact,p_revision) s;
 if not found then return; end if;
 select manifest->'bob_construction' into pin from bob.artifact_cad_revisions where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision;
 if pin is null then return query select base_state,reasons;return; end if;
 select * into head from bob.artifacts where project_id=p_project and id=(pin->>'artifact_id')::uuid;
 if not found or not exists(select 1 from bob.artifact_construction_revisions where project_id=p_project and artifact_id=head.id and artifact_revision=(pin->>'revision')::integer) then
  return query select 'unavailable'::text,array_append(reasons,'construction_source_unavailable');return;
 end if;
 select s.source_state into construction_state from bob_private.artifact_source_assessment_before_construction_drawings(p_project,head.id,(pin->>'revision')::integer) s;
 if construction_state is distinct from 'current' or head.current_revision<>(pin->>'revision')::integer
  or exists(select 1 from bob.artifact_revisions where artifact_id=head.id and revision=head.current_revision and archived) then
  reasons:=array_append(reasons,'construction_source_changed');
  base_state:=case when base_state='unavailable' or construction_state is distinct from 'current' and construction_state is distinct from 'changed' then 'unavailable' else 'changed' end;
 end if;
 return query select base_state,reasons;
end $$;
revoke all on function bob_private.artifact_source_assessment(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.artifact_source_assessment(text,uuid,integer) to authenticated;
create or replace view bob.artifact_source_status with(security_invoker=true) as
 select r.project_id,r.artifact_id,r.revision,s.source_state,s.source_reasons from bob.artifact_revisions r
 cross join lateral bob_private.artifact_source_assessment(r.project_id,r.artifact_id,r.revision) s;

update bob.tool_catalog set how_to='Read current construction drafts and check the exact revision. Pass that construction Artifact ID as artifact_id to design_project_cad. The server rechecks its current sources and renders the same geometry with dimensions and part IDs; no second designer construction is created. Original requirements, joints, materials, checks and pixels go to the independent reviewer. Only save_cad_design saves an approved candidate; verify its receipt, exact revision, work link and readback. Correct construction issues in the checkpoint; renderer annotation defects need a renderer repair. Unknown product or strength checks remain concept limitations.' where name='design_project_cad';
update bob.tool_catalog set how_to=replace(how_to,'Exact checkpoint rendering/annotation is a later capability; do not recreate it with the CAD designer as a second model or claim a drawing was delivered.','For a requested drawing pass this checked construction Artifact ID to design_project_cad. A construction receipt alone is not a drawing delivery; verify the drawing save/link receipts and exact readback.') where name='save_construction_draft';

alter function bob.read_cad_artifact(text,uuid,integer) rename to read_cad_artifact_before_construction_drawings;
create function bob.read_cad_artifact(p_project text,p_artifact uuid,p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare answer jsonb; metadata jsonb;
begin
 answer:=bob.read_cad_artifact_before_construction_drawings(p_project,p_artifact,p_revision);
 if answer is null then return null; end if;
 select jsonb_build_object('bob_construction',manifest->'bob_construction','annotations',manifest->'annotations') into metadata
  from bob.artifact_cad_revisions where project_id=p_project and artifact_id=p_artifact and artifact_revision=(answer->>'revision')::integer;
 return answer||jsonb_build_object('manifest',jsonb_strip_nulls(metadata));
end $$;
revoke all on function bob.read_cad_artifact(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.read_cad_artifact(text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
