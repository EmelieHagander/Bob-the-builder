-- Living-plan active-step workspace:
-- compact plan spine + Step Brief + Step-owned Task blueprints/links.
-- New Task blueprints remain proposal data until the exact plan is approved.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.project_plan_step_briefs (
  project_id text not null,
  plan_revision integer not null,
  step_id uuid not null,
  brief text not null check(char_length(brief) between 1 and 1600),
  primary key(project_id,plan_revision,step_id),
  foreign key(project_id,plan_revision,step_id)
    references bob.project_plan_steps(project_id,plan_revision,step_id) on delete cascade
);

create table bob.project_plan_step_tasks (
  project_id text not null,
  plan_revision integer not null,
  step_id uuid not null,
  item_id uuid not null default gen_random_uuid(),
  position integer not null check(position between 1 and 1000),
  task_key text not null check(task_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  task_id text references bob.tasks(id) on delete set null,
  area_id text not null references bob.areas(id),
  title text not null check(char_length(title) between 1 and 300),
  instructions text not null default '' check(char_length(instructions)<=12000),
  materialized_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key(project_id,plan_revision,item_id),
  unique(project_id,plan_revision,step_id,position),
  unique(project_id,plan_revision,step_id,task_key),
  foreign key(project_id,plan_revision,step_id)
    references bob.project_plan_steps(project_id,plan_revision,step_id) on delete cascade
);
create unique index project_plan_step_tasks_task_idx
  on bob.project_plan_step_tasks(project_id,plan_revision,task_id)
  where task_id is not null;
create index project_plan_step_tasks_step_idx
  on bob.project_plan_step_tasks(project_id,plan_revision,step_id,position);

alter table bob.project_plan_step_briefs enable row level security;
alter table bob.project_plan_step_tasks enable row level security;

revoke all on bob.project_plan_step_briefs,bob.project_plan_step_tasks from public,anon,authenticated;
grant select on bob.project_plan_step_briefs,bob.project_plan_step_tasks to authenticated;
grant all on bob.project_plan_step_briefs,bob.project_plan_step_tasks to service_role;

create policy project_read on bob.project_plan_step_briefs for select to authenticated
  using(bob_private.has_project_access(project_id));
create policy project_read on bob.project_plan_step_tasks for select to authenticated
  using(bob_private.has_project_access(project_id));

create function bob_private.plan_evidence_current_v2(p_project text,p_kind text,p_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_kind<>'task' then
    return bob_private.plan_evidence_current(p_project,p_kind,p_id);
  end if;
  select jsonb_build_object('exists',true,'revision',null,'label',t.name,'updated_at',t.updated_at,'status',t.status)
    into r
  from bob.tasks t join bob.areas a on a.id=t.area_id
  where a.project_id=p_project and t.id=p_id;
  return coalesce(r,jsonb_build_object('exists',false,'revision',null,'label',null,'updated_at',null,'status',null));
end $$;

create function bob_private.plan_requirement_state_v2(p_project text,p_revision integer,p_requirement uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare req bob.project_plan_requirements; selector jsonb; row record; cur jsonb;
  linked jsonb:='[]'::jsonb; selector_evidence jsonb:='[]'::jsonb;
  has_conflict boolean:=false; has_fresh boolean:=false; has_stale boolean:=false;
  matches integer:=0; state text:='missing';
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  select * into req from bob.project_plan_requirements
    where project_id=p_project and plan_revision=p_revision and requirement_id=p_requirement;
  if not found then raise exception 'plan_requirement_not_found' using errcode='22023'; end if;
  if req.resolution<>'open' then
    return jsonb_build_object('state',req.resolution,'evidence','[]'::jsonb,'source','override');
  end if;

  for row in select * from bob.project_plan_evidence
    where project_id=p_project and plan_revision=p_revision and requirement_id=p_requirement
    order by linked_at,evidence_kind,evidence_id loop
    cur:=bob_private.plan_evidence_current_v2(p_project,row.evidence_kind,row.evidence_id);
    linked:=linked||jsonb_build_array(jsonb_build_object(
      'kind',row.evidence_kind,'id',row.evidence_id,'pinned_revision',row.evidence_revision,
      'relation',row.relation,'current',cur));
    if row.relation='conflicts' then
      has_conflict:=true;
    elsif row.relation in ('resolves','refines','supersedes') then
      if not (cur->>'exists')::boolean then
        has_stale:=true;
      elsif row.evidence_revision is not null and (cur->>'revision')::integer is distinct from row.evidence_revision then
        has_stale:=true;
      elsif row.evidence_kind='task' and coalesce(cur->>'status','')<>'done' then
        null;
      else
        has_fresh:=true;
      end if;
    end if;
  end loop;

  selector:=req.evidence_selector;
  if selector->>'kind'='measurement' then
    if selector->'id'<>'null'::jsonb then
      select count(*) into matches from bob.current_measurements m
        where m.project_id=p_project and m.id::text=selector->>'id' and not m.archived;
      if matches=1 then
        select jsonb_build_array(jsonb_build_object('kind','measurement','id',m.id::text,'revision',m.revision,'label',m.subject,
          'value',m.value,'unit',m.unit,'truth',m.truth,'actor',m.actor_label,'updated_at',m.recorded_at))
          into selector_evidence
        from bob.current_measurements m
        where m.project_id=p_project and m.id::text=selector->>'id' and not m.archived;
        select (m.truth<>'unknown' and m.value is not null) into has_fresh
        from bob.current_measurements m
        where m.project_id=p_project and m.id::text=selector->>'id' and not m.archived;
      end if;
    else
      select count(*) into matches from bob.current_measurements m
        where m.project_id=p_project and not m.archived and m.subject=selector->>'subject'
          and (selector->'area_id'='null'::jsonb or m.area_id=selector->>'area_id');
      if matches>1 then
        has_conflict:=true;
      elsif matches=1 then
        select jsonb_build_array(jsonb_build_object('kind','measurement','id',m.id::text,'revision',m.revision,'label',m.subject,
          'value',m.value,'unit',m.unit,'truth',m.truth,'actor',m.actor_label,'updated_at',m.recorded_at)),
          (m.truth<>'unknown' and m.value is not null)
          into selector_evidence,has_fresh
        from bob.current_measurements m
        where m.project_id=p_project and not m.archived and m.subject=selector->>'subject'
          and (selector->'area_id'='null'::jsonb or m.area_id=selector->>'area_id');
      end if;
    end if;
  elsif selector->>'kind'='task' and selector->>'id' like '@task:%' then
    selector_evidence:=jsonb_build_array(jsonb_build_object(
      'kind','task_blueprint','key',substring(selector->>'id' from 7),'current',jsonb_build_object('exists',false,'status','planned')));
  elsif selector->>'kind'<>'none' then
    cur:=bob_private.plan_evidence_current_v2(p_project,selector->>'kind',selector->>'id');
    selector_evidence:=jsonb_build_array(jsonb_build_object('kind',selector->>'kind','id',selector->>'id','current',cur));
    if (cur->>'exists')::boolean
      and (selector->>'kind'<>'task' or coalesce(cur->>'status','')='done') then
      has_fresh:=true;
    end if;
  end if;

  if has_conflict then state:='conflicted';
  elsif has_fresh then state:='satisfied';
  elsif has_stale then state:='stale';
  else state:='missing';
  end if;
  return jsonb_build_object('state',state,'evidence',selector_evidence||linked,
    'source',case when jsonb_array_length(selector_evidence)>0 then 'selector'
      when jsonb_array_length(linked)>0 then 'linked' else 'none' end);
end $$;

create function bob.project_plan_read_v2(p_project text,p_revision integer default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare rev integer; meta bob.project_plan_revisions; steps jsonb; result jsonb;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_revision is null then select current_revision into rev from bob.project_plans where project_id=p_project;
  else rev:=p_revision; end if;
  if rev is null then return jsonb_build_object('status','not_initialized','projectId',p_project,'record',null); end if;
  select * into meta from bob.project_plan_revisions where project_id=p_project and revision=rev;
  if not found then return jsonb_build_object('status','not_found','projectId',p_project,'record',null); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.step_id,'position',s.position,'title',s.title,'goal',s.goal,
    'brief',coalesce((select b.brief from bob.project_plan_step_briefs b
      where b.project_id=p_project and b.plan_revision=rev and b.step_id=s.step_id),''),
    'state',s.state,'area_id',s.area_id,'responsible_kind',s.responsible_kind,
    'responsible_person_id',s.responsible_person_id,'notes',s.notes,
    'tasks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',pt.item_id,'position',pt.position,'task_key',pt.task_key,'task_id',pt.task_id,'area_id',pt.area_id,
        'planned_title',pt.title,'title',coalesce(t.name,pt.title),
        'instructions',coalesce(t.instructions,pt.instructions),
        'status',case when t.id is not null then t.status::text
          when pt.materialized_at is not null then 'missing' else 'planned' end,
        'materialized_at',pt.materialized_at,'updated_at',t.updated_at
      ) order by pt.position,pt.item_id)
      from bob.project_plan_step_tasks pt left join bob.tasks t on t.id=pt.task_id
      where pt.project_id=p_project and pt.plan_revision=rev and pt.step_id=s.step_id
    ),'[]'::jsonb),
    'requirements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',q.requirement_id,'position',q.position,'type',q.requirement_type,'title',q.title,'description',q.description,
        'resolution',q.resolution,'responsible_kind',q.responsible_kind,'responsible_person_id',q.responsible_person_id,
        'evidence_selector',q.evidence_selector,'status',bob_private.plan_requirement_state_v2(p_project,rev,q.requirement_id)
      ) order by q.position,q.requirement_id)
      from bob.project_plan_requirements q
      where q.project_id=p_project and q.plan_revision=rev and q.step_id=s.step_id
    ),'[]'::jsonb)
  ) order by s.position,s.step_id),'[]'::jsonb) into steps
  from bob.project_plan_steps s
  where s.project_id=p_project and s.plan_revision=rev;

  result:=jsonb_build_object('id',p_project,'name','Living project plan v'||rev,'project_id',p_project,
    'revision',rev,'status',meta.status,'based_on_revision',meta.based_on_revision,
    'summary',meta.summary,'reason',meta.reason,'proposed_by',meta.proposed_by,'approved_by',meta.approved_by,
    'created_at',meta.created_at,'updated_at',coalesce(meta.decided_at,meta.created_at),'steps',steps);
  return jsonb_build_object('status','ok','projectId',p_project,'record',result);
