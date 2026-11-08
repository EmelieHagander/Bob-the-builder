-- P2.2: A linked Task is not completion evidence merely because it exists.
-- Keep open as the normal evidence-derived state; require an actually completed
-- Task for both explicit links and automatic selectors. Historical task links
-- remain intact but report missing until the Task reaches done.
-- No project Plan, task status, Construction or geometry is mutated here.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $verified_task_evidence$
declare
  body text;
  old_part text;
  new_part text;
begin
  body := pg_get_functiondef('bob_private.plan_requirement_state(text,integer,uuid)'::regprocedure);
  old_part := $old$    cur:=bob_private.plan_evidence_current(p_project,row.evidence_kind,row.evidence_id);$old$;
  new_part := $new$    cur:=bob_private.plan_evidence_current(p_project,row.evidence_kind,row.evidence_id);
    if row.evidence_kind='task' then
      cur:=cur||jsonb_build_object('task_status',
        (select t.status from bob.tasks t where t.project_id=p_project and t.id=row.evidence_id));
    end if;$new$;
  if position(old_part in body)=0 then raise exception 'p2_requirement_evidence_lookup_changed'; end if;
  body:=replace(body,old_part,new_part);

  old_part := $old$      if not (cur->>'exists')::boolean then has_stale:=true;$old$;
  new_part := $new$      if row.evidence_kind='task' and cur->>'task_status' is distinct from 'done' then
        null; -- A pending Task is an action, not completion evidence.
      elsif not (cur->>'exists')::boolean then has_stale:=true;$new$;
  if position(old_part in body)=0 then raise exception 'p2_requirement_link_state_changed'; end if;
  body:=replace(body,old_part,new_part);

  old_part := $old$    cur:=bob_private.plan_evidence_current(p_project,selector->>'kind',selector->>'id');$old$;
  new_part := $new$    cur:=bob_private.plan_evidence_current(p_project,selector->>'kind',selector->>'id');
    if selector->>'kind'='task' then
      cur:=cur||jsonb_build_object('task_status',
        (select t.status from bob.tasks t where t.project_id=p_project and t.id=selector->>'id'));
    end if;$new$;
  if position(old_part in body)=0 then raise exception 'p2_requirement_selector_status_changed'; end if;
  body:=replace(body,old_part,new_part);

  old_part := $old$    if (cur->>'exists')::boolean then has_fresh:=true; end if;$old$;
  new_part := $new$    if (cur->>'exists')::boolean
      and (selector->>'kind'<>'task' or exists(
        select 1 from bob.tasks t where t.project_id=p_project
          and t.id=selector->>'id' and t.status='done'
      )) then has_fresh:=true; end if;$new$;
  if position(old_part in body)=0 then raise exception 'p2_requirement_selector_changed'; end if;
  execute replace(body,old_part,new_part);

  body := pg_get_functiondef(
    'bob_private.project_plan_link_evidence(text,integer,uuid,text,text,integer,text)'::regprocedure);
  old_part := $old$declare cur jsonb; requirement_title text; current_rev integer;$old$;
  new_part := $new$declare cur jsonb; requirement_title text; current_rev integer;
  requirement_step uuid; step_completion jsonb;$new$;
  if position(old_part in body)=0 then raise exception 'p2_task_link_variables_changed'; end if;
  body:=replace(body,old_part,new_part);

  old_part := $old$  cur:=bob_private.plan_evidence_current(p_project,p_kind,p_id);$old$;
  new_part := $new$  -- Only finished Tasks can be attached as evidence of completion.
  -- Conflicting, non-resolving references may still describe pending work.
  if p_kind='task' and p_relation in ('resolves','refines','supersedes')
    and not exists(select 1 from bob.tasks t where t.project_id=p_project
      and t.id=p_id and t.status='done') then
    raise exception 'plan_task_not_completed' using errcode='22023';
  end if;
  cur:=bob_private.plan_evidence_current(p_project,p_kind,p_id);$new$;
  if position(old_part in body)=0 then raise exception 'p2_task_link_writer_changed'; end if;
  body:=replace(body,old_part,new_part);

  old_part := $old$  select q.title into requirement_title from bob.project_plan_requirements q where q.project_id=p_project and q.plan_revision=p_expected and q.requirement_id=p_requirement;$old$;
  new_part := $new$  select q.title,q.step_id into requirement_title,requirement_step
  from bob.project_plan_requirements q where q.project_id=p_project and q.plan_revision=p_expected and q.requirement_id=p_requirement;
  select jsonb_build_object('total',count(*)::integer,
    'satisfied',count(*) filter(where state='satisfied'),
    'missing',count(*) filter(where state='missing'),
    'stale',count(*) filter(where state='stale'),
    'conflicted',count(*) filter(where state='conflicted'),
    'requirements_ready',coalesce(bool_and(state in ('satisfied','waived','not_applicable')),true))
  into step_completion from (
    select bob_private.plan_requirement_state(q.project_id,q.plan_revision,q.requirement_id)->>'state' as state
    from bob.project_plan_requirements q
    where q.project_id=p_project and q.plan_revision=p_expected and q.step_id=requirement_step
  ) states;$new$;
  if position(old_part in body)=0 then raise exception 'p2_task_link_completion_read_changed'; end if;
  body:=replace(body,old_part,new_part);

  old_part := $old$    'updated_at',clock_timestamp());$old$;
  new_part := $new$    'updated_at',clock_timestamp(),'step_completion',step_completion);$new$;
  if position(old_part in body)=0 then raise exception 'p2_task_link_receipt_changed'; end if;
  execute replace(body,old_part,new_part);
end $verified_task_evidence$;
notify pgrst,'reload schema';
commit;
