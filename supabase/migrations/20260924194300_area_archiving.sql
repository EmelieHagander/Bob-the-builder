-- Archive work groupings without deleting plan, task or evidence history.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob.areas add column archived_at timestamptz;
create index areas_active_project_idx on bob.areas(project_id,sort_order) where archived_at is null;

create table bob.area_lifecycle_events (
 id uuid primary key default gen_random_uuid(),
 project_id text not null references bob.projects(id) on delete cascade,
 area_id text not null references bob.areas(id) on delete cascade,
 action text not null check(action in ('archive','restore')),
 actor_id uuid not null,
 actor_label text not null,
 recorded_at timestamptz not null default clock_timestamp()
);
create index area_lifecycle_events_area_idx on bob.area_lifecycle_events(project_id,area_id,recorded_at);
alter table bob.area_lifecycle_events enable row level security;
revoke all on bob.area_lifecycle_events from public,anon,authenticated;
grant select on bob.area_lifecycle_events to authenticated;
grant all on bob.area_lifecycle_events to service_role;
create policy project_read on bob.area_lifecycle_events for select to authenticated
 using(bob_private.has_project_access(project_id));

create function bob_private.guard_area_archive() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op='INSERT' and new.archived_at is not null)
 or (tg_op='UPDATE' and new.archived_at is distinct from old.archived_at) then
  if current_user in ('anon','authenticated') then
   raise exception 'Use the Area archive or restore command.' using errcode='42501';
  end if;
  if new.archived_at is not null then
   if exists(select 1 from bob.tasks where project_id=new.project_id and area_id=new.id and status<>'done')
   or exists(select 1 from bob.project_plan_steps s join bob.project_plans p
      on p.project_id=s.project_id and p.current_revision=s.plan_revision
      where s.project_id=new.project_id and s.area_id=new.id and s.state<>'completed') then
    raise exception 'Move or finish this Area''s unfinished Steps and Tasks before archiving.' using errcode='22023';
   end if;
   if exists(select 1 from bob.project_plan_steps s join bob.project_plan_revisions r
      on r.project_id=s.project_id and r.revision=s.plan_revision
      where s.project_id=new.project_id and s.area_id=new.id and r.status='proposed') then
    raise exception 'Resolve the pending plan proposal that uses this Area before archiving.' using errcode='22023';
   end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function bob_private.guard_area_archive() from public,anon,authenticated;
create trigger guard_area_archive before insert or update on bob.areas
 for each row execute function bob_private.guard_area_archive();

