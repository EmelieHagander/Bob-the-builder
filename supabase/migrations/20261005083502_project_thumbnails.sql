-- Private project identity; overview surfaces have no editing controls.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create table bob.project_thumbnails (
  project_id text primary key references bob.projects(id) on delete cascade,
  media_id uuid not null,
  foreign key (media_id, project_id) references bob.media_assets(id, project_id) on delete cascade
);
create index project_thumbnails_media_idx on bob.project_thumbnails(media_id,project_id);
alter table bob.project_thumbnails enable row level security;
revoke all on bob.project_thumbnails from public,anon,authenticated;
grant select on bob.project_thumbnails to authenticated;
create policy project_read on bob.project_thumbnails for select to authenticated
  using(bob_private.has_project_access(project_id));
create function bob_private.pin_project_thumbnail(p_project text,p_media uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  -- Same membership authority as image uploads; lock against concurrent removal.
  perform 1 from bob.projects where id=p_project for update;
  if not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_media is null then
    delete from bob.project_thumbnails where project_id=p_project;
    return;
  end if;
  perform 1 from bob.media_assets where id=p_media and project_id=p_project and state='ready' for share;
  if not found then raise exception 'Choose a completed image from this project'; end if;
  insert into bob.project_thumbnails(project_id,media_id) values(p_project,p_media)
    on conflict(project_id) do update set media_id=excluded.media_id;
end $$;
revoke all on function bob_private.pin_project_thumbnail(text,uuid) from public,anon;
grant execute on function bob_private.pin_project_thumbnail(text,uuid) to authenticated;
create function bob.pin_project_thumbnail(p_project text,p_media uuid default null)
returns void language sql security invoker set search_path='' as $$
  select bob_private.pin_project_thumbnail(p_project,p_media);
$$;
revoke all on function bob.pin_project_thumbnail(text,uuid) from public,anon;
grant execute on function bob.pin_project_thumbnail(text,uuid) to authenticated;
commit;
