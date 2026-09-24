begin;
-- CAD revisions live under the existing Artifact identity and project authority.
create table bob.artifact_cad_revisions (
 project_id text not null references bob.projects(id) on delete cascade,
 artifact_id uuid not null references bob.artifacts(id) on delete cascade,
 artifact_revision integer not null,
 recipe jsonb not null check(jsonb_typeof(recipe)='object' and recipe->>'units'='mm' and recipe->>'contract_version'='1'),
 manifest jsonb not null check(jsonb_typeof(manifest)='object'),
 files jsonb not null check(jsonb_typeof(files)='object' and octet_length(files::text)<=6291456),
 source_artifact_id uuid,
 source_revision integer,
 part_ids jsonb not null default '[]' check(jsonb_typeof(part_ids)='array'),
 component_id uuid references bob.existing_components(id),
 step_id uuid,
 primary key(artifact_id,artifact_revision),
 foreign key(artifact_id,artifact_revision) references bob.artifact_revisions(artifact_id,revision) on delete cascade,
 foreign key(source_artifact_id,source_revision) references bob.artifact_cad_revisions(artifact_id,artifact_revision),
 check((source_artifact_id is null)=(source_revision is null))
);
alter table bob.artifact_cad_revisions enable row level security;
revoke all on bob.artifact_cad_revisions from public,anon,authenticated;
grant select on bob.artifact_cad_revisions to authenticated;
grant all on bob.artifact_cad_revisions to service_role;
create policy project_read on bob.artifact_cad_revisions for select to authenticated using(bob_private.has_project_access(project_id));
create index artifact_cad_step_idx on bob.artifact_cad_revisions(project_id,step_id);

