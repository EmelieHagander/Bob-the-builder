-- Hosted live proof showed PostgreSQL can visit sibling cascades in an order
-- where levels are removed before historical space revisions. Keep the strong
-- FKs and make the guarded Building delete explicit about dependency order.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function bob_private.physical_building_delete_command(p_building uuid,p_expected integer)
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

  -- Delete sibling branches while their referenced parents still exist.
  -- Their own revision/evidence rows cascade from these stable identities.
  delete from bob.spatial_relationships where building_id=p_building;
  delete from bob.building_elements where building_id=p_building;
  delete from bob.building_spaces where building_id=p_building;
  delete from bob.building_levels where building_id=p_building;
  delete from bob.buildings where id=p_building;

  return jsonb_build_object('id',p_building,'removed',true);
end $$;

notify pgrst, 'reload schema';
commit;
