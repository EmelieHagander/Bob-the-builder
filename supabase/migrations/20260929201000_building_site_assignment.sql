-- Allow a directly-authorised Building owner to attach an existing standalone
-- Building to a Site (or move it deliberately), while preserving the Building identity.
-- This is needed when a persistent Building predates the Site/address model.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function bob_private.physical_building_command(
  p_action text,
  p_building uuid,
  p_expected integer,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  uid uuid:=auth.uid();
  actor text;
  head bob.buildings;
  old bob.building_revisions;
  next_rev integer;
  sid uuid;
begin
  if uid is null
     or p_building is null
     or p_action not in ('create','revise','archive','restore')
     or p_data is null
     or jsonb_typeof(p_data)<>'object'
  then
    raise exception 'Invalid building command';
  end if;

  actor:=bob_private.physical_actor();

  if p_action='create' then
    if p_expected is distinct from 0
       or exists(select 1 from bob.buildings where id=p_building)
    then
      raise exception 'Building changed. Reload before saving.';
    end if;

    if p_data - array['site_id','name','notes']::text[] <> '{}'::jsonb then
      raise exception 'Unsupported building fields';
    end if;

    sid:=nullif(p_data->>'site_id','')::uuid;
    if sid is not null and not bob_private.has_site_access(sid) then
      raise exception 'site_denied' using errcode='42501';
    end if;

    insert into bob.buildings(id,site_id) values(p_building,sid);
    insert into bob.building_members(building_id,auth_user_id,member_label)
      values(p_building,uid,actor);

    next_rev:=1;
    insert into bob.building_revisions(
      building_id,revision,name,notes,archived,change_note,recorded_by,actor_label
    )
    values(
      p_building,next_rev,btrim(p_data->>'name'),btrim(coalesce(p_data->>'notes','')),
      false,'Initial building',uid,actor
    );
  else
    if not bob_private.can_edit_building(p_building) then
      raise exception 'building_denied' using errcode='42501';
    end if;

    select * into head
    from bob.buildings
    where id=p_building
    for update;

    if not found or p_expected is distinct from head.current_revision then
      raise exception 'Building changed. Reload before saving.';
    end if;

    select * into old
    from bob.building_revisions
    where building_id=p_building
      and revision=head.current_revision;

    if p_action='revise'
       and p_data - array['site_id','name','notes','change_note']::text[] <> '{}'::jsonb
    then
      raise exception 'Unsupported building fields';
    end if;

    if p_action in ('archive','restore') and p_data <> '{}'::jsonb then
      raise exception 'Unsupported building fields';
    end if;

    sid:=head.site_id;
    if p_action='revise' and p_data ? 'site_id' then
      sid:=nullif(p_data->>'site_id','')::uuid;
      if sid is distinct from head.site_id then
        if not bob_private.has_building_direct_access(p_building) then
          raise exception 'building_site_admin_required' using errcode='42501';
        end if;
        if sid is not null and not bob_private.has_site_access(sid) then
          raise exception 'site_denied' using errcode='42501';
        end if;
      end if;
    end if;

    next_rev:=head.current_revision+1;

    insert into bob.building_revisions(
      building_id,revision,name,notes,archived,change_note,recorded_by,actor_label
    )
    values(
      p_building,next_rev,
      case when p_action='revise' and p_data ? 'name'
        then btrim(p_data->>'name') else old.name end,
      case when p_action='revise' and p_data ? 'notes'
        then btrim(coalesce(p_data->>'notes','')) else old.notes end,
      case when p_action='archive' then true
           when p_action='restore' then false
           else old.archived end,
      case p_action
        when 'archive' then 'Archived'
        when 'restore' then 'Restored'
        else coalesce(nullif(btrim(p_data->>'change_note'),''),'Building details updated')
      end,
      uid,actor
    );

    update bob.buildings
      set current_revision=next_rev,
          site_id=sid
      where id=p_building;
  end if;

  return jsonb_build_object('id',p_building,'revision',next_rev,'site_id',sid);
end
$$;

comment on function bob_private.physical_building_command(text,uuid,integer,jsonb) is
  'Revisioned Building command. A site_id change on revise requires direct Building authority plus access to the target Site; ordinary household/project editors cannot move Building identity between Sites.';

commit;