end $$;

create function bob.project_plan_step_read(p_project text,p_step uuid,p_revision integer default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare plan jsonb; step jsonb; rev integer;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_revision is null then select current_revision into rev from bob.project_plans where project_id=p_project;
  else rev:=p_revision; end if;
  plan:=bob.project_plan_read_v2(p_project,rev);
  if plan->>'status'<>'ok' then return plan; end if;
  select e.value into step
  from jsonb_array_elements(plan->'record'->'steps') e(value)
  where e.value->>'id'=p_step::text
  limit 1;
  if step is null then
    return jsonb_build_object('status','not_found','projectId',p_project,'record',null);
  end if;
  return jsonb_build_object('status','ok','projectId',p_project,'record',step);
end $$;

create function bob.project_plan_briefing_v2(p_project text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare rev integer; meta bob.project_plan_revisions; plan_doc jsonb; record jsonb; current_step jsonb;
  spine jsonb:='[]'::jsonb; tasks jsonb:='[]'::jsonb; reqs jsonb:='[]'::jsonb;
  task_counts jsonb; req_counts jsonb; recent jsonb:='[]'::jsonb; new_count integer:=0;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select current_revision into rev from bob.project_plans where project_id=p_project;
  if rev is null then
    select coalesce(jsonb_agg(jsonb_build_object('id',m.id::text,'subject',m.subject,'value',m.value,'unit',m.unit,
      'truth',m.truth,'area_id',m.area_id,'revision',m.revision,'actor',m.actor_label,'recorded_at',m.recorded_at)
      order by m.recorded_at desc,m.id),'[]'::jsonb)
      into recent
    from (select * from bob.current_measurements where project_id=p_project and not archived
      order by recorded_at desc limit 5) m;
    return jsonb_build_object('status','not_initialized','plan_needed',true,'current_revision',null,
      'plan_spine','[]'::jsonb,'current_step',null,'completion',null,'recent_shared_facts',recent,
      'new_shared_facts_since_plan',0,'plan_review_hint',false,
      'note','No approved living plan exists yet. Recent shared facts are bootstrap context only.');
  end if;

  select * into meta from bob.project_plan_revisions where project_id=p_project and revision=rev;
  plan_doc:=bob.project_plan_read_v2(p_project,rev);
  record:=plan_doc->'record';

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',e.value->>'id','position',(e.value->>'position')::integer,'title',e.value->>'title','state',e.value->>'state')
      order by (e.value->>'position')::integer),'[]'::jsonb)
    into spine
  from jsonb_array_elements(record->'steps') e(value);

  select e.value into current_step
  from jsonb_array_elements(record->'steps') e(value)
  where e.value->>'state'='active'
  order by (e.value->>'position')::integer
  limit 1;
  if current_step is null then
    select e.value into current_step
    from jsonb_array_elements(record->'steps') e(value)
    where e.value->>'state'='blocked'
    order by (e.value->>'position')::integer
    limit 1;
  end if;

  if current_step is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.value->>'id','task_key',t.value->>'task_key','task_id',t.value->>'task_id',
      'title',t.value->>'title','area_id',t.value->>'area_id','status',t.value->>'status')
      order by (t.value->>'position')::integer),'[]'::jsonb)
      into tasks
    from jsonb_array_elements(current_step->'tasks') t(value);

    select coalesce(jsonb_agg(jsonb_build_object(
      'id',q.value->>'id','type',q.value->>'type','title',q.value->>'title','description',q.value->>'description',
      'responsible_kind',q.value->>'responsible_kind','responsible_person_id',q.value->>'responsible_person_id',
      'status',q.value->'status')
      order by (q.value->>'position')::integer),'[]'::jsonb)
      into reqs
    from jsonb_array_elements(current_step->'requirements') q(value);

    select jsonb_build_object(
      'total',count(*),
      'todo',count(*) filter(where t.value->>'status'='todo'),
      'doing',count(*) filter(where t.value->>'status'='doing'),
      'done',count(*) filter(where t.value->>'status'='done'),
      'blocked',count(*) filter(where t.value->>'status'='blocked'),
      'planned',count(*) filter(where t.value->>'status'='planned'),
      'missing',count(*) filter(where t.value->>'status'='missing')
    ) into task_counts
    from jsonb_array_elements(current_step->'tasks') t(value);

    select jsonb_build_object(
      'total',count(*),
      'satisfied',count(*) filter(where q.value->'status'->>'state'='satisfied'),
      'missing',count(*) filter(where q.value->'status'->>'state'='missing'),
      'conflicted',count(*) filter(where q.value->'status'->>'state'='conflicted'),
      'stale',count(*) filter(where q.value->'status'->>'state'='stale'),
      'waived',count(*) filter(where q.value->'status'->>'state' in ('waived','not_applicable'))
    ) into req_counts
    from jsonb_array_elements(current_step->'requirements') q(value);

    current_step:=jsonb_build_object(
      'id',current_step->>'id','position',(current_step->>'position')::integer,'title',current_step->>'title',
      'goal',current_step->>'goal','brief',current_step->>'brief','state',current_step->>'state',
      'area_id',current_step->>'area_id','responsible_kind',current_step->>'responsible_kind',
      'responsible_person_id',current_step->>'responsible_person_id','tasks',tasks,'requirements',reqs);
  end if;

  select count(*) into new_count
  from bob.current_measurements m
  where m.project_id=p_project and not m.archived
    and m.recorded_at>coalesce(meta.decided_at,meta.created_at);

  return jsonb_build_object('status','ok','plan_needed',false,'current_revision',rev,
    'summary',meta.summary,'reason',meta.reason,'plan_spine',spine,'current_step',current_step,
    'completion',case when current_step is null then null
      else jsonb_build_object('tasks',task_counts,'requirements',req_counts) end,
    'recent_shared_facts','[]'::jsonb,'new_shared_facts_since_plan',new_count,'plan_review_hint',new_count>0,
    'note','plan_spine is orientation only. current_step is the working desk. brief is a working note, not evidence. Tasks are actions; Completion Requirements decide whether the Step is complete.');