create function bob_private.area_lifecycle_command(p_project text,p_area text,p_action text,p_expected timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a bob.areas; actor text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then
  raise exception 'project_denied' using errcode='42501'; end if;
 select name into actor from bob.people where project_id=p_project and auth_user_id=auth.uid();
 if actor is null then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action is null or p_action not in ('archive','restore') then raise exception 'Invalid Area action' using errcode='22023'; end if;
 -- The plan lock serializes against proposals/approval before the Area lock.
 perform 1 from bob.project_plans where project_id=p_project for update;
 select * into a from bob.areas where project_id=p_project and id=p_area for update;
 if not found then raise exception 'Area unavailable' using errcode='42501'; end if;
 if a.updated_at is distinct from p_expected then raise exception 'Area changed. Reload before trying again.' using errcode='40001'; end if;
 if (p_action='archive')=(a.archived_at is not null) then return to_jsonb(a); end if;
 update bob.areas set archived_at=case when p_action='archive' then clock_timestamp() else null end
  where project_id=p_project and id=p_area returning * into a;
 insert into bob.area_lifecycle_events(project_id,area_id,action,actor_id,actor_label)
  values(p_project,p_area,p_action,auth.uid(),actor);
 return to_jsonb(a);
end $$;
create function bob.area_lifecycle_command(p_project text,p_area text,p_action text,p_expected timestamptz)
returns jsonb language sql security invoker set search_path='' as $$
 select bob_private.area_lifecycle_command(p_project,p_area,p_action,p_expected) $$;
revoke all on function bob_private.area_lifecycle_command(text,text,text,timestamptz),bob.area_lifecycle_command(text,text,text,timestamptz) from public,anon;
grant execute on function bob_private.area_lifecycle_command(text,text,text,timestamptz),bob.area_lifecycle_command(text,text,text,timestamptz) to authenticated;

-- Lock the Area for share while attaching work, preventing a concurrent archive
-- from overlooking a newly inserted Task/Step. Completed history can be copied.
create function bob_private.guard_task_archived_area() returns trigger
language plpgsql security invoker set search_path='' as $$
declare archived timestamptz;
begin
 if new.area_id is not null then
  select archived_at into archived from bob.areas where id=new.area_id and project_id=new.project_id for share;
  if archived is not null and (tg_op='INSERT' or new.area_id is distinct from old.area_id or new.status<>'done') then
   raise exception 'Restore the Area before adding or reopening work.' using errcode='22023'; end if;
 end if;
 return new;
end $$;
revoke all on function bob_private.guard_task_archived_area() from public,anon,authenticated;
create trigger zz_task_archived_area before insert or update on bob.tasks
 for each row execute function bob_private.guard_task_archived_area();

create function bob_private.guard_plan_archived_area() returns trigger
language plpgsql security invoker set search_path='' as $$
declare archived timestamptz;
begin
 if new.area_id is not null then
  select archived_at into archived from bob.areas where id=new.area_id and project_id=new.project_id for share;
  if archived is not null and new.state<>'completed' then
   raise exception 'Restore the Area before adding or reopening work.' using errcode='22023'; end if;
 end if;
 return new;
end $$;
revoke all on function bob_private.guard_plan_archived_area() from public,anon,authenticated;
create trigger zz_plan_archived_area before insert or update on bob.project_plan_steps
 for each row execute function bob_private.guard_plan_archived_area();

comment on column bob.areas.archived_at is 'Inactive work grouping. History and reference records remain readable; restore before adding or reopening work.';


create or replace function bob.project_work_read(p_project text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare plan jsonb; areas jsonb; pending_tasks jsonb;
begin
 if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 plan:=bob.project_plan_read(p_project,null);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'slug',slug,'phase',phase,'archived_at',archived_at) order by sort_order,id),'[]'::jsonb)
  into areas from bob.areas where project_id=p_project;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'area_id',t.area_id,'primary_step_id',t.primary_step_id) order by t.id),'[]'::jsonb)
  into pending_tasks from bob.tasks t where t.project_id=p_project and (t.primary_step_id is null or not exists(
    select 1 from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision
    where s.project_id=p_project and s.step_id=t.primary_step_id));
 return jsonb_build_object('project_id',p_project,'vocabulary_version','2026-09-24.1','status',plan->'status',
  'revision',plan->'record'->'revision','focus_step_id',(select focus_step_id from bob.project_plans where project_id=p_project),
  'areas',areas,'steps',coalesce(plan->'record'->'steps','[]'::jsonb),'unorganised_tasks',pending_tasks);
end $$;

