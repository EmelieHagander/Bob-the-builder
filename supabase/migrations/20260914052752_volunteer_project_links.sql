-- No-email volunteer participation, confined to Bob. No Auth user or household
-- membership is created; bearer secrets authorize a narrow project-only API.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create schema bob_volunteer_private;
revoke all on schema bob_volunteer_private from public;
grant usage on schema bob_volunteer_private to anon,authenticated,service_role;

create table bob.volunteer_links (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references bob.projects(id) on delete cascade,
  secret_hash bytea not null unique check(octet_length(secret_hash)=32),
  label text not null check(char_length(btrim(label)) between 1 and 120),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  unique(id,project_id)
);
create index volunteer_links_project_idx on bob.volunteer_links(project_id,created_at);
create index volunteer_links_creator_idx on bob.volunteer_links(created_by);
create table bob.volunteer_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  link_id uuid not null,
  person_id text not null unique,
  secret_hash bytea not null unique check(octet_length(secret_hash)=32),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key(link_id,project_id) references bob.volunteer_links(id,project_id) on delete cascade,
  foreign key(person_id,project_id) references bob.people(id,project_id) on delete cascade
);
create index volunteer_sessions_link_idx on bob.volunteer_sessions(link_id,project_id);
create index volunteer_sessions_project_idx on bob.volunteer_sessions(project_id);
alter table bob.volunteer_links enable row level security;
alter table bob.volunteer_sessions enable row level security;
revoke all on bob.volunteer_links,bob.volunteer_sessions from public,anon,authenticated;
grant all on bob.volunteer_links,bob.volunteer_sessions to service_role;
comment on table bob.volunteer_links is 'Project-owned multi-use volunteer invitations. Only SHA-256 digests are stored. Revocation/expiry ends all sessions from the link.';
comment on table bob.volunteer_sessions is 'One unverified name in one project, with a separate device bearer secret; never an auth.users account. Name matching never restores access.';

create function bob_volunteer_private.volunteer_hash(p_secret text) returns bytea
language plpgsql immutable set search_path='' as $$ begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then raise exception 'Volunteer access is unavailable. Ask the organiser for a new link.' using errcode='42501'; end if;
  return sha256(convert_to(p_secret,'UTF8'));
end $$;
create function bob_volunteer_private.volunteer_food_enabled(p_project text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from bob.meals where project_id=p_project)
    or exists(select 1 from bob.events where project_id=p_project and nullif(btrim(food),'') is not null)
$$;

-- Lock parent before session everywhere, so revocation and writes serialize.
create function bob_volunteer_private.volunteer_session(p_secret text) returns bob.volunteer_sessions
language plpgsql security definer set search_path='' as $$
declare s bob.volunteer_sessions; l bob.volunteer_links; digest bytea:=bob_volunteer_private.volunteer_hash(p_secret);
begin
  select * into s from bob.volunteer_sessions where secret_hash=digest;
  if not found then raise exception 'Volunteer access is unavailable. Ask the organiser for a new link.' using errcode='42501'; end if;
  select * into l from bob.volunteer_links where id=s.link_id for share;
  if not found or l.revoked_at is not null or l.expires_at<=clock_timestamp() then
    raise exception 'Volunteer access is unavailable. Ask the organiser for a new link.' using errcode='42501'; end if;
  select * into s from bob.volunteer_sessions where id=s.id for share;
  if not found or s.revoked_at is not null then raise exception 'Volunteer access is unavailable. Ask the organiser for a new link.' using errcode='42501'; end if;
  return s;
end $$;