end $$;

create function bob_private.project_plan_propose_v2(p_project text,p_expected integer,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare step jsonb; task jsonb; req jsonb; selector jsonb; core_steps jsonb; saved jsonb;
  new_rev integer; historical_count integer:=0; step_ord integer:=0; task_ord integer; sid uuid;
  live_task bob.tasks; key_count integer;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_data)<>'object'
    or p_data-array['summary','reason','steps']::text[]<>'{}'
    or (select count(*) from jsonb_object_keys(p_data))<>3
    or jsonb_typeof(p_data->'summary')<>'string' or char_length(btrim(p_data->>'summary')) not between 1 and 4000
    or jsonb_typeof(p_data->'reason')<>'string' or char_length(btrim(p_data->>'reason')) not between 1 and 4000
    or jsonb_typeof(p_data->'steps')<>'array' or jsonb_array_length(p_data->'steps') not between 1 and 30
    or octet_length(p_data::text)>120000 then
    raise exception 'plan_invalid_proposal' using errcode='22023';
  end if;

  if p_expected>0 then
    select count(*) into historical_count
    from bob.project_plan_steps
    where project_id=p_project and plan_revision=p_expected and state='completed';
  end if;

  for step in select value from jsonb_array_elements(p_data->'steps') loop
    if jsonb_typeof(step)<>'object'
      or step-array['step_id','title','goal','brief','state','area_id','responsible_kind','responsible_person_id','notes','tasks','requirements']::text[]<>'{}'
      or (select count(*) from jsonb_object_keys(step))<>11
      or jsonb_typeof(step->'brief')<>'string' or char_length(btrim(step->>'brief')) not between 1 and 1600
      or jsonb_typeof(step->'tasks')<>'array' or jsonb_array_length(step->'tasks')>20
      or jsonb_typeof(step->'requirements')<>'array' or jsonb_array_length(step->'requirements') not between 1 and 20 then
      raise exception 'plan_invalid_workspace' using errcode='22023';
    end if;

    select count(*),count(distinct value->>'task_key') into task_ord,key_count
    from jsonb_array_elements(step->'tasks');
    if task_ord<>key_count then raise exception 'plan_duplicate_task_key' using errcode='22023'; end if;

    for task in select value from jsonb_array_elements(step->'tasks') loop
      if jsonb_typeof(task)<>'object'
        or task-array['task_key','task_id','area_id','title','instructions']::text[]<>'{}'
        or (select count(*) from jsonb_object_keys(task))<>5
        or jsonb_typeof(task->'task_key')<>'string' or (task->>'task_key')!~'^[a-z][a-z0-9_-]{0,63}$'
        or not(task->'task_id'='null'::jsonb or (jsonb_typeof(task->'task_id')='string' and char_length(task->>'task_id') between 1 and 200))
        or jsonb_typeof(task->'area_id')<>'string' or char_length(task->>'area_id') not between 1 and 200
        or jsonb_typeof(task->'title')<>'string' or char_length(btrim(task->>'title')) not between 1 and 300
        or jsonb_typeof(task->'instructions')<>'string' or char_length(task->>'instructions')>12000 then
        raise exception 'plan_invalid_task_blueprint' using errcode='22023';
      end if;
      if not exists(select 1 from bob.areas where id=task->>'area_id' and project_id=p_project) then
        raise exception 'project_denied' using errcode='42501';
      end if;
      if step->'area_id'<>'null'::jsonb and task->>'area_id' is distinct from step->>'area_id' then
        raise exception 'plan_task_area_mismatch' using errcode='22023';
      end if;
      if task->'task_id'<>'null'::jsonb then
        select t.* into live_task
        from bob.tasks t join bob.areas a on a.id=t.area_id
        where t.id=task->>'task_id' and a.project_id=p_project;
        if not found then raise exception 'project_denied' using errcode='42501'; end if;
        if live_task.area_id is distinct from task->>'area_id'
          or live_task.name is distinct from btrim(task->>'title')
          or live_task.instructions is distinct from task->>'instructions' then
          raise exception 'record_changed' using errcode='40001';
        end if;
      end if;
    end loop;

    for req in select value from jsonb_array_elements(step->'requirements') loop
      selector:=req->'evidence_selector';
      if selector is not null and selector->>'kind'='task' and coalesce(selector->>'id','') like '@task:%'
        and not exists(select 1 from jsonb_array_elements(step->'tasks') t
          where t->>'task_key'=substring(selector->>'id' from 7)) then
        raise exception 'plan_unknown_task_key' using errcode='22023';
      end if;
    end loop;
  end loop;

  select jsonb_agg(e.value-'brief'-'tasks' order by e.ordinality)
    into core_steps
  from jsonb_array_elements(p_data->'steps') with ordinality e(value,ordinality);

  saved:=bob_private.project_plan_propose(p_project,p_expected,
    jsonb_build_object('summary',p_data->'summary','reason',p_data->'reason','steps',core_steps));
  new_rev:=(saved->'record'->>'revision')::integer;

  if p_expected>0 then
    insert into bob.project_plan_step_briefs(project_id,plan_revision,step_id,brief)
      select b.project_id,new_rev,b.step_id,b.brief
      from bob.project_plan_step_briefs b
      join bob.project_plan_steps s
        on s.project_id=b.project_id and s.plan_revision=new_rev and s.step_id=b.step_id and s.state='completed'
      where b.project_id=p_project and b.plan_revision=p_expected
      on conflict do nothing;

    insert into bob.project_plan_step_tasks(project_id,plan_revision,step_id,item_id,position,task_key,task_id,area_id,title,instructions,materialized_at,created_at)
      select pt.project_id,new_rev,pt.step_id,pt.item_id,pt.position,pt.task_key,pt.task_id,pt.area_id,pt.title,pt.instructions,pt.materialized_at,pt.created_at
      from bob.project_plan_step_tasks pt
      join bob.project_plan_steps s
        on s.project_id=pt.project_id and s.plan_revision=new_rev and s.step_id=pt.step_id and s.state='completed'
      where pt.project_id=p_project and pt.plan_revision=p_expected
      on conflict do nothing;
  end if;

  step_ord:=0;
  for step in select value from jsonb_array_elements(p_data->'steps') loop
    step_ord:=step_ord+1;
    select step_id into sid
    from bob.project_plan_steps
    where project_id=p_project and plan_revision=new_rev and position=historical_count+step_ord;
    if sid is null then raise exception 'plan_workspace_step_missing'; end if;

    insert into bob.project_plan_step_briefs(project_id,plan_revision,step_id,brief)
      values(p_project,new_rev,sid,btrim(step->>'brief'));

    task_ord:=0;
    for task in select value from jsonb_array_elements(step->'tasks') loop
      task_ord:=task_ord+1;
      insert into bob.project_plan_step_tasks(
        project_id,plan_revision,step_id,position,task_key,task_id,area_id,title,instructions,materialized_at)
      values(
        p_project,new_rev,sid,task_ord,task->>'task_key',nullif(task->>'task_id',''),task->>'area_id',
        btrim(task->>'title'),task->>'instructions',
        case when task->'task_id'<>'null'::jsonb then clock_timestamp() else null end);
    end loop;
  end loop;

  return bob.project_plan_read_v2(p_project,new_rev);
