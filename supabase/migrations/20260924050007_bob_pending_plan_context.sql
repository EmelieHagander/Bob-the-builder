-- Expose saved pending proposals in the existing caller-scoped project briefing.
-- No approval, write authority, table policy or project data changes.

create or replace function bob.project_plan_briefing(p_project text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare rev integer; meta bob.project_plan_revisions; active bob.project_plan_steps;
  reqs jsonb:='[]'::jsonb; counts jsonb; spine jsonb:='[]'::jsonb; tasks jsonb:='[]'::jsonb;
  recent jsonb:='[]'::jsonb; new_count integer:=0; task_count integer:=0;
  pending jsonb;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select current_revision into rev from bob.project_plans where project_id=p_project;

  -- The writer permits one pending proposal per project. Expose its exact
  -- read handle without confusing it with the approved working plan.
  select jsonb_build_object('record_id',revision::text,'revision',revision,
    'based_on_revision',coalesce(based_on_revision,0),'summary',summary,
    'created_at',created_at) into pending
  from bob.project_plan_revisions where project_id=p_project and status='proposed'
  order by revision desc limit 1;

  if rev is null then
    select coalesce(jsonb_agg(jsonb_build_object('id',m.id::text,'subject',m.subject,'value',m.value,'unit',m.unit,'truth',m.truth,
      'area_id',m.area_id,'revision',m.revision,'actor',m.actor_label,'recorded_at',m.recorded_at)
      order by m.recorded_at desc,m.id),'[]'::jsonb)
      into recent from (select * from bob.current_measurements where project_id=p_project and not archived order by recorded_at desc limit 6) m;
    return jsonb_build_object('status','not_initialized','plan_needed',pending is null,'current_revision',null,
      'plan_spine','[]'::jsonb,'current_step',null,'completion',null,'recent_shared_facts',recent,
      'pending_proposal',pending,
      'note','No approved living plan exists yet. A pending proposal is a saved draft, readable by its exact revision. Recent shared facts are current project data, regardless of which collaborator recorded them.');
  end if;

  select * into meta from bob.project_plan_revisions where project_id=p_project and revision=rev;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.step_id,'position',s.position,'title',s.title,'state',s.state)
    order by s.position),'[]'::jsonb) into spine
    from bob.project_plan_steps s where s.project_id=p_project and s.plan_revision=rev;

  select * into active from bob.project_plan_steps
    where project_id=p_project and plan_revision=rev and state='active' order by position limit 1;

  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',q.requirement_id,'type',q.requirement_type,'title',q.title,'description',q.description,
      'resolution',q.resolution,'responsible_kind',q.responsible_kind,'responsible_person_id',q.responsible_person_id,
      'status',bob_private.plan_requirement_state(p_project,rev,q.requirement_id)
    ) order by q.position),'[]'::jsonb)
      into reqs from bob.project_plan_requirements q
      where q.project_id=p_project and q.plan_revision=rev and q.step_id=active.step_id;

    select jsonb_build_object(
      'total',count(*),
      'satisfied',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state')='satisfied'),
      'missing',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state')='missing'),
      'conflicted',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state')='conflicted'),
      'stale',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state')='stale'),
      'waived',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state') in ('waived','not_applicable'))
    ) into counts from bob.project_plan_requirements q
      where q.project_id=p_project and q.plan_revision=rev and q.step_id=active.step_id;

    select count(*) into task_count from bob.project_plan_step_tasks x
      where x.project_id=p_project and x.step_id=active.step_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'position',x.position,'name',t.name,'status',t.status,'area_id',t.area_id,
      'updated_at',t.updated_at
    ) order by x.position,x.task_id),'[]'::jsonb) into tasks
      from bob.project_plan_step_tasks x
      join bob.tasks t on t.id=x.task_id
      join bob.areas a on a.id=t.area_id and a.project_id=x.project_id
      where x.project_id=p_project and x.step_id=active.step_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',m.id::text,'subject',m.subject,'value',m.value,'unit',m.unit,'truth',m.truth,
    'area_id',m.area_id,'revision',m.revision,'actor',m.actor_label,'recorded_at',m.recorded_at)
    order by m.recorded_at desc,m.id),'[]'::jsonb)
    into recent from (select * from bob.current_measurements where project_id=p_project and not archived order by recorded_at desc limit 4) m;
  select count(*) into new_count from bob.current_measurements m
    where m.project_id=p_project and not m.archived and m.recorded_at>meta.created_at;

  return jsonb_build_object(
    'status','ok','plan_needed',false,'current_revision',rev,'summary',meta.summary,
    'pending_proposal',pending,
    'plan_spine',spine,
    'current_step',case when active.step_id is null then null else jsonb_build_object(
      'id',active.step_id,'position',active.position,'title',active.title,'goal',active.goal,'brief',active.notes,
      'state',active.state,'area_id',active.area_id,'responsible_kind',active.responsible_kind,
      'responsible_person_id',active.responsible_person_id,'tasks',tasks,'task_count',task_count,'requirements',reqs
    ) end,
    'completion',counts,'recent_shared_facts',recent,
    'new_shared_facts_since_plan',new_count,'plan_review_hint',new_count>0,
    'note','Plan spine is orientation. Current Step is the working desk: Tasks are actions; Completion Requirements are criteria. Requirement state comes from project evidence. Use exact tools when more detail is needed.'
  );
end $$;
