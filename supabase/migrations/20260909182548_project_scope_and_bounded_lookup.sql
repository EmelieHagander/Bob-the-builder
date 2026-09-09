-- Slice 0. Apply AFTER db/migrations/0001..0010. No other app schema is changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Bootstrap and policy changes commit together. Preserve existing memberships
-- when the reviewed account already belongs to another project.
lock table bob.projects, bob.people in share row exclusive mode;
drop index bob.people_auth_user_idx;
create unique index people_project_auth_idx on bob.people(project_id, auth_user_id)
  where auth_user_id is not null;
create index people_auth_projects_idx on bob.people(auth_user_id, project_id)
  where auth_user_id is not null;

-- An operator may supply an explicitly reviewed mapping as transaction-local
-- JSON. No emails or generated Auth ids belong in repository migration files.
-- This executes only during the privileged migration, never through an RPC.
do $$
declare m record; v_users uuid[]; v_user uuid;
begin
  for m in select * from jsonb_to_recordset(coalesce(
    nullif(current_setting('bob.reviewed_member_mapping', true), '')::jsonb, '[]'::jsonb
  )) as approved(project_id text, email text, name text)
  loop
    if nullif(trim(m.project_id), '') is null or nullif(trim(m.email), '') is null
      or nullif(trim(m.name), '') is null then
      raise exception 'Bob bootstrap blocked: project, confirmed email and member name are required';
    end if;
    if not exists(select 1 from bob.projects where id = m.project_id) then
      raise exception 'Bob bootstrap blocked: reviewed project does not exist';
    end if;
    select array_agg(id) into v_users from auth.users where lower(email) = lower(trim(m.email));
    if coalesce(cardinality(v_users), 0) <> 1 then
      raise exception 'Bob bootstrap blocked: reviewed email must resolve to exactly one Auth account';
    end if;
    v_user := v_users[1];
    if not exists(select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
      raise exception 'Bob bootstrap blocked: reviewed Auth email is not confirmed';
    end if;
    if exists(select 1 from bob.people where project_id = m.project_id and auth_user_id = v_user) then
      continue;
    end if;
    if exists(select 1 from bob.people where project_id = m.project_id) then
      raise exception 'Bob bootstrap blocked: existing crew requires an explicit person mapping';
    end if;
    insert into bob.people(id, project_id, name, initials, role, auth_user_id)
    values ('u_' || replace(gen_random_uuid()::text, '-', ''), m.project_id,
      trim(m.name), upper(left(trim(m.name), 2)), 'Organiser', v_user);
  end loop;
end $$;

-- Do not guess ownership or silently remove access to an existing project.
do $$ begin
  if exists (select 1 from bob.projects p where not exists (
    select 1 from bob.people m where m.project_id = p.id and m.auth_user_id is not null
  )) then
    raise exception 'Bob migration blocked: existing projects need a reviewed member mapping';
  end if;
end $$;

create schema if not exists bob_private;
revoke all on schema bob_private from public, anon;
grant usage on schema bob_private to authenticated;
alter default privileges in schema bob_private revoke execute on functions from public;
alter function bob.set_updated_at() set search_path = '';

alter table bob.person_emails add column project_id text;
update bob.person_emails e set project_id = p.project_id from bob.people p where p.id = e.person_id;
alter table bob.person_emails alter column project_id set not null;
alter table bob.people add constraint people_project_person_key unique(project_id, id);
alter table bob.person_emails add constraint invite_project_person_fk
  foreign key(project_id, person_id) references bob.people(project_id, id) on delete cascade;
drop index bob.person_emails_email_idx;
create unique index person_emails_project_email_idx on bob.person_emails(project_id, lower(email));
create index person_emails_claim_idx on bob.person_emails(lower(email));
revoke all on bob.person_emails from public, anon, authenticated;

-- This is the authority source, not the editable crew role label. The only
-- definers live in a non-exposed schema with an empty search_path and uid gate.
create function bob_private.has_project_access(p_project_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from bob.people p
    where p.project_id = p_project_id and p.auth_user_id = (select auth.uid())
  );
$$;
grant execute on function bob_private.has_project_access(text) to authenticated;

-- Drop ALL policies on the named tables: a permissive policy left over from a
-- dashboard change would otherwise OR with the new ones. Account and other
-- app tables are intentionally not in this project policy migration.
do $$ declare r record; begin
  for r in select tablename, policyname from pg_policies where schemaname = 'bob'
    and tablename = any(array['projects','people','person_skills','areas','area_crew',
      'area_reference_images','tasks','task_assignees','materials','events',
      'event_attendees','meals','diet_columns','diet_flags','food_groups',
      'food_items','announcements'])
  loop execute format('drop policy %I on bob.%I', r.policyname, r.tablename); end loop;
end $$;

-- Generated below: static, reviewable policies with both relation ends scoped.
revoke all on bob.projects from public, anon, authenticated;
grant select on bob.projects to authenticated;
grant update (name, slug, description, location, type, theme, start_label, start_date, end_date) on bob.projects to authenticated;
create policy project_members on bob.projects for all to authenticated
  using (bob_private.has_project_access(id))
  with check (bob_private.has_project_access(id));


revoke all on bob.people from public, anon, authenticated;
grant select, delete on bob.people to authenticated;
grant update (name, initials, color, role, diet, sort_order) on bob.people to authenticated;
create policy project_members on bob.people for all to authenticated
  using (bob_private.has_project_access(project_id))
  with check (bob_private.has_project_access(project_id));


revoke all on bob.areas from public, anon, authenticated;
grant select, insert, delete on bob.areas to authenticated;
grant update (slug, name, description, icon, lead_id, assigned_pct, materials_pct, done_pct, task_summary, sort_order) on bob.areas to authenticated;
create policy project_members on bob.areas for all to authenticated
  using (bob_private.has_project_access(project_id) and (lead_id is null or exists (select 1 from bob.people p where p.id = lead_id and p.project_id = areas.project_id)))
  with check (bob_private.has_project_access(project_id) and (lead_id is null or exists (select 1 from bob.people p where p.id = lead_id and p.project_id = areas.project_id)));


revoke all on bob.materials from public, anon, authenticated;
grant select, insert, delete on bob.materials to authenticated;
grant update (name, qty, area_label, supplier, status, cost, category, category_icon, sort_order) on bob.materials to authenticated;
create policy project_members on bob.materials for all to authenticated
  using (bob_private.has_project_access(project_id))
  with check (bob_private.has_project_access(project_id));


revoke all on bob.events from public, anon, authenticated;
grant select, insert, delete on bob.events to authenticated;
grant update (slug, title, day, time, place, spots, status, food, sort_order) on bob.events to authenticated;
create policy project_members on bob.events for all to authenticated
  using (bob_private.has_project_access(project_id))
  with check (bob_private.has_project_access(project_id));


revoke all on bob.meals from public, anon, authenticated;
grant select, insert, delete on bob.meals to authenticated;
grant update (event_id, meal, time, icon, dish, notes, sort_order) on bob.meals to authenticated;
create policy project_members on bob.meals for all to authenticated
  using (bob_private.has_project_access(project_id) and (event_id is null or exists (select 1 from bob.events e where e.id = event_id and e.project_id = meals.project_id)))
  with check (bob_private.has_project_access(project_id) and (event_id is null or exists (select 1 from bob.events e where e.id = event_id and e.project_id = meals.project_id)));


revoke all on bob.diet_columns from public, anon, authenticated;
grant select, insert, delete on bob.diet_columns to authenticated;
grant update (name, sort_order) on bob.diet_columns to authenticated;
create policy project_members on bob.diet_columns for all to authenticated
  using (bob_private.has_project_access(project_id))
  with check (bob_private.has_project_access(project_id));


revoke all on bob.food_groups from public, anon, authenticated;
grant select, insert, delete on bob.food_groups to authenticated;
grant update (category, icon, sort_order) on bob.food_groups to authenticated;
create policy project_members on bob.food_groups for all to authenticated
  using (bob_private.has_project_access(project_id))
  with check (bob_private.has_project_access(project_id));


revoke all on bob.announcements from public, anon, authenticated;
grant select, insert, delete on bob.announcements to authenticated;
grant update (author_id, time_label, pinned, text, reacts, comments) on bob.announcements to authenticated;
create policy project_members on bob.announcements for all to authenticated
  using (bob_private.has_project_access(project_id) and (author_id is null or exists (select 1 from bob.people p where p.id = author_id and p.project_id = announcements.project_id)))
  with check (bob_private.has_project_access(project_id) and (author_id is null or exists (select 1 from bob.people p where p.id = author_id and p.project_id = announcements.project_id)));


revoke all on bob.tasks from public, anon, authenticated;
grant select, insert, delete on bob.tasks to authenticated;
grant update (name, skill, hours, status, materials) on bob.tasks to authenticated;
create policy project_members on bob.tasks for all to authenticated
  using (exists (select 1 from bob.areas a where a.id = area_id and bob_private.has_project_access(a.project_id)))
  with check (exists (select 1 from bob.areas a where a.id = area_id and bob_private.has_project_access(a.project_id)));


revoke all on bob.area_reference_images from public, anon, authenticated;
grant select, insert, delete on bob.area_reference_images to authenticated;
grant update (label, sort_order) on bob.area_reference_images to authenticated;
create policy project_members on bob.area_reference_images for all to authenticated
  using (exists (select 1 from bob.areas a where a.id = area_id and bob_private.has_project_access(a.project_id)))
  with check (exists (select 1 from bob.areas a where a.id = area_id and bob_private.has_project_access(a.project_id)));


revoke all on bob.person_skills from public, anon, authenticated;
grant select, insert, delete on bob.person_skills to authenticated;
grant update (name, level) on bob.person_skills to authenticated;
create policy project_members on bob.person_skills for all to authenticated
  using (exists (select 1 from bob.people p where p.id = person_id and bob_private.has_project_access(p.project_id)))
  with check (exists (select 1 from bob.people p where p.id = person_id and bob_private.has_project_access(p.project_id)));


revoke all on bob.food_items from public, anon, authenticated;
grant select, insert, delete on bob.food_items to authenticated;
grant update (name, qty, note, checked, sort_order) on bob.food_items to authenticated;
create policy project_members on bob.food_items for all to authenticated
  using (exists (select 1 from bob.food_groups g where g.id = group_id and bob_private.has_project_access(g.project_id)))
  with check (exists (select 1 from bob.food_groups g where g.id = group_id and bob_private.has_project_access(g.project_id)));


revoke all on bob.area_crew from public, anon, authenticated;
grant select, insert, delete on bob.area_crew to authenticated;
-- Relation keys cannot be moved with UPDATE; delete/insert validates both ends.
create policy project_members on bob.area_crew for all to authenticated
  using (exists (select 1 from bob.areas a join bob.people p on p.project_id = a.project_id where a.id = area_id and p.id = person_id and bob_private.has_project_access(a.project_id)))
  with check (exists (select 1 from bob.areas a join bob.people p on p.project_id = a.project_id where a.id = area_id and p.id = person_id and bob_private.has_project_access(a.project_id)));


revoke all on bob.task_assignees from public, anon, authenticated;
grant select, insert, delete on bob.task_assignees to authenticated;
-- Relation keys cannot be moved with UPDATE; delete/insert validates both ends.
create policy project_members on bob.task_assignees for all to authenticated
  using (exists (select 1 from bob.tasks t join bob.areas a on a.id = t.area_id join bob.people p on p.project_id = a.project_id where t.id = task_id and p.id = person_id and bob_private.has_project_access(a.project_id)))
  with check (exists (select 1 from bob.tasks t join bob.areas a on a.id = t.area_id join bob.people p on p.project_id = a.project_id where t.id = task_id and p.id = person_id and bob_private.has_project_access(a.project_id)));


revoke all on bob.event_attendees from public, anon, authenticated;
grant select, insert, delete on bob.event_attendees to authenticated;
-- Relation keys cannot be moved with UPDATE; delete/insert validates both ends.
create policy project_members on bob.event_attendees for all to authenticated
  using (exists (select 1 from bob.events e join bob.people p on p.project_id = e.project_id where e.id = event_id and p.id = person_id and bob_private.has_project_access(e.project_id)))
  with check (exists (select 1 from bob.events e join bob.people p on p.project_id = e.project_id where e.id = event_id and p.id = person_id and bob_private.has_project_access(e.project_id)));


revoke all on bob.diet_flags from public, anon, authenticated;
grant select, insert, delete on bob.diet_flags to authenticated;
-- Relation keys cannot be moved with UPDATE; delete/insert validates both ends.
create policy project_members on bob.diet_flags for all to authenticated
  using (exists (select 1 from bob.diet_columns c join bob.people p on p.project_id = c.project_id where c.id = column_id and p.id = person_id and bob_private.has_project_access(c.project_id)))
  with check (exists (select 1 from bob.diet_columns c join bob.people p on p.project_id = c.project_id where c.id = column_id and p.id = person_id and bob_private.has_project_access(c.project_id)));

alter view bob.today_tasks set (security_invoker = true);
revoke all on bob.today_tasks from public, anon;
grant select on bob.today_tasks to authenticated;

-- No client can insert/link a member or rewrite any row's project/parent id.
-- Preserve signed-in collaborative editing inside a project.
drop function if exists bob.join_project();
drop function if exists bob.invite_person(text, text, text);

create function bob_private.claim_project_invites() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select email into v_email from auth.users where id = v_uid and email_confirmed_at is not null;
  if v_email is null then return; end if;
  update bob.people p set auth_user_id = v_uid
    from bob.person_emails e
    where e.person_id = p.id and e.project_id = p.project_id
      and lower(e.email) = lower(v_email) and p.auth_user_id is null
      and not exists (select 1 from bob.people m where m.project_id = p.project_id and m.auth_user_id = v_uid);
end $$;

create function bob.claim_project_invites() returns void
language sql security invoker set search_path = '' as $$
  select bob_private.claim_project_invites();
$$;
revoke all on function bob.claim_project_invites() from public, anon;
grant execute on function bob.claim_project_invites(), bob_private.claim_project_invites() to authenticated;

create function bob.join_project(p_project_id text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_person jsonb;
begin
  if not bob_private.has_project_access(p_project_id) then
    raise exception 'project_denied' using errcode = '42501';
  end if;
  select to_jsonb(p) into v_person from bob.people p
    where project_id = p_project_id and auth_user_id = (select auth.uid());
  return v_person;
end $$;
revoke all on function bob.join_project(text) from public, anon;
grant execute on function bob.join_project(text) to authenticated;

create function bob_private.create_project(p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_project bob.projects; v_id text := 'p_' || replace(gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if coalesce(length(trim(p_input->>'name')), 0) not between 1 and 200 then
    raise exception 'invalid_project_name' using errcode = '22023';
  end if;
  insert into bob.projects(id, slug, name, description, location, type, theme, start_label, start_date, end_date)
  values(v_id, v_id, trim(p_input->>'name'), coalesce(p_input->>'description',''),
    coalesce(p_input->>'location',''), coalesce(p_input->>'type',''),
    coalesce(p_input->>'theme','birch')::bob.theme_name, coalesce(p_input->>'start_label',''),
    (p_input->>'start_date')::date, (p_input->>'end_date')::date)
  returning * into v_project;
  insert into bob.people(id, project_id, name, initials, role, auth_user_id)
    values('m_' || replace(gen_random_uuid()::text, '-', ''), v_id, 'Project creator', 'PC', 'Organiser', v_uid);
  return to_jsonb(v_project);
end $$;
create function bob.create_project(p_input jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select bob_private.create_project(p_input); $$;
revoke all on function bob.create_project(jsonb) from public, anon;
grant execute on function bob.create_project(jsonb), bob_private.create_project(jsonb) to authenticated;

create function bob_private.invite_person(p_project_id text, p_name text, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_person bob.people;
begin
  if not bob_private.has_project_access(p_project_id) then
    raise exception 'project_denied' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_name)),0) not between 1 and 200
     or coalesce(length(trim(p_email)),0) not between 3 and 320 or position('@' in p_email) < 2 then
    raise exception 'invalid_invitation' using errcode = '22023';
  end if;
  insert into bob.people(id, project_id, name, initials)
    values('i_' || replace(gen_random_uuid()::text, '-', ''), p_project_id, trim(p_name), upper(left(trim(p_name),2)))
    returning * into v_person;
  insert into bob.person_emails(person_id, project_id, email)
    values(v_person.id, p_project_id, lower(trim(p_email)));
  return to_jsonb(v_person);
end $$;
create function bob.invite_person(p_project_id text, p_name text, p_email text) returns jsonb
language sql security invoker set search_path = '' as $$
  select bob_private.invite_person(p_project_id, p_name, p_email);
$$;
revoke all on function bob.invite_person(text,text,text) from public, anon;
grant execute on function bob.invite_person(text,text,text),
  bob_private.invite_person(text,text,text) to authenticated;

-- Keep a project reachable when a crew member is removed. Serialize competing
-- removals; deleting an entire project as an operator still cascades normally.
create function bob_private.keep_last_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.auth_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(old.project_id, 1));
    if exists (select 1 from bob.projects where id = old.project_id)
      and not exists (select 1 from bob.people where project_id = old.project_id
        and id <> old.id and auth_user_id is not null) then
      raise exception 'last_project_member' using errcode = '23514';
    end if;
  end if;
  return old;
end $$;
create trigger keep_last_member before delete on bob.people
  for each row execute function bob_private.keep_last_member();

-- Fixed dataset projections; caller JWT + RLS apply to every underlying table.
-- SQL, schema names, columns and project ids are never model tool arguments.
create function bob.search_project_data(
  p_project_id text, p_dataset text, p_query text default null,
  p_status text default null, p_area_id text default null, p_record_id text default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
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
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description, 'lead_id', r.lead_id, 'updated_at', r.updated_at) as item
        from bob.areas r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.description))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'tasks' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'area_id', r.area_id, 'name', r.name, 'skill', r.skill, 'hours', r.hours, 'status', r.status, 'materials', r.materials, 'updated_at', r.updated_at, 'area_name', a.name) as item
        from bob.tasks r join bob.areas a on a.id = r.area_id
        where a.project_id = p_project_id
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
      join bob.areas a on a.id = t.area_id
      join bob.people p on p.id = ta.person_id and p.project_id = a.project_id
      where a.project_id = p_project_id and t.id in (select value->>'id' from jsonb_array_elements(v_rows))
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
end $$;
revoke all on function bob.search_project_data(text,text,text,text,text,text) from public, anon;
grant execute on function bob.search_project_data(text,text,text,text,text,text) to authenticated;

commit;
notify pgrst, 'reload schema';