end $$;

create function bob_private.project_plan_decide_v2(
  p_project text,p_expected integer,p_proposal integer,p_action text,p_note text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_sid uuid; pt record; tid text; saved jsonb;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_action<>all(array['approve','reject']) then
    raise exception 'plan_invalid_decision' using errcode='22023';
  end if;
  if p_action='reject' then
    perform bob_private.project_plan_decide(p_project,p_expected,p_proposal,p_action,p_note);
    return bob.project_plan_read_v2(p_project,p_proposal);
  end if;

  if exists(
    select 1
    from bob.project_plan_step_tasks x
    join bob.project_plan_steps s
      on s.project_id=x.project_id and s.plan_revision=x.plan_revision and s.step_id=x.step_id
    left join bob.tasks t on t.id=x.task_id
    where x.project_id=p_project and x.plan_revision=p_proposal and s.state<>'completed'
      and x.materialized_at is not null
      and (x.task_id is null or t.id is null or t.area_id is distinct from x.area_id
        or t.name is distinct from x.title or t.instructions is distinct from x.instructions)
  ) then
    raise exception 'record_changed' using errcode='40001';
  end if;

  select step_id into current_sid
  from bob.project_plan_steps
  where project_id=p_project and plan_revision=p_proposal and state='active'
  order by position limit 1;
  if current_sid is null then
    select step_id into current_sid
    from bob.project_plan_steps
    where project_id=p_project and plan_revision=p_proposal and state='blocked'
    order by position limit 1;
  end if;

  if current_sid is not null then
    for pt in
      select * from bob.project_plan_step_tasks
      where project_id=p_project and plan_revision=p_proposal and step_id=current_sid
      order by position,item_id
      for update
    loop
      if pt.task_id is null and pt.materialized_at is null then
        if exists(
          select 1 from bob.tasks t
          where t.area_id=pt.area_id and lower(btrim(t.name))=lower(btrim(pt.title))
        ) then
          raise exception 'plan_task_conflict' using errcode='40001';
        end if;
        tid:='t_'||replace(gen_random_uuid()::text,'-','');
        insert into bob.tasks(id,area_id,name,instructions,status)
          values(tid,pt.area_id,pt.title,pt.instructions,'todo');
        update bob.project_plan_step_tasks
          set task_id=tid,materialized_at=clock_timestamp()
          where project_id=p_project and plan_revision=p_proposal and item_id=pt.item_id;
      end if;
    end loop;

    update bob.project_plan_requirements q
      set evidence_selector=jsonb_set(q.evidence_selector,'{id}',to_jsonb(pt.task_id),false)
    from bob.project_plan_step_tasks pt
    where q.project_id=p_project and q.plan_revision=p_proposal and q.step_id=current_sid
      and pt.project_id=q.project_id and pt.plan_revision=q.plan_revision and pt.step_id=q.step_id
      and q.evidence_selector->>'kind'='task'
      and q.evidence_selector->>'id'='@task:'||pt.task_key
      and pt.task_id is not null;
  end if;

  saved:=bob_private.project_plan_decide(p_project,p_expected,p_proposal,p_action,p_note);
  return bob.project_plan_read_v2(p_project,p_proposal);
end $$;

create function bob.search_bob_project_data_v9(
  p_project_id text,p_dataset text,p_query text default null,p_status text default null,p_area_id text default null,
  p_record_id text default null,p_after_id text default null
) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; plan jsonb; item jsonb; requested_rev integer; requested_step uuid;
begin
  if p_dataset='plan' then
    if p_query is not null or p_status is not null or p_area_id is not null or p_after_id is not null then
      raise exception 'invalid_lookup' using errcode='22023';
    end if;
    if p_record_id is null then
      plan:=bob.project_plan_read_v2(p_project_id,null);
    elsif p_record_id~'^[1-9][0-9]{0,8}$' then
      requested_rev:=p_record_id::integer;
      plan:=bob.project_plan_read_v2(p_project_id,requested_rev);
    elsif p_record_id~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      requested_step:=p_record_id::uuid;
      plan:=bob.project_plan_step_read(p_project_id,requested_step,null);
    else
      raise exception 'invalid_lookup' using errcode='22023';
    end if;
    return jsonb_build_object(
      'records',case when plan->>'status'='ok' then jsonb_build_array(plan->'record') else '[]'::jsonb end,
      'related','[]'::jsonb,'truncated',false,'next_cursor',null);
  end if;

  result:=bob.search_bob_project_data_v8(
    p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id,p_after_id);
  if p_dataset='project' and jsonb_array_length(result->'records')>0 then
    item:=(result->'records')->0;
    item:=item||jsonb_build_object('working_plan',bob.project_plan_briefing_v2(p_project_id));
    result:=jsonb_set(result,'{records,0}',item,false);
  end if;
  return result;
end $$;

create function bob_private.bob_project_write_v9(
  p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare kind text:=p_payload->>'kind'; d jsonb; quote text; message text; saved jsonb; record jsonb; result jsonb;
  key text; existing bob_private.bob_write_receipts; expected integer; proposal integer; action text;
begin
  if kind<>all(array['plan_proposal','plan_decision']) then
    return bob_private.bob_project_write_v8(p_project,p_thread,p_turn,p_generation,p_payload);
  end if;
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  if p_payload-array['kind','record_id','expected_updated_at','expected_revision','data','request_quote']::text[]<>'{}'
    or (select count(*) from jsonb_object_keys(p_payload))<>6
    or p_payload->'record_id' is distinct from 'null'::jsonb
    or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
    or jsonb_typeof(p_payload->'expected_revision')<>'number'
    or coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$'
    or jsonb_typeof(p_payload->'data')<>'object'
    or jsonb_typeof(p_payload->'request_quote')<>'string'
    or char_length(p_payload->>'request_quote') not between 1 and 500 then
    raise exception 'invalid_write' using errcode='22023';
  end if;
  d:=p_payload->'data';
  quote:=p_payload->>'request_quote';
  expected:=(p_payload->>'expected_revision')::integer;
  select text into message from bob.bob_messages
    where thread_id=p_thread and turn_id=p_turn and role='user';
  if message is null or position(quote in message)=0 then
    raise exception 'request_quote_required' using errcode='22023';
  end if;

  if kind='plan_proposal' then key:='plan:proposal';
  else key:='plan:decision:'||coalesce(d->>'proposal_revision',''); end if;

  select * into existing from bob_private.bob_write_receipts
  where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=key;
  if found then
    if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if;
    return existing.receipt;
  end if;
  if (select count(*) from bob_private.bob_write_receipts
      where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then
    raise exception 'write_budget_exhausted' using errcode='22023';
  end if;

  if kind='plan_proposal' then
    saved:=bob_private.project_plan_propose_v2(p_project,expected,d);
    record:=saved->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',record->'revision',
      'label','Plan proposal v'||(record->>'revision'),'operation','created','savedAt',clock_timestamp(),'record',record);
  else
    if d-array['action','proposal_revision','decision_note']::text[]<>'{}'
      or (select count(*) from jsonb_object_keys(d))<>3 then
      raise exception 'invalid_write' using errcode='22023';
    end if;
    proposal:=(d->>'proposal_revision')::integer;
    action:=d->>'action';
    saved:=bob_private.project_plan_decide_v2(
      p_project,expected,proposal,action,d->>'decision_note');
    record:=saved->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',record->'revision',
      'label','Project plan v'||(record->>'revision')||' '||action,'operation','updated','savedAt',clock_timestamp(),'record',record);
  end if;

  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
    values(p_project,auth.uid(),p_turn,key,p_payload,null,result);
  return result;
end $$;

create function bob.bob_project_write_v9(
  p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb
) returns jsonb
language sql security invoker set search_path='' as $$
  select bob_private.bob_project_write_v9(p_project,p_thread,p_turn,p_generation,p_payload)
$$;

revoke all on function
  bob_private.plan_evidence_current_v2(text,text,text),
  bob_private.plan_requirement_state_v2(text,integer,uuid),
  bob.project_plan_read_v2(text,integer),
  bob.project_plan_step_read(text,uuid,integer),
  bob.project_plan_briefing_v2(text),
  bob_private.project_plan_propose_v2(text,integer,jsonb),
  bob_private.project_plan_decide_v2(text,integer,integer,text,text),
  bob.search_bob_project_data_v9(text,text,text,text,text,text,text),
  bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb),
  bob.bob_project_write_v9(text,uuid,uuid,bigint,jsonb)
