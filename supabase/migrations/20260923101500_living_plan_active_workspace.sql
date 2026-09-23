-- Living-plan active workspace: stable Step identities, operational Step↔Task links
-- and a compact plan-spine/current-Step briefing. Tasks are actions; completion
-- requirements remain the evidence-driven criteria for finishing a Step.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.project_plan_step_identities (
  project_id text not null references bob.projects(id) on delete cascade,
  step_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(project_id,step_id)
);

insert into bob.project_plan_step_identities(project_id,step_id)
select distinct project_id,step_id from bob.project_plan_steps
on conflict do nothing;

create function bob_private.ensure_project_plan_step_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  insert into bob.project_plan_step_identities(project_id,step_id)
    values(new.project_id,new.step_id) on conflict do nothing;
  return new;
end $$;

create trigger ensure_project_plan_step_identity
before insert on bob.project_plan_steps
for each row execute function bob_private.ensure_project_plan_step_identity();

alter table bob.project_plan_steps
  add constraint project_plan_steps_identity_fk
  foreign key(project_id,step_id)
  references bob.project_plan_step_identities(project_id,step_id);

create table bob.project_plan_step_tasks (
  project_id text not null,
  step_id uuid not null,
  task_id text not null references bob.tasks(id) on delete cascade,
  position integer not null check(position between 1 and 1000),
  linked_by uuid not null,
  linked_at timestamptz not null default clock_timestamp(),
  primary key(project_id,step_id,task_id),
  unique(project_id,step_id,position),
  foreign key(project_id,step_id)
    references bob.project_plan_step_identities(project_id,step_id) on delete cascade
);
create index project_plan_step_tasks_task_idx on bob.project_plan_step_tasks(task_id);

create function bob_private.project_plan_step_task_scope_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare actual_project text;
begin
  select a.project_id into actual_project
  from bob.tasks t join bob.areas a on a.id=t.area_id
  where t.id=new.task_id;
  if actual_project is distinct from new.project_id then
    raise exception 'project_denied' using errcode='42501';
  end if;
  return new;
end $$;
create trigger project_plan_step_task_scope_guard
before insert or update on bob.project_plan_step_tasks
for each row execute function bob_private.project_plan_step_task_scope_guard();

alter table bob.project_plan_step_identities enable row level security;
alter table bob.project_plan_step_tasks enable row level security;
revoke all on bob.project_plan_step_identities,bob.project_plan_step_tasks from public,anon,authenticated;
grant select on bob.project_plan_step_identities,bob.project_plan_step_tasks to authenticated;
grant all on bob.project_plan_step_identities,bob.project_plan_step_tasks to service_role;
create policy project_read on bob.project_plan_step_identities for select to authenticated
  using(bob_private.has_project_access(project_id));
create policy project_read on bob.project_plan_step_tasks for select to authenticated
  using(bob_private.has_project_access(project_id));