create function bob_volunteer_private.volunteer_links_state(p_project text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare links jsonb; participants jsonb;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'label',l.label,'expiresAt',l.expires_at,
    'revokedAt',l.revoked_at,'createdAt',l.created_at,'participants',(select count(*) from bob.volunteer_sessions s where s.link_id=l.id)) order by l.created_at desc),'[]')
    into links from bob.volunteer_links l where l.project_id=p_project;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'linkId',s.link_id,'personId',s.person_id,'name',p.name,
    'revokedAt',s.revoked_at,'createdAt',s.created_at) order by s.created_at desc),'[]') into participants
    from bob.volunteer_sessions s join bob.people p on p.id=s.person_id where s.project_id=p_project;
  return jsonb_build_object('projectId',p_project,'links',links,'participants',participants);
end $$;
create function bob_volunteer_private.create_volunteer_link(p_project text,p_label text,p_secret text,p_days integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l bob.volunteer_links; digest bytea;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if coalesce(char_length(btrim(p_label)),0) not between 1 and 120 or p_days is null or p_days not between 1 and 90 then
    raise exception 'Choose a link name and between 1 and 90 days.' using errcode='22023'; end if;
  digest:=bob_volunteer_private.volunteer_hash(p_secret);
  perform 1 from bob.projects where id=p_project for update;
  select * into l from bob.volunteer_links where secret_hash=digest;
  if found then
    if l.project_id<>p_project or l.created_by is distinct from auth.uid() or l.revoked_at is not null or l.expires_at<=now() then
      raise exception 'This link cannot be reused. Create a new link.' using errcode='40001'; end if;
  else
    if (select count(*) from bob.volunteer_links where project_id=p_project and revoked_at is null and expires_at>now())>=10 then
      raise exception 'Revoke an old volunteer link before creating another.' using errcode='22023'; end if;
    insert into bob.volunteer_links(project_id,secret_hash,label,created_by,expires_at)
      values(p_project,digest,btrim(p_label),auth.uid(),now()+make_interval(days=>p_days)) returning * into l;
  end if;
  return jsonb_build_object('projectId',p_project,'id',l.id,'label',l.label,'expiresAt',l.expires_at);
end $$;
create function bob_volunteer_private.revoke_volunteer_access(p_project text,p_link uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if num_nonnulls(p_link,p_session)<>1 then raise exception 'Choose one link or participant.' using errcode='22023'; end if;
  if p_link is not null then
    update bob.volunteer_links set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_link and project_id=p_project;
  else
    update bob.volunteer_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_session and project_id=p_project;
  end if;
  if not found then raise exception 'Volunteer access not found.' using errcode='42501'; end if;
  return jsonb_build_object('projectId',p_project,'revoked',true);
end $$;

create function bob_volunteer_private.volunteer_preview(p_secret text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l bob.volunteer_links; project_name text;
begin
  select * into l from bob.volunteer_links where secret_hash=bob_volunteer_private.volunteer_hash(p_secret)
    and revoked_at is null and expires_at>now();
  if not found then raise exception 'Volunteer access is unavailable. Ask the organiser for a new link.' using errcode='42501'; end if;
  select name into project_name from bob.projects where id=l.project_id;
  return jsonb_build_object('linkId',l.id,'projectId',l.project_id,'projectName',project_name,
    'hasFood',bob_volunteer_private.volunteer_food_enabled(l.project_id),'expiresAt',l.expires_at);
end $$;
create function bob_volunteer_private.volunteer_state(p_secret text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); result jsonb; food boolean:=bob_volunteer_private.volunteer_food_enabled(s.project_id);
begin
  select jsonb_build_object('projectId',p.id,'linkId',s.link_id,'project',jsonb_build_object('name',p.name,'description',p.description,
    'location',p.location,'theme',p.theme,'startLabel',p.start_label,'startDate',p.start_date,'endDate',p.end_date),
    'person',jsonb_build_object('id',v.id,'name',v.name,'allergies',case when food then nullif(v.diet,'') end,'updatedAt',v.updated_at),
    'hasFood',food,'expiresAt',l.expires_at) into result
    from bob.projects p join bob.people v on v.id=s.person_id join bob.volunteer_links l on l.id=s.link_id where p.id=s.project_id;
  return result;
end $$;
create function bob_volunteer_private.volunteer_join(p_invite text,p_session text,p_name text,p_allergies text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l bob.volunteer_links; s bob.volunteer_sessions; person text; digest bytea:=bob_volunteer_private.volunteer_hash(p_session);
begin
  if p_invite=p_session or coalesce(char_length(btrim(p_name)),0) not between 1 and 120 or coalesce(char_length(p_allergies),0)>1000 then
    raise exception 'Enter your name (up to 120 characters) and optional allergies (up to 1000 characters).' using errcode='22023'; end if;
  select * into l from bob.volunteer_links where secret_hash=bob_volunteer_private.volunteer_hash(p_invite) for update;
  if not found or l.revoked_at is not null or l.expires_at<=clock_timestamp() then
    raise exception 'Volunteer access is unavailable. Ask the organiser for a new link.' using errcode='42501'; end if;
  select * into s from bob.volunteer_sessions where secret_hash=digest;
  if found then
    if s.link_id<>l.id then raise exception 'Volunteer access is unavailable. Ask the organiser for a new link.' using errcode='42501'; end if;
    return bob_volunteer_private.volunteer_state(p_session); -- Retry never creates a second person or edits their profile.
  end if;
  if not bob_volunteer_private.volunteer_food_enabled(l.project_id) and nullif(btrim(p_allergies),'') is not null then
    raise exception 'Allergies can only be added when this project has food planned.' using errcode='22023'; end if;
  if (select count(*) from bob.volunteer_sessions where link_id=l.id)>=200 then
    raise exception 'This volunteer link is full. Ask the organiser for a new link.' using errcode='22023'; end if;
  person:='v_'||replace(gen_random_uuid()::text,'-','');
  insert into bob.people(id,project_id,name,initials,role,diet,auth_user_id,access_origin)
    values(person,l.project_id,btrim(p_name),upper(left(btrim(p_name),2)),'Volunteer',coalesce(btrim(p_allergies),''),null,'derived');
  insert into bob.volunteer_sessions(project_id,link_id,person_id,secret_hash) values(l.project_id,l.id,person,digest);
  return bob_volunteer_private.volunteer_state(p_session);
end $$;
create function bob_volunteer_private.volunteer_profile(p_secret text,p_name text,p_allergies text,p_expected timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); p bob.people; food boolean:=bob_volunteer_private.volunteer_food_enabled(s.project_id);
begin
  if coalesce(char_length(btrim(p_name)),0) not between 1 and 120 or coalesce(char_length(p_allergies),0)>1000 then raise exception 'Check your name and allergies.' using errcode='22023'; end if;
  if not food and nullif(btrim(p_allergies),'') is not null then raise exception 'Allergies can only be added when this project has food planned.' using errcode='22023'; end if;
  select * into p from bob.people where id=s.person_id for update;
  if p_expected is distinct from p.updated_at then raise exception 'Your profile changed. Refresh before saving.' using errcode='40001'; end if;
  update bob.people set name=btrim(p_name),initials=upper(left(btrim(p_name),2)),diet=case when food then coalesce(btrim(p_allergies),'') else diet end where id=p.id;
  return bob_volunteer_private.volunteer_state(p_secret);
end $$;

-- Volunteer feeds disclose no crew allergies, account settings, invitation
-- records, other projects, physical inventories or author account identifiers.
create function bob_volunteer_private.volunteer_feed(p_secret text,p_section text,p_after text,p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); items jsonb; page jsonb; next_id text;
begin
  if p_limit is null or p_limit not between 1 and 50 or char_length(coalesce(p_after,''))>200 then raise exception 'Invalid page.' using errcode='22023'; end if;
  if p_section='tasks' then
    select coalesce(jsonb_agg(j order by id),'[]') into items from (
      select t.id,jsonb_build_object('id',t.id,'name',t.name,'area',a.name,'status',t.status,'skill',t.skill,'hours',t.hours,
        'mine',exists(select 1 from bob.task_assignees where task_id=t.id and person_id=s.person_id)) j
      from bob.tasks t join bob.areas a on a.id=t.area_id where a.project_id=s.project_id and t.id>coalesce(p_after,'') order by t.id limit p_limit+1) rows;
  elsif p_section='events' then
    select coalesce(jsonb_agg(j order by id),'[]') into items from (
      select e.id,jsonb_build_object('id',e.id,'title',e.title,'day',e.day,'time',e.time,'place',e.place,'food',e.food,
        'going',exists(select 1 from bob.event_attendees where event_id=e.id and person_id=s.person_id)) j
      from bob.events e where e.project_id=s.project_id and e.id>coalesce(p_after,'') order by e.id limit p_limit+1) rows;
  elsif p_section='updates' then
    select coalesce(jsonb_agg(j order by id),'[]') into items from (
      select a.id,jsonb_build_object('id',a.id,'text',a.text,'pinned',a.pinned,'createdAt',a.created_at) j
      from bob.announcements a where a.project_id=s.project_id and a.id>coalesce(p_after,'') order by a.id limit p_limit+1) rows;
  elsif p_section='meals' then
    select coalesce(jsonb_agg(j order by id),'[]') into items from (
      select m.id,jsonb_build_object('id',m.id,'meal',m.meal,'time',m.time,'dish',m.dish,'notes',m.notes) j
      from bob.meals m where m.project_id=s.project_id and m.id>coalesce(p_after,'') order by m.id limit p_limit+1) rows;
  else raise exception 'Unknown volunteer section.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(value order by ordinality),'[]') into page from jsonb_array_elements(items) with ordinality where ordinality<=p_limit;
  if jsonb_array_length(items)>p_limit then next_id:=page->(p_limit-1)->>'id'; end if;
  return jsonb_build_object('projectId',s.project_id,'items',page,'nextCursor',next_id);
end $$;
create function bob_volunteer_private.volunteer_rsvp(p_secret text,p_event text,p_going boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret);
begin
  if p_going is null then raise exception 'Choose your attendance.' using errcode='22023'; end if;
  perform 1 from bob.events where id=p_event and project_id=s.project_id for share;
  if not found then raise exception 'Build day unavailable.' using errcode='42501'; end if;
  if p_going then insert into bob.event_attendees(event_id,person_id) values(p_event,s.person_id) on conflict do nothing;
  else delete from bob.event_attendees where event_id=p_event and person_id=s.person_id; end if;
  return jsonb_build_object('projectId',s.project_id,'eventId',p_event,'going',p_going);
end $$;

-- Keep distinct provenance for a name-only volunteer completing a step. Never
-- manufacture an Auth UUID. Historical person ids survive profile deletion.
alter table bob.task_steps add column completed_by_volunteer text;
comment on column bob.task_steps.completed_by_volunteer is 'Bob person id for a named volunteer checkpoint author; mutually exclusive with completed_by Auth identity. Historical identifier is retained.';
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='bob.task_steps'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%completed_at%' and pg_get_constraintdef(oid) like '%completed_by%' loop
    execute format('alter table bob.task_steps drop constraint %I',c.conname);
  end loop;
end $$;
alter table bob.task_steps add constraint task_step_completion_actor check(
  (completed_at is null and num_nonnulls(completed_by,completed_by_volunteer)=0)
  or (completed_at is not null and num_nonnulls(completed_by,completed_by_volunteer)=1));
create function bob_volunteer_private.volunteer_step_actor() returns trigger language plpgsql set search_path='' as $$ begin
  if new.completed_at is null or new.completed_by is not null then new.completed_by_volunteer:=null; end if;
  return new;
end $$;
create trigger volunteer_step_actor before update of completed_at,completed_by on bob.task_steps for each row execute function bob_volunteer_private.volunteer_step_actor();

create function bob_volunteer_private.volunteer_task(p_secret text,p_task text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); t bob.tasks; area_name text; steps jsonb; images jsonb;
begin
  select t0.* into t from bob.tasks t0 join bob.areas a on a.id=t0.area_id where t0.id=p_task and a.project_id=s.project_id;
  if not found then raise exception 'Task unavailable.' using errcode='42501'; end if;
  select name into area_name from bob.areas where id=t.area_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'instructions',instructions,'required',required,
    'isCheckpoint',is_checkpoint,'completedAt',completed_at,'revision',revision) order by position),'[]') into steps from bob.task_steps where task_id=t.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'title',m.title) order by m.created_at,m.id),'[]') into images from bob.media_assets m
    where m.project_id=s.project_id and m.state='ready' and exists(select 1 from bob.media_links l left join bob.task_steps st on st.id=l.step_id
      where l.media_id=m.id and (l.task_id=t.id or l.area_id=t.area_id or st.task_id=t.id));
  return jsonb_build_object('projectId',s.project_id,'id',t.id,'name',t.name,'area',area_name,'instructions',t.instructions,'status',t.status,
    'updatedAt',t.updated_at,'mine',exists(select 1 from bob.task_assignees where task_id=t.id and person_id=s.person_id),'steps',steps,'images',images);
