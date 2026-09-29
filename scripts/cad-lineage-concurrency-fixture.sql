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
 physical_measure uuid:=gen_random_uuid(); project_measure uuid:=gen_random_uuid(); solution uuid:=gen_random_uuid();
 turn_id uuid:=gen_random_uuid(); donor text; project text; claim jsonb; snapshot jsonb;
 recipe jsonb; lineage jsonb; payload jsonb; detail jsonb; saved jsonb; child jsonb; readback jsonb;
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
 recipe:='{"contract_version":1,"units":"mm","assembly_id":"p1-release","definitions":[{"id":"panel","primitive":"box","material_ref":null,"x_mm":1001,"y_mm":300,"z_mm":18}],"instances":[{"id":"panel","definition_id":"panel","placement":{"x":0,"y":0,"z":0,"rx":0,"ry":0,"rz":0}}],"views":["front"]}'::jsonb;
 lineage:=jsonb_build_object('version',2,'coverage','partial','project_id',project,'coordinates',null,'inherited_from',null,'bindings',jsonb_build_array(
  jsonb_build_object('definition_id','panel','dimension','x_mm','source',jsonb_build_object('kind','space_measurement','id',snapshot->>'id','building_id',building,'space_id',space,'space_revision',1,'measurement_id',physical_measure,'measurement_revision',1,'value','1.001','unit','m','truth','measured','description','Synthetic release fixture'),'normalized',jsonb_build_object('value',1001,'unit','mm')),
  jsonb_build_object('definition_id','panel','dimension','y_mm','source',jsonb_build_object('kind','project_measurement','id',project_measure,'revision',1,'value','30.000','unit','cm','truth','provided_spec','description','Synthetic release fixture'),'normalized',jsonb_build_object('value',300,'unit','mm'))));
 set local role service_role;
 claim:=bob.bob_claim_turn(project,actor,turn_id,request_text);
 if claim->>'status' is distinct from 'claimed' then raise exception 'smoke_claim_failed'; end if;
 set local role authenticated;
 payload:=jsonb_build_object('kind','cad','record_id',null,'expected_updated_at',null,'expected_revision',0,'request_quote',request_text,'data',jsonb_build_object(
  'title','Synthetic source-bound panel','description','Release fixture','assumptions','No physical claim','target_revision',1,'measurements',jsonb_build_array(jsonb_build_object('id',project_measure,'revision',1)),
  'source_artifact_id',null,'source_revision',null,'part_ids','[]'::jsonb,'area_id',null,'component_id',null,'step_id',null,'artifact_id',null,'expected_revision',0,
  'packet',jsonb_build_object('recipe',recipe,'manifest',jsonb_build_object('engine',jsonb_build_object('name','build123d'),'assembly_id','p1-release','bob_lineage',lineage),'files',jsonb_build_object('front','PHN2Zz48L3N2Zz4=','step','SYNTHETIC_RELEASE_EXPORT'))));
 reset role;
 insert into public.cad_race_fixture values(jsonb_build_object(
  'actor',actor,'project',project,'donor',donor,'building',building,'space',space,'scope',scope,
  'physical_measure',physical_measure,'project_measure',project_measure,'turn_id',turn_id,'claim',claim,'payload',payload));
end $$;
commit;
