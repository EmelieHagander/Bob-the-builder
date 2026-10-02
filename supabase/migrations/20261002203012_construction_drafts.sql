-- K1: construction checkpoints share Artifact identity and CAD parameter validation.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.check_cad_parameter_graph(new bob.artifact_cad_revisions, allow_history boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare g jsonb:=new.manifest->'bob_parameters'; n jsonb; s jsonb; ref jsonb; b jsonb; a jsonb; c jsonb;
 checked jsonb:='{}'; paths text[]:='{}'; used text[]:='{}'; key text; u text; x numeric; y numeric; v numeric;
 m bob.measurement_revisions; sm bob.space_measurements; expected jsonb; parent jsonb; geometry jsonb;
 prior bob.artifact_cad_revisions; history boolean; target record; f jsonb; frame_ids text[]:='{}'; translation jsonb; rotation jsonb; axes jsonb; i integer; j integer; sx double precision;cx double precision;sy double precision;cy double precision;sz double precision;cz double precision;
begin
 select * into prior from bob.artifact_cad_revisions where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=new.artifact_revision-1;
 if allow_history and found and to_jsonb(prior)-'artifact_revision'=to_jsonb(new)-'artifact_revision' then
  select p.archived<>r.archived into history from bob.artifact_revisions p join bob.artifact_revisions r on r.artifact_id=p.artifact_id and r.revision=p.revision+1 where r.artifact_id=new.artifact_id and r.revision=new.artifact_revision;
  if coalesce(history,false) then return; end if;
 end if;
 if new.source_artifact_id is not null then
  select manifest->'bob_parameters' into parent from bob.artifact_cad_revisions where project_id=new.project_id and artifact_id=new.source_artifact_id and artifact_revision=new.source_revision;
  -- Exact legacy detail views retain honest partial provenance. No reconstruction.
  if parent is null and g is null then return; end if;
  if parent is null then raise exception 'legacy_parameters_unknown' using errcode='22023'; end if;
 end if;
 if g is null then raise exception 'cad_parameters_required' using errcode='22023'; end if;
 if jsonb_typeof(g) is distinct from 'object' or g-array['version','project_id','coverage','precision','coordinate_system','frames','nodes','bindings']<>'{}'
  or (select count(*) from jsonb_object_keys(g))<>8 or g->'version' is distinct from '1'::jsonb or g->>'project_id' is distinct from new.project_id
  or g->>'coverage' is distinct from 'complete' or g->>'precision' is distinct from 'decimal_6'
  or jsonb_typeof(g->'frames') is distinct from 'array' or jsonb_array_length(g->'frames')>16
  or jsonb_typeof(g->'nodes') is distinct from 'array' or jsonb_array_length(g->'nodes') not between 1 and 1024
  or jsonb_typeof(g->'bindings') is distinct from 'array' or jsonb_array_length(g->'bindings') not between 1 and 8192
  then raise exception 'invalid_cad_parameters' using errcode='22023'; end if;
 if g->'coordinate_system' is distinct from ('{"version":1,"length_unit":"mm","angle_unit":"deg","origin":[0,0,0],"positive_axes":[[1,0,0],[0,1,0],[0,0,1]],"rotation":"build123d_0.13_intrinsic_xyz","definition_origins":{"box":"minimum_corner","cylinder":"xy_center_z_min","tube":"xy_center_z_min"},"instance_parent":"assembly","cut_parent":"definition","frame_identity":"artifact_revision_and_recipe_path","views":{"front":{"toward_camera":[0,-1,0],"up":[0,0,1]},"right":{"toward_camera":[1,0,0],"up":[0,0,1]},"top":{"toward_camera":[0,0,1],"up":[0,1,0]},"isometric":{"toward_camera":[1,-1,1],"up":[0,0,1]}}}'::jsonb||jsonb_build_object('id',new.recipe->>'assembly_id')) then raise exception 'invalid_coordinate_system'; end if;
 if exists(select 1 from jsonb_array_elements(g->'nodes') node where node->>'role'='source' group by node->'source'->>'kind' having count(distinct node->'source'->>'id')>20)
  or exists(select 1 from jsonb_array_elements(g->'nodes') node where node->>'role'='source' group by node->'source'->>'kind',node->'source'->>'id' having count(distinct node->'source')>1) then raise exception 'parameter_source_budget_or_conflict'; end if;
 -- The earlier lineage trigger locks all canonical project measurement pins.
 -- Physical graph-only inputs additionally serialize accepted scope/head changes.
 perform 1 from bob.project_physical_scope where project_id=new.project_id order by id for share;
 perform 1 from bob.buildings where id in (select (node_item->'sources'->0->>'building_id')::uuid from jsonb_array_elements(g->'nodes') node_item where node_item->>'role'='source' and node_item->'source'->>'kind'='space_measurement') order by id for share;
 perform 1 from bob.building_spaces where id in (select (node_item->'sources'->0->>'space_id')::uuid from jsonb_array_elements(g->'nodes') node_item where node_item->>'role'='source' and node_item->'source'->>'kind'='space_measurement') order by id for share;
 perform 1 from bob.media_assets where project_id=new.project_id and id in (select substring(frame_item->>'source_ref' from 7)::uuid from jsonb_array_elements(g->'frames') frame_item where frame_item->>'kind'='image') order by id for update;
 perform 1 from bob.media_links where project_id=new.project_id and media_id in (select substring(frame_item->>'source_ref' from 7)::uuid from jsonb_array_elements(g->'frames') frame_item where frame_item->>'kind'='image') order by id for share;
 for n in select value from jsonb_array_elements(g->'nodes') loop
  key:=n->>'id';
  if coalesce(key,'')!~'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$' or checked?key or jsonb_typeof(n->'normalized') is distinct from 'object'
   or (n->'normalized')-array['value','unit']<>'{}' or (select count(*) from jsonb_object_keys(n->'normalized'))<>2
   or jsonb_typeof(n->'normalized'->'value') is distinct from 'number' or jsonb_typeof(n->'sources') is distinct from 'array' then raise exception 'invalid_parameter_node'; end if;
  if n->>'role'='source' then
   if n-array['id','role','source','normalized','sources']<>'{}' or (select count(*) from jsonb_object_keys(n))<>5 or jsonb_array_length(n->'sources')<>1 then raise exception 'invalid_parameter_source'; end if;
   s:=n->'sources'->0;ref:=n->'source';u:='mm';
   if jsonb_typeof(ref) is distinct from 'object' or jsonb_typeof(ref->'id') is distinct from 'string' or coalesce(ref->>'id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'invalid_parameter_source'; end if;
   if ref->>'kind'='project_measurement' then
    if ref-array['kind','id','revision']<>'{}' or jsonb_typeof(ref->'revision') is distinct from 'number' or coalesce(ref->>'revision','')!~'^[1-9][0-9]{0,8}$' then raise exception 'invalid_parameter_source'; end if;
    select r.* into m from bob.measurement_revisions r join bob.artifact_measurements pin on pin.project_id=r.project_id and pin.measurement_id=r.measurement_id and pin.measurement_revision=r.revision
     where pin.project_id=new.project_id and pin.artifact_id=new.artifact_id and pin.artifact_revision=new.artifact_revision and r.measurement_id=(ref->>'id')::uuid and r.revision=(ref->>'revision')::integer;
    if not found or m.archived or m.value is null or m.value<=0 or m.truth='unknown' then raise exception 'parameter_source_not_pinned'; end if;
    expected:=jsonb_build_object('kind','project_measurement','id',m.measurement_id,'revision',m.revision,'value',m.value::text,'unit',m.unit,'truth',m.truth,'description',m.source);
    v:=m.value*case m.unit when 'm' then 1000 when 'cm' then 10 when 'mm' then 1 end;
   elsif ref->>'kind'='space_measurement' then
    if ref-array['kind','id','space_revision']<>'{}' or jsonb_typeof(ref->'space_revision') is distinct from 'number' or coalesce(ref->>'space_revision','')!~'^[1-9][0-9]{0,8}$' then raise exception 'invalid_parameter_source'; end if;
    select r.* into sm from bob.space_measurements r join bob.project_spaces sp on sp.project_id=new.project_id and sp.id=r.space_id join bob.project_buildings bu on bu.project_id=new.project_id and bu.id=r.building_id
     where r.id=(ref->>'id')::uuid and not sp.archived and not bu.archived;
    if not found then raise exception 'physical_source_unavailable' using errcode='42501'; end if;
    if sm.space_revision<>(ref->>'space_revision')::integer or not exists(select 1 from bob.project_spaces sp where sp.project_id=new.project_id and sp.id=sm.space_id and sp.revision=sm.space_revision) then raise exception 'physical_source_changed' using errcode='40001'; end if;
    if sm.value is null or sm.value<=0 or sm.truth='unknown' then raise exception 'invalid_parameter_source'; end if;
    expected:=jsonb_build_object('kind','space_measurement','id',sm.id,'building_id',sm.building_id,'space_id',sm.space_id,'space_revision',sm.space_revision,'measurement_id',sm.measurement_id,'measurement_revision',sm.measurement_revision,'value',sm.value::text,'unit',sm.unit,'truth',sm.truth,'description',sm.source);
    v:=sm.value*case sm.unit when 'm' then 1000 when 'cm' then 10 when 'mm' then 1 end;
   else raise exception 'invalid_parameter_source'; end if;
   if s is distinct from expected or v is null then raise exception 'parameter_source_mismatch'; end if;
  elsif n->>'role' in ('decision','estimate') then
   if n-array['id','role','value','unit','reason','normalized','sources']<>'{}' or (select count(*) from jsonb_object_keys(n))<>7
    or jsonb_array_length(n->'sources')<>0 or jsonb_typeof(n->'value') is distinct from 'number' or jsonb_typeof(n->'reason') is distinct from 'string'
    or char_length(btrim(n->>'reason')) not between 1 and 2000 then raise exception 'invalid_parameter_decision'; end if;
   v:=(n->>'value')::numeric;u:=n->>'unit';
  elsif n->>'role'='derived' then
   if n-array['id','role','operation','operands','rounding','normalized','sources']<>'{}' or (select count(*) from jsonb_object_keys(n))<>7
    or jsonb_array_length(n->'sources')<>0 or jsonb_typeof(n->'operands') is distinct from 'array' or jsonb_array_length(n->'operands')<>2
    or coalesce(n->>'rounding','') not in ('exact','half_away_6') then raise exception 'invalid_parameter_formula'; end if;
   a:=checked->(n->'operands'->>0);c:=checked->(n->'operands'->>1);
   if a is null or c is null then raise exception 'parameter_cycle_or_missing_operand'; end if;
   used:=used||array[n->'operands'->>0,n->'operands'->>1];
   x:=(a->>'value')::numeric;y:=(c->>'value')::numeric;
   if n->>'operation' in ('add_v1','subtract_v1') then
    if a->>'unit'<>c->>'unit' then raise exception 'parameter_unit_mismatch'; end if;
    u:=a->>'unit';v:=case when n->>'operation'='add_v1' then x+y else x-y end;
   elsif n->>'operation'='multiply_v1' then
    if a->>'unit'<>'scalar' and c->>'unit'<>'scalar' then raise exception 'parameter_unit_mismatch'; end if;
    u:=case when a->>'unit'='scalar' then c->>'unit' else a->>'unit' end;v:=x*y;
   elsif n->>'operation'='divide_v1' then
    if y=0 or c->>'unit'<>'scalar' and a->>'unit'<>c->>'unit' then raise exception 'parameter_unit_mismatch'; end if;
    u:=case when a->>'unit'=c->>'unit' then 'scalar' else a->>'unit' end;v:=x/y;
   else raise exception 'invalid_parameter_formula'; end if;
   if n->>'rounding'='half_away_6' then v:=round(v,6); end if;
  else raise exception 'unknown_required_parameter'; end if;
  if u is null or u not in ('mm','deg','scalar') or abs(v)>1000000000 or v<>round(v,6) or n->'normalized' is distinct from jsonb_build_object('value',v,'unit',u) then raise exception 'parameter_result_mismatch'; end if;
  checked:=checked||jsonb_build_object(key,jsonb_build_object('value',v,'unit',u));
 end loop;
 for f in select value from jsonb_array_elements(g->'frames') loop
  if jsonb_typeof(f) is distinct from 'object' or f-array['id','kind','source_ref','required','reason','placement','source_version','translation_mm','rotation_degrees','axes']<>'{}'
   or (select count(*) from jsonb_object_keys(f))<>10 or coalesce(f->>'id','')!~'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$' or f->>'id'=any(frame_ids)
   or jsonb_typeof(f->'required') is distinct from 'boolean' or jsonb_typeof(f->'reason') is distinct from 'string' or char_length(btrim(f->>'reason')) not between 1 and 2000 then raise exception 'invalid_coordinate_frame'; end if;
  frame_ids:=array_append(frame_ids,f->>'id');
  if f->>'kind'='room' then
   key:=substring(f->>'source_ref' from 11);
   if left(f->>'source_ref',10) is distinct from 'parameter:' or f->'source_version' is distinct from 'null'::jsonb
    or not exists(select 1 from jsonb_array_elements(g->'nodes') node_item where node_item->>'id'=key and node_item->>'role'='source' and node_item->'source'->>'kind'='space_measurement') then raise exception 'coordinate_room_source_required'; end if;
   used:=array_append(used,key);
  elsif f->>'kind'='image' then
   if coalesce(f->>'source_ref','')!~*'^image:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or jsonb_typeof(f->'source_version') is distinct from 'string'
    or not bob_private.cad_image_version_matches(new.project_id,substring(f->>'source_ref' from 7)::uuid,f->>'source_version') then raise exception 'coordinate_image_changed' using errcode='40001'; end if;
  else raise exception 'invalid_coordinate_source'; end if;
  if f->'placement'='null'::jsonb then
   if f->'required'='true'::jsonb or f->'translation_mm' is distinct from 'null'::jsonb or f->'rotation_degrees' is distinct from 'null'::jsonb or f->'axes' is distinct from 'null'::jsonb then raise exception 'unknown_required_transform'; end if;
  else
   if jsonb_typeof(f->'placement') is distinct from 'object' or (f->'placement')-array['x','y','z','rx','ry','rz']<>'{}' or (select count(*) from jsonb_object_keys(f->'placement'))<>6 then raise exception 'invalid_coordinate_transform'; end if;
   translation:='[]';rotation:='[]';
   foreach key in array array['x','y','z','rx','ry','rz'] loop
    a:=checked->(f->'placement'->>key);u:=case when left(key,1)='r' then 'deg' else 'mm' end;
    if a is null or jsonb_typeof(f->'placement'->key) is distinct from 'string' or a->>'unit'<>u or abs((a->>'value')::numeric)>(case when u='deg' then 360000 else 10000000 end) then raise exception 'coordinate_transform_unit_or_range'; end if;
    used:=array_append(used,f->'placement'->>key);
    if u='mm' then translation:=translation||jsonb_build_array(a->'value');else rotation:=rotation||jsonb_build_array(a->'value');end if;
   end loop;
   if f->'translation_mm' is distinct from translation or f->'rotation_degrees' is distinct from rotation then raise exception 'coordinate_transform_mismatch'; end if;
   sx:=sin((rotation->>0)::double precision*pi()/180);cx:=cos((rotation->>0)::double precision*pi()/180);
   sy:=sin((rotation->>1)::double precision*pi()/180);cy:=cos((rotation->>1)::double precision*pi()/180);
   sz:=sin((rotation->>2)::double precision*pi()/180);cz:=cos((rotation->>2)::double precision*pi()/180);
   axes:=to_jsonb(array[array[cy*cz,cx*sz+sx*sy*cz,sx*sz-cx*sy*cz],array[-cy*sz,cx*cz-sx*sy*sz,sx*cz+cx*sy*sz],array[sy,-sx*cy,cx*cy]]);
   if jsonb_typeof(f->'axes') is distinct from 'array' or jsonb_array_length(f->'axes')<>3 then raise exception 'invalid_coordinate_axes'; end if;
   for i in 0..2 loop
    if jsonb_typeof(f->'axes'->i) is distinct from 'array' or jsonb_array_length(f->'axes'->i)<>3 then raise exception 'invalid_coordinate_axes'; end if;
    for j in 0..2 loop
     if jsonb_typeof(f->'axes'->i->j) is distinct from 'number' or abs((f->'axes'->i->>j)::numeric-(axes->i->>j)::numeric)>0.000000001 then raise exception 'coordinate_axes_mismatch'; end if;
    end loop;
   end loop;
  end if;
 end loop;
 select jsonb_object_agg(parameter_path,jsonb_build_object('value',parameter_value,'unit',parameter_unit)) into geometry from bob_private.cad_numeric_parameters(new.recipe);
 for b in select value from jsonb_array_elements(g->'bindings') loop
  if jsonb_typeof(b) is distinct from 'object' or b-array['path','node']<>'{}' or (select count(*) from jsonb_object_keys(b))<>2
   or jsonb_typeof(b->'path') is distinct from 'string' or jsonb_typeof(b->'node') is distinct from 'string' or b->>'path'=any(paths) or not checked?(b->>'node') then raise exception 'invalid_parameter_binding'; end if;
  paths:=array_append(paths,b->>'path');used:=array_append(used,b->>'node');
  if geometry->(b->>'path') is null or geometry->(b->>'path') is distinct from checked->(b->>'node') then raise exception 'parameter_geometry_mismatch'; end if;
 end loop;
 if exists(select 1 from jsonb_object_keys(geometry) parameter_path where not parameter_path=any(paths)) then raise exception 'unbound_required_parameter'; end if;
 if exists(select 1 from jsonb_object_keys(checked) k where not k=any(used)) then raise exception 'unused_parameter_node'; end if;
 for b in select value from jsonb_array_elements(coalesce(new.manifest->'bob_lineage'->'bindings','[]')) loop
  select node into n from jsonb_array_elements(g->'bindings') binding join jsonb_array_elements(g->'nodes') node on node->>'id'=binding->>'node'
   where binding->>'path'='definitions/'||(b->>'definition_id')||'/'||(b->>'dimension');
  if n->>'role' is distinct from 'source' or n->'sources'->0 is distinct from b->'source' then raise exception 'conflicting_parameter_bindings'; end if;
 end loop;
 if parent is not null then
  if g->'frames' is distinct from parent->'frames' or g->'coordinate_system' is distinct from parent->'coordinate_system'
   or exists(select 1 from jsonb_array_elements(g->'nodes') node where not exists(select 1 from jsonb_array_elements(parent->'nodes') old_node where old_node=node))
   or exists(select 1 from jsonb_array_elements(g->'bindings') binding where not exists(select 1 from jsonb_array_elements(parent->'bindings') old_binding where old_binding=binding)) then raise exception 'parameters_must_reuse_source'; end if;
 end if;
 return;
end $$;

revoke all on function bob_private.check_cad_parameter_graph(bob.artifact_cad_revisions,boolean) from public,anon,authenticated,service_role;
create or replace function bob_private.validate_cad_parameter_graph()
returns trigger language plpgsql security invoker set search_path='' as $$
begin perform bob_private.check_cad_parameter_graph(new,true); return new; end $$;

create table bob.artifact_construction_revisions (
 project_id text not null references bob.projects(id) on delete cascade,
 artifact_id uuid not null,
 artifact_revision integer not null,
 recipe jsonb not null,
 parameters jsonb not null,
 materials jsonb not null,
 joints jsonb not null,
 open_questions jsonb not null,
 primary key(artifact_id,artifact_revision),
 foreign key(artifact_id,artifact_revision) references bob.artifact_revisions(artifact_id,revision) on delete cascade,
 foreign key(artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade
);
create index construction_project_idx on bob.artifact_construction_revisions(project_id,artifact_id);
alter table bob.artifact_construction_revisions enable row level security;
revoke all on bob.artifact_construction_revisions from public,anon,authenticated,service_role;
grant select on bob.artifact_construction_revisions to authenticated;
create policy project_read on bob.artifact_construction_revisions for select to authenticated using(bob_private.has_project_access(project_id));
create function bob_private.construction_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'construction_revision_immutable' using errcode='22023'; end $$;
create trigger construction_immutable before update on bob.artifact_construction_revisions for each row execute function bob_private.construction_immutable();
revoke all on function bob_private.construction_immutable() from public,anon,authenticated,service_role;

-- All public Artifact paths preserve the checkpoint. Publication is a later
-- guarded operation; a generic revise or older CAD command cannot discard it.
alter function bob_private.artifact_command(text,text,uuid,integer,jsonb) rename to artifact_command_before_construction;
revoke all on function bob_private.artifact_command_before_construction(text,text,uuid,integer,jsonb) from public,anon,authenticated,service_role;
create function bob_private.artifact_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior bob.artifact_construction_revisions; saved jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select c.* into prior from bob.artifact_construction_revisions c join bob.artifacts a on a.id=c.artifact_id and a.current_revision=c.artifact_revision where c.project_id=p_project and c.artifact_id=p_artifact;
 if prior.artifact_id is not null and p_action='revise' then raise exception 'use_construction_draft_tool' using errcode='22023'; end if;
 saved:=bob_private.artifact_command_before_construction(p_project,p_action,p_artifact,p_expected,p_data);
 if prior.artifact_id is not null and p_action in ('archive','restore') then
  insert into bob.artifact_construction_revisions values(p_project,p_artifact,(saved->>'revision')::integer,prior.recipe,prior.parameters,prior.materials,prior.joints,prior.open_questions);
 end if;
 return saved;
end $$;
revoke all on function bob_private.artifact_command(text,text,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function bob_private.artifact_command(text,text,uuid,integer,jsonb) to authenticated;

create function bob_private.check_construction(p_project text,p_artifact uuid,p_recipe jsonb,p_materials jsonb,p_joints jsonb,p_questions jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare d jsonb; m jsonb; j jsonb; endpoint jsonb; c bob.catalog_items; r bob.catalog_item_revisions; old bob.artifact_construction_revisions; count_used integer;
begin
 if jsonb_typeof(p_recipe) is distinct from 'object' or p_recipe-array['contract_version','units','assembly_id','definitions','instances','views','clearances','motions']<>'{}'
  or p_recipe->'contract_version' is distinct from '1'::jsonb or p_recipe->>'units' is distinct from 'mm' or coalesce(p_recipe->>'assembly_id','')!~'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'
  or jsonb_typeof(p_recipe->'views') is distinct from 'array' or jsonb_array_length(p_recipe->'views') not between 1 and 4
  or exists(select 1 from jsonb_array_elements_text(p_recipe->'views') v where v not in ('front','right','top','isometric'))
  or (select count(distinct v) from jsonb_array_elements_text(p_recipe->'views') v)<>jsonb_array_length(p_recipe->'views')
  then raise exception 'invalid_construction_recipe' using errcode='22023'; end if;
 -- This runs the existing geometry enumerator, including finite ranges and references.
 perform * from bob_private.cad_numeric_parameters(p_recipe);
 -- First checkpoint supports the existing primitives/cuts; optional engine checks
 -- will be admitted with the K2 validation contract rather than silently ignored.
 if coalesce(p_recipe->'clearances','[]')<>'[]' or coalesce(p_recipe->'motions','[]')<>'[]' then raise exception 'construction_checks_not_supported' using errcode='22023'; end if;
 if jsonb_typeof(p_materials) is distinct from 'array' or jsonb_array_length(p_materials)<>jsonb_array_length(p_recipe->'definitions')
  or (select count(distinct x->>'definition_id') from jsonb_array_elements(p_materials) x)<>jsonb_array_length(p_materials)
  or jsonb_typeof(p_joints) is distinct from 'array' or jsonb_array_length(p_joints)>1024
  or (select count(distinct x->>'id') from jsonb_array_elements(p_joints) x)<>jsonb_array_length(p_joints)
  or jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)>40
  or exists(select 1 from jsonb_array_elements(p_questions) q where jsonb_typeof(q)<>'string' or char_length(btrim(q#>>'{}')) not between 1 and 1000)
  then raise exception 'invalid_construction_shape' using errcode='22023'; end if;
 -- Serialize exact catalog pins with catalog revisions in a stable order.
 perform 1 from bob.catalog_items where id in (select (x->>'material_id')::uuid from jsonb_array_elements(p_materials) x union select (x->>'part_id')::uuid from jsonb_array_elements(p_materials) x) order by id for share;
 for m in select value from jsonb_array_elements(p_materials) loop
  if jsonb_typeof(m) is distinct from 'object' or m-array['definition_id','material_id','material_revision','part_id','part_revision']<>'{}' or (select count(*) from jsonb_object_keys(m))<>5
   or coalesce(m->>'material_revision','')!~'^[1-9][0-9]{0,8}$' then raise exception 'invalid_material_pin' using errcode='22023'; end if;
  select value into d from jsonb_array_elements(p_recipe->'definitions') x where x->>'id'=m->>'definition_id';
  if d is null or d->'material_ref' is distinct from 'null'::jsonb then raise exception 'material_binding_required' using errcode='22023'; end if;
  select * into c from bob.catalog_items where id=(m->>'material_id')::uuid and kind='material' and (project_id=p_project or project_id is null);
  if not found then raise exception 'material_unavailable' using errcode='42501'; end if;
  if c.current_revision<>(m->>'material_revision')::integer then raise exception 'material_changed' using errcode='PT409'; end if;
  if m->>'part_id' is null then
   if m->'part_id' is distinct from 'null'::jsonb or m->'part_revision' is distinct from 'null'::jsonb then raise exception 'invalid_part_pin' using errcode='22023'; end if;
  else
   if coalesce(m->>'part_revision','')!~'^[1-9][0-9]{0,8}$' then raise exception 'invalid_part_pin' using errcode='22023'; end if;
   select * into c from bob.catalog_items where id=(m->>'part_id')::uuid and kind='part' and (project_id=p_project or project_id is null);
   if not found then raise exception 'part_unavailable' using errcode='42501'; end if;
   if c.current_revision<>(m->>'part_revision')::integer then raise exception 'part_changed' using errcode='PT409'; end if;
   select * into r from bob.catalog_item_revisions where item_id=c.id and revision=c.current_revision;
   if r.material_id is distinct from (m->>'material_id')::uuid or r.material_revision is distinct from (m->>'material_revision')::integer then raise exception 'part_material_mismatch' using errcode='22023'; end if;
  end if;
 end loop;
 for j in select value from jsonb_array_elements(p_joints) loop
  if jsonb_typeof(j) is distinct from 'object' or j-array['id','method','first','second','reason']<>'{}' or (select count(*) from jsonb_object_keys(j))<>5
   or coalesce(j->>'id','')!~'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'
   or coalesce(j->>'method','') not in ('screwed_butt','glued_butt','dowel','bolted','unresolved')
   or jsonb_typeof(j->'reason') is distinct from 'string' or char_length(btrim(j->>'reason')) not between 1 and 2000
   or j->'first'->>'instance_id'=j->'second'->>'instance_id' then raise exception 'invalid_joint' using errcode='22023'; end if;
  for endpoint in select value from jsonb_array_elements(jsonb_build_array(j->'first',j->'second')) loop
   if jsonb_typeof(endpoint) is distinct from 'object' or endpoint-array['instance_id','face']<>'{}' or (select count(*) from jsonb_object_keys(endpoint))<>2
    or coalesce(endpoint->>'face','') not in ('x_min','x_max','y_min','y_max','z_min','z_max')
    or not exists(select 1 from jsonb_array_elements(p_recipe->'instances') i join jsonb_array_elements(p_recipe->'definitions') def on def->>'id'=i->>'definition_id' where i->>'id'=endpoint->>'instance_id' and def->>'primitive'='box')
    then raise exception 'joint_endpoint_missing_or_unsupported' using errcode='22023'; end if;
  end loop;
 end loop;
 -- Existing identities retain their meaning, including across removal/re-add.
 for old in select * from bob.artifact_construction_revisions where project_id=p_project and artifact_id=p_artifact loop
  if old.recipe->>'assembly_id' is distinct from p_recipe->>'assembly_id'
   or exists(select 1 from jsonb_array_elements(old.recipe->'instances') a join jsonb_array_elements(p_recipe->'instances') b on a->>'id'=b->>'id' where a->>'definition_id' is distinct from b->>'definition_id')
   or exists(select 1 from jsonb_array_elements(old.recipe->'definitions') a join jsonb_array_elements(p_recipe->'definitions') b on a->>'id'=b->>'id' where a->>'primitive' is distinct from b->>'primitive')
   or exists(select 1 from jsonb_array_elements(old.joints) a join jsonb_array_elements(p_joints) b on a->>'id'=b->>'id' where a->'first' is distinct from b->'first' or a->'second' is distinct from b->'second')
   then raise exception 'construction_identity_reused' using errcode='22023'; end if;
 end loop;
end $$;
revoke all on function bob_private.check_construction(text,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

create function bob_private.construction_revision_complete() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from bob.artifact_construction_revisions where artifact_id=new.artifact_id and artifact_revision=new.revision-1)
  and not exists(select 1 from bob.artifact_construction_revisions where artifact_id=new.artifact_id and artifact_revision=new.revision) then
  raise exception 'construction_checkpoint_required' using errcode='22023'; end if;
 return new;
end $$;
create constraint trigger construction_revision_complete after insert on bob.artifact_revisions deferrable initially deferred for each row execute function bob_private.construction_revision_complete();
revoke all on function bob_private.construction_revision_complete() from public,anon,authenticated,service_role;

alter function bob_private.artifact_source_assessment(text,uuid,integer) rename to artifact_source_assessment_before_construction;
create function bob_private.artifact_source_assessment(p_project text,p_artifact uuid,p_revision integer)
returns table(source_state text,source_reasons text[]) language plpgsql stable security invoker set search_path='' as $$
declare c bob.artifact_construction_revisions; base_state text; reasons text[]; changed boolean; unavailable boolean;
begin
 select s.source_state,s.source_reasons into base_state,reasons from bob_private.artifact_source_assessment_before_construction(p_project,p_artifact,p_revision) s;
 if not found then return; end if;
 select * into c from bob.artifact_construction_revisions where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision;
 if not found then return query select base_state,reasons;return; end if;
 select exists(select 1 from jsonb_array_elements(c.materials) m left join bob.catalog_items material on material.id=(m->>'material_id')::uuid left join bob.catalog_items part on part.id=(m->>'part_id')::uuid
  where material.id is null or m->>'part_id' is not null and part.id is null) into unavailable;
 select exists(select 1 from jsonb_array_elements(c.materials) m join bob.catalog_items material on material.id=(m->>'material_id')::uuid left join bob.catalog_items part on part.id=(m->>'part_id')::uuid
  where material.current_revision is distinct from (m->>'material_revision')::integer or m->>'part_id' is not null and part.current_revision is distinct from (m->>'part_revision')::integer) into changed;
 if changed then reasons:=array_append(reasons,'construction_catalog_changed'); end if;
 if exists(select 1 from jsonb_array_elements(c.parameters->'nodes') n where n->>'role'='source' and n->'source'->>'kind'='space_measurement' and not exists(
  select 1 from bob.space_measurements m join bob.project_spaces s on s.id=m.space_id and s.project_id=p_project join bob.project_buildings b on b.id=m.building_id and b.project_id=p_project
  where m.id=(n->'source'->>'id')::uuid and m.space_revision=(n->'source'->>'space_revision')::integer and s.revision=m.space_revision and not s.archived and not b.archived)) then
  unavailable:=true;reasons:=array_append(reasons,'construction_physical_source_changed_or_unavailable'); end if;
 if exists(select 1 from jsonb_array_elements(c.parameters->'frames') f where f->>'kind'='image' and not bob_private.cad_image_version_matches(p_project,substring(f->>'source_ref' from 7)::uuid,f->>'source_version')) then
  changed:=true;reasons:=array_append(reasons,'construction_image_changed'); end if;
 return query select case when unavailable or base_state='unavailable' then 'unavailable' when changed or base_state='changed' then 'changed' else base_state end,reasons;
end $$;
revoke all on function bob_private.artifact_source_assessment(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.artifact_source_assessment(text,uuid,integer) to authenticated;
create or replace view bob.artifact_source_status with(security_invoker=true) as
 select r.project_id,r.artifact_id,r.revision,s.source_state,s.source_reasons from bob.artifact_revisions r
 cross join lateral bob_private.artifact_source_assessment(r.project_id,r.artifact_id,r.revision) s;

create function bob.read_construction_draft(p_project text,p_artifact uuid default null,p_revision integer default null,p_after uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c bob.artifact_construction_revisions; a bob.current_artifacts; r bob.artifact_revisions; freshness text; items jsonb; more boolean;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_artifact is null then
  if p_revision is not null then raise exception 'artifact_required' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from (
   select head.id,head.revision,head.title,'draft'::text as construction_status from bob.current_artifacts head join bob.artifact_construction_revisions draft on draft.artifact_id=head.id and draft.artifact_revision=head.revision
   where head.project_id=p_project and not head.archived and (p_after is null or head.id>p_after) order by head.id limit 13
  ) x;
  more:=jsonb_array_length(items)>12;
  if more then items:=items-12; end if;
  return jsonb_build_object('status','ok','projectId',p_project,'items',items,'truncated',more,'next_cursor',case when more then items->11->>'id' else null end);
 end if;
 if p_after is not null or p_revision is not null and p_revision<1 then raise exception 'invalid_construction_read' using errcode='22023'; end if;
 select * into a from bob.current_artifacts where project_id=p_project and id=p_artifact;
 select * into c from bob.artifact_construction_revisions where project_id=p_project and artifact_id=p_artifact and artifact_revision=coalesce(p_revision,a.revision);
 if not found then return jsonb_build_object('status','not_found','projectId',p_project); end if;
 select * into r from bob.artifact_revisions where project_id=p_project and artifact_id=p_artifact and revision=c.artifact_revision;
 select source_state into freshness from bob.artifact_source_status where project_id=p_project and artifact_id=p_artifact and revision=c.artifact_revision;
 return jsonb_build_object('status','ok','projectId',p_project,'artifact_id',p_artifact,'revision',c.artifact_revision,'current_revision',a.revision,'archived',a.archived,
  'title',r.title,'description',substring(r.description from char_length('Construction draft — not rendered or reviewed. ')+1),'area_id',a.area_id,'target_revision',r.target_revision,
  'construction_status','draft','rendered',false,'reviewed',false,'source_state',coalesce(freshness,'unavailable'),
  'recipe',c.recipe,'parameters',c.parameters,'materials',c.materials,'joints',c.joints,'open_questions',c.open_questions,
  'limits',jsonb_build_array('joint_fit_and_strength_unchecked','hardware_not_derived','no_drawing_or_purchase_output'));
end $$;
revoke all on function bob.read_construction_draft(text,uuid,integer,uuid) from public,anon,service_role;
grant execute on function bob.read_construction_draft(text,uuid,integer,uuid) to authenticated;

create function bob_private.bob_project_write_v14(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; msg text; op text; existing bob_private.bob_write_receipts; aid uuid; expected integer; saved jsonb; rec jsonb; result jsonb; h bob.artifacts; before_row jsonb; packet bob.artifact_cad_revisions; pins jsonb;
begin
 if p_payload->>'kind' is distinct from 'construction' then return bob_private.bob_project_write_v13(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>512000
  or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}' or (select count(*) from jsonb_object_keys(p_payload))<>6
  or p_payload->'expected_updated_at' is distinct from 'null'::jsonb or coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$'
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(p_payload->>'request_quote') not between 1 and 500
  or jsonb_typeof(d) is distinct from 'object' or d-array['key','title','description','area_id','target_revision','change_note','recipe','parameters','materials','joints','open_questions']<>'{}'
  or (select count(*) from jsonb_object_keys(d))<>11 or coalesce(d->>'key','')!~'^[A-Za-z0-9_-]{1,80}$'
  or coalesce(d->>'target_revision','')!~'^[1-9][0-9]{0,8}$'
  or jsonb_typeof(d->'title') is distinct from 'string' or char_length(btrim(d->>'title')) not between 1 and 200
  or jsonb_typeof(d->'description') is distinct from 'string' or char_length(btrim(d->>'description')) not between 1 and 5500
  or jsonb_typeof(d->'change_note') is distinct from 'string' or char_length(btrim(d->>'change_note')) not between 1 and 1000
  then raise exception 'invalid_construction_write' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 op:='construction:'||(d->>'key');
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='PT409'; end if;
  return existing.receipt;
 end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 expected:=(p_payload->>'expected_revision')::integer;
 aid:=coalesce((p_payload->>'record_id')::uuid,gen_random_uuid());
 if p_payload->>'record_id' is null then
  if expected<>0 then raise exception 'construction_changed' using errcode='PT409'; end if;
 else
  select * into h from bob.artifacts where id=aid and project_id=p_project;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  if h.current_revision<>expected then raise exception 'construction_changed' using errcode='PT409'; end if;
  if not exists(select 1 from bob.artifact_construction_revisions where project_id=p_project and artifact_id=aid and artifact_revision=expected)
   or exists(select 1 from bob.artifact_cad_revisions where artifact_id=aid) then raise exception 'not_a_construction_draft' using errcode='22023'; end if;
  if h.area_id is distinct from d->>'area_id' then raise exception 'construction_scope_changed' using errcode='PT409'; end if;
  select to_jsonb(a) into before_row from bob.current_artifacts a where id=aid;
 end if;
 perform bob_private.check_construction(p_project,aid,d->'recipe',d->'materials',d->'joints',d->'open_questions');
 select coalesce(jsonb_agg(distinct jsonb_build_object('id',n->'source'->>'id','revision',n->'source'->'revision')),'[]') into pins
  from jsonb_array_elements(d->'parameters'->'nodes') n where n->>'role'='source' and n->'source'->>'kind'='project_measurement';
 -- CAD's lineage trigger normally owns these locks. A checkpoint has no CAD
 -- insert, so lock and verify the same project source heads before saving.
 perform 1 from bob.measurements where project_id=p_project and id in (select (pin->>'id')::uuid from jsonb_array_elements(pins) pin) order by id for share;
 if exists(select 1 from jsonb_array_elements(pins) pin left join bob.current_measurements m on m.project_id=p_project and m.id=(pin->>'id')::uuid
  where m.id is null or m.revision is distinct from (pin->>'revision')::integer or m.archived) then raise exception 'construction_measurement_changed' using errcode='PT409'; end if;
 saved:=bob_private.artifact_command_before_construction(p_project,case when expected=0 then 'create' else 'revise' end,aid,expected,
  jsonb_build_object('title',d->>'title','description','Construction draft — not rendered or reviewed. '||(d->>'description'),'kind','detail','status','concept',
   'assumptions','Joint fit, strength and hardware remain unchecked. No drawing, cut list or purchase output has been generated.',
   'target_revision',d->'target_revision','measurements',pins)
  ||case when expected=0 then jsonb_build_object('area_id',d->'area_id') else jsonb_build_object('change_note',d->>'change_note') end);
 packet.project_id:=p_project;packet.artifact_id:=aid;packet.artifact_revision:=(saved->>'revision')::integer;packet.recipe:=d->'recipe';packet.manifest:=jsonb_build_object('bob_parameters',d->'parameters');
 perform bob_private.check_cad_parameter_graph(packet,false);
 insert into bob.artifact_construction_revisions values(p_project,aid,packet.artifact_revision,d->'recipe',d->'parameters',d->'materials',d->'joints',d->'open_questions');
 select to_jsonb(a)||jsonb_build_object('construction_status','draft','rendered',false,'reviewed',false) into rec from bob.current_artifacts a where id=aid and project_id=p_project;
 result:=jsonb_build_object('projectId',p_project,'dataset','artifacts','recordId',aid,'revision',packet.artifact_revision,'areaId',rec->'area_id','label',rec->>'title',
  'operation',case when expected=0 then 'created' else 'updated' end,'savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
exception when serialization_failure then raise exception 'construction_source_changed' using errcode='PT409';
end $$;
create function bob.bob_project_write_v14(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_project_write_v14(p_project,p_thread,p_turn,p_generation,p_payload) $$;
revoke all on function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v14(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v14(text,uuid,uuid,bigint,jsonb) to authenticated;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('save_construction_draft','Save or revise a versioned construction with parts, exact materials and typed joints, without rendering.','Read existing drafts and catalog revisions first. Reuse Artifact, assembly, part and joint IDs. Supply the complete CAD parameter plan; the server calculates values and rejects unknown controlling dimensions. Joint methods are design choices, not checked strength or hardware. Open questions stay explicit. A draft receipt is not a drawing or purchase receipt.',1,false,array[]::text[],true),
 ('read_construction_draft','List construction drafts or read one exact saved revision.','Null artifact_id lists current drafts with pagination. Read exact Artifact ID and optional historical revision; inspect source_state, open_questions and limits before changing. Use save_construction_draft for revisions.',1,false,array[]::text[],true);
notify pgrst,'reload schema';
commit;