end $$;
create function bob_volunteer_private.volunteer_task_action(p_secret text,p_task text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); t bob.tasks; st bob.task_steps; complete boolean;
begin
  select t0.* into t from bob.tasks t0 join bob.areas a on a.id=t0.area_id where t0.id=p_task and a.project_id=s.project_id for update of t0;
  if not found then raise exception 'Task unavailable.' using errcode='42501'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid task action.' using errcode='22023'; end if;
  if p_action in ('claim','release') then
    if p_data<>'{}'::jsonb then raise exception 'Invalid task action.' using errcode='22023'; end if;
    if p_action='claim' then
      if t.status='done' then raise exception 'This task is already done. Refresh the task list.' using errcode='40001'; end if;
      insert into bob.task_assignees(task_id,person_id) values(t.id,s.person_id) on conflict do nothing;
    else delete from bob.task_assignees where task_id=t.id and person_id=s.person_id; end if;
  else
    if not exists(select 1 from bob.task_assignees where task_id=t.id and person_id=s.person_id) then raise exception 'Join this task before updating it.' using errcode='42501'; end if;
    if p_action='status' then
      if p_data-array['status','expectedUpdatedAt']<>'{}'::jsonb or p_data->>'status' is null or p_data->>'status' not in ('todo','doing','blocked','done') then raise exception 'Invalid task status.' using errcode='22023'; end if;
      if (p_data->>'expectedUpdatedAt')::timestamptz is distinct from t.updated_at then raise exception 'Task changed. Refresh before saving.' using errcode='40001'; end if;
      update bob.tasks set status=(p_data->>'status')::bob.task_status where id=t.id;
    elsif p_action='check' then
      if p_data-array['stepId','revision','completed']<>'{}'::jsonb or jsonb_typeof(p_data->'completed') is distinct from 'boolean' then raise exception 'Invalid task check.' using errcode='22023'; end if;
      select * into st from bob.task_steps where id=(p_data->>'stepId')::uuid and task_id=t.id and project_id=s.project_id for update;
      if not found then raise exception 'Step unavailable.' using errcode='42501'; end if;
      if (p_data->>'revision')::integer is distinct from st.revision then raise exception 'Step changed. Refresh before saving.' using errcode='40001'; end if;
      complete:=(p_data->>'completed')::boolean;
      if not complete and st.required and t.status='done' then raise exception 'Reopen the task before reopening a required check.' using errcode='40001'; end if;
      update bob.task_steps set completed_at=case when complete then clock_timestamp() end,completed_by=null,
        completed_by_volunteer=case when complete then s.person_id end,revision=revision+1 where id=st.id;
    else raise exception 'Unknown task action.' using errcode='22023'; end if;
  end if;
  return bob_volunteer_private.volunteer_task(p_secret,p_task);