create function bob_private.project_plan_link_task(
  p_project text,p_expected integer,p_step uuid,p_task text,p_action text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_rev integer; pos integer; task_name text; step_title text;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  select current_revision into current_rev from bob.project_plans where project_id=p_project for share;
  if current_rev is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
  if current_rev is null or not exists(
    select 1 from bob.project_plan_steps
    where project_id=p_project and plan_revision=current_rev and step_id=p_step
  ) then raise exception 'plan_step_not_found' using errcode='22023'; end if;
  select t.name into task_name from bob.tasks t join bob.areas a on a.id=t.area_id
    where t.id=p_task and a.project_id=p_project for share of t;
  if not found then raise exception 'plan_task_not_found' using errcode='22023'; end if;
  select title into step_title from bob.project_plan_steps
    where project_id=p_project and plan_revision=current_rev and step_id=p_step;

  if p_action='link' then
    if not exists(select 1 from bob.project_plan_step_tasks where project_id=p_project and step_id=p_step and task_id=p_task) then
      select coalesce(max(position),0)+1 into pos from bob.project_plan_step_tasks
        where project_id=p_project and step_id=p_step;
      insert into bob.project_plan_step_tasks(project_id,step_id,task_id,position,linked_by)
        values(p_project,p_step,p_task,pos,auth.uid());
    end if;
  elsif p_action='unlink' then
    delete from bob.project_plan_step_tasks
      where project_id=p_project and step_id=p_step and task_id=p_task;
  else raise exception 'plan_invalid_task_action' using errcode='22023';
  end if;

  return jsonb_build_object('id',p_project,'revision',current_rev,'name','Living project plan v'||current_rev,
    'step_id',p_step,'step_title',step_title,'task_id',p_task,'task_name',task_name,'action',p_action,'updated_at',clock_timestamp());
end $$;

revoke all on function bob_private.project_plan_link_task(text,integer,uuid,text,text)
  from public,anon,authenticated;
grant execute on function bob_private.project_plan_link_task(text,integer,uuid,text,text) to authenticated;

create or replace function bob.project_plan_briefing(p_project text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare rev integer; meta bob.project_plan_revisions; active bob.project_plan_steps;
  reqs jsonb:='[]'::jsonb; counts jsonb; spine jsonb:='[]'::jsonb; tasks jsonb:='[]'::jsonb;
  recent jsonb:='[]'::jsonb; new_count integer:=0; task_count integer:=0;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select current_revision into rev from bob.project_plans where project_id=p_project;

  if rev is null then
    select coalesce(jsonb_agg(jsonb_build_object('id',m.id::text,'subject',m.subject,'value',m.value,'unit',m.unit,'truth',m.truth,
      'area_id',m.area_id,'revision',m.revision,'actor',m.actor_label,'recorded_at',m.recorded_at)
      order by m.recorded_at desc,m.id),'[]'::jsonb)
      into recent from (select * from bob.current_measurements where project_id=p_project and not archived order by recorded_at desc limit 6) m;
    return jsonb_build_object('status','not_initialized','plan_needed',true,'current_revision',null,
      'plan_spine','[]'::jsonb,'current_step',null,'completion',null,'recent_shared_facts',recent,
      'note','No approved living plan exists yet. Recent shared facts are current project data, regardless of which collaborator recorded them.');
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

create or replace function bob_private.bob_project_write_v8(
  p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare kind text:=p_payload->>'kind'; d jsonb; quote text; message text; saved jsonb; record jsonb; result jsonb;
  key text; existing bob_private.bob_write_receipts; expected integer; proposal integer; action text;
begin
  if kind<>all(array['plan_proposal','plan_decision','plan_evidence','plan_task']) then
    return bob_private.bob_project_write_v7(p_project,p_thread,p_turn,p_generation,p_payload);
  end if;
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  if p_payload-array['kind','record_id','expected_updated_at','expected_revision','data','request_quote']::text[]<>'{}'
    or (select count(*) from jsonb_object_keys(p_payload))<>6
    or p_payload->'record_id' is distinct from 'null'::jsonb
    or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
    or jsonb_typeof(p_payload->'expected_revision')<>'number' or coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$'
    or jsonb_typeof(p_payload->'data')<>'object'
    or jsonb_typeof(p_payload->'request_quote')<>'string' or char_length(p_payload->>'request_quote') not between 1 and 500 then
    raise exception 'invalid_write' using errcode='22023'; end if;
  d:=p_payload->'data'; quote:=p_payload->>'request_quote'; expected:=(p_payload->>'expected_revision')::integer;
  select text into message from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  if message is null or position(quote in message)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;

  if kind='plan_proposal' then key:='plan:proposal';
  elsif kind='plan_decision' then key:='plan:decision:'||coalesce(d->>'proposal_revision','');
  elsif kind='plan_evidence' then
    key:='plan:evidence:'||coalesce(d->>'requirement_id','')||':'||coalesce(d->>'evidence_kind','')||':'||coalesce(d->>'evidence_id','')||':'||coalesce(d->>'relation','');
  else key:='plan:task:'||coalesce(d->>'step_id','')||':'||coalesce(d->>'task_id','')||':'||coalesce(d->>'action',''); end if;

  select * into existing from bob_private.bob_write_receipts
    where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=key;
  if found then
    if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if;
    return existing.receipt;
  end if;
  if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then
    raise exception 'write_budget_exhausted' using errcode='22023'; end if;

  if kind='plan_proposal' then
    saved:=bob_private.project_plan_propose(p_project,expected,d);
    record:=saved->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',record->'revision',
      'label','Plan proposal v'||(record->>'revision'),'operation','created','savedAt',clock_timestamp(),'record',record);
  elsif kind='plan_decision' then
    if d-array['action','proposal_revision','decision_note']::text[]<>'{}' or (select count(*) from jsonb_object_keys(d))<>3 then
      raise exception 'invalid_write' using errcode='22023'; end if;
    proposal:=(d->>'proposal_revision')::integer; action:=d->>'action';
    saved:=bob_private.project_plan_decide(p_project,expected,proposal,action,d->>'decision_note');
    record:=saved->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',record->'revision',
      'label','Project plan v'||(record->>'revision')||' '||action,'operation','updated','savedAt',clock_timestamp(),'record',record);
  elsif kind='plan_evidence' then
    if d-array['requirement_id','relation','evidence_kind','evidence_id','evidence_revision']::text[]<>'{}'
      or (select count(*) from jsonb_object_keys(d))<>5 then raise exception 'invalid_write' using errcode='22023'; end if;
    saved:=bob_private.project_plan_link_evidence(p_project,expected,(d->>'requirement_id')::uuid,d->>'evidence_kind',d->>'evidence_id',
      (d->>'evidence_revision')::integer,d->>'relation');
    record:=bob.project_plan_read(p_project,expected)->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',expected,
      'label',saved->>'requirement_title','operation','updated','savedAt',clock_timestamp(),'record',record);
  else
    if d-array['action','step_id','task_id']::text[]<>'{}' or (select count(*) from jsonb_object_keys(d))<>3
      or d->>'action'<>all(array['link','unlink']) then raise exception 'invalid_write' using errcode='22023'; end if;
    saved:=bob_private.project_plan_link_task(p_project,expected,(d->>'step_id')::uuid,d->>'task_id',d->>'action');
    record:=bob.project_plan_read(p_project,expected)->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',expected,
      'label',(saved->>'task_name')||' ↔ '||(saved->>'step_title'),'operation','updated','savedAt',clock_timestamp(),'record',record);
  end if;

  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
    values(p_project,auth.uid(),p_turn,key,p_payload,null,result);
  return result;
