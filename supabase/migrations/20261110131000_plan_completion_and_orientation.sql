begin;
-- Both proposal paths and a proposal awaiting approval use live evidence.
-- Completed history can be carried after its evidence changes.
create function bob_private.check_plan_step_completions(p_project text, p_base integer, p_revision integer)
returns void language plpgsql stable set search_path='' as $$
declare unfinished record;
begin
  with closing as (
    select s.step_id from bob.project_plan_steps s
    where s.project_id=p_project and s.plan_revision=p_revision and s.state='completed'
      and not exists(select 1 from bob.project_plan_steps old where old.project_id=p_project
        and old.plan_revision=p_base and old.step_id=s.step_id and old.state='completed')
  ), criteria as (
    select q.* from bob.project_plan_requirements q join closing using(step_id)
    where q.project_id=p_project and q.plan_revision=p_revision
    union all
    -- Dropping a still-open check while closing the step cannot certify it.
    select q.* from bob.project_plan_requirements q join closing using(step_id)
    where q.project_id=p_project and q.plan_revision=p_base and not exists (
      select 1 from bob.project_plan_requirements n where n.project_id=p_project
        and n.plan_revision=p_revision and n.requirement_id=q.requirement_id)
  )
  select c.step_id,c.requirement_id into unfinished from criteria c
  where coalesce(bob_private.plan_requirement_state(p_project,c.plan_revision,c.requirement_id)->>'state','missing')
    not in ('satisfied','waived','not_applicable') limit 1;
  if found then raise exception 'plan_step_requirements_unmet' using errcode='22023',
    detail=format('Step %s, requirement %s',unfinished.step_id,unfinished.requirement_id); end if;
end $$;
revoke all on function bob_private.check_plan_step_completions(text,integer,integer) from public,anon,authenticated;

-- Preserve historical step identity and relative order in the new revision.
-- A completed step may have occupied any position in the previous revision.
do $patch$
declare body text; anchor text;
begin
  body:=pg_get_functiondef('bob_private.project_plan_propose(text,integer,jsonb)'::regprocedure);
  anchor:='select project_id,new_rev,step_id,position,title,goal,state,area_id,responsible_kind,responsible_person_id,notes,phase';
  if strpos(body,anchor)=0 then raise exception 'plan_propose_positions_changed'; end if;
  body:=replace(body,anchor,replace(anchor,'step_id,position','step_id,row_number() over(order by position)'));
  anchor:='return bob.project_plan_read(p_project,new_rev);';
  if strpos(body,anchor)=0 then raise exception 'plan_propose_return_changed'; end if;
  execute replace(body,anchor,'perform bob_private.check_plan_step_completions(p_project,current_rev,new_rev);' || chr(10) || anchor);

  body:=pg_get_functiondef('bob_private.project_plan_decide(text,integer,integer,text,text)'::regprocedure);
  anchor:='if h.current_revision is not null then';
  if strpos(body,anchor)=0 then raise exception 'plan_decision_changed'; end if;
  execute replace(body,anchor,'perform bob_private.check_plan_step_completions(p_project,h.current_revision,p_proposal);' || chr(10) || anchor);
end $patch$;

-- A single caller-scoped snapshot for orientation. Other steps contribute
-- navigation cards. Exact task and evidence detail belongs to the selected step.
create function bob.read_plan_orientation(p_project text,p_screen_step text,p_screen_task text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare project_row jsonb; briefing jsonb; plan jsonb; selected text; steps jsonb;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select jsonb_build_object('id',p.id,'name',p.name,'phase',p.phase,'description',p.description,'updated_at',p.updated_at)
    into strict project_row from bob.projects p where p.id=p_project;
  briefing:=bob.project_plan_briefing(p_project);
  project_row:=project_row||jsonb_build_object('working_plan',jsonb_build_object('status',briefing->'status',
    'pending_proposal',briefing->'pending_proposal','recent_shared_facts',briefing->'recent_shared_facts'));
  plan:=bob.project_plan_read(p_project,null)->'record';
  if plan->>'status'='approved' then
    if p_screen_task is not null then
      select t.primary_step_id::text into selected from bob.tasks t where t.project_id=p_project and t.id=p_screen_task;
    else selected:=coalesce(p_screen_step,plan->>'focus_step_id'); end if;
    select coalesce(jsonb_agg(case when s->>'id'=selected then s-'related_tasks'
      else jsonb_build_object('id',s->'id','title',s->'title','state',s->'state','phase',s->'phase',
        'area_id',s->'area_id','tasks','[]'::jsonb,'requirements','[]'::jsonb) end order by pos),'[]'::jsonb)
      into steps from jsonb_array_elements(plan->'steps') with ordinality as entries(s,pos);
    plan:=jsonb_build_object('id',p_project,'project_id',p_project,'revision',plan->'revision','status','approved',
      'focus_step_id',plan->'focus_step_id','steps',steps,'detail_step_id',selected);
  end if;
  return jsonb_build_object('project',project_row,'plan',plan);
end $$;
revoke all on function bob.read_plan_orientation(text,text,text) from public,anon;
grant execute on function bob.read_plan_orientation(text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