end $$;

-- Used by the media proxy before each download; never makes the bucket public.
create function bob_volunteer_private.volunteer_media(p_secret text,p_task text,p_media uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); result jsonb;
begin
  select jsonb_build_object('bucket',m.bucket_id,'path',m.object_path,'contentType',m.content_type,'byteSize',m.byte_size) into result
    from bob.media_assets m join bob.tasks t on t.id=p_task join bob.areas a on a.id=t.area_id
    where a.project_id=s.project_id and m.project_id=s.project_id and m.id=p_media and m.state='ready'
      and exists(select 1 from bob.media_links l left join bob.task_steps st on st.id=l.step_id where l.media_id=m.id
        and (l.task_id=t.id or l.area_id=t.area_id or st.task_id=t.id));
  if result is null then raise exception 'Image unavailable.' using errcode='42501'; end if;
  return result;
end $$;

-- All internal helpers start private. Only exact caller-/capability-checked
-- entrypoints receive an invoker wrapper and paired EXECUTE grants.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bob_volunteer_private' and p.proname in ('volunteer_hash','volunteer_food_enabled','volunteer_session','volunteer_step_actor',
      'volunteer_links_state','create_volunteer_link','revoke_volunteer_access','volunteer_preview','volunteer_state','volunteer_join',
      'volunteer_profile','volunteer_feed','volunteer_rsvp','volunteer_task','volunteer_task_action','volunteer_media') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  end loop;
