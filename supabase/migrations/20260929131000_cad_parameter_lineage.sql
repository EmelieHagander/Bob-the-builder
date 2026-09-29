-- P1a: retain and validate direct project-measurement provenance per CAD parameter.
-- No backfill: old geometry without this metadata remains explicitly untracked.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.validate_cad_parameter_lineage()
returns trigger language plpgsql security invoker set search_path='' as $$
declare l jsonb:=new.manifest->'bob_lineage'; b jsonb; s jsonb; definition jsonb;
 m bob.measurement_revisions; seen text[]:='{}'; key text; original jsonb; inherited jsonb;
 previous bob.artifact_cad_revisions; lifecycle_copy boolean:=false;
begin
 if not(new.manifest?'bob_lineage') then return new; end if;
 if jsonb_typeof(l) is distinct from 'object'
  or l-array['version','coverage','project_id','coordinates','inherited_from','bindings']::text[]<>'{}'
  or (select count(*) from jsonb_object_keys(l))<>6
  or l->'version' is distinct from '1'::jsonb or l->>'coverage' is distinct from 'partial'
  or l->>'project_id' is distinct from new.project_id
  or jsonb_typeof(l->'bindings') is distinct from 'array' then
  raise exception 'invalid_cad_lineage' using errcode='22023'; end if;
 if jsonb_array_length(l->'bindings')>32 then raise exception 'invalid_cad_lineage' using errcode='22023'; end if;
 -- Only a byte-identical canonical archive/restore copy may retain stale pins.
 -- Newly generated geometry must lock and recheck current source heads at save.
 select c.* into previous from bob.artifact_cad_revisions c
  where c.project_id=new.project_id and c.artifact_id=new.artifact_id and c.artifact_revision=new.artifact_revision-1;
 if found and (to_jsonb(previous)-'artifact_revision')=(to_jsonb(new)-'artifact_revision') then
  select prior_rev.archived<>cur.archived into lifecycle_copy from bob.artifact_revisions prior_rev join bob.artifact_revisions cur
   on cur.artifact_id=prior_rev.artifact_id and cur.revision=prior_rev.revision+1
   where cur.artifact_id=new.artifact_id and cur.revision=new.artifact_revision;
 end if;
 if not coalesce(lifecycle_copy,false) then
  perform 1 from bob.measurements h join bob.artifact_measurements pin
   on pin.measurement_id=h.id and pin.project_id=h.project_id
   where pin.project_id=new.project_id and pin.artifact_id=new.artifact_id and pin.artifact_revision=new.artifact_revision
   order by h.id for share of h;
  if exists(select 1 from bob.artifact_measurements pin join bob.measurements h
   on h.id=pin.measurement_id and h.project_id=pin.project_id
   join bob.measurement_revisions r on r.measurement_id=h.id and r.revision=h.current_revision
   where pin.project_id=new.project_id and pin.artifact_id=new.artifact_id and pin.artifact_revision=new.artifact_revision
    and (pin.measurement_revision<>h.current_revision or r.archived)) then
   raise exception 'cad_lineage_source_changed' using errcode='40001'; end if;
 end if;

 if l->'coordinates' is distinct from 'null'::jsonb and (
  jsonb_typeof(l->'coordinates') is distinct from 'object'
  or (l->'coordinates')-array['origin','positive_x','positive_y','positive_z']::text[]<>'{}'
  or (select count(*) from jsonb_object_keys(l->'coordinates'))<>4
  or exists(select 1 from jsonb_each(l->'coordinates') e where jsonb_typeof(e.value) not in ('string','null') or char_length(e.value#>>'{}')>500)) then
  raise exception 'invalid_cad_lineage_coordinates' using errcode='22023'; end if;
 for b in select value from jsonb_array_elements(l->'bindings') loop
  s:=b->'source';key:=(b->>'definition_id')||':'||(b->>'dimension');
  if jsonb_typeof(b) is distinct from 'object' or b-array['definition_id','dimension','source','normalized']::text[]<>'{}'
   or (select count(*) from jsonb_object_keys(b))<>4
   or jsonb_typeof(b->'definition_id') is distinct from 'string' or char_length(b->>'definition_id') not between 1 and 200
   or coalesce(b->>'dimension','')<>all(array['x_mm','y_mm','z_mm','diameter_mm','length_mm','outside_diameter_mm','wall_thickness_mm'])
   or key=any(seen) or jsonb_typeof(s) is distinct from 'object'
   or s-array['kind','id','revision','value','unit','truth','description']::text[]<>'{}'
   or (select count(*) from jsonb_object_keys(s))<>7
   or s->>'kind' is distinct from 'project_measurement'
   or coalesce(s->>'revision','')!~'^[1-9][0-9]{0,8}$'
   or jsonb_typeof(s->'value') is distinct from 'string'
   or coalesce(s->>'truth','')<>all(array['measured','provided_spec','estimated'])
   or jsonb_typeof(b->'normalized') is distinct from 'object'
   or (b->'normalized')-array['value','unit']::text[]<>'{}'
   or b->'normalized'->>'unit' is distinct from 'mm'
   or jsonb_typeof(b->'normalized'->'value') is distinct from 'number' then
   raise exception 'invalid_cad_lineage_binding' using errcode='22023'; end if;
  seen:=array_append(seen,key);
  select r.* into m from bob.measurement_revisions r join bob.artifact_measurements pin
    on pin.project_id=r.project_id and pin.measurement_id=r.measurement_id and pin.measurement_revision=r.revision
   where pin.project_id=new.project_id and pin.artifact_id=new.artifact_id and pin.artifact_revision=new.artifact_revision
    and r.measurement_id=(s->>'id')::uuid and r.revision=(s->>'revision')::integer;
  if not found then raise exception 'cad_lineage_source_not_pinned' using errcode='22023'; end if;
  if s->>'value' is distinct from m.value::text or s->>'unit' is distinct from m.unit
   or s->>'truth' is distinct from m.truth or s->>'description' is distinct from m.source
   or m.archived or m.value is null or m.value<=0
   or (b->'normalized'->>'value')::numeric is distinct from (m.value*case m.unit when 'm' then 1000 when 'cm' then 10 else 1 end) then
   raise exception 'cad_lineage_source_mismatch' using errcode='22023'; end if;
  if (select count(*) from jsonb_array_elements(new.recipe->'definitions') d where d->>'id'=b->>'definition_id')<>1 then
   raise exception 'cad_lineage_parameter_missing' using errcode='22023'; end if;
  select d into definition from jsonb_array_elements(new.recipe->'definitions') d where d->>'id'=b->>'definition_id';
  if definition->(b->>'dimension') is distinct from b->'normalized'->'value' then
   raise exception 'cad_lineage_geometry_mismatch' using errcode='22023'; end if;
 end loop;
 if new.source_artifact_id is null then
  if l->'inherited_from' is distinct from 'null'::jsonb then raise exception 'invalid_cad_lineage_parent' using errcode='22023'; end if;
 else
  if l->'inherited_from' is distinct from jsonb_build_object('artifact_id',new.source_artifact_id,'revision',new.source_revision) then
   raise exception 'invalid_cad_lineage_parent' using errcode='22023'; end if;
  select c.manifest->'bob_lineage' into original from bob.artifact_cad_revisions c
   where c.project_id=new.project_id and c.artifact_id=new.source_artifact_id and c.artifact_revision=new.source_revision;
  if original is not null then
   select coalesce(jsonb_agg(item.value order by item.value->>'definition_id',item.value->>'dimension'),'[]'::jsonb) into inherited
    from jsonb_array_elements(original->'bindings') item
    where exists(select 1 from jsonb_array_elements(new.recipe->'definitions') d where d->>'id'=item.value->>'definition_id');
   if inherited is distinct from (select coalesce(jsonb_agg(item.value order by item.value->>'definition_id',item.value->>'dimension'),'[]'::jsonb) from jsonb_array_elements(l->'bindings') item)
    or original->'coordinates' is distinct from l->'coordinates' then
    raise exception 'cad_lineage_must_reuse_source' using errcode='22023'; end if;
  elsif jsonb_array_length(l->'bindings')<>0 or l->'coordinates' is distinct from 'null'::jsonb then
   raise exception 'cad_lineage_legacy_unknown' using errcode='22023'; end if;
 end if;
 return new;
end $$;
revoke all on function bob_private.validate_cad_parameter_lineage() from public,anon,authenticated,service_role;
create trigger validate_cad_parameter_lineage before insert or update on bob.artifact_cad_revisions
 for each row execute function bob_private.validate_cad_parameter_lineage();

-- A specialist reads metadata, not exports or image bytes. The existing invoker
-- authority is unchanged; exact source revisions stay readable after changes.
create or replace function bob.read_cad_artifact(p_project text,p_artifact uuid,p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare answer jsonb;
begin
 if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select jsonb_build_object('artifact_id',c.artifact_id,'revision',c.artifact_revision,'recipe',c.recipe,
  'area_id',a.area_id,'component_id',c.component_id,'source_artifact_id',c.source_artifact_id,'source_revision',c.source_revision,'part_ids',c.part_ids,'step_id',c.step_id,
  'lineage',c.manifest->'bob_lineage','lineage_state',case when c.manifest?'bob_lineage' then 'partial' else 'legacy_untracked' end)
 into answer from bob.artifact_cad_revisions c join bob.artifacts a on a.id=c.artifact_id
 where c.project_id=p_project and a.project_id=p_project and c.artifact_id=p_artifact and c.artifact_revision=coalesce(p_revision,a.current_revision);
 return answer;
end $$;
revoke all on function bob.read_cad_artifact(text,uuid,integer) from public,anon;
grant execute on function bob.read_cad_artifact(text,uuid,integer) to authenticated;
commit;
