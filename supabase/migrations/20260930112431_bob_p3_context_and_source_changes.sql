-- P3: private logical-turn focus and caller-authorized drawing source deltas.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.validate_turn_screen(p_screen jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare surface text; allowed text[]; k text; v jsonb;
begin
 if p_screen is null or p_screen='null'::jsonb then return; end if;
 if jsonb_typeof(p_screen) is distinct from 'object' then raise exception 'invalid_screen' using errcode='22023'; end if;
 surface:=p_screen->>'surface';
 allowed:=case surface
 when 'project' then array['planStepId'] when 'areas' then '{}'::text[]
 when 'area' then array['areaId','planStepId'] when 'task' then array['areaId','taskId','planStepId','instructionId']
 when 'facts' then array['areaId'] when 'solutions' then array['areaId','solutionId','solutionRevision']
 when 'drawings' then array['areaId','artifactId','artifactRevision'] when 'people' then '{}'::text[]
 when 'events' then '{}'::text[] when 'event' then array['eventId'] when 'shopping' then '{}'::text[]
 when 'today' then '{}'::text[] when 'announcements' then '{}'::text[] when 'building' then '{}'::text[]
 when 'material-plan' then array['areaId'] end;
 if allowed is null or jsonb_typeof(p_screen->'surface') is distinct from 'string' or p_screen-(allowed||array['surface'])<>'{}'::jsonb then raise exception 'invalid_screen' using errcode='22023'; end if;
 for k,v in select key,value from jsonb_each(p_screen-'surface') loop
  if right(k,8)='Revision' then
   if jsonb_typeof(v) is distinct from 'number' or (v::text)::numeric<>trunc((v::text)::numeric) or (v::text)::numeric not between 1 and 2147483647 then raise exception 'invalid_screen' using errcode='22023'; end if;
  elsif jsonb_typeof(v) is distinct from 'string' or (p_screen->>k)!~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$' then raise exception 'invalid_screen' using errcode='22023'; end if;
 end loop;
 if surface='area' and not p_screen?'areaId' or surface='task' and not p_screen?'taskId' or surface='event' and not p_screen?'eventId'
  or (p_screen?'artifactId')<>(p_screen?'artifactRevision') or (p_screen?'solutionId')<>(p_screen?'solutionRevision') then raise exception 'invalid_screen' using errcode='22023'; end if;
end $$;
revoke all on function bob_private.validate_turn_screen(jsonb) from public,anon,authenticated,service_role;
create table bob_private.bob_turn_screens (
 thread_id uuid not null references bob.bob_threads(id) on delete cascade,
 turn_id uuid not null,
 screen jsonb,
 primary key(thread_id,turn_id),
 check(screen is null or jsonb_typeof(screen)='object')
);
alter table bob_private.bob_turn_screens enable row level security;
revoke all on bob_private.bob_turn_screens from public,anon,authenticated,service_role;
-- Old jobs keep their original lack of focus, including failed-job retries.
insert into bob_private.bob_turn_screens(thread_id,turn_id,screen)
 select distinct thread_id,turn_id,null::jsonb from bob_private.bob_jobs on conflict do nothing;

create function bob.bob_capture_turn_screen(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_screen jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare captured jsonb;
begin
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 perform bob_private.validate_turn_screen(p_screen);
 insert into bob_private.bob_turn_screens values(p_thread,p_turn,nullif(p_screen,'null'::jsonb)) on conflict do nothing;
 select screen into captured from bob_private.bob_turn_screens where thread_id=p_thread and turn_id=p_turn;
 -- Legacy omission preserves the first capture. A supplied pointer cannot recontextualize a turn.
 if p_screen is not null and p_screen<>'null'::jsonb and captured is distinct from p_screen then raise exception 'turn_screen_changed' using errcode='22023'; end if;
 return jsonb_build_object('screen',captured);
end $$;
revoke all on function bob.bob_capture_turn_screen(text,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function bob.bob_capture_turn_screen(text,uuid,uuid,uuid,bigint,jsonb) to service_role;

alter function bob_private.bob_enqueue_job(text,uuid,uuid,text,jsonb,timestamptz,text) rename to bob_enqueue_job_before_screen;
create function bob_private.bob_enqueue_job(p_project text,p_user uuid,p_turn uuid,p_message text,p_credential jsonb,p_expires timestamptz,p_worker_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; j bob_private.bob_jobs;
begin
 result:=bob_private.bob_enqueue_job_before_screen(p_project,p_user,p_turn,p_message,p_credential,p_expires,p_worker_url);
 if result->>'status'='accepted' then
  select * into j from bob_private.bob_jobs where id=(result->>'jobId')::uuid;
  insert into bob_private.bob_turn_screens values(j.thread_id,p_turn,null) on conflict do nothing;
 end if;
 return result;
end $$;
revoke all on function bob_private.bob_enqueue_job(text,uuid,uuid,text,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function bob_private.bob_enqueue_job(text,uuid,uuid,text,jsonb,timestamptz,text) to service_role;
create or replace function bob.bob_enqueue_job(p_project text,p_user uuid,p_turn uuid,p_message text,p_credential jsonb,p_expires timestamptz,p_worker_url text)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_enqueue_job(p_project,p_user,p_turn,p_message,p_credential,p_expires,p_worker_url) $$;

create function bob.bob_enqueue_job_v2(p_project text,p_user uuid,p_turn uuid,p_message text,p_credential jsonb,p_expires timestamptz,p_worker_url text,p_screen jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; j bob_private.bob_jobs; captured jsonb;
begin
 perform bob_private.bob_assert_server_actor(p_project,p_user);
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||p_user::text,0));
 perform bob_private.validate_turn_screen(p_screen);
 result:=bob_private.bob_enqueue_job_before_screen(p_project,p_user,p_turn,p_message,p_credential,p_expires,p_worker_url);
 if result->>'status'='accepted' then
  select * into j from bob_private.bob_jobs where id=(result->>'jobId')::uuid;
  -- Existing active jobs may already have a worker lease; compare without mutating its claim.
  insert into bob_private.bob_turn_screens values(j.thread_id,p_turn,nullif(p_screen,'null'::jsonb)) on conflict do nothing;
  select screen into captured from bob_private.bob_turn_screens where thread_id=j.thread_id and turn_id=p_turn;
  if p_screen is not null and p_screen<>'null'::jsonb and captured is distinct from p_screen then raise exception 'turn_screen_changed' using errcode='22023'; end if;
  result:=result||jsonb_build_object('screen',captured);
 end if;
 return result;
end $$;
revoke all on function bob.bob_enqueue_job_v2(text,uuid,uuid,text,jsonb,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function bob.bob_enqueue_job_v2(text,uuid,uuid,text,jsonb,timestamptz,text,jsonb) to service_role;

alter function bob_private.bob_claim_job(uuid,uuid) rename to bob_claim_job_before_screen;
create function bob_private.bob_claim_job(p_job uuid,p_capability uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=bob_private.bob_claim_job_before_screen(p_job,p_capability);
 if result->>'status'='claimed' then
  -- Legacy enqueue callers also freeze omission before the first worker executes.
  insert into bob_private.bob_turn_screens values((result->>'threadId')::uuid,(result->>'clientTurnId')::uuid,null) on conflict do nothing;
  result:=result||jsonb_build_object('screen',(select screen from bob_private.bob_turn_screens where thread_id=(result->>'threadId')::uuid and turn_id=(result->>'clientTurnId')::uuid));
 end if;
 return result;
end $$;
revoke all on function bob_private.bob_claim_job(uuid,uuid) from public,anon,authenticated;
grant execute on function bob_private.bob_claim_job(uuid,uuid) to service_role;
create or replace function bob.bob_claim_job(p_job uuid,p_capability uuid) returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_claim_job(p_job,p_capability) $$;

alter function bob_private.bob_job_status(text,uuid) rename to bob_job_status_before_screen;
create function bob_private.bob_job_status(p_project text,p_turn uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; captured jsonb;
begin
 result:=bob_private.bob_job_status_before_screen(p_project,p_turn);
 if result is null then return null; end if;
 select s.screen into captured from bob_private.bob_turn_screens s join bob_private.bob_jobs j on j.thread_id=s.thread_id and j.turn_id=s.turn_id
 where j.project_id=p_project and j.actor_id=auth.uid() and j.turn_id=p_turn and j.drawing_request_id is null;
 return result||jsonb_build_object('screen',captured);
end $$;
revoke all on function bob_private.bob_job_status(text,uuid) from public,anon,service_role;
grant execute on function bob_private.bob_job_status(text,uuid) to authenticated;
create or replace function bob.bob_job_status(p_project text,p_turn uuid) returns jsonb language sql security invoker set search_path='' as $$ select bob_private.bob_job_status(p_project,p_turn) $$;

-- Canonical labels come from already-shared Tasks/current Plan records. Never
-- read private brief/assessment prose to publish a gap.
alter function bob.drawing_request_work(text,uuid) set schema bob_private;
alter function bob_private.drawing_request_work(text,uuid) rename to drawing_request_work_before_screen;
create function bob_private.drawing_gap_labels(p_project text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'label',coalesce(t.name,q.title),'owner_label',case coalesce(q.responsible_kind,s.responsible_kind) when 'bob' then 'Bob' when 'person' then person.name else null end,
 'step_title',s.title,'area_id',coalesce(t.area_id,s.area_id)) order by g.id),'[]') into result
 from bob_private.drawing_gaps g
 join bob_private.project_drawing_requests r on r.id=g.request_id and r.project_id=p_project
 left join bob.tasks t on t.id=g.task_id and t.project_id=p_project
 left join bob.project_plans plan on plan.project_id=p_project
 left join bob.project_plan_steps s on s.project_id=p_project and s.plan_revision=plan.current_revision and s.step_id=g.step_id
 left join bob_private.drawing_requirement_tasks rt on rt.project_id=p_project and rt.task_id=t.id
 left join bob.project_plan_requirements q on q.project_id=p_project and q.plan_revision=plan.current_revision and q.requirement_id=rt.requirement_id and q.step_id=s.step_id
 left join bob.people person on person.project_id=p_project and person.id=coalesce(q.responsible_person_id,s.responsible_person_id)
 where g.request_id=p_id;
 return result;
end $$;
revoke all on function bob_private.drawing_gap_labels(text,uuid) from public,anon,service_role;
grant execute on function bob_private.drawing_gap_labels(text,uuid) to authenticated;
create function bob.drawing_request_work(p_project text,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; labels jsonb; artifact uuid; state text;
begin
 result:=bob_private.drawing_request_work_before_screen(p_project,p_id);
 if result is null then return null; end if;
 labels:=bob_private.drawing_gap_labels(p_project,p_id);
 result:=jsonb_set(result,'{gaps}',coalesce((select jsonb_agg(g||coalesce((select l-'id' from jsonb_array_elements(labels) l where l->>'id'=g->>'id'),'{}') order by g->>'id') from jsonb_array_elements(result->'gaps') g),'[]'));
 artifact:=coalesce(result#>>'{request,artifact_id}',result#>>'{request,scope,artifact_id}')::uuid;
 if artifact is not null then
  select freshness.source_state into state from bob.artifact_source_status freshness join bob.artifacts a on a.project_id=freshness.project_id and a.id=freshness.artifact_id and coalesce((result#>>'{request,artifact_revision}')::integer,a.current_revision)=freshness.revision
  where freshness.project_id=p_project and freshness.artifact_id=artifact;
 end if;
 return result||jsonb_build_object('artifact_source_state',state);
end $$;
revoke all on function bob.drawing_request_work(text,uuid) from public,anon,service_role;
grant execute on function bob.drawing_request_work(text,uuid) to authenticated;

-- The existing list was a definer; make its hydration an invoker boundary too.
create function bob_private.drawing_work_ids(p_project text,p_after uuid,p_task text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(id order by id),'[]') into ids from (
  select q.id from bob_private.project_drawing_requests q where project_id=p_project and (p_after is null or q.id>p_after)
   and (p_task is null or exists(select 1 from bob_private.drawing_gaps g where g.request_id=q.id and g.task_id=p_task)) order by q.id limit 20
 ) q;
 return ids;
end $$;
revoke all on function bob_private.drawing_work_ids(text,uuid,text) from public,anon,service_role;
grant execute on function bob_private.drawing_work_ids(text,uuid,text) to authenticated;
create or replace function bob.drawing_work_list(p_project text,p_after uuid default null,p_task text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ids jsonb; result jsonb; cursor_id uuid;
begin
 ids:=bob_private.drawing_work_ids(p_project,p_after,p_task);
 select coalesce(jsonb_agg(bob.drawing_request_work(p_project,id::uuid) order by id),'[]') into result from jsonb_array_elements_text(ids) id;
 if jsonb_array_length(ids)=20 then cursor_id:=(ids->>19)::uuid; end if;
 return jsonb_build_object('items',result,'next_cursor',cursor_id);
end $$;

-- Source status stays caller-authorized: invoker queries preserve physical/media
-- revocation. The projection publishes identities/revisions, never source prose.
create function bob.artifact_source_changes(p_project text,p_artifact uuid,p_revision integer)
returns jsonb language plpgsql stable security invoker set search_path='' set join_collapse_limit=1 set from_collapse_limit=1 as $$
declare result jsonb; total integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if not exists(select 1 from bob.artifact_revisions where project_id=p_project and artifact_id=p_artifact and revision=p_revision) then return null; end if;
 with recursive chain as (
  select c.artifact_id,c.artifact_revision,c.source_artifact_id,c.source_revision,c.manifest,1 depth from bob.artifact_cad_revisions c where c.project_id=p_project and c.artifact_id=p_artifact and c.artifact_revision=p_revision
  union all
  select c.artifact_id,c.artifact_revision,c.source_artifact_id,c.source_revision,c.manifest,x.depth+1 from chain x join bob.artifact_cad_revisions c on c.project_id=p_project and c.artifact_id=x.source_artifact_id and c.artifact_revision=x.source_revision where x.depth<64
 ), graph_nodes as (
  select n from chain x cross join lateral jsonb_array_elements(coalesce(x.manifest#>'{bob_parameters,nodes}','[]')) n
  where x.depth=1
 ), dependencies(source_id,node_id) as (
  select n->>'id',n->>'id' from graph_nodes where n->>'role'='source'
  union
  select d.source_id,n->>'id' from dependencies d join graph_nodes on n->>'role'='derived' and n->'operands'?d.node_id
 ), graph_pin_nodes as (
  select distinct n->'source' src,n->'sources'->0 snapshot,
   coalesce((select jsonb_agg(d.node_id order by d.node_id) from dependencies d where d.source_id=n->>'id'),'[]') parameters
  from graph_nodes where n->>'role'='source'
  union all
  select distinct b->'source',b->'source','[]'::jsonb from chain x cross join lateral jsonb_array_elements(coalesce(x.manifest#>'{bob_lineage,bindings}','[]')) b where x.depth=1 and not x.manifest?'bob_parameters'
 ), graph_pins as (
  select g.src,g.snapshot,coalesce((select jsonb_agg(id order by id) from (select distinct jsonb_array_elements_text(n.parameters) id from graph_pin_nodes n where n.src=g.src) ids),'[]') parameters
  from graph_pin_nodes g group by g.src,g.snapshot
 ), measurement_pins as (
  select distinct pin.measurement_id id,pin.measurement_revision revision,
   coalesce((select parameters from graph_pins g where g.src->>'kind'='project_measurement' and g.src->>'id'=pin.measurement_id::text limit 1),'[]') parameters
  from bob.artifact_measurements pin where pin.project_id=p_project and pin.artifact_id=p_artifact and pin.artifact_revision=p_revision
  union
  select distinct pin.measurement_id,pin.measurement_revision,'[]'::jsonb from chain x join bob.artifact_measurements pin on pin.project_id=p_project and pin.artifact_id=x.artifact_id and pin.artifact_revision=x.artifact_revision
   where x.depth>1 and not exists(select 1 from jsonb_array_elements(coalesce(x.manifest#>'{bob_parameters,nodes}','[]')) n where n->>'role'='source' and n#>>'{source,kind}'='project_measurement' and n#>>'{source,id}'=pin.measurement_id::text)
 ), measurement_changes as (
  select jsonb_build_object('kind','project_measurement','id',p.id,'saved_revision',p.revision,'current_revision',m.revision,'parameter_ids',p.parameters,
   'state',case when m.id is null then 'unavailable' else 'changed' end) entry
  from measurement_pins p left join bob.current_measurements m on m.project_id=p_project and m.id=p.id
  where m.id is null or m.revision is distinct from p.revision or m.archived
 ), physical_changes as (
  select jsonb_build_object('kind','space_measurement','id',case when sm.id is not null and sp.id is not null and bu.id is not null then p.src->>'id' end,
   'saved_revision',(p.src->>'space_revision')::integer,'current_revision',sp.revision,'parameter_ids',p.parameters,
   'state',case when sm.id is null or sp.id is null or bu.id is null then 'unavailable' else 'changed' end) entry
  from graph_pins p left join bob.space_measurements sm on sm.id=(p.src->>'id')::uuid
  left join bob.project_spaces sp on sp.project_id=p_project and sp.id=(p.snapshot->>'space_id')::uuid
  left join bob.project_buildings bu on bu.project_id=p_project and bu.id=(p.snapshot->>'building_id')::uuid
  where p.src->>'kind'='space_measurement' and (sm.id is null or sp.id is null or bu.id is null or sp.revision is distinct from (p.src->>'space_revision')::integer or sp.archived or bu.archived)
 ), drawing_pins as (
  select distinct x.source_artifact_id id,x.source_revision revision from chain x where x.source_artifact_id is not null
 ), drawing_changes as (
  select jsonb_build_object('kind','drawing','id',p.id,'saved_revision',p.revision,'current_revision',a.current_revision,'parameter_ids','[]'::jsonb,
   'state',case when a.id is null or saved.artifact_id is null then 'unavailable' else 'changed' end) entry
  from drawing_pins p left join bob.artifacts a on a.project_id=p_project and a.id=p.id
  left join bob.artifact_revisions saved on saved.project_id=p_project and saved.artifact_id=p.id and saved.revision=p.revision
  left join bob.artifact_revisions current_r on current_r.project_id=p_project and current_r.artifact_id=p.id and current_r.revision=a.current_revision
  where a.id is null or saved.artifact_id is null or a.current_revision is distinct from p.revision or current_r.archived
 ), target_pins as (
  select r.target_revision,r.solution_id,r.solution_revision,a.area_id from bob.artifact_revisions r join bob.artifacts a on a.project_id=r.project_id and a.id=r.artifact_id
  where r.project_id=p_project and r.artifact_id=p_artifact and r.revision=p_revision
  union
  select r.target_revision,r.solution_id,r.solution_revision,a.area_id from chain x join bob.artifact_revisions r on r.project_id=p_project and r.artifact_id=x.artifact_id and r.revision=x.artifact_revision join bob.artifacts a on a.project_id=p_project and a.id=x.artifact_id
 ), target_changes as (
  select jsonb_build_object('kind','target','id',coalesce(t.area_id,p.area_id,p_project),'saved_revision',p.target_revision,'current_revision',t.revision,'parameter_ids','[]'::jsonb,
   'state',case when t.revision is null then 'unavailable' else 'changed' end) entry
  from target_pins p left join lateral (select t.* from bob.current_target t where t.project_id=p_project and (t.area_id is not distinct from p.area_id or p.area_id is not null and t.area_id is null) order by case when t.area_id is not distinct from p.area_id then 0 else 1 end limit 1) t on true
  where t.revision is null or t.revision is distinct from p.target_revision or t.solution_id is distinct from p.solution_id or t.solution_revision is distinct from p.solution_revision
 ), image_pins as (
  select distinct (substring(f->>'source_ref' from 7))::uuid id,f->>'source_version' version from chain x cross join lateral jsonb_array_elements(coalesce(x.manifest#>'{bob_parameters,frames}','[]')) f where f->>'kind'='image' and x.depth=1
 ), image_changes as (
  select case when m.id is null then jsonb_build_object('kind','image','id',null,'parameter_ids','[]'::jsonb,'state','unavailable')
   else jsonb_build_object('kind','image','id',p.id,'saved_version',encode(sha256(convert_to(p.version,'UTF8')),'hex'),
    'current_version',encode(sha256(convert_to(jsonb_build_array(m.updated_at,m.content_type,m.byte_size,m.width,m.height,m.title,m.purpose,coalesce(m.source_kind,'unknown'),
     coalesce((select jsonb_agg(to_jsonb(jsonb_build_array(l.area_id,l.task_id,l.step_id,l.plan_step_id)::text) order by jsonb_build_array(l.area_id,l.task_id,l.step_id,l.plan_step_id)::text) from bob.media_links l where l.project_id=p_project and l.media_id=m.id),'[]'))::text,'UTF8')),'hex'),
    'parameter_ids','[]'::jsonb,'state','changed') end entry
  from image_pins p left join bob.media_assets m on m.project_id=p_project and m.id=p.id and m.state='ready'
  where not bob_private.cad_image_version_matches(p_project,p.id,p.version)
 ), all_changes as (
  select entry from measurement_changes union select entry from physical_changes union select entry from drawing_changes union select entry from target_changes union select entry from image_changes
 ), bounded as (select entry from all_changes order by entry->>'kind',entry->>'id',entry->>'saved_revision' limit 200)
 select coalesce((select jsonb_agg(entry order by entry->>'kind',entry->>'id') from bounded),'[]'),(select count(*) from all_changes) into result,total;
 return jsonb_build_object('changes',result,'truncated',total>200);
end $$;
revoke all on function bob.artifact_source_changes(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.artifact_source_changes(text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