end $$;
create function bob.volunteer_links_state(p_project text) returns jsonb language sql stable security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_links_state(p_project) $$;
create function bob.create_volunteer_link(p_project text,p_label text,p_secret text,p_days integer) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.create_volunteer_link(p_project,p_label,p_secret,p_days) $$;
create function bob.revoke_volunteer_access(p_project text,p_link uuid,p_session uuid) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.revoke_volunteer_access(p_project,p_link,p_session) $$;
create function bob.volunteer_preview(p_secret text) returns jsonb language sql stable security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_preview(p_secret) $$;
create function bob.volunteer_state(p_secret text) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_state(p_secret) $$;
create function bob.volunteer_join(p_invite text,p_session text,p_name text,p_allergies text) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_join(p_invite,p_session,p_name,p_allergies) $$;
create function bob.volunteer_profile(p_secret text,p_name text,p_allergies text,p_expected timestamptz) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_profile(p_secret,p_name,p_allergies,p_expected) $$;
create function bob.volunteer_feed(p_secret text,p_section text,p_after text,p_limit integer) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_feed(p_secret,p_section,p_after,p_limit) $$;
create function bob.volunteer_rsvp(p_secret text,p_event text,p_going boolean) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_rsvp(p_secret,p_event,p_going) $$;
create function bob.volunteer_task(p_secret text,p_task text) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_task(p_secret,p_task) $$;
create function bob.volunteer_task_action(p_secret text,p_task text,p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_task_action(p_secret,p_task,p_action,p_data) $$;
create function bob.volunteer_media(p_secret text,p_task text,p_media uuid) returns jsonb language sql security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_media(p_secret,p_task,p_media) $$;
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('bob','bob_volunteer_private') and p.proname in ('volunteer_links_state','create_volunteer_link','revoke_volunteer_access',
      'volunteer_preview','volunteer_state','volunteer_join','volunteer_profile','volunteer_feed','volunteer_rsvp','volunteer_task','volunteer_task_action','volunteer_media') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to authenticated,service_role',f.signature);
    if f.proname not in ('volunteer_links_state','create_volunteer_link','revoke_volunteer_access') then
      execute format('grant execute on function %s to anon',f.signature);
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
