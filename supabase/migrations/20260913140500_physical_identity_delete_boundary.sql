-- Complete Slice 2C's explicit physical-identity deletion boundary.
-- Deletion is intentionally stricter than archive: direct physical authority,
-- current revision match, archived state, and no active project context.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function bob_private.physical_site_delete_command(p_site uuid,p_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  head bob.sites;
  current bob.site_revisions;
begin
  if auth.uid() is null or p_site is null or p_expected is null then
    raise exception 'Invalid site delete command';
  end if;
  if not bob_private.has_site_access(p_site) then
    raise exception 'site_denied' using errcode='42501';
  end if;

  select * into head from bob.sites where id=p_site for update;
  if not found or p_expected is distinct from head.current_revision then
    raise exception 'Site changed. Reload before saving.';
  end if;
  select * into current from bob.site_revisions
    where site_id=p_site and revision=head.current_revision;

  if not current.archived then
    raise exception 'Archive site before deleting.';
  end if;
  if exists(select 1 from bob.buildings where site_id=p_site) then
    raise exception 'Site still contains buildings.';
  end if;
  if exists(select 1 from bob.project_physical_scope where site_id=p_site) then
    raise exception 'Site is still used by a project.';
  end if;

  delete from bob.sites where id=p_site;
  return jsonb_build_object('id',p_site,'removed',true);
end $$;

create function bob_private.physical_building_delete_command(p_building uuid,p_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  head bob.buildings;
  current bob.building_revisions;
begin
  if auth.uid() is null or p_building is null or p_expected is null then
    raise exception 'Invalid building delete command';
  end if;
  if not bob_private.has_building_direct_access(p_building) then
    raise exception 'building_denied' using errcode='42501';
  end if;

  select * into head from bob.buildings where id=p_building for update;
  if not found or p_expected is distinct from head.current_revision then
    raise exception 'Building changed. Reload before saving.';
  end if;
  select * into current from bob.building_revisions
    where building_id=p_building and revision=head.current_revision;

  if not current.archived then
    raise exception 'Archive building before deleting.';
  end if;
  if exists(select 1 from bob.project_physical_scope where building_id=p_building) then
    raise exception 'Building is still used by a project.';
  end if;
  if head.site_id is not null and exists(
    select 1 from bob.project_physical_scope
    where target_kind='site' and site_id=head.site_id
  ) then
    raise exception 'Building site is still used by a project.';
  end if;
  if exists(select 1 from bob.area_physical_targets where building_id=p_building) then
    raise exception 'Building is still used by a project Area.';
  end if;

  delete from bob.buildings where id=p_building;
  return jsonb_build_object('id',p_building,'removed',true);
end $$;

create or replace function bob.physical_site_command(p_action text,p_site uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_action='delete' then
    if p_data is null or p_data <> '{}'::jsonb then raise exception 'Unsupported site fields'; end if;
    return bob_private.physical_site_delete_command(p_site,p_expected);
  end if;
  return bob_private.physical_site_command(p_action,p_site,p_expected,p_data);
end $$;

create or replace function bob.physical_building_command(p_action text,p_building uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_action='delete' then
    if p_data is null or p_data <> '{}'::jsonb then raise exception 'Unsupported building fields'; end if;
    return bob_private.physical_building_delete_command(p_building,p_expected);
  end if;
  return bob_private.physical_building_command(p_action,p_building,p_expected,p_data);
end $$;

-- Slice 0 revokes PUBLIC execute from new bob_private functions by default.
-- The exposed bob.* wrappers are security invokers, so authenticated callers
-- need explicit execute on the guarded private implementation they delegate to.
revoke all on function
  bob_private.has_site_access(uuid),
  bob_private.has_building_direct_access(uuid),
  bob_private.has_building_access(uuid),
  bob_private.has_site_context_access(uuid),
  bob_private.physical_actor(),
  bob_private.physical_site_command(text,uuid,integer,jsonb),
  bob_private.physical_building_command(text,uuid,integer,jsonb),
  bob_private.project_scopes_building(text,uuid),
  bob_private.physical_node_command(uuid,text,text,uuid,integer,jsonb),
  bob_private.physical_scope_command(text,text,text,uuid,jsonb),
  bob_private.physical_site_delete_command(uuid,integer),
  bob_private.physical_building_delete_command(uuid,integer)
from public,anon,authenticated;

grant execute on function
  bob_private.has_site_access(uuid),
  bob_private.has_building_direct_access(uuid),
  bob_private.has_building_access(uuid),
  bob_private.has_site_context_access(uuid),
  bob_private.physical_actor(),
  bob_private.physical_site_command(text,uuid,integer,jsonb),
  bob_private.physical_building_command(text,uuid,integer,jsonb),
  bob_private.project_scopes_building(text,uuid),
  bob_private.physical_node_command(uuid,text,text,uuid,integer,jsonb),
  bob_private.physical_scope_command(text,text,text,uuid,jsonb),
  bob_private.physical_site_delete_command(uuid,integer),
  bob_private.physical_building_delete_command(uuid,integer)
to authenticated;

notify pgrst, 'reload schema';
commit;