from public,anon,authenticated;

grant execute on function
  bob_private.plan_evidence_current_v2(text,text,text),
  bob_private.plan_requirement_state_v2(text,integer,uuid),
  bob.project_plan_read_v2(text,integer),
  bob.project_plan_step_read(text,uuid,integer),
  bob.project_plan_briefing_v2(text),
  bob.search_bob_project_data_v9(text,text,text,text,text,text,text),
  bob_private.bob_project_write_v9(text,uuid,uuid,bigint,jsonb),
  bob.bob_project_write_v9(text,uuid,uuid,bigint,jsonb)
to authenticated;

update bob.tool_catalog
set schema_version=2,
    description='Create a reviewable living Project Plan proposal. Each Step has a concise working brief, Tasks/actions and Completion Requirements. New Task blueprints remain proposal data until approval.',
    how_to='Read the current plan before replanning. You choose the project-specific Steps and sequence; there is no universal construction flow. Every submitted Step needs a concise brief, zero or more Tasks/actions, and at least one meaningful Completion Requirement. Tasks say what gets done; requirements say what must be true before leaving the Step. Give each Task a unique lowercase task_key. A task requirement may point to an exact existing Task ID or @task:<task_key> for a blueprint in the same Step. Existing Task IDs must be exact current project Tasks. New Task blueprints do not create project Tasks until the exact proposal is approved, and only the current active/blocked Step is materialized. Keep completed history: the server carries completed Steps unchanged. Reuse exact Step/Requirement IDs only from the current plan; use null for genuinely new ones. Near-term criteria should be concrete; distant Steps may remain coarser but still need a meaningful exit condition. The Step brief is a working note to future Bob, not evidence. Explain why the plan changes. This write still needs an exact quote from the current request.'
where name='propose_project_plan' and active=true;

update bob.tool_catalog
set schema_version=2,
    description='Approve or reject one exact living Project Plan proposal. Approval makes it current and atomically materializes Task blueprints for the current active/blocked Step; rejection creates no Tasks.',
    how_to='Use only after the current user clearly approves or rejects a specific proposal. Read the proposal and current approved revision first. On approval the server rechecks linked existing Tasks, creates only the current Step Task blueprints, resolves @task:<task_key> Completion Requirement selectors to the resulting exact Task IDs, and then approves in the same transaction. Future Step blueprints remain inside the plan until a later approved replan makes that Step current. Never approve your own proposal without explicit user authority. A stale proposal or changed linked Task conflicts instead of overwriting collaborator changes.'
where name='decide_project_plan' and active=true;

do $$
begin
  if (select count(*) from bob.tool_catalog
      where name in ('propose_project_plan','decide_project_plan')
        and schema_version=2 and always_load=true and active=true)<>2 then
    raise exception 'living_plan_workspace_tool_update_incomplete';
  end if;
end $$;

commit;
