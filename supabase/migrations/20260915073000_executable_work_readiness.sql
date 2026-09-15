-- V1 executable work foundation: explicit dependencies, tools/information needs,
-- canonical material readiness and one deterministic task-readiness projection.
-- Task status remains a separate human workflow state; readiness never rewrites it.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table bob.task_dependencies (
  id uuid primary key,
  project_id text not null references bob.projects(id) on delete cascade,
  task_id text not null references bob.tasks(id) on delete cascade,
  prerequisite_task_id text not null references bob.tasks(id) on delete cascade,
  prerequisite_step_id uuid references bob.task_steps(id) on delete cascade,
  note text not null default '' check(char_length(note) <= 1000),
  created_by uuid not null,
  actor_label text not null,
  created_at timestamptz not null default clock_timestamp(),
  check(task_id <> prerequisite_task_id),
  unique(task_id, prerequisite_task_id)
);
create index task_dependencies_project_idx on bob.task_dependencies(project_id);
create index task_dependencies_task_idx on bob.task_dependencies(task_id);
create index task_dependencies_prerequisite_idx on bob.task_dependencies(prerequisite_task_id);

create table bob.task_needs (
  id uuid primary key,
  project_id text not null references bob.projects(id) on delete cascade,
  task_id text not null references bob.tasks(id) on delete cascade,
  kind text not null check(kind in ('tool','information')),
  label text not null check(char_length(btrim(label)) between 1 and 200),
  notes text not null default '' check(char_length(notes) <= 2000),
  ready boolean not null default false,
  revision integer not null default 1 check(revision > 0),
  created_by uuid not null,
  updated_by uuid not null,
  actor_label text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index task_needs_project_idx on bob.task_needs(project_id);
create index task_needs_task_idx on bob.task_needs(task_id);
create unique index task_needs_unique_label_idx on bob.task_needs(task_id, kind, lower(label));

-- A task is never called Ready merely because no blocker rows happen to exist.
-- The organiser explicitly confirms the current blocker-free work plan. Changes
-- to dependencies/needs invalidate this row; newer material-plan revisions make
-- the derived state unreviewed until it is confirmed again.
create table bob.task_readiness_reviews (
  task_id text primary key references bob.tasks(id) on delete cascade,
  project_id text not null references bob.projects(id) on delete cascade,
  note text not null default '' check(char_length(note) <= 1000),
  confirmed_by uuid not null,
  actor_label text not null,
  confirmed_at timestamptz not null default clock_timestamp()
);
create index task_readiness_reviews_project_idx on bob.task_readiness_reviews(project_id);

create function bob_private.validate_task_dependency_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  task_project text;
  prerequisite_project text;
  checkpoint_project text;
  checkpoint_task text;
  checkpoint boolean;
begin
  select a.project_id into task_project
  from bob.tasks t join bob.areas a on a.id=t.area_id
  where t.id=new.task_id;
  select a.project_id into prerequisite_project
  from bob.tasks t join bob.areas a on a.id=t.area_id
  where t.id=new.prerequisite_task_id;
  if task_project is null or prerequisite_project is null
    or task_project is distinct from new.project_id
    or prerequisite_project is distinct from new.project_id then
    raise exception 'Task dependency must stay inside one Project.';
  end if;
  if new.prerequisite_step_id is not null then
    select project_id,task_id,is_checkpoint into checkpoint_project,checkpoint_task,checkpoint
    from bob.task_steps where id=new.prerequisite_step_id;
    if checkpoint_project is distinct from new.project_id
      or checkpoint_task is distinct from new.prerequisite_task_id
      or checkpoint is distinct from true then
      raise exception 'Dependency checkpoint must be a checkpoint on the prerequisite task.';
    end if;
  end if;
  if exists(
    with recursive chain(task_id) as (
      select new.prerequisite_task_id
      union
      select d.prerequisite_task_id
      from bob.task_dependencies d join chain c on d.task_id=c.task_id
      where d.project_id=new.project_id
    )
    select 1 from chain where task_id=new.task_id
  ) then
    raise exception 'Task dependencies cannot form a cycle.';
  end if;
  return new;
end $$;
revoke all on function bob_private.validate_task_dependency_row() from public,anon,authenticated;
create trigger task_dependency_guard before insert or update on bob.task_dependencies
  for each row execute function bob_private.validate_task_dependency_row();

create function bob_private.validate_task_parent_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare task_project text;
begin
  select a.project_id into task_project
  from bob.tasks t join bob.areas a on a.id=t.area_id
  where t.id=new.task_id;
  if task_project is null or task_project is distinct from new.project_id then
    raise exception 'Task planning record must stay inside its Project.';
  end if;
  return new;
end $$;
revoke all on function bob_private.validate_task_parent_row() from public,anon,authenticated;
create trigger task_need_guard before insert or update on bob.task_needs
  for each row execute function bob_private.validate_task_parent_row();
create trigger task_readiness_review_guard before insert or update on bob.task_readiness_reviews
  for each row execute function bob_private.validate_task_parent_row();

alter table bob.task_dependencies enable row level security;
alter table bob.task_needs enable row level security;
alter table bob.task_readiness_reviews enable row level security;
revoke all on bob.task_dependencies,bob.task_needs,bob.task_readiness_reviews from public,anon,authenticated;
grant select on bob.task_dependencies,bob.task_needs,bob.task_readiness_reviews to authenticated;
create policy project_read on bob.task_dependencies for select to authenticated
  using(bob_private.has_project_access(project_id));
create policy project_read on bob.task_needs for select to authenticated
  using(bob_private.has_project_access(project_id));
create policy project_read on bob.task_readiness_reviews for select to authenticated
  using(bob_private.has_project_access(project_id));

create view bob.task_dependency_status with(security_invoker=true) as
select d.id,d.project_id,d.task_id,d.prerequisite_task_id,d.prerequisite_step_id,d.note,d.created_at,
  prerequisite.name as prerequisite_task_name,
  coalesce(step.title,'') as prerequisite_step_title,
  case when d.prerequisite_step_id is null
    then prerequisite.status='done'::bob.task_status
    else step.completed_at is not null end as satisfied
from bob.task_dependencies d
join bob.tasks prerequisite on prerequisite.id=d.prerequisite_task_id
left join bob.task_steps step on step.id=d.prerequisite_step_id;

create view bob.task_material_readiness with(security_invoker=true) as
select cm.project_id,cm.task_id,cm.area_id,cm.id as requirement_id,cm.name,
  cm.purchase_quantity,cm.unit,cm.recorded_at,
  case
    when cm.target_changed or cm.artifact_changed or cm.stock_changed or cm.component_changed then false
    when cm.purchase_quantity <= 0 then true
    when shopping.requirement_id is null then false
    when shopping.material_missing or shopping.source_outdated or shopping.shopping_edited then false
    when material.status='delivered'::bob.material_status then true
    else false
  end as ready,
  case
    when cm.target_changed or cm.artifact_changed or cm.stock_changed or cm.component_changed
      then 'Review material plan: ' || cm.name
    when cm.purchase_quantity <= 0 then 'Available from confirmed stock/reuse'
    when shopping.requirement_id is null then 'Send ' || cm.name || ' to Shopping'
    when shopping.material_missing then 'Shopping item for ' || cm.name || ' is missing'
    when shopping.source_outdated then 'Update Shopping from latest ' || cm.name || ' requirement'
    when shopping.shopping_edited then 'Review edited Shopping item for ' || cm.name
    when material.status='delivered'::bob.material_status then 'Delivered'
    when material.status='backorder'::bob.material_status then cm.name || ' is on backorder'
    when material.status='ordered'::bob.material_status then cm.name || ' is ordered, not delivered'
    when material.status='needed'::bob.material_status then cm.name || ' still needs buying'
    else 'Confirm Shopping state for ' || cm.name
  end as reason,
  material.status::text as shopping_status
from bob.current_material_requirements cm
left join bob.material_requirement_shopping_state shopping
  on shopping.project_id=cm.project_id and shopping.requirement_id=cm.id
left join bob.materials material
  on material.project_id=cm.project_id and material.id=shopping.material_id
where cm.task_id is not null and not cm.archived;

create view bob.current_task_readiness with(security_invoker=true) as
select t.id as task_id,a.project_id,t.area_id,a.phase as area_phase,t.status as task_status,
  case
    when t.status='done'::bob.task_status then 'complete'
    when coalesce(jsonb_array_length(blockers.items),0)>0 then 'blocked'
    when review.confirmed_at is null then 'unreviewed'
    when source_change.latest_change is not null and source_change.latest_change>review.confirmed_at then 'unreviewed'
    else 'ready'
  end as readiness_state,
  case when t.status='done'::bob.task_status then 0 else coalesce(jsonb_array_length(blockers.items),0) end as blocker_count,
  case when t.status='done'::bob.task_status then '[]'::jsonb else coalesce(blockers.items,'[]'::jsonb) end as blockers,
  review.confirmed_at as reviewed_at,
  review.actor_label as reviewed_by,
  review.note as review_note
from bob.tasks t
join bob.areas a on a.id=t.area_id
left join bob.task_readiness_reviews review on review.project_id=a.project_id and review.task_id=t.id
left join lateral (
  select max(changed_at) as latest_change from (
    select dependency.created_at as changed_at from bob.task_dependencies dependency where dependency.task_id=t.id
    union all
    select need.updated_at from bob.task_needs need where need.task_id=t.id
    union all
    select material.recorded_at from bob.current_material_requirements material where material.task_id=t.id
  ) changes
) source_change on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object('kind',reasons.kind,'id',reasons.id,'label',reasons.label)
    order by reasons.priority,reasons.label
  ) as items
  from (
    select 1 as priority,'phase'::text as kind,a.id::text as id,
      case when a.phase is null then 'Set Area phase before starting'
        else 'Area is in ' || initcap(a.phase::text) || '; move to Build when work is actually ready' end as label
    where t.status<>'done'::bob.task_status and a.phase is distinct from 'build'::bob.project_phase
    union all
    select 2,'status',t.id::text,'Task is manually marked Blocked'
    where t.status='blocked'::bob.task_status
    union all
    select 3,'dependency',dependency.id::text,
      case when dependency.prerequisite_step_id is null
        then 'Finish ' || dependency.prerequisite_task_name
        else dependency.prerequisite_task_name || ': complete ' || dependency.prerequisite_step_title end
    from bob.task_dependency_status dependency
    where t.status<>'done'::bob.task_status and dependency.task_id=t.id and not dependency.satisfied
    union all
    select 4,'material',material.requirement_id::text,material.reason
    from bob.task_material_readiness material
    where t.status<>'done'::bob.task_status and material.task_id=t.id and not material.ready
    union all
    select case need.kind when 'tool' then 5 else 6 end,need.kind,need.id::text,
      case need.kind when 'tool' then 'Tool needed: ' || need.label else 'Confirm: ' || need.label end
    from bob.task_needs need
    where t.status<>'done'::bob.task_status and need.task_id=t.id and not need.ready
  ) reasons
) blockers on true;

