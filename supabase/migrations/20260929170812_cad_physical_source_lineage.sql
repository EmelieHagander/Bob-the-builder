-- P1b: accepted physical snapshots remain separate from project measurements.
-- Supabase CLI generated migration; additive, no source copies or data backfill.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function bob_private.validate_cad_parameter_lineage()
returns trigger language plpgsql security invoker set search_path='' as $$
declare l jsonb:=new.manifest->'bob_lineage'; b jsonb; s jsonb; definition jsonb;
 m bob.measurement_revisions; physical bob.space_measurements; seen text[]:='{}'; key text; original jsonb; inherited jsonb;
 previous bob.artifact_cad_revisions; lifecycle_copy boolean:=false;
begin
 -- Historical rows are immutable. Archive/restore creates a new revision.
 if tg_op='UPDATE' then
  if new is distinct from old then raise exception 'cad_revision_immutable' using errcode='22023'; end if;
  return new;
 end if;
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

 -- Compatibility for genuinely untracked inputs must not become a bypass for
 -- freshness or for stripping a tracked parent / previously traced revision.
 if not(new.manifest?'bob_lineage') then
  if coalesce(previous.manifest?'bob_lineage',false)
   or exists(select 1 from bob.artifact_cad_revisions c
    where c.project_id=new.project_id and c.artifact_id=new.source_artifact_id
     and c.artifact_revision=new.source_revision and c.manifest?'bob_lineage') then
   raise exception 'cad_lineage_required' using errcode='22023';
  end if;
  return new;
 end if;
 if jsonb_typeof(l) is distinct from 'object'
  or l-array['version','coverage','project_id','coordinates','inherited_from','bindings']::text[]<>'{}'
  or (select count(*) from jsonb_object_keys(l))<>6
  or l->'version' not in ('1'::jsonb,'2'::jsonb) or l->>'coverage' is distinct from 'partial'
  or l->>'project_id' is distinct from new.project_id
  or jsonb_typeof(l->'bindings') is distinct from 'array' then
  raise exception 'invalid_cad_lineage' using errcode='22023'; end if;
 if jsonb_array_length(l->'bindings')>32 then raise exception 'invalid_cad_lineage' using errcode='22023'; end if;

 -- Serialise accepted-space and scope changes with physical-source saves.
 -- No global physical scan: only referenced identities and this project's links.
 if not coalesce(lifecycle_copy,false) and l->'version'='2'::jsonb then
  perform 1 from bob.project_physical_scope where project_id=new.project_id order by id for share;
  perform 1 from bob.buildings where id in (select (v->'source'->>'building_id')::uuid from jsonb_array_elements(l->'bindings') v where v->'source'->>'kind'='space_measurement') order by id for share;
  perform 1 from bob.building_spaces where id in (select (v->'source'->>'space_id')::uuid from jsonb_array_elements(l->'bindings') v where v->'source'->>'kind'='space_measurement') order by id for share;
 end if;

 if l->'coordinates' is distinct from 'null'::jsonb and (
  jsonb_typeof(l->'coordinates') is distinct from 'object'
  or (l->'coordinates')-array['origin','positive_x','positive_y','positive_z']::text[]<>'{}'
  or (select count(*) from jsonb_object_keys(l->'coordinates'))<>4
  or exists(select 1 from jsonb_each(l->'coordinates') e where jsonb_typeof(e.value) not in ('string','null') or char_length(e.value#>>'{}')>500 or (jsonb_typeof(e.value)='string' and btrim(e.value#>>'{}')=''))) then
  raise exception 'invalid_cad_lineage_coordinates' using errcode='22023'; end if;
 for b in select value from jsonb_array_elements(l->'bindings') loop
  s:=b->'source';key:=(b->>'definition_id')||':'||(b->>'dimension');
  if l->'version'='2'::jsonb and s->>'kind'='space_measurement' then
   if jsonb_typeof(b) is distinct from 'object' or (select count(*) from jsonb_object_keys(b))<>4
    or b-array['definition_id','dimension','source','normalized']::text[]<>'{}'
    or jsonb_typeof(b->'definition_id') is distinct from 'string' or char_length(b->>'definition_id') not between 1 and 200
    or coalesce(b->>'dimension','')<>all(array['x_mm','y_mm','z_mm','diameter_mm','length_mm','outside_diameter_mm','wall_thickness_mm'])
    or key=any(seen) or (select count(*) from jsonb_object_keys(s))<>11
    or s-array['kind','id','building_id','space_id','space_revision','measurement_id','measurement_revision','value','unit','truth','description']::text[]<>'{}'
    or exists(select 1 from unnest(array['id','building_id','space_id','measurement_id']) k where jsonb_typeof(s->k) is distinct from 'string'
      or coalesce(s->>k,'')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    or exists(select 1 from unnest(array['space_revision','measurement_revision']) k where jsonb_typeof(s->k) is distinct from 'number' or coalesce(s->>k,'')!~'^[1-9][0-9]{0,8}$')
    or jsonb_typeof(s->'value') is distinct from 'string' or coalesce(s->>'truth','')<>all(array['measured','provided_spec','estimated'])
    or jsonb_typeof(b->'normalized') is distinct from 'object' or (select count(*) from jsonb_object_keys(b->'normalized'))<>2
    or (b->'normalized')-array['value','unit']::text[]<>'{}' or b->'normalized'->>'unit' is distinct from 'mm'
    or jsonb_typeof(b->'normalized'->'value') is distinct from 'number' then
    raise exception 'invalid_physical_lineage' using errcode='22023'; end if;
   seen:=array_append(seen,key);
   -- Historical copies are project-owned evidence, not current physical facts.
   -- Canonical snapshots may be hidden/deleted after scope loss; preserve only
   -- the byte-identical already validated archive/restore packet in that case.
   if coalesce(lifecycle_copy,false) then continue; end if;
   select sm.* into physical from bob.space_measurements sm
    join bob.project_spaces sp on sp.project_id=new.project_id and sp.id=sm.space_id
    join bob.project_buildings bu on bu.project_id=new.project_id and bu.id=sm.building_id
    where sm.id=(s->>'id')::uuid and not sp.archived and not bu.archived;
   if not found then raise exception 'physical_source_unavailable' using errcode='42501'; end if;
   if not exists(select 1 from bob.project_spaces sp where sp.project_id=new.project_id and sp.id=physical.space_id and sp.revision=physical.space_revision)
    then raise exception 'physical_source_changed' using errcode='40001'; end if;
   if physical.building_id::text is distinct from s->>'building_id' or physical.space_id::text is distinct from s->>'space_id'
    or physical.space_revision is distinct from (s->>'space_revision')::integer
    or physical.measurement_id::text is distinct from s->>'measurement_id' or physical.measurement_revision is distinct from (s->>'measurement_revision')::integer
    or physical.value::text is distinct from s->>'value' or physical.unit is distinct from s->>'unit'
    or physical.truth is distinct from s->>'truth' or physical.source is distinct from s->>'description'
    or physical.value is null or physical.value<=0
    or (b->'normalized'->>'value')::numeric is distinct from (physical.value*case physical.unit when 'm' then 1000 when 'cm' then 10 when 'mm' then 1 end)
    then raise exception 'physical_lineage_source_mismatch' using errcode='22023'; end if;
   if (select count(*) from jsonb_array_elements(new.recipe->'definitions') d where d->>'id'=b->>'definition_id')<>1
    then raise exception 'physical_lineage_parameter_missing' using errcode='22023'; end if;
   select d into definition from jsonb_array_elements(new.recipe->'definitions') d where d->>'id'=b->>'definition_id';
   if definition->(b->>'dimension') is distinct from b->'normalized'->'value'
    then raise exception 'physical_lineage_geometry_mismatch' using errcode='22023'; end if;
   continue;
  end if;
  if jsonb_typeof(b) is distinct from 'object' or b-array['definition_id','dimension','source','normalized']::text[]<>'{}'
   or (select count(*) from jsonb_object_keys(b))<>4
   or jsonb_typeof(b->'definition_id') is distinct from 'string' or char_length(b->>'definition_id') not between 1 and 200
   or coalesce(b->>'dimension','')<>all(array['x_mm','y_mm','z_mm','diameter_mm','length_mm','outside_diameter_mm','wall_thickness_mm'])
   or key=any(seen) or jsonb_typeof(s) is distinct from 'object'
   or s-array['kind','id','revision','value','unit','truth','description']::text[]<>'{}'
   or (select count(*) from jsonb_object_keys(s))<>7
   or s->>'kind' is distinct from 'project_measurement'
   or jsonb_typeof(s->'revision') is distinct from 'number'
   or jsonb_typeof(s->'id') is distinct from 'string'
   or coalesce(s->>'id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
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
 if coalesce(lifecycle_copy,false) then return new; end if;
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
-- The existing trigger retains its function identity.


-- Preserve the prior bounded assessment as a dependency rather than copy its
-- other-domain logic. Rebind the public view below: it otherwise retains the old
-- function OID after the rename and would silently miss these checks.
alter function bob_private.artifact_source_assessment(text,uuid,integer) rename to artifact_source_assessment_before_physical;
create function bob_private.artifact_source_assessment(p_project text,p_artifact uuid,p_revision integer)
returns table(source_state text,source_reasons text[])
language sql stable security invoker set search_path='' set join_collapse_limit=1 set from_collapse_limit=1 as $$
 with recursive chain as (
  select c.artifact_id,c.artifact_revision,c.source_artifact_id,c.source_revision,c.manifest,1 depth from bob.artifact_cad_revisions c
   where c.project_id=p_project and c.artifact_id=p_artifact and c.artifact_revision=p_revision
  union all
  select c.artifact_id,c.artifact_revision,c.source_artifact_id,c.source_revision,c.manifest,x.depth+1 from chain x
   join bob.artifact_cad_revisions c on c.project_id=p_project and c.artifact_id=x.source_artifact_id and c.artifact_revision=x.source_revision where x.depth<64
 ), pins as (
  select distinct b->'source' src from chain x cross join lateral jsonb_array_elements(coalesce(x.manifest->'bob_lineage'->'bindings','[]'::jsonb)) b
   where b->'source'->>'kind'='space_measurement'
 ), physical as (
  select coalesce(bool_or(sm.id is null or sp.id is null or bu.id is null),false) unavailable,
   coalesce(bool_or(sp.revision is distinct from (p.src->>'space_revision')::integer or sp.archived or bu.archived),false) changed
  from pins p left join bob.space_measurements sm on sm.id=(p.src->>'id')::uuid
   left join bob.project_spaces sp on sp.project_id=p_project and sp.id=(p.src->>'space_id')::uuid
   left join bob.project_buildings bu on bu.project_id=p_project and bu.id=(p.src->>'building_id')::uuid
 )
 select case when old.source_state='unavailable' or physical.unavailable then 'unavailable'
   when old.source_state='changed' or physical.changed then 'changed' else 'current' end,
  old.source_reasons||case when physical.unavailable then array['physical_source_unavailable']::text[]
    when physical.changed then array['physical_source_changed']::text[] else '{}'::text[] end
 from bob_private.artifact_source_assessment_before_physical(p_project,p_artifact,p_revision) old cross join physical;
$$;
revoke all on function bob_private.artifact_source_assessment(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.artifact_source_assessment(text,uuid,integer) to authenticated;
create or replace view bob.artifact_source_status with(security_invoker=true) as
 select r.project_id,r.artifact_id,r.revision,s.source_state,s.source_reasons from bob.artifact_revisions r
 cross join lateral bob_private.artifact_source_assessment(r.project_id,r.artifact_id,r.revision) s;
commit;