create or replace function bob_private.phase_command(
  p_project text,
  p_scope text,
  p_area text,
  p_phase text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  actor text;
  before bob.project_phase;
  after bob.project_phase;
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_scope not in ('project','area')
    or p_phase not in ('concept','design','planning','build','complete')
    or coalesce(char_length(btrim(p_reason)),0) not between 1 and 1000 then
    raise exception 'Invalid phase command';
  end if;
  after := p_phase::bob.project_phase;
  perform 1 from bob.projects where id=p_project for no key update;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  if actor is null then raise exception 'project_denied' using errcode='42501'; end if;

  if p_scope='project' then
    if p_area is not null then raise exception 'Project phase does not accept an Area'; end if;
    select phase into before from bob.projects where id=p_project;
    if before is not distinct from after then raise exception 'Project is already in that phase'; end if;
    if after='complete' and exists(
      select 1 from bob.areas where project_id=p_project and archived_at is null and phase is distinct from 'complete'::bob.project_phase
    ) then
      raise exception 'Complete or explicitly defer every Area before completing the Project.';
    end if;
    update bob.projects set phase=after where id=p_project;
    insert into bob.phase_history(project_id,scope_kind,area_id,from_phase,to_phase,reason,recorded_by,actor_label)
      values(p_project,'project',null,before,after,btrim(p_reason),uid,actor);
  else
    if p_area is null then raise exception 'Area phase requires an Area'; end if;
    select phase into before from bob.areas where id=p_area and project_id=p_project for update;
    if not found then raise exception 'project_denied' using errcode='42501'; end if;
    if before is not distinct from after then raise exception 'Area is already in that phase'; end if;
    update bob.areas set phase=after where id=p_area and project_id=p_project;
    insert into bob.phase_history(project_id,scope_kind,area_id,from_phase,to_phase,reason,recorded_by,actor_label)
      values(p_project,'area',p_area,before,after,btrim(p_reason),uid,actor);
  end if;
  return jsonb_build_object('scope',p_scope,'areaId',p_area,'phase',after::text);
end $$;

create or replace function bob.search_project_data(p_project_id text, p_dataset text, p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_area_id text DEFAULT NULL::text, p_record_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_rows jsonb := '[]'; v_links jsonb := '[]'; v_truncated boolean := false; v_result jsonb;
begin
  if not bob_private.has_project_access(p_project_id) then
    raise exception 'project_denied' using errcode = '42501';
  end if;
  if p_dataset is null or p_dataset <> all(array['project','areas','tasks','materials','crew','events','announcements'])
    or length(coalesce(p_query,'')) > 200 or length(coalesce(p_record_id,'')) > 200
    or length(coalesce(p_area_id,'')) > 200
    or (p_area_id is not null and p_dataset <> 'tasks')
    or (p_status is not null and not (
      (p_dataset = 'tasks' and p_status = any(array['todo','doing','done','blocked'])) or
      (p_dataset = 'materials' and p_status = any(array['needed','ordered','delivered','backorder'])) or
      (p_dataset = 'events' and p_status = any(array['going','open'])))) then
    raise exception 'invalid_lookup' using errcode = '22023';
  end if;
  case p_dataset
    when 'project' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description, 'location', r.location, 'type', r.type, 'start_label', r.start_label, 'start_date', r.start_date, 'end_date', r.end_date, 'updated_at', r.updated_at) as item
        from bob.projects r
        where r.id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.description))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'areas' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description, 'lead_id', r.lead_id, 'archived_at', r.archived_at, 'updated_at', r.updated_at) as item
        from bob.areas r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.description))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'tasks' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'project_id',r.project_id,'primary_step_id',r.primary_step_id,'area_id', r.area_id, 'name', r.name, 'skill', r.skill, 'hours', r.hours, 'status', r.status, 'materials', r.materials, 'updated_at', r.updated_at, 'area_name', a.name) as item
        from bob.tasks r left join bob.areas a on a.id = r.area_id
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.materials, a.name))) > 0)
          and (p_status is null or r.status::text = p_status)
          and (p_area_id is null or r.area_id = p_area_id)
        order by r.id limit 26
      ) bounded;
    when 'materials' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'name', r.name, 'qty', r.qty, 'area_label', r.area_label, 'supplier', r.supplier, 'status', r.status, 'cost', r.cost, 'category', r.category, 'updated_at', r.updated_at) as item
        from bob.materials r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.area_label, r.supplier))) > 0)
          and (p_status is null or r.status::text = p_status)
        order by r.id limit 26
      ) bounded;
    when 'crew' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'name', r.name, 'role', r.role, 'updated_at', r.updated_at) as item
        from bob.people r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.role))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'events' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'title', r.title, 'day', r.day, 'time', r.time, 'place', r.place, 'spots', r.spots, 'status', r.status, 'updated_at', r.updated_at) as item
        from bob.events r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.title, r.place))) > 0)
          and (p_status is null or r.status::text = p_status)
        order by r.id limit 26
      ) bounded;
    when 'announcements' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'text', r.text, 'pinned', r.pinned, 'time_label', r.time_label, 'author_id', r.author_id, 'updated_at', r.updated_at) as item
        from bob.announcements r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.text))) > 0)
        order by r.id limit 26
      ) bounded;
  end case;
  if jsonb_array_length(v_rows) > 25 then
    v_truncated := true;
    v_rows := v_rows - 25;
  end if;

  -- Each query checks both relation ends even though RLS already does so.
  if p_dataset = 'tasks' then
    select coalesce(jsonb_agg(item order by parent_id, id), '[]') into v_links from (
      select t.id parent_id, p.id, jsonb_build_object('kind','assignee','parent_id',t.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.task_assignees ta join bob.tasks t on t.id = ta.task_id
      left join bob.areas a on a.id = t.area_id
      join bob.people p on p.id = ta.person_id and p.project_id = t.project_id
      where t.project_id = p_project_id and t.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by t.id, p.id limit 26
    ) bounded;
  elsif p_dataset = 'crew' then
    select coalesce(jsonb_agg(item order by parent_id, name), '[]') into v_links from (
      select p.id parent_id, s.name, jsonb_build_object('kind','skill','parent_id',p.id,
        'id',jsonb_build_array(p.id,s.name)::text,'name',s.name,'level',s.level,'updated_at',null) item
      from bob.person_skills s join bob.people p on p.id = s.person_id
      where p.project_id = p_project_id and p.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by p.id, s.name limit 26
    ) bounded;
  elsif p_dataset = 'events' then
    select coalesce(jsonb_agg(item order by parent_id, id), '[]') into v_links from (
      select e.id parent_id, p.id, jsonb_build_object('kind','attendee','parent_id',e.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.event_attendees ea join bob.events e on e.id = ea.event_id
      join bob.people p on p.id = ea.person_id and p.project_id = e.project_id
      where e.project_id = p_project_id and e.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by e.id, p.id limit 26
    ) bounded;
  elsif p_dataset = 'announcements' then
    select coalesce(jsonb_agg(item order by parent_id), '[]') into v_links from (
      select a.id parent_id, jsonb_build_object('kind','author','parent_id',a.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.announcements a join bob.people p on p.id = a.author_id and p.project_id = a.project_id
      where a.project_id = p_project_id and a.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by a.id limit 26
    ) bounded;
  end if;
  if jsonb_array_length(v_links) > 25 then
    v_truncated := true;
    v_links := v_links - 25;
  end if;

  loop
    v_result := jsonb_build_object('records',v_rows,'related',v_links,'truncated',v_truncated);
    -- Reserve room for the edge's provenance envelope within the 16 KiB cap.
    exit when octet_length(v_result::text) <= 14000;
    v_truncated := true;
    if jsonb_array_length(v_links) > 0 then
      v_links := v_links - (jsonb_array_length(v_links)-1);
    else
      v_rows := v_rows - (jsonb_array_length(v_rows)-1);
    end if;
  end loop;
  return v_result;
end $function$
;

create or replace function bob.search_bob_project_data_v2(p_project_id text, p_dataset text, p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_area_id text DEFAULT NULL::text, p_record_id text DEFAULT NULL::text, p_after_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_rows jsonb := '[]'; v_links jsonb := '[]'; v_truncated boolean := false; v_result jsonb; v_more boolean:=false;
begin
  if not bob_private.has_project_access(p_project_id) then
    raise exception 'project_denied' using errcode = '42501';
  end if;
  if p_dataset is null or p_dataset <> all(array['project','areas','tasks','materials','crew','events','announcements','measurements','components','solutions','target','artifacts','requirements'])
    or length(coalesce(p_query,'')) > 200 or length(coalesce(p_record_id,'')) > 200
    or length(coalesce(p_area_id,'')) > 200 or length(coalesce(p_after_id,'')) > 200
    or (p_area_id is not null and p_dataset <> all(array['tasks','measurements','components','solutions','target','artifacts','requirements']))
    or (p_status is not null and not (
      (p_dataset = 'tasks' and p_status = any(array['todo','doing','done','blocked'])) or
      (p_dataset = 'materials' and p_status = any(array['needed','ordered','delivered','backorder'])) or
      (p_dataset = 'events' and p_status = any(array['going','open'])))) then
    raise exception 'invalid_lookup' using errcode = '22023';
  end if;
  case p_dataset
    when 'project' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description, 'location', r.location, 'type', r.type, 'start_label', r.start_label, 'start_date', r.start_date, 'end_date', r.end_date, 'updated_at', r.updated_at) as item
        from bob.projects r
        where r.id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.description))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'areas' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description, 'lead_id', r.lead_id, 'archived_at', r.archived_at, 'updated_at', r.updated_at) as item
        from bob.areas r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.description))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'tasks' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'project_id',r.project_id,'primary_step_id',r.primary_step_id,'area_id', r.area_id, 'name', r.name, 'skill', r.skill, 'hours', r.hours, 'status', r.status, 'materials', r.materials, 'instructions', r.instructions, 'updated_at', r.updated_at, 'area_name', a.name) as item
        from bob.tasks r left join bob.areas a on a.id = r.area_id
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.materials, r.instructions, a.name))) > 0)
          and (p_status is null or r.status::text = p_status)
          and (p_area_id is null or r.area_id = p_area_id)
        order by r.id limit 26
      ) bounded;
    when 'materials' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'name', r.name, 'qty', r.qty, 'area_label', r.area_label, 'supplier', r.supplier, 'status', r.status, 'cost', r.cost, 'category', r.category, 'updated_at', r.updated_at) as item
        from bob.materials r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.area_label, r.supplier))) > 0)
          and (p_status is null or r.status::text = p_status)
        order by r.id limit 26
      ) bounded;
    when 'crew' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'name', r.name, 'role', r.role, 'updated_at', r.updated_at) as item
        from bob.people r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.role))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'events' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'title', r.title, 'day', r.day, 'time', r.time, 'place', r.place, 'spots', r.spots, 'status', r.status, 'updated_at', r.updated_at) as item
        from bob.events r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.title, r.place))) > 0)
          and (p_status is null or r.status::text = p_status)
        order by r.id limit 26
      ) bounded;
    when 'announcements' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'text', r.text, 'pinned', r.pinned, 'time_label', r.time_label, 'author_id', r.author_id, 'updated_at', r.updated_at) as item
        from bob.announcements r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.text))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'measurements' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'subject', r.subject,'area_id', r.area_id,'component_id', r.component_id,'value', r.value,'unit', r.unit,'millimetres', r.millimetres,'truth', r.truth,'source', r.source,'notes', r.notes,'required', r.required,'revision', r.revision,'archived', r.archived,'updated_at', r.recorded_at) item
        from bob.current_measurements r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.subject,r.source,r.notes)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
    when 'components' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'name', r.name,'area_id', r.area_id,'kind', r.kind,'quantity', r.quantity,'condition', r.condition,'specification', r.specification,'intent', r.intent,'notes', r.notes,'revision', r.revision,'archived', r.archived,'updated_at', r.recorded_at) item
        from bob.current_components r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.name,r.kind,r.specification,r.notes)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
    when 'solutions' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'title', r.title,'area_id', r.area_id,'description', r.description,'assumptions', r.assumptions,'tradeoffs', r.tradeoffs,'revision', r.revision,'archived', r.archived,'updated_at', r.recorded_at) item
        from bob.current_solutions r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.title,r.description,r.assumptions,r.tradeoffs)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
    when 'target' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.scope_key id,jsonb_build_object('id',r.scope_key,'area_id',r.area_id,'scope_key',r.scope_key,'revision',r.revision,'reason',r.reason,'updated_at',r.recorded_at,
          'solution_id',r.solution_id,'solution_revision',r.solution_revision,'title',chosen.title,
          'description',chosen.description,'assumptions',chosen.assumptions,'tradeoffs',chosen.tradeoffs,'archived',chosen.archived) item
        from bob.current_target r left join bob.solution_revisions chosen on chosen.solution_id=r.solution_id and chosen.revision=r.solution_revision and chosen.project_id=r.project_id
        where r.project_id=p_project_id and (p_record_id is null or r.scope_key=p_record_id)
          and (p_after_id is null or r.scope_key>p_after_id) and (p_area_id is null or r.area_id=p_area_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.reason,chosen.title,chosen.description)))>0)
        order by r.scope_key limit 26
      ) bounded;
    when 'artifacts' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'title', r.title,'area_id', r.area_id,'kind', r.kind,'description', r.description,'status', r.status,'assumptions', r.assumptions,'revision', r.revision,'archived', r.archived,'target_revision', r.target_revision,'solution_id', r.solution_id,'solution_revision', r.solution_revision,'solution_title', r.solution_title,'updated_at', r.recorded_at) item
        from bob.current_artifacts r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.title,r.description,r.assumptions)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
    when 'requirements' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'name', r.name,'area_id', r.area_id,'task_id', r.task_id,'unit', r.unit,'required_quantity', r.required_quantity,'waste_percent', r.waste_percent,'required_with_waste', r.required_with_waste,'stock_quantity', r.stock_quantity,'component_quantity', r.component_quantity,'purchase_quantity', r.purchase_quantity,'source_kind', r.source_kind,'method_key', r.method_key,'basis', r.basis,'assumptions', r.assumptions,'revision', r.revision,'archived', r.archived,'target_revision', r.target_revision,'solution_id', r.solution_id,'solution_revision', r.solution_revision,'artifact_id', r.artifact_id,'artifact_revision', r.artifact_revision,'target_changed', r.target_changed,'artifact_changed', r.artifact_changed,'stock_changed', r.stock_changed,'component_changed', r.component_changed,'updated_at', r.recorded_at) item
        from bob.current_material_requirements r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.name,r.basis,r.assumptions)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
  end case;
  if jsonb_array_length(v_rows) > 25 then
    v_truncated := true;
    v_rows := v_rows - 25;
    v_more:=true;
  end if;

  -- Each query checks both relation ends even though RLS already does so.
  if p_dataset = 'tasks' then
    select coalesce(jsonb_agg(item order by parent_id, id), '[]') into v_links from (
      select t.id parent_id, p.id, jsonb_build_object('kind','assignee','parent_id',t.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.task_assignees ta join bob.tasks t on t.id = ta.task_id
      left join bob.areas a on a.id = t.area_id
      join bob.people p on p.id = ta.person_id and p.project_id = t.project_id
      where t.project_id = p_project_id and t.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by t.id, p.id limit 26
    ) bounded;
  elsif p_dataset = 'target' then
    select coalesce(jsonb_agg(item order by parent_id,id),'[]'::jsonb) into v_links from (
      select t.scope_key parent_id,d.measurement_id::text id,jsonb_build_object('kind','selected_measurement','parent_id',t.scope_key,'area_id',t.area_id,'id',d.measurement_id::text,'subject',d.subject,'value',d.value,'unit',d.unit,'truth',d.truth,'source',d.source,
        'revision',d.measurement_revision,'latest_revision',d.latest_revision,'currently_archived',d.currently_archived) item
      from bob.solution_measurement_details d join bob.current_target t on t.project_id=d.project_id and t.solution_id=d.solution_id and t.solution_revision=d.solution_revision
      where d.project_id=p_project_id and t.scope_key in (select value->>'id' from jsonb_array_elements(v_rows))
      order by t.scope_key,d.measurement_id::text limit 26
    ) bounded;
  elsif p_dataset = 'artifacts' then
    select coalesce(jsonb_agg(item order by parent_id,id),'[]'::jsonb) into v_links from (
      select a.id::text parent_id,d.measurement_id::text id,jsonb_build_object('kind','drawing_measurement','parent_id',a.id::text,'id',d.measurement_id::text,'subject',d.subject,'value',d.value,'unit',d.unit,'truth',d.truth,'source',d.source,
        'revision',d.measurement_revision,'latest_revision',d.latest_revision,'currently_archived',d.currently_archived) item
      from bob.artifact_measurement_details d join bob.current_artifacts a on a.id=d.artifact_id and a.revision=d.artifact_revision and a.project_id=d.project_id
      where d.project_id=p_project_id and a.id::text in (select value->>'id' from jsonb_array_elements(v_rows)) order by a.id::text,d.measurement_id::text limit 26
    ) bounded;
  elsif p_dataset = 'crew' then
    select coalesce(jsonb_agg(item order by parent_id, name), '[]') into v_links from (
      select p.id parent_id, s.name, jsonb_build_object('kind','skill','parent_id',p.id,
        'id',jsonb_build_array(p.id,s.name)::text,'name',s.name,'level',s.level,'updated_at',null) item
      from bob.person_skills s join bob.people p on p.id = s.person_id
      where p.project_id = p_project_id and p.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by p.id, s.name limit 26
    ) bounded;
  elsif p_dataset = 'events' then
    select coalesce(jsonb_agg(item order by parent_id, id), '[]') into v_links from (
      select e.id parent_id, p.id, jsonb_build_object('kind','attendee','parent_id',e.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.event_attendees ea join bob.events e on e.id = ea.event_id
      join bob.people p on p.id = ea.person_id and p.project_id = e.project_id
      where e.project_id = p_project_id and e.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by e.id, p.id limit 26
    ) bounded;
  elsif p_dataset = 'announcements' then
    select coalesce(jsonb_agg(item order by parent_id), '[]') into v_links from (
      select a.id parent_id, jsonb_build_object('kind','author','parent_id',a.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.announcements a join bob.people p on p.id = a.author_id and p.project_id = a.project_id
      where a.project_id = p_project_id and a.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by a.id limit 26
    ) bounded;
  end if;
  if jsonb_array_length(v_links) > 25 then
    v_truncated := true;
    v_links := v_links - 25;
  end if;

  loop
    v_result := jsonb_build_object('records',v_rows,'related',v_links,'truncated',v_truncated,'next_cursor',case when v_more then v_rows->-1->>'id' else null end);
    -- Reserve room for the edge's provenance envelope within the 32 KiB cap.
    exit when octet_length(v_result::text) <= 30000;
    v_truncated := true;
    if jsonb_array_length(v_links) > 0 then
      v_links := v_links - (jsonb_array_length(v_links)-1);
    else
      if jsonb_array_length(v_rows)<=1 then raise exception 'lookup_record_too_large' using errcode='54000'; end if;
      v_rows := v_rows - (jsonb_array_length(v_rows)-1);
      v_more:=true;
    end if;
  end loop;
  return v_result;
end $function$
;

notify pgrst, 'reload schema';
commit;