end $$;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('link_project_plan_task',
  'Link or unlink one exact existing Task to a stable Step in the current approved living Project Plan. Tasks are actions; Completion Requirements are separate completion criteria.',
  'Use this for the operational Task list of the current approved Step. Read the current plan and exact Task first. Link only Tasks that actually belong to this project. Adding/removing an action does not by itself satisfy a Completion Requirement. If Task completion is itself a completion criterion, model that separately as a task-type Completion Requirement/evidence. Step identity survives ordinary replans.',
  1,true,array[]::text[],true)
on conflict(name) do update set description=excluded.description,how_to=excluded.how_to,schema_version=excluded.schema_version,
  always_load=excluded.always_load,preload_phases=excluded.preload_phases,active=excluded.active;

update bob.tool_catalog
set how_to='Read the current plan through search_project_data dataset=plan before replanning. Keep completed history: the server carries completed Steps unchanged. Reuse exact Step/Requirement IDs only when they come from the current plan; use null for genuinely new ones. Near-term requirements should be concrete; distant Steps may remain coarse. For every active/near-term Step, notes is the Step Brief: a short self-prompt covering purpose, focus, important constraints and what matters while working there. Tasks are actions and Completion Requirements are finish criteria; do not turn every Task into a requirement. A measurement requirement should prefer an exact existing Measurement ID when one exists, otherwise an exact subject/Area selector. Responsibility is Bob, a project person, or unassigned; assignment never grants authority. Explain why the plan changes. This write creates only a proposal and still needs an exact quote from the current request.'
where name='propose_project_plan' and schema_version=1 and active=true;

update bob.tool_catalog
set how_to='Resolve the Area inside this project. Read the exact existing task timestamp before editing. Preserve unrelated instructions. A Task is an action, not a living-plan Step or Completion Requirement. When the Task belongs to the current Step, use link_project_plan_task after creation/revision so the Active Step workspace can carry it. Missing task-material relations must not be invented. Every write needs the current request and a successful receipt; loading is not write permission.'
where name='save_project_task' and schema_version=1 and active=true;

notify pgrst,'reload schema';
commit;