create function bob.read_cad_artifact(p_project text,p_artifact uuid,p_revision integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare answer jsonb;
begin
 if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select jsonb_build_object('artifact_id',c.artifact_id,'revision',c.artifact_revision,'recipe',c.recipe,
  'area_id',a.area_id,'component_id',c.component_id,'source_artifact_id',c.source_artifact_id,'source_revision',c.source_revision,'part_ids',c.part_ids,'step_id',c.step_id)
 into answer from bob.artifact_cad_revisions c join bob.artifacts a on a.id=c.artifact_id
 where c.project_id=p_project and a.project_id=p_project and c.artifact_id=p_artifact and c.artifact_revision=coalesce(p_revision,a.current_revision);
 return answer;
end $$;
revoke all on function bob.read_cad_artifact(text,uuid,integer) from public,anon;
grant execute on function bob.read_cad_artifact(text,uuid,integer) to authenticated;

create function bob_private.bob_project_write_v9(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kind text:=p_payload->>'kind'; d jsonb:=p_payload->'data'; rid text:=p_payload->>'record_id';
 quote text:=p_payload->>'request_quote'; msg text; op text; existing bob_private.bob_write_receipts;
 expected integer; saved jsonb; rec jsonb; before_row jsonb; result jsonb; dataset text; label text; task bob.tasks;
 aid uuid; source bob.artifact_cad_revisions; recipe jsonb; packet jsonb; revision integer;
begin
 if kind<>all(array['cad','measurement_state','solution','target','task_work']) then
  return bob_private.bob_project_write_v8(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>6600000
  or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or jsonb_typeof(d)<>'object'
  or jsonb_typeof(p_payload->'request_quote')<>'string' or coalesce(char_length(quote),0) not between 1 and 500 then
  raise exception 'invalid_write' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(quote in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 op:=kind||':'||coalesce(rid,concat_ws(':','new',d->>'area_id',lower(btrim(d->>'title'))))||case when kind='target' then ':'||coalesce(d->>'area_id','project') else '' end;
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if; return existing.receipt; end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then
  raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 if kind<>'task_work' then
  if coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$' or p_payload->'expected_updated_at' is distinct from 'null'::jsonb then raise exception 'invalid_write' using errcode='22023'; end if;
  expected:=(p_payload->>'expected_revision')::integer;
 end if;
 if kind='measurement_state' then
  if d-array['action']::text[]<>'{}' or d->>'action' is null or d->>'action'<>all(array['archive','restore']) then raise exception 'invalid_write' using errcode='22023'; end if;
  saved:=bob_private.evidence_command(p_project,'measurement',d->>'action',rid::uuid,expected,'{}');
  select to_jsonb(m) into rec from bob.current_measurements m where id=rid::uuid and project_id=p_project;
  dataset:='measurements';label:=rec->>'subject';
 elsif kind='solution' then
  aid:=coalesce(rid::uuid,gen_random_uuid());
  -- Retain an existing source image when changing text/measurements.
  if rid is not null then select to_jsonb(s) into before_row from bob.current_solutions s where id=aid and project_id=p_project;
   if before_row is null then raise exception 'project_denied' using errcode='42501'; end if;
   d:=d||jsonb_build_object('source_media_id',before_row->'source_media_id'); end if;
  saved:=bob_private.solution_command(p_project,case when rid is null then 'create' else 'revise' end,aid,expected,d);
  select to_jsonb(s) into rec from bob.current_solutions s where id=aid and project_id=p_project;
  dataset:='solutions';label:=rec->>'title';
 elsif kind='target' then
  if d-array['solution_revision','area_id','reason']::text[]<>'{}' then raise exception 'invalid_write' using errcode='22023'; end if;
  saved:=bob_private.solution_command(p_project,'select',rid::uuid,expected,d);
  select to_jsonb(t)||jsonb_build_object('id',coalesce(d->>'area_id',p_project)) into rec from bob.current_target t where project_id=p_project and area_id is not distinct from (d->>'area_id');
  dataset:='target';label:='Selected project target';
 elsif kind='task_work' then
  if d-array['status','person_ids']::text[]<>'{}' or d->>'status' is null or d->>'status'<>all(array['todo','doing','done','blocked'])
   or jsonb_typeof(d->'person_ids')<>'array' or jsonb_array_length(d->'person_ids')>40 then raise exception 'invalid_write' using errcode='22023'; end if;
  select t.* into task from bob.tasks t join bob.areas a on a.id=t.area_id where t.id=rid and a.project_id=p_project for update of t;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  if task.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then raise exception 'record_changed' using errcode='40001'; end if;
  if exists(select 1 from jsonb_array_elements_text(d->'person_ids') v where not exists(select 1 from bob.people p where p.id=v and p.project_id=p_project)) then raise exception 'project_denied' using errcode='42501'; end if;
  before_row:=to_jsonb(task);
  update bob.tasks set status=(d->>'status')::bob.task_status where id=rid;
  delete from bob.task_assignees where task_id=rid;
  insert into bob.task_assignees(task_id,person_id) select rid,v from jsonb_array_elements_text(d->'person_ids') v;
  select to_jsonb(t)||jsonb_build_object('person_ids',d->'person_ids') into rec from bob.tasks t where id=rid;
  dataset:='tasks';label:=task.name;
 else
  -- Use the canonical Artifact lock before validating the source revision.
  perform 1 from bob.projects where id=p_project for no key update;
  -- Plan acceptance serializes on this row, independently of Artifact writes.
  if d->>'step_id' is not null then
   perform 1 from bob.project_plans where project_id=p_project for share;
  end if;
  packet:=d->'packet';recipe:=packet->'recipe';
  if d-array['packet','title','description','assumptions','target_revision','measurements','source_artifact_id','source_revision','part_ids','area_id','component_id','step_id','artifact_id','expected_revision']::text[]<>'{}'
   or jsonb_typeof(recipe)<>'object' or recipe->>'contract_version'<>'1' or recipe->>'units'<>'mm'
   or jsonb_typeof(recipe->'instances')<>'array' or jsonb_array_length(recipe->'instances') not between 1 and 512
   or jsonb_typeof(recipe->'definitions')<>'array' or jsonb_array_length(recipe->'definitions') not between 1 and 128
   or jsonb_typeof(packet->'manifest')<>'object' or jsonb_typeof(packet->'files')<>'object'
   or packet->'manifest'->>'assembly_id' is distinct from recipe->>'assembly_id'
   or packet->'manifest'->'engine'->>'name' is distinct from 'build123d' then raise exception 'invalid_cad' using errcode='22023'; end if;
  if d->>'component_id' is not null and not exists(select 1 from bob.existing_components where id=(d->>'component_id')::uuid and project_id=p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if d->>'step_id' is not null and not exists(select 1 from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=p_project and s.step_id=(d->>'step_id')::uuid) then raise exception 'step_changed' using errcode='40001'; end if;
  if d->>'source_artifact_id' is not null then
   select c.* into source from bob.artifact_cad_revisions c join bob.artifacts a on a.id=c.artifact_id and a.current_revision=c.artifact_revision
    where c.project_id=p_project and c.artifact_id=(d->>'source_artifact_id')::uuid and c.artifact_revision=(d->>'source_revision')::integer;
   if not found then raise exception 'source_changed' using errcode='40001'; end if;
   if exists(select 1 from jsonb_array_elements(recipe->'instances') i where not exists(select 1 from jsonb_array_elements(source.recipe->'instances') j where i=j))
    or exists(select 1 from jsonb_array_elements(recipe->'definitions') i where not exists(select 1 from jsonb_array_elements(source.recipe->'definitions') j where i=j)) then raise exception 'detail_must_reuse_source' using errcode='22023'; end if;
  end if;
  aid:=coalesce(rid::uuid,gen_random_uuid());
  saved:=bob_private.artifact_command(p_project,case when rid is null then 'create' else 'revise' end,aid,expected,
   jsonb_build_object('title',d->>'title','description',d->>'description','assumptions',d->>'assumptions','kind','detail','status','concept','target_revision',d->'target_revision','measurements',d->'measurements')
   ||case when rid is null then jsonb_build_object('area_id',d->'area_id') else jsonb_build_object('change_note','CAD design revision') end);
  revision:=(saved->>'revision')::integer;
  insert into bob.artifact_cad_revisions values(p_project,aid,revision,recipe,packet->'manifest',packet->'files',(d->>'source_artifact_id')::uuid,(d->>'source_revision')::integer,d->'part_ids',(d->>'component_id')::uuid,(d->>'step_id')::uuid);
  select to_jsonb(a) into rec from bob.current_artifacts a where id=aid and project_id=p_project;
  rec:=rec||jsonb_build_object('cad',true,'step_id',d->'step_id');dataset:='artifacts';label:=rec->>'title';
 end if;
 if rec is null or rec->>'id' is null then raise exception 'readback_unavailable'; end if;
 result:=jsonb_build_object('projectId',p_project,'dataset',dataset,'recordId',rec->>'id','revision',rec->'revision','areaId',rec->'area_id',
  'label',label,'operation',case when rid is null then 'created' else 'updated' end,'savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
end $$;
create function bob.bob_project_write_v9(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_project_write_v9(p_project,p_thread,p_turn,p_generation,p_payload) $$;
revoke all on function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v9(text,uuid,uuid,bigint,jsonb) to authenticated;

insert into shared.ai_settings(app,coworker_id,function_name,module_id,model,model_type,max_output_tokens,temperature,reasoning_effort,prompt_template,web_search,is_enabled,metadata)
select 'bob','bob','cad-designer','cad',model,model_type,16000,null,'high',null,false,is_enabled,'{"role":"cad_designer"}'::jsonb
from shared.ai_settings where app='bob' and coworker_id='bob' and function_name='ask-bob' and module_id='global'
on conflict(app,coworker_id,function_name,module_id) do nothing;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('design_project_cad','Delegate a construction or drawing to the CAD assistant with its own research and rendering tools.','Provide the object, brief and known Area/component/Step/Artifact IDs; null means unspecified. It can fetch wider dependencies. A detail reuses the source assembly. Rendering returns a candidate, not a save. Missing CAD infrastructure is a technical blocker, not a request for approval.',1,false,array['design'],true) on conflict(name) do nothing;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('save_cad_design','Save the exact rendered CAD candidate and its project Step link.','Use after design_project_cad returned ready. Saves a concept Artifact, immutable geometry and exact inputs. Use the current request quote. The receipt proves persistence, not structural certification.',1,false,array[]::text[],true) on conflict(name) do nothing;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('archive_project_measurement','Archive or restore an existing project measurement.','Read its current revision. Archive preserves history and exposes stale evidence to dependent drawings. Do not create a replacement measurement just to remove an obsolete one.',1,false,array[]::text[],true) on conflict(name) do nothing;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('save_project_solution','Create or revise a solution alternative for the project or Area.','Read existing solutions and measurement revisions first. Record actual intent, assumptions and tradeoffs. A solution is distinct from selected target. Ordinary delegated design choices do not need another permission round.',1,false,array[]::text[],true) on conflict(name) do nothing;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('select_project_target','Select a saved solution revision as project target.','Read current target and solution. expected_revision is the target decision revision (zero if none); solution_revision is the exact current solution. Resolve genuinely conflicting owner choices; selecting a working design does not certify it.',1,false,array[]::text[],true) on conflict(name) do nothing;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('update_project_task_work','Update task status and assign project people.','Read the task timestamp and crew IDs. person_ids replaces the full assignee set. Assignment changes no access rights. Done records performed work, not verification of all plan criteria.',1,false,array[]::text[],true) on conflict(name) do nothing;
notify pgrst,'reload schema';
commit;
