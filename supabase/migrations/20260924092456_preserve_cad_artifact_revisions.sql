begin;
-- Keep CAD identity intact across every canonical Artifact entry point.
alter function bob_private.artifact_command(text,text,uuid,integer,jsonb) rename to artifact_command_before_cad;
revoke all on function bob_private.artifact_command_before_cad(text,text,uuid,integer,jsonb) from public,anon,authenticated;
create function bob_private.artifact_command(p_project text,p_action text,p_artifact uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous bob.artifact_cad_revisions; saved jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select c.* into previous from bob.artifact_cad_revisions c join bob.artifacts a on a.id=c.artifact_id and a.current_revision=c.artifact_revision
 where c.project_id=p_project and c.artifact_id=p_artifact;
 if previous.artifact_id is not null and p_action='revise' then
  raise exception 'Use the CAD assistant to revise this construction and its drawings together.' using errcode='22023';
 end if;
 saved:=bob_private.artifact_command_before_cad(p_project,p_action,p_artifact,p_expected,p_data);
 if previous.artifact_id is not null and p_action in ('archive','restore') then
  insert into bob.artifact_cad_revisions(project_id,artifact_id,artifact_revision,recipe,manifest,files,source_artifact_id,source_revision,part_ids,component_id,step_id)
  values(p_project,p_artifact,(saved->>'revision')::integer,previous.recipe,previous.manifest,previous.files,previous.source_artifact_id,previous.source_revision,previous.part_ids,previous.component_id,previous.step_id);
 end if;
 return saved;
end $$;
revoke all on function bob_private.artifact_command(text,text,uuid,integer,jsonb) from public,anon;
grant execute on function bob_private.artifact_command(text,text,uuid,integer,jsonb) to authenticated;

-- Only the guarded CAD save can replace the construction packet.
create or replace function bob_private.bob_project_write_v9(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
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
  saved:=bob_private.artifact_command_before_cad(p_project,case when rid is null then 'create' else 'revise' end,aid,expected,
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
notify pgrst,'reload schema';
commit;
