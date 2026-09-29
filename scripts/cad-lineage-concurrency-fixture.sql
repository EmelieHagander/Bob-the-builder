-- Disposable PostgreSQL only: independent source/scope and CAD-save sessions.
-- Called by check-cad-lineage-concurrency.ts; never run on the hosted project.
create table public.cad_race_fixture (data jsonb);
grant select on public.cad_race_fixture to authenticated;
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
declare
 actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 site uuid:=gen_random_uuid(); building uuid:=gen_random_uuid(); space uuid:=gen_random_uuid(); scope uuid:=gen_random_uuid();
 image_id uuid:=gen_random_uuid(); media jsonb; image_version text;
 physical_measure uuid:=gen_random_uuid(); project_measure uuid:=gen_random_uuid(); solution uuid:=gen_random_uuid();
 turn_id uuid:=gen_random_uuid(); donor text; project text; claim jsonb; snapshot jsonb;
 recipe jsonb; parameters jsonb; lineage jsonb; payload jsonb; detail jsonb; saved jsonb; child jsonb; readback jsonb;
 request_text text:='P1 release smoke: save synthetic source-bound CAD'; source_state text;
begin
 insert into auth.users(id,email,email_confirmed_at) values(actor,actor::text||'@p1-release.invalid',now());
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor)::text,true);
 set local role authenticated;
 donor:=bob.create_project('{"name":"P1 rollback-only donor"}'::jsonb)->>'id';
 project:=bob.create_project('{"name":"P1 rollback-only delivery"}'::jsonb)->>'id';
 perform bob.physical_site_command('create',site,0,'{"name":"P1 rollback-only site"}'::jsonb);
 perform bob.physical_building_command('create',building,0,jsonb_build_object('site_id',site,'name','Synthetic house'));
 perform bob.evidence_command(donor,'measurement','create',physical_measure,0,
  '{"subject":"Room width","value":"1.001","unit":"m","truth":"measured","source":"Synthetic release fixture","required":true}'::jsonb);
 perform bob.evidence_command(project,'measurement','create',project_measure,0,
  '{"subject":"Panel depth","value":"30.000","unit":"cm","truth":"provided_spec","source":"Synthetic release fixture","required":true}'::jsonb);
 perform bob.physical_node_command(building,'space','create',space,0,jsonb_build_object('name','Synthetic room','kind','room','truth','measured','source','Synthetic release fixture','measurements',jsonb_build_array(jsonb_build_object('id',physical_measure,'revision',1))));
 perform bob.physical_scope_command(project,'project','link',scope,jsonb_build_object('target_kind','space','building_id',building,'space_id',space));
 snapshot:=bob.search_bob_project_data_v8(project,'physical_space_measurements',null,null,null,null,null)->'records'->0;
 if snapshot is null then raise exception 'smoke_snapshot_missing'; end if;
 perform bob.solution_command(project,'create',solution,0,'{"area_id":null,"title":"Synthetic panel","description":"Fixture","assumptions":"No physical claim","tradeoffs":"Fixture","measurements":[]}'::jsonb);
 perform bob.solution_command(project,'select',solution,0,'{"solution_revision":1,"reason":"Release fixture"}'::jsonb);
 recipe:='{"contract_version":1,"units":"mm","assembly_id":"p1-release","definitions":[{"id":"panel","primitive":"box","material_ref":null,"x_mm":960,"y_mm":300,"z_mm":18}],"instances":[{"id":"panel","definition_id":"panel","placement":{"x":0,"y":0,"z":0,"rx":0,"ry":0,"rz":0}}],"views":["front"]}'::jsonb;
 lineage:=jsonb_build_object('version',2,'coverage','partial','project_id',project,'coordinates',null,'inherited_from',null,'bindings',jsonb_build_array(
  jsonb_build_object('definition_id','panel','dimension','x_mm','source',jsonb_build_object('kind','space_measurement','id',snapshot->>'id','building_id',building,'space_id',space,'space_revision',1,'measurement_id',physical_measure,'measurement_revision',1,'value','1.001','unit','m','truth','measured','description','Synthetic release fixture'),'normalized',jsonb_build_object('value',1001,'unit','mm')),
  jsonb_build_object('definition_id','panel','dimension','y_mm','source',jsonb_build_object('kind','project_measurement','id',project_measure,'revision',1,'value','30.000','unit','cm','truth','provided_spec','description','Synthetic release fixture'),'normalized',jsonb_build_object('value',300,'unit','mm'))));
 -- Explicit synthetic graph: a physical span minus a design clearance. No
 -- old direct binding supplies these dependencies or their locking semantics.
 parameters:=jsonb_build_object('version',1,'project_id',project,'coverage','complete','precision','decimal_6',
  'coordinate_system','{"version":1,"length_unit":"mm","angle_unit":"deg","origin":[0,0,0],"positive_axes":[[1,0,0],[0,1,0],[0,0,1]],"rotation":"build123d_0.13_intrinsic_xyz","definition_origins":{"box":"minimum_corner","cylinder":"xy_center_z_min","tube":"xy_center_z_min"},"instance_parent":"assembly","cut_parent":"definition","frame_identity":"artifact_revision_and_recipe_path","views":{"front":{"toward_camera":[0,-1,0],"up":[0,0,1]},"right":{"toward_camera":[1,0,0],"up":[0,0,1]},"top":{"toward_camera":[0,0,1],"up":[0,1,0]},"isometric":{"toward_camera":[1,-1,1],"up":[0,0,1]}}}'::jsonb||jsonb_build_object('id','p1-release'),
  'frames','[{"id": "room", "kind": "room", "source_ref": "parameter:span", "required": true, "reason": "Synthetic aligned room datum", "placement": {"x": "zero", "y": "zero", "z": "zero", "rx": "angle", "ry": "angle", "rz": "angle"}, "source_version": null, "translation_mm": [0, 0, 0], "rotation_degrees": [0, 0, 0], "axes": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]}]'::jsonb,'bindings','[{"path": "definitions/panel/x_mm", "node": "width"}, {"path": "definitions/panel/y_mm", "node": "depth"}, {"path": "definitions/panel/z_mm", "node": "thickness"}, {"path": "instances/panel/placement/x", "node": "zero"}, {"path": "instances/panel/placement/y", "node": "zero"}, {"path": "instances/panel/placement/z", "node": "zero"}, {"path": "instances/panel/placement/rx", "node": "angle"}, {"path": "instances/panel/placement/ry", "node": "angle"}, {"path": "instances/panel/placement/rz", "node": "angle"}]'::jsonb,
  'nodes',jsonb_build_array(
   jsonb_build_object('id','span','role','source','source',jsonb_build_object('kind','space_measurement','id',snapshot->>'id','space_revision',1),'normalized',jsonb_build_object('value',1001,'unit','mm'),'sources',jsonb_build_array(lineage->'bindings'->0->'source')),
   jsonb_build_object('id','depth','role','source','source',jsonb_build_object('kind','project_measurement','id',project_measure,'revision',1),'normalized',jsonb_build_object('value',300,'unit','mm'),'sources',jsonb_build_array(lineage->'bindings'->1->'source'))
  )||'[{"id": "allowance", "role": "decision", "value": 41, "unit": "mm", "reason": "Synthetic fixture clearance", "normalized": {"value": 41, "unit": "mm"}, "sources": []}, {"id": "width", "role": "derived", "operation": "subtract_v1", "operands": ["span", "allowance"], "rounding": "exact", "normalized": {"value": 960, "unit": "mm"}, "sources": []}, {"id": "thickness", "role": "decision", "value": 18, "unit": "mm", "reason": "Explicit synthetic fixture choice", "normalized": {"value": 18, "unit": "mm"}, "sources": []}, {"id": "zero", "role": "decision", "value": 0, "unit": "mm", "reason": "Explicit synthetic fixture choice", "normalized": {"value": 0, "unit": "mm"}, "sources": []}, {"id": "angle", "role": "decision", "value": 0, "unit": "deg", "reason": "Explicit synthetic fixture choice", "normalized": {"value": 0, "unit": "deg"}, "sources": []}]'::jsonb);
 lineage:=jsonb_set(lineage,'{bindings}','[]');
 perform bob.media_command(project,'reserve',image_id,jsonb_build_object('original_name','fixture.png','title','Synthetic direction','purpose','reference','content_type','image/png','byte_size',8,'width',2,'height',2,'target_kind','project','target_id',project));
 insert into storage.objects(bucket_id,name,metadata) values('bob-project-media',project||'/'||image_id::text,'{"size":8,"mimetype":"image/png"}');
 media:=bob.media_command(project,'finalize',image_id,'{}');
 image_version:=jsonb_build_array(media->'updated_at',media->'content_type',media->'byte_size',media->'width',media->'height',media->'title',media->'purpose',media->'source_kind','[]'::jsonb)::text;
 parameters:=jsonb_set(parameters,'{frames}',parameters->'frames'||jsonb_build_array((parameters->'frames'->0)||jsonb_build_object('id','photo','kind','image','source_ref','image:'||image_id::text,'source_version',image_version)));

 set local role service_role;
 claim:=bob.bob_claim_turn(project,actor,turn_id,request_text);
 if claim->>'status' is distinct from 'claimed' then raise exception 'smoke_claim_failed'; end if;
 set local role authenticated;
 payload:=jsonb_build_object('kind','cad','record_id',null,'expected_updated_at',null,'expected_revision',0,'request_quote',request_text,'data',jsonb_build_object(
  'title','Synthetic source-bound panel','description','Release fixture','assumptions','No physical claim','target_revision',1,'measurements',jsonb_build_array(jsonb_build_object('id',project_measure,'revision',1)),
  'source_artifact_id',null,'source_revision',null,'part_ids','[]'::jsonb,'area_id',null,'component_id',null,'step_id',null,'artifact_id',null,'expected_revision',0,
  'packet',jsonb_build_object('recipe',recipe,'manifest',jsonb_build_object('engine',jsonb_build_object('name','build123d'),'assembly_id','p1-release','bob_lineage',lineage,'bob_parameters',parameters),'files',jsonb_build_object('front','PHN2Zz48L3N2Zz4=','step','SYNTHETIC_RELEASE_EXPORT'))));
 reset role;
 insert into public.cad_race_fixture values(jsonb_build_object(
  'image',image_id,'actor',actor,'project',project,'donor',donor,'building',building,'space',space,'scope',scope,
  'physical_measure',physical_measure,'project_measure',project_measure,'turn_id',turn_id,'claim',claim,'payload',payload));
end $$;
commit;
