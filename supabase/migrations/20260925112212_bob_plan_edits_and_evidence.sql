begin;
set local lock_timeout='5s';
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values ('edit_project_plan','Prepare focused edits to the current plan while preserving unrelated Steps, criteria and Task ownership exactly.','Use exact current IDs and a bounded changes list. Read-only: creates an exact candidate for save_compiled_project_plan. Remove obsolete work explicitly instead of falsely marking a physical check complete. Save the proposal, then use decide_project_plan when the current owner request explicitly instructs applying this exact edit. A request for suggestions alone does not approve a change.',1,true,array[]::text[],true);
update bob.tool_catalog set how_to='Read the proposal and current approved revision. The current owner must explicitly approve it or instruct this exact edit to be applied; do not require the same permission twice. A request for suggestions alone does not approve a plan, nor does approval of a specific edit authorise unrelated strategy. A stale proposal conflicts. Staged Task ownership is applied atomically on approval.' where name='decide_project_plan' and schema_version=1;
update bob.tool_catalog set how_to='Pass only plan_intent for an initial plan or broad replan. For a focused change use edit_project_plan, preserving unrelated work mechanically. The server binds the current revision. Mini compiles and nano advises; Bob assesses objections. Correct server errors, then save a sound proposal with save_compiled_project_plan. Task candidates contain only ownership changes, staged with the proposal and applied on approval. Use remaining_attempts; do not ask again for granted proposal scope.' where name='compile_project_plan' and schema_version=1;
update bob.tool_catalog set how_to='Save the exact server-valid compilation or focused edit after assessing its result. Pass only the current request_quote. This saves a proposal and stages Task ownership changes; it does not approve it. Use decide_project_plan separately when the owner has explicitly authorised applying that exact plan or edit. Never reconstruct the nested plan JSON.' where name='save_compiled_project_plan' and schema_version=1;