revoke all on bob.task_dependency_status,bob.task_material_readiness,bob.current_task_readiness
  from public,anon,authenticated;
grant select on bob.task_dependency_status,bob.task_material_readiness,bob.current_task_readiness
  to authenticated;

create function bob_private.work_plan_command(
  p_project text,
  p_task text,
  p_action text,
  p_item uuid,
  p_expected integer,
  p_data jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  actor text;
  allowed text[];
  prerequisite text;
  checkpoint uuid;
  need bob.task_needs;
  current_readiness bob.current_task_readiness;
  next_revision integer;
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_task is null or p_action is null
    or p_action not in ('add_dependency','remove_dependency','add_need','revise_need','set_need_ready','remove_need','confirm_readiness')
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>12000 then
    raise exception 'Invalid work-plan command';
  end if;
  perform 1 from bob.projects where id=p_project for no key update;
  perform 1 from bob.tasks t join bob.areas a on a.id=t.area_id
    where t.id=p_task and a.project_id=p_project for share of t;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  if actor is null then raise exception 'project_denied' using errcode='42501'; end if;

  if p_action='confirm_readiness' then
    allowed := array['note'];
    if p_item is not null or p_data-allowed<>'{}'::jsonb then raise exception 'Invalid readiness confirmation'; end if;
    select * into current_readiness from bob.current_task_readiness
      where project_id=p_project and task_id=p_task;
    if not found or current_readiness.task_status='done'::bob.task_status then
      raise exception 'Only active tasks can be confirmed ready.';
    end if;
    if current_readiness.blocker_count>0 then raise exception 'Resolve named blockers before confirming readiness.'; end if;
    insert into bob.task_readiness_reviews(task_id,project_id,note,confirmed_by,actor_label)
      values(p_task,p_project,btrim(coalesce(p_data->>'note','')),uid,actor)
      on conflict(task_id) do update set project_id=excluded.project_id,note=excluded.note,
        confirmed_by=excluded.confirmed_by,actor_label=excluded.actor_label,confirmed_at=clock_timestamp();
    return jsonb_build_object('id',p_task,'readiness','ready');
  end if;

  if p_action='add_dependency' then
    allowed := array['prerequisite_task_id','prerequisite_step_id','note'];
    if p_item is null or p_expected is distinct from 0 or p_data-allowed<>'{}'::jsonb then
      raise exception 'Invalid dependency command';
    end if;
    prerequisite := nullif(p_data->>'prerequisite_task_id','');
    checkpoint := nullif(p_data->>'prerequisite_step_id','')::uuid;
    if prerequisite is null then raise exception 'Choose a prerequisite task'; end if;
    insert into bob.task_dependencies(id,project_id,task_id,prerequisite_task_id,prerequisite_step_id,note,created_by,actor_label)
      values(p_item,p_project,p_task,prerequisite,checkpoint,btrim(coalesce(p_data->>'note','')),uid,actor);
    delete from bob.task_readiness_reviews where task_id=p_task and project_id=p_project;
    return jsonb_build_object('id',p_item,'action',p_action);
  end if;

  if p_action='remove_dependency' then
    if p_item is null or p_data<>'{}'::jsonb then raise exception 'Invalid dependency command'; end if;
    delete from bob.task_dependencies where id=p_item and project_id=p_project and task_id=p_task;
    if not found then raise exception 'Dependency changed. Reload first.'; end if;
    delete from bob.task_readiness_reviews where task_id=p_task and project_id=p_project;
    return jsonb_build_object('id',p_item,'removed',true);
  end if;

  if p_action='add_need' then
    allowed := array['kind','label','notes'];
    if p_item is null or p_expected is distinct from 0 or p_data-allowed<>'{}'::jsonb
      or p_data->>'kind' not in ('tool','information') then
      raise exception 'Invalid task need';
    end if;
    insert into bob.task_needs(id,project_id,task_id,kind,label,notes,created_by,updated_by,actor_label)
      values(p_item,p_project,p_task,p_data->>'kind',btrim(p_data->>'label'),btrim(coalesce(p_data->>'notes','')),uid,uid,actor)
      returning * into need;
    delete from bob.task_readiness_reviews where task_id=p_task and project_id=p_project;
    return jsonb_build_object('id',need.id,'revision',need.revision);
  end if;

  select * into need from bob.task_needs
    where id=p_item and project_id=p_project and task_id=p_task for update;
  if not found then raise exception 'Task need changed. Reload first.'; end if;
  if p_expected is distinct from need.revision then raise exception 'Task need changed. Reload first.'; end if;

  if p_action='remove_need' then
    if p_data<>'{}'::jsonb then raise exception 'Invalid task need'; end if;
    delete from bob.task_needs where id=need.id;
    delete from bob.task_readiness_reviews where task_id=p_task and project_id=p_project;
    return jsonb_build_object('id',need.id,'removed',true);
  end if;

  next_revision := need.revision+1;
  if p_action='set_need_ready' then
    if p_data-array['ready']<>'{}'::jsonb or jsonb_typeof(p_data->'ready')<>'boolean' then
      raise exception 'Invalid readiness update';
    end if;
    update bob.task_needs set ready=(p_data->>'ready')::boolean,revision=next_revision,
      updated_by=uid,actor_label=actor,updated_at=clock_timestamp()
      where id=need.id returning * into need;
  else
    allowed := array['label','notes','ready'];
    if p_data-allowed<>'{}'::jsonb or not (p_data ? 'label') then raise exception 'Invalid task need'; end if;
    update bob.task_needs set label=btrim(p_data->>'label'),notes=btrim(coalesce(p_data->>'notes','')),
      ready=coalesce((p_data->>'ready')::boolean,need.ready),revision=next_revision,
      updated_by=uid,actor_label=actor,updated_at=clock_timestamp()
      where id=need.id returning * into need;
  end if;
  delete from bob.task_readiness_reviews where task_id=p_task and project_id=p_project;
  return jsonb_build_object('id',need.id,'revision',need.revision,'ready',need.ready);
end $$;
revoke all on function bob_private.work_plan_command(text,text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob_private.work_plan_command(text,text,text,uuid,integer,jsonb) to authenticated;

create function bob.work_plan_command(
  p_project text,
  p_task text,
  p_action text,
  p_item uuid default null,
  p_expected integer default 0,
  p_data jsonb default '{}'::jsonb
) returns jsonb
language sql security invoker set search_path='' as $$
  select bob_private.work_plan_command(p_project,p_task,p_action,p_item,p_expected,p_data)
$$;
revoke all on function bob.work_plan_command(text,text,text,uuid,integer,jsonb) from public,anon;
grant execute on function bob.work_plan_command(text,text,text,uuid,integer,jsonb) to authenticated;

-- Today is a field surface, so manually blocked tasks must stay visible instead
-- of disappearing from the day. Readiness detail is fetched from the dedicated
-- projection so task status and readiness remain separate concepts.
drop view if exists bob.today_tasks;
create view bob.today_tasks with(security_invoker=true) as
select
  t.id,
  a.project_id,
  a.name as area_name,
  t.name,
  t.skill,
  t.status,
  coalesce(
    (select array_agg(ta.person_id) from bob.task_assignees ta where ta.task_id=t.id),
    '{}'::text[]
  ) as assignee_ids,
  t.area_id,
  a.phase as area_phase
from bob.tasks t
join bob.areas a on a.id=t.area_id
where t.status in ('todo','doing','blocked');
revoke all on bob.today_tasks from public,anon;
grant select on bob.today_tasks to authenticated;

notify pgrst,'reload schema';
commit;
