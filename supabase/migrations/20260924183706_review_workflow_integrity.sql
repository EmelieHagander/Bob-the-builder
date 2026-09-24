-- Review fixes: truthful CAD receipts and readiness independent of lifecycle phase.
-- Append-only migration; existing history and project data are preserved.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

drop trigger link_new_cad_work on bob.artifact_cad_revisions;
drop function bob_private.link_new_cad_work();

CREATE OR REPLACE FUNCTION bob_private.bob_project_write_v9(p_project text, p_thread uuid, p_turn uuid, p_generation bigint, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select t.* into task from bob.tasks t left join bob.areas a on a.id=t.area_id where t.id=rid and t.project_id=p_project for update of t;
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
  -- Only an intentional CAD save changes live work links. Archive/restore
  -- copy provenance and never reattach a previously unlinked Step.
  if d->>'step_id' is not null then
   insert into bob.artifact_step_links(project_id,artifact_id,step_id)
    values(p_project,aid,(d->>'step_id')::uuid) on conflict do nothing;
  end if;
  rec:=rec||jsonb_build_object('cad',true,'step_id',d->'step_id','step_ids',(
   select coalesce(jsonb_agg(l.step_id order by l.step_id),'[]'::jsonb)
   from bob.artifact_step_links l join bob.project_plans p on p.project_id=l.project_id
   join bob.project_plan_steps s on s.project_id=p.project_id and s.plan_revision=p.current_revision and s.step_id=l.step_id
   where l.project_id=p_project and l.artifact_id=aid));
  dataset:='artifacts';label:=rec->>'title';
 end if;
 if rec is null or rec->>'id' is null then raise exception 'readback_unavailable'; end if;
 result:=jsonb_build_object('projectId',p_project,'dataset',dataset,'recordId',rec->>'id','revision',rec->'revision','areaId',rec->'area_id',
  'label',label,'operation',case when rid is null then 'created' else 'updated' end,'savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
end $function$
;

-- Phase describes the work lifecycle. Actual needs/dependencies still block;
-- zero blockers still requires a recorded readiness review.

create or replace view bob.current_task_readiness with(security_invoker=true) as
 SELECT t.id AS task_id,
    t.project_id,
    t.area_id,
    a.phase AS area_phase,
    t.status AS task_status,
        CASE
            WHEN (t.status = 'done'::bob.task_status) THEN 'complete'::text
            WHEN (COALESCE(jsonb_array_length(blockers.items), 0) > 0) THEN 'blocked'::text
            WHEN (review.confirmed_at IS NULL) THEN 'unreviewed'::text
            WHEN ((source_change.latest_change IS NOT NULL) AND (source_change.latest_change > review.confirmed_at)) THEN 'unreviewed'::text
            ELSE 'ready'::text
        END AS readiness_state,
        CASE
            WHEN (t.status = 'done'::bob.task_status) THEN 0
            ELSE COALESCE(jsonb_array_length(blockers.items), 0)
        END AS blocker_count,
        CASE
            WHEN (t.status = 'done'::bob.task_status) THEN '[]'::jsonb
            ELSE COALESCE(blockers.items, '[]'::jsonb)
        END AS blockers,
    review.confirmed_at AS reviewed_at,
    review.actor_label AS reviewed_by,
    review.note AS review_note
   FROM ((((bob.tasks t
     LEFT JOIN bob.areas a ON ((a.id = t.area_id)))
     LEFT JOIN bob.task_readiness_reviews review ON (((review.project_id = t.project_id) AND (review.task_id = t.id))))
     LEFT JOIN LATERAL ( SELECT max(changes.changed_at) AS latest_change
           FROM ( SELECT dependency.created_at AS changed_at
                   FROM bob.task_dependencies dependency
                  WHERE (dependency.task_id = t.id)
                UNION ALL
                 SELECT need.updated_at
                   FROM bob.task_needs need
                  WHERE (need.task_id = t.id)
                UNION ALL
                 SELECT material.recorded_at
                   FROM bob.current_material_requirements material
                  WHERE (material.task_id = t.id)) changes) source_change ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('kind', reasons.kind, 'id', reasons.id, 'label', reasons.label) ORDER BY reasons.priority, reasons.label) AS items
           FROM ( SELECT 2 AS priority,
                    'status'::text AS kind,
                    t.id,
                    'Task is manually marked Blocked'::text AS label
                  WHERE (t.status = 'blocked'::bob.task_status)
                UNION ALL
                 SELECT 3,
                    'dependency'::text,
                    (dependency.id)::text AS id,
                        CASE
                            WHEN (dependency.prerequisite_step_id IS NULL) THEN ('Finish '::text || dependency.prerequisite_task_name)
                            ELSE ((dependency.prerequisite_task_name || ': complete '::text) || dependency.prerequisite_step_title)
                        END AS "case"
                   FROM bob.task_dependency_status dependency
                  WHERE ((t.status <> 'done'::bob.task_status) AND (dependency.task_id = t.id) AND (NOT dependency.satisfied))
                UNION ALL
                 SELECT 4,
                    'material'::text,
                    (material.requirement_id)::text AS requirement_id,
                    material.reason
                   FROM bob.task_material_readiness material
                  WHERE ((t.status <> 'done'::bob.task_status) AND (material.task_id = t.id) AND (NOT material.ready))
                UNION ALL
                 SELECT
                        CASE need.kind
                            WHEN 'tool'::text THEN 5
                            ELSE 6
                        END AS "case",
                    need.kind,
                    (need.id)::text AS id,
                        CASE need.kind
                            WHEN 'tool'::text THEN ('Tool needed: '::text || need.label)
                            ELSE ('Confirm: '::text || need.label)
                        END AS "case"
                   FROM bob.task_needs need
                  WHERE ((t.status <> 'done'::bob.task_status) AND (need.task_id = t.id) AND (NOT need.ready))) reasons) blockers ON (true));



-- Include images from the current primary work Step, with capability checks.

CREATE OR REPLACE FUNCTION bob_volunteer_private.volunteer_media(p_secret text, p_task text, p_media uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); result jsonb;
begin
  select jsonb_build_object('bucket',m.bucket_id,'path',m.object_path,'contentType',m.content_type,'byteSize',m.byte_size) into result
    from bob.media_assets m join bob.tasks t on t.id=p_task left join bob.areas a on a.id=t.area_id
    where t.project_id=s.project_id and m.project_id=s.project_id and m.id=p_media and m.state='ready'
      and exists(select 1 from bob.media_links l left join bob.task_steps st on st.id=l.step_id where l.media_id=m.id
        and (l.task_id=t.id or l.area_id=t.area_id or st.task_id=t.id
          or (l.plan_step_id=t.primary_step_id and exists(
            select 1 from bob.project_plans p join bob.project_plan_steps ps
              on ps.project_id=p.project_id and ps.plan_revision=p.current_revision
            where p.project_id=s.project_id and ps.step_id=t.primary_step_id))));
  if result is null then raise exception 'Image unavailable.' using errcode='42501'; end if;
  return result;
end $function$
;

-- Include images from the current primary work Step, with capability checks.

CREATE OR REPLACE FUNCTION bob_volunteer_private.volunteer_task(p_secret text, p_task text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); t bob.tasks; area_name text; steps jsonb; images jsonb;
begin
  select t0.* into t from bob.tasks t0 left join bob.areas a on a.id=t0.area_id where t0.id=p_task and t0.project_id=s.project_id;
  if not found then raise exception 'Task unavailable.' using errcode='42501'; end if;
  select name into area_name from bob.areas where id=t.area_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'instructions',instructions,'required',required,
    'isCheckpoint',is_checkpoint,'completedAt',completed_at,'revision',revision) order by position),'[]') into steps from bob.task_steps where task_id=t.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'title',m.title) order by m.created_at,m.id),'[]') into images from bob.media_assets m
    where m.project_id=s.project_id and m.state='ready' and exists(select 1 from bob.media_links l left join bob.task_steps st on st.id=l.step_id
      where l.media_id=m.id and (l.task_id=t.id or l.area_id=t.area_id or st.task_id=t.id
          or (l.plan_step_id=t.primary_step_id and exists(
            select 1 from bob.project_plans p join bob.project_plan_steps ps
              on ps.project_id=p.project_id and ps.plan_revision=p.current_revision
            where p.project_id=s.project_id and ps.step_id=t.primary_step_id))));
  return jsonb_build_object('projectId',s.project_id,'id',t.id,'name',t.name,'area',area_name,'instructions',t.instructions,'status',t.status,
    'updatedAt',t.updated_at,'mine',exists(select 1 from bob.task_assignees where task_id=t.id and person_id=s.person_id),'steps',steps,'images',images);
end $function$
;

commit;