CREATE OR REPLACE FUNCTION bob_private.project_plan_propose(p_project text, p_expected integer, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h bob.project_plans; new_rev integer; current_rev integer; step jsonb; req jsonb; sid uuid; qid uuid;
  step_pos integer:=0; req_pos integer; completed_count integer:=0; active_count integer:=0; selector jsonb; link jsonb; staged_links jsonb:='[]'::jsonb; task_stamp timestamptz;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if jsonb_typeof(p_data)<>'object' or p_data-array['summary','reason','steps','task_links']::text[]<>'{}'
    or (select count(*) from jsonb_object_keys(p_data)) not in (3,4)
    or jsonb_typeof(p_data->'summary')<>'string' or char_length(btrim(p_data->>'summary')) not between 1 and 4000
    or jsonb_typeof(p_data->'reason')<>'string' or char_length(btrim(p_data->>'reason')) not between 1 and 4000
    or jsonb_typeof(p_data->'steps')<>'array' or jsonb_array_length(p_data->'steps') not between 1 and 100
    or octet_length(p_data::text)>320000 then raise exception 'plan_invalid_proposal' using errcode='22023'; end if;

  insert into bob.project_plans(project_id) values(p_project) on conflict do nothing;
  select * into h from bob.project_plans where project_id=p_project for update;
  current_rev:=h.current_revision;
  if coalesce(current_rev,0) is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
  if exists(select 1 from bob.project_plan_revisions where project_id=p_project and status='proposed') then
    raise exception 'plan_proposal_pending' using errcode='40001'; end if;
  new_rev:=h.next_revision;
  update bob.project_plans set next_revision=next_revision+1,updated_at=clock_timestamp() where project_id=p_project;
  insert into bob.project_plan_revisions(project_id,revision,status,based_on_revision,summary,reason,proposed_by)
    values(p_project,new_rev,'proposed',current_rev,btrim(p_data->>'summary'),btrim(p_data->>'reason'),auth.uid());

  if current_rev is not null then
    insert into bob.project_plan_steps(project_id,plan_revision,step_id,position,title,goal,state,area_id,responsible_kind,responsible_person_id,notes,phase)
      select project_id,new_rev,step_id,position,title,goal,state,area_id,responsible_kind,responsible_person_id,notes,phase
      from bob.project_plan_steps where project_id=p_project and plan_revision=current_rev and state='completed' order by position;
    get diagnostics completed_count=row_count;
    insert into bob.project_plan_requirements(project_id,plan_revision,requirement_id,step_id,position,requirement_type,title,description,resolution,responsible_kind,responsible_person_id,evidence_selector)
      select project_id,new_rev,requirement_id,step_id,position,requirement_type,title,description,resolution,responsible_kind,responsible_person_id,evidence_selector
      from bob.project_plan_requirements q where q.project_id=p_project and q.plan_revision=current_rev
        and exists(select 1 from bob.project_plan_steps s where s.project_id=p_project and s.plan_revision=current_rev and s.step_id=q.step_id and s.state='completed');
    insert into bob.project_plan_evidence(project_id,plan_revision,requirement_id,evidence_kind,evidence_id,evidence_revision,relation,linked_by,linked_at)
      select project_id,new_rev,requirement_id,evidence_kind,evidence_id,evidence_revision,relation,linked_by,linked_at
      from bob.project_plan_evidence e where e.project_id=p_project and e.plan_revision=current_rev
        and exists(select 1 from bob.project_plan_requirements q join bob.project_plan_steps s
          on s.project_id=q.project_id and s.plan_revision=q.plan_revision and s.step_id=q.step_id
          where q.project_id=p_project and q.plan_revision=current_rev and q.requirement_id=e.requirement_id and s.state='completed');
  end if;
  step_pos:=completed_count;

  for step in select value from jsonb_array_elements(p_data->'steps') loop
    if jsonb_typeof(step)<>'object' or step-array['step_id','title','goal','state','area_id','responsible_kind','responsible_person_id','notes','requirements','phase']::text[]<>'{}'
      or (select count(*) from jsonb_object_keys(step)) not in (9,10)
      or jsonb_typeof(step->'title')<>'string' or char_length(btrim(step->>'title')) not between 1 and 240
      or jsonb_typeof(step->'goal')<>'string' or char_length(btrim(step->>'goal')) not between 1 and 4000
      or coalesce(step->>'state','')<>all(array['planned','active','blocked','completed'])
      or not(step->'area_id'='null'::jsonb or (jsonb_typeof(step->'area_id')='string' and char_length(step->>'area_id') between 1 and 200))
      or coalesce(step->>'responsible_kind','')<>all(array['bob','person','unassigned'])
      or not(step->'responsible_person_id'='null'::jsonb or jsonb_typeof(step->'responsible_person_id')='string')
      or jsonb_typeof(step->'notes')<>'string' or char_length(step->>'notes')>4000
      or (step->>'phase' is not null and step->>'phase'<>all(array['concept','design','planning','build','complete']))
      or jsonb_typeof(step->'requirements')<>'array' or jsonb_array_length(step->'requirements')>20 then
      raise exception 'plan_invalid_step' using errcode='22023'; end if;
    if (step->>'responsible_kind'='person') is distinct from (step->'responsible_person_id'<>'null'::jsonb) then
      raise exception 'plan_invalid_responsibility' using errcode='22023'; end if;
    if step->'area_id'<>'null'::jsonb and not exists(select 1 from bob.areas where id=step->>'area_id' and project_id=p_project) then
      raise exception 'project_denied' using errcode='42501'; end if;
    if step->>'responsible_kind'='person' and not exists(select 1 from bob.people where id=step->>'responsible_person_id' and project_id=p_project) then
      raise exception 'project_denied' using errcode='42501'; end if;

    if step->'step_id'='null'::jsonb then sid:=gen_random_uuid();
    else
      sid:=(step->>'step_id')::uuid;
      if current_rev is null or not exists(select 1 from bob.project_plan_steps
        where project_id=p_project and plan_revision=current_rev and step_id=sid and state<>'completed') then
        raise exception 'plan_unknown_step_id' using errcode='22023'; end if;
    end if;
    if exists(select 1 from bob.project_plan_steps where project_id=p_project and plan_revision=new_rev and step_id=sid) then
      raise exception 'plan_duplicate_step' using errcode='22023'; end if;
    step_pos:=step_pos+1;
    -- Step execution state is independent from the single Bob focus.
    insert into bob.project_plan_steps values(p_project,new_rev,sid,step_pos,btrim(step->>'title'),btrim(step->>'goal'),step->>'state',
      nullif(step->>'area_id',''),step->>'responsible_kind',nullif(step->>'responsible_person_id',''),step->>'notes',case when step ? 'phase' then (step->>'phase')::bob.project_phase else
        (select phase from bob.project_plan_steps where project_id=p_project and plan_revision=current_rev and step_id=sid) end);

    req_pos:=0;
    for req in select value from jsonb_array_elements(step->'requirements') loop
      if jsonb_typeof(req)<>'object'
        or req-array['requirement_id','type','title','description','resolution','responsible_kind','responsible_person_id','evidence_selector']::text[]<>'{}'
        or (select count(*) from jsonb_object_keys(req))<>8
        or coalesce(req->>'type','')<>all(array['measurement','photo','decision','drawing','material_requirement','material_delivery','task','approval','check','other'])
        or jsonb_typeof(req->'title')<>'string' or char_length(btrim(req->>'title')) not between 1 and 240
        or jsonb_typeof(req->'description')<>'string' or char_length(req->>'description')>2000
        or coalesce(req->>'resolution','')<>all(array['open','waived','not_applicable'])
        or coalesce(req->>'responsible_kind','')<>all(array['bob','person','unassigned'])
        or not bob_private.plan_selector_valid(req->'evidence_selector') then
        raise exception 'plan_invalid_requirement' using errcode='22023'; end if;
      if (req->>'responsible_kind'='person') is distinct from (req->'responsible_person_id'<>'null'::jsonb) then
        raise exception 'plan_invalid_responsibility' using errcode='22023'; end if;
      if req->>'responsible_kind'='person' and not exists(select 1 from bob.people where id=req->>'responsible_person_id' and project_id=p_project) then
        raise exception 'project_denied' using errcode='42501'; end if;
      selector:=req->'evidence_selector';
      if selector->>'kind'='measurement' and selector->'area_id'<>'null'::jsonb
        and not exists(select 1 from bob.areas where id=selector->>'area_id' and project_id=p_project) then
        raise exception 'project_denied' using errcode='42501'; end if;

      if req->'requirement_id'='null'::jsonb then qid:=gen_random_uuid();
      else
        qid:=(req->>'requirement_id')::uuid;
        if current_rev is null or step->'step_id'='null'::jsonb or not exists(select 1 from bob.project_plan_requirements
          where project_id=p_project and plan_revision=current_rev and requirement_id=qid and step_id=sid) then
          raise exception 'plan_unknown_requirement_id' using errcode='22023'; end if;
      end if;
      if exists(select 1 from bob.project_plan_requirements where project_id=p_project and plan_revision=new_rev and requirement_id=qid) then
        raise exception 'plan_duplicate_requirement' using errcode='22023'; end if;
      req_pos:=req_pos+1;
      insert into bob.project_plan_requirements values(p_project,new_rev,qid,sid,req_pos,req->>'type',btrim(req->>'title'),req->>'description',
        req->>'resolution',req->>'responsible_kind',nullif(req->>'responsible_person_id',''),selector);
    end loop;
  end loop;
  if p_data ? 'task_links' then
    if jsonb_typeof(p_data->'task_links')<>'array' or jsonb_array_length(p_data->'task_links')>200 then
      raise exception 'plan_invalid_task_links' using errcode='22023'; end if;
    for link in select value from jsonb_array_elements(p_data->'task_links') loop
      if link-array['step_position','task_id']::text[]<>'{}' or coalesce(link->>'step_position','')!~'^[0-9]{1,3}$' then
        raise exception 'plan_invalid_task_links' using errcode='22023'; end if;
      select step_id into sid from bob.project_plan_steps where project_id=p_project and plan_revision=new_rev
        and position=completed_count+(link->>'step_position')::integer;
      if not found then raise exception 'plan_step_not_found' using errcode='22023'; end if;
      select updated_at into task_stamp from bob.tasks where project_id=p_project and id=link->>'task_id' for share;
      if not found then raise exception 'plan_task_not_found' using errcode='22023'; end if;
      if exists(select 1 from jsonb_array_elements(staged_links) l where l->>'task_id'=link->>'task_id') then
        raise exception 'plan_duplicate_task_owner' using errcode='22023'; end if;
      staged_links:=staged_links||jsonb_build_array(jsonb_build_object('task_id',link->>'task_id','step_id',sid,'expected_updated_at',task_stamp));
    end loop;
  end if;
  update bob.project_plan_revisions set task_links=staged_links where project_id=p_project and revision=new_rev;

  -- Preserve only semantically unchanged criteria, including late evidence
  -- recorded while a proposal was pending. Keep the original author/time.
  insert into bob.project_plan_evidence(project_id,plan_revision,requirement_id,evidence_kind,evidence_id,evidence_revision,relation,linked_by,linked_at)
  select e.project_id,new_rev,e.requirement_id,e.evidence_kind,e.evidence_id,e.evidence_revision,e.relation,e.linked_by,e.linked_at
  from bob.project_plan_evidence e
  join bob.project_plan_requirements old on old.project_id=e.project_id and old.plan_revision=e.plan_revision and old.requirement_id=e.requirement_id
  join bob.project_plan_requirements fresh on fresh.project_id=old.project_id and fresh.plan_revision=new_rev and fresh.requirement_id=old.requirement_id
  where e.project_id=p_project and e.plan_revision=current_rev
    and (to_jsonb(old)-array['plan_revision','position','responsible_kind','responsible_person_id'])
      =(to_jsonb(fresh)-array['plan_revision','position','responsible_kind','responsible_person_id'])
  on conflict(project_id,plan_revision,requirement_id,evidence_kind,evidence_id,relation) do update
    set evidence_revision=excluded.evidence_revision,linked_by=excluded.linked_by,linked_at=excluded.linked_at;
  return bob.project_plan_read(p_project,new_rev);
end $function$
;

CREATE OR REPLACE FUNCTION bob_private.project_plan_decide(p_project text, p_expected integer, p_proposal integer, p_action text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h bob.project_plans; r bob.project_plan_revisions; link jsonb; stamp timestamptz;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_action<>all(array['approve','reject']) or p_proposal<1 or char_length(coalesce(p_note,''))>2000 then
    raise exception 'plan_invalid_decision' using errcode='22023'; end if;
  select * into h from bob.project_plans where project_id=p_project for update;
  if not found or coalesce(h.current_revision,0) is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
  select * into r from bob.project_plan_revisions where project_id=p_project and revision=p_proposal for update;
  if not found or r.status<>'proposed' or coalesce(r.based_on_revision,0) is distinct from p_expected then
    raise exception 'record_changed' using errcode='40001'; end if;
  if p_action='reject' then
    update bob.project_plan_revisions set status='rejected',decided_at=clock_timestamp() where project_id=p_project and revision=p_proposal;
    return bob.project_plan_read(p_project,p_proposal);
  end if;
  for link in select value from jsonb_array_elements(r.task_links) loop
    select updated_at into stamp from bob.tasks where project_id=p_project and id=link->>'task_id' for update;
    if not found or stamp is distinct from (link->>'expected_updated_at')::timestamptz then
      raise exception 'plan_task_changed' using errcode='40001'; end if;
  end loop;

  -- Preserve only semantically unchanged criteria, including late evidence
  -- recorded while a proposal was pending. Keep the original author/time.
  insert into bob.project_plan_evidence(project_id,plan_revision,requirement_id,evidence_kind,evidence_id,evidence_revision,relation,linked_by,linked_at)
  select e.project_id,p_proposal,e.requirement_id,e.evidence_kind,e.evidence_id,e.evidence_revision,e.relation,e.linked_by,e.linked_at
  from bob.project_plan_evidence e
  join bob.project_plan_requirements old on old.project_id=e.project_id and old.plan_revision=e.plan_revision and old.requirement_id=e.requirement_id
  join bob.project_plan_requirements fresh on fresh.project_id=old.project_id and fresh.plan_revision=p_proposal and fresh.requirement_id=old.requirement_id
  where e.project_id=p_project and e.plan_revision=h.current_revision
    and (to_jsonb(old)-array['plan_revision','position','responsible_kind','responsible_person_id'])
      =(to_jsonb(fresh)-array['plan_revision','position','responsible_kind','responsible_person_id'])
  on conflict(project_id,plan_revision,requirement_id,evidence_kind,evidence_id,relation) do update
    set evidence_revision=excluded.evidence_revision,linked_by=excluded.linked_by,linked_at=excluded.linked_at;
  if h.current_revision is not null then
    update bob.project_plan_revisions set status='superseded',decided_at=coalesce(decided_at,clock_timestamp()),
      approved_by=coalesce(approved_by,auth.uid())
    where project_id=p_project and revision=h.current_revision and status='approved';
  end if;
  update bob.project_plan_revisions set status='approved',approved_by=auth.uid(),decided_at=clock_timestamp()
    where project_id=p_project and revision=p_proposal;
  update bob.project_plans set current_revision=p_proposal,updated_at=clock_timestamp() where project_id=p_project;
  for link in select value from jsonb_array_elements(r.task_links) loop
    perform bob_private.project_plan_link_task(p_project,p_proposal,(link->>'step_id')::uuid,link->>'task_id','move');
  end loop;
  -- Preserve work whose old Step was intentionally removed; expose it as unorganised.
  update bob.tasks t set primary_step_id=null where t.project_id=p_project and t.primary_step_id is not null
    and not exists(select 1 from bob.project_plan_steps s where s.project_id=p_project and s.plan_revision=p_proposal and s.step_id=t.primary_step_id);
  update bob.tasks t set area_id=s.area_id from bob.project_plan_steps s
    where t.project_id=p_project and s.project_id=p_project and s.plan_revision=p_proposal and s.step_id=t.primary_step_id and t.area_id is distinct from s.area_id;
  update bob.project_plans p set focus_step_id=(select s.step_id from bob.project_plan_steps s
    where s.project_id=p_project and s.plan_revision=p_proposal and s.state<>'completed'
    order by (s.step_id=p.focus_step_id) desc nulls last,(s.state='active') desc,s.position limit 1)
    where p.project_id=p_project;
  return bob.project_plan_read(p_project,p_proposal);
end $function$
;

-- Explicitly relinking revised evidence must replace its old pin, not silently
-- succeed with stale evidence. Serialize with plan approval.
create or replace function bob_private.project_plan_link_evidence(p_project text,p_expected integer,p_requirement uuid,p_kind text,p_id text,p_revision integer,p_relation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cur jsonb; requirement_title text; current_rev integer;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select current_revision into current_rev from bob.project_plans where project_id=p_project for update;
  if current_rev is distinct from p_expected then
    raise exception 'record_changed' using errcode='40001'; end if;
  if not exists(select 1 from bob.project_plan_requirements where project_id=p_project and plan_revision=p_expected and requirement_id=p_requirement) then
    raise exception 'plan_requirement_not_found' using errcode='22023'; end if;
  if p_relation<>all(array['resolves','conflicts','refines','supersedes'])
    or p_kind<>all(array['measurement','media','artifact','material_requirement','solution','task']) then
    raise exception 'plan_invalid_evidence' using errcode='22023'; end if;
  if (p_kind in ('measurement','artifact','material_requirement','solution')) is distinct from (p_revision is not null and p_revision>0) then
    raise exception 'plan_invalid_evidence_revision' using errcode='22023'; end if;
  cur:=bob_private.plan_evidence_current(p_project,p_kind,p_id);
  if not (cur->>'exists')::boolean then raise exception 'plan_evidence_not_found' using errcode='22023'; end if;
  if p_revision is not null and (cur->>'revision')::integer < p_revision then raise exception 'plan_evidence_not_found' using errcode='22023'; end if;
  insert into bob.project_plan_evidence(project_id,plan_revision,requirement_id,evidence_kind,evidence_id,evidence_revision,relation,linked_by)
    values(p_project,p_expected,p_requirement,p_kind,p_id,p_revision,p_relation,auth.uid())
    on conflict(project_id,plan_revision,requirement_id,evidence_kind,evidence_id,relation) do update
      set evidence_revision=excluded.evidence_revision,linked_by=excluded.linked_by,linked_at=clock_timestamp();
  select q.title into requirement_title from bob.project_plan_requirements q where q.project_id=p_project and q.plan_revision=p_expected and q.requirement_id=p_requirement;
  return jsonb_build_object('id',p_project,'revision',p_expected,'name','Living project plan v'||p_expected,
    'requirement_id',p_requirement,'requirement_title',requirement_title,'requirement_status',bob_private.plan_requirement_state(p_project,p_expected,p_requirement),
    'updated_at',clock_timestamp());
end $$;

commit;
