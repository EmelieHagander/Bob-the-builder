-- Milestones 1A/1B. Contract: Docs/media-and-steps.md.
-- Additive Bob-only data changes and policies confined to the new private bucket.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table bob.tasks add column instructions text not null default ''
  check (char_length(instructions) <= 12000);

create table bob.task_steps (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references bob.projects(id) on delete cascade,
  task_id text not null references bob.tasks(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  instructions text not null default '' check (char_length(instructions) <= 12000),
  position integer not null check (position > 0),
  is_checkpoint boolean not null default false,
  required boolean not null default false check (not required or is_checkpoint),
  completed_at timestamptz,
  completed_by uuid,
  revision integer not null default 1,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((completed_at is null) = (completed_by is null)),
  unique (id, project_id),
  unique (task_id, position) deferrable initially deferred
);
create index task_steps_project_idx on bob.task_steps(project_id);

create table bob.media_assets (
  id uuid primary key,
  project_id text not null references bob.projects(id) on delete restrict,
  bucket_id text not null default 'bob-project-media' check (bucket_id = 'bob-project-media'),
  object_path text generated always as (project_id || '/' || id::text) stored,
  original_name text not null check (char_length(original_name) between 1 and 255),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  purpose text not null check (purpose in ('current_state','reference','instruction','proposal','progress','as_built')),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  byte_size integer not null check (byte_size between 1 and 6291456),
  width integer not null check (width between 1 and 20000),
  height integer not null check (height between 1 and 20000),
  check (width::bigint * height <= 48000000),
  source_kind text not null default 'user_upload' check (source_kind = 'user_upload'),
  state text not null default 'pending' check (state in ('pending','ready','deleting')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (object_path)
);
create index media_assets_project_idx on bob.media_assets(project_id, created_at desc);

create table bob.media_links (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  media_id uuid not null,
  area_id text references bob.areas(id) on delete cascade,
  task_id text references bob.tasks(id) on delete cascade,
  step_id uuid,
  created_at timestamptz not null default now(),
  foreign key (media_id, project_id) references bob.media_assets(id, project_id) on delete cascade,
  foreign key (step_id, project_id) references bob.task_steps(id, project_id) on delete cascade,
  check (num_nonnulls(area_id, task_id, step_id) = 1),
  unique (media_id, area_id),
  unique (media_id, task_id),
  unique (media_id, step_id)
);
create index media_links_project_idx on bob.media_links(project_id);
create index media_links_asset_project_idx on bob.media_links(media_id, project_id);
create index media_links_area_idx on bob.media_links(area_id);
create index media_links_task_idx on bob.media_links(task_id);
create index media_links_step_project_idx on bob.media_links(step_id, project_id);

alter table bob.task_steps enable row level security;
alter table bob.media_assets enable row level security;
alter table bob.media_links enable row level security;
revoke all on bob.task_steps, bob.media_assets, bob.media_links from public, anon, authenticated;
grant select on bob.task_steps, bob.media_assets, bob.media_links to authenticated;
create policy project_read on bob.task_steps for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.media_assets for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.media_links for select to authenticated
  using (bob_private.has_project_access(project_id));

-- All media link writers must validate both ends even when the user belongs to both.
create function bob_private.link_media(p_project text, p_media uuid, p_kind text, p_target text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_project text;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode = '42501';
  end if;
  perform 1 from bob.media_assets where id=p_media and project_id=p_project and state <> 'deleting' for update;
  if not found then raise exception 'Image unavailable'; end if;
  if p_kind = 'project' and p_target = p_project then return;
  elsif p_kind = 'area' then
    select project_id into target_project from bob.areas where id=p_target for share;
  elsif p_kind = 'task' then
    select a.project_id into target_project from bob.tasks t join bob.areas a on a.id=t.area_id where t.id=p_target for share of t;
  elsif p_kind = 'step' then
    select project_id into target_project from bob.task_steps where id=p_target::uuid for share;
  else raise exception 'Invalid image attachment'; end if;
  if target_project is distinct from p_project then raise exception 'project_denied' using errcode='42501'; end if;
  insert into bob.media_links(project_id,media_id,area_id,task_id,step_id)
    values(p_project,p_media,case when p_kind='area' then p_target end,
      case when p_kind='task' then p_target end,case when p_kind='step' then p_target::uuid end)
    on conflict do nothing;
end $$;
revoke all on function bob_private.link_media(text,uuid,text,text) from public, anon, authenticated;

create function bob_private.media_command(p_project text, p_action text, p_media uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m bob.media_assets; object_meta jsonb;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_action = 'reserve' then
    insert into bob.media_assets(id,project_id,original_name,title,purpose,content_type,byte_size,width,height,created_by)
      values(p_media,p_project,p_data->>'original_name',p_data->>'title',p_data->>'purpose',
        p_data->>'content_type',(p_data->>'byte_size')::integer,(p_data->>'width')::integer,
        (p_data->>'height')::integer,auth.uid()) returning * into m;
    perform bob_private.link_media(p_project,p_media,p_data->>'target_kind',p_data->>'target_id');
    return to_jsonb(m);
  end if;
  select * into m from bob.media_assets where id=p_media and project_id=p_project for update;
  if not found then raise exception 'Image unavailable'; end if;
  if p_action = 'finalize' then
    if m.state='ready' then return to_jsonb(m); end if;
    if m.state<>'pending' then raise exception 'Image removal is in progress'; end if;
    select metadata into object_meta from storage.objects where bucket_id=m.bucket_id and name=m.object_path;
    if not found or (object_meta->>'size')::bigint is distinct from m.byte_size
      or object_meta->>'mimetype' is distinct from m.content_type then
      raise exception 'Upload incomplete. Remove this entry and choose the image again.';
    end if;
    update bob.media_assets set state='ready', updated_at=now() where id=m.id returning * into m;
  elsif p_action = 'begin_delete' then
    update bob.media_assets set state='deleting', updated_at=now() where id=m.id returning * into m;
  elsif p_action = 'finish_delete' then
    if m.state<>'deleting' then raise exception 'Begin image removal first'; end if;
    if exists(select 1 from storage.objects where bucket_id=m.bucket_id and name=m.object_path) then
      raise exception 'File removal incomplete. Retry removing the image.';
    end if;
    delete from bob.media_assets where id=m.id;
    return jsonb_build_object('removed',true);
  elsif p_action = 'link' then
    if m.state<>'ready' then raise exception 'Finish the upload before attaching this image'; end if;
    perform bob_private.link_media(p_project,m.id,p_data->>'target_kind',p_data->>'target_id');
  elsif p_action = 'unlink' then
    delete from bob.media_links where id=(p_data->>'link_id')::uuid and project_id=p_project and media_id=m.id;
    if not found then raise exception 'Image attachment unavailable'; end if;
  else raise exception 'Unknown image command'; end if;
  return to_jsonb(m);
end $$;
revoke all on function bob_private.media_command(text,text,uuid,jsonb) from public, anon;
grant execute on function bob_private.media_command(text,text,uuid,jsonb) to authenticated;
create function bob.media_command(p_project text, p_action text, p_media uuid, p_data jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select bob_private.media_command(p_project,p_action,p_media,p_data);
$$;
revoke all on function bob.media_command(text,text,uuid,jsonb) from public, anon;
grant execute on function bob.media_command(text,text,uuid,jsonb) to authenticated;

-- A dedicated bucket: fail instead of adopting/changing an existing bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('bob-project-media','bob-project-media',false,6291456,array['image/jpeg','image/png','image/webp']);

create function bob_private.media_object_access(p_name text, p_operation text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare m bob.media_assets;
begin
  if auth.uid() is null then return false; end if;
  if p_operation in ('insert','delete') then
    -- Serialize object metadata writes against reservation removal/finalisation.
    select * into m from bob.media_assets where object_path=p_name for share;
  else select * into m from bob.media_assets where object_path=p_name; end if;
  if not found or not bob_private.has_project_access(m.project_id) then return false; end if;
  return case p_operation
    when 'read' then true
    when 'insert' then m.state='pending' and m.created_by=auth.uid()
    when 'delete' then m.state='deleting'
    else false end;
end $$;
revoke all on function bob_private.media_object_access(text,text) from public, anon;
grant execute on function bob_private.media_object_access(text,text) to authenticated;

create policy bob_media_read on storage.objects for select to authenticated
  using(bucket_id='bob-project-media' and bob_private.media_object_access(name,'read'));
create policy bob_media_insert on storage.objects for insert to authenticated
  with check(bucket_id='bob-project-media' and bob_private.media_object_access(name,'insert'));
create policy bob_media_delete on storage.objects for delete to authenticated
  using(bucket_id='bob-project-media' and bob_private.media_object_access(name,'delete'));
create policy bob_media_read_guard on storage.objects as restrictive for select to authenticated
  using(bucket_id<>'bob-project-media' or bob_private.media_object_access(name,'read'));
create policy bob_media_insert_guard on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'bob-project-media' or bob_private.media_object_access(name,'insert'));
create policy bob_media_delete_guard on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'bob-project-media' or bob_private.media_object_access(name,'delete'));
create policy bob_media_update_guard on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'bob-project-media') with check(bucket_id<>'bob-project-media');
create policy bob_media_anon_guard on storage.objects as restrictive for all to anon
  using(bucket_id<>'bob-project-media') with check(bucket_id<>'bob-project-media');
-- Ordinary clients cannot turn this bucket public, rename or delete it.
create policy bob_media_bucket_insert_guard on storage.buckets as restrictive for insert to anon,authenticated
  with check(id<>'bob-project-media');
create policy bob_media_bucket_update_guard on storage.buckets as restrictive for update to anon,authenticated
  using(id<>'bob-project-media') with check(id<>'bob-project-media');
create policy bob_media_bucket_delete_guard on storage.buckets as restrictive for delete to anon,authenticated
  using(id<>'bob-project-media');

create function bob_private.task_steps_command(p_project text, p_task text, p_action text, p_step uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t bob.tasks; s bob.task_steps; neighbour bob.task_steps; next_position integer;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  select t0.* into t from bob.tasks t0 join bob.areas a on a.id=t0.area_id
    where t0.id=p_task and a.project_id=p_project for update of t0;
  if not found or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_action='instructions' then
    if (p_data->>'expected_updated_at')::timestamptz is distinct from t.updated_at then
      raise exception 'Task changed. Reload before saving your edits.' using errcode='40001';
    end if;
    update bob.tasks set instructions=p_data->>'instructions', updated_at=now() where id=p_task;
  elsif p_action='create' then
    select coalesce(max(position),0)+1 into next_position from bob.task_steps where task_id=p_task;
    insert into bob.task_steps(project_id,task_id,title,instructions,position,is_checkpoint,required,created_by)
      values(p_project,p_task,p_data->>'title',coalesce(p_data->>'instructions',''),next_position,
        coalesce((p_data->>'is_checkpoint')::boolean,false),coalesce((p_data->>'required')::boolean,false),auth.uid());
  else
    select * into s from bob.task_steps where id=p_step and task_id=p_task and project_id=p_project for update;
    if not found then raise exception 'Step unavailable'; end if;
    if (p_data->>'revision')::integer is distinct from s.revision then
      raise exception 'Step changed. Reload before saving your edits.' using errcode='40001';
    end if;
    if p_action='edit' then
      update bob.task_steps set title=p_data->>'title', instructions=coalesce(p_data->>'instructions',''),
        is_checkpoint=coalesce((p_data->>'is_checkpoint')::boolean,false),
        required=coalesce((p_data->>'required')::boolean,false),
        revision=revision+1, updated_at=now() where id=s.id;
    elsif p_action='complete' then
      if jsonb_typeof(p_data->'completed') is distinct from 'boolean' then raise exception 'Choose a completion state'; end if;
      update bob.task_steps set completed_at=case when (p_data->>'completed')::boolean then now() end,
        completed_by=case when (p_data->>'completed')::boolean then auth.uid() end,
        revision=revision+1, updated_at=now() where id=s.id;
    elsif p_action='move' then
      if p_data->>'direction'='up' then
        select * into neighbour from bob.task_steps where task_id=p_task and position<s.position order by position desc limit 1;
      elsif p_data->>'direction'='down' then
        select * into neighbour from bob.task_steps where task_id=p_task and position>s.position order by position limit 1;
      else raise exception 'Choose up or down'; end if;
      if neighbour.id is not null then
        update bob.task_steps set position=case when id=s.id then neighbour.position else s.position end,
          revision=revision+1, updated_at=now() where id in (s.id,neighbour.id);
      end if;
    elsif p_action='delete' then
      delete from bob.task_steps where id=s.id;
    else raise exception 'Unknown step command'; end if;
  end if;
  if t.status='done' and exists(select 1 from bob.task_steps where task_id=p_task and required and completed_at is null) then
    raise exception 'Reopen the task before adding or reopening a required check.';
  end if;
  return jsonb_build_object('saved',true);
end $$;
revoke all on function bob_private.task_steps_command(text,text,text,uuid,jsonb) from public,anon;
grant execute on function bob_private.task_steps_command(text,text,text,uuid,jsonb) to authenticated;
create function bob.task_steps_command(p_project text, p_task text, p_action text, p_step uuid default null, p_data jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select bob_private.task_steps_command(p_project,p_task,p_action,p_step,p_data);
$$;
revoke all on function bob.task_steps_command(text,text,text,uuid,jsonb) from public,anon;
grant execute on function bob.task_steps_command(text,text,text,uuid,jsonb) to authenticated;

create function bob_private.require_task_checks() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status='done' and exists(select 1 from bob.task_steps where task_id=new.id and required and completed_at is null) then
    raise exception 'Complete required checks before marking this task done.';
  end if;
  return new;
end $$;
revoke all on function bob_private.require_task_checks() from public,anon,authenticated;
create trigger require_task_checks before update of status on bob.tasks
  for each row execute function bob_private.require_task_checks();

notify pgrst, 'reload schema';
commit;
