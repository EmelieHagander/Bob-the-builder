-- Keep the explicit Shopping handoff separate from requirement revision writes.
-- The 4B2a base command's publish branch remains unreachable through the public
-- wrapper after this migration; this helper owns the deployed publish path.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function bob_private.material_requirement_publish(
  p_project text,
  p_requirement uuid,
  p_expected integer
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  actor text;
  h bob.material_requirements;
  current bob.material_requirement_revisions;
  link bob.material_requirement_shopping;
  qty_text text;
  shopping_area_label text;
  icon text;
  material text;
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_requirement is null or p_expected is null or p_expected < 1 then
    raise exception 'Invalid material requirement publish';
  end if;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  if actor is null then raise exception 'project_denied' using errcode='42501'; end if;

  perform 1 from bob.projects where id=p_project for no key update;
  select * into h from bob.material_requirements
    where id=p_requirement and project_id=p_project for update;
  if not found then raise exception 'Material requirement unavailable'; end if;
  if p_expected is distinct from h.current_revision then
    raise exception 'Material requirement changed. Reload before sending it to Shopping.';
  end if;
  select * into current from bob.material_requirement_revisions
    where requirement_id=p_requirement and project_id=p_project and revision=h.current_revision;
  if not found or current.archived then
    raise exception 'Restore the material requirement before sending it to Shopping.';
  end if;

  perform 1 from bob.project_targets
    where project_id=p_project and current_revision=current.target_revision;
  if not found then
    raise exception 'Project target changed. Review the material requirement before Shopping.';
  end if;
  if current.artifact_id is not null then
    perform 1
    from bob.artifacts ah
    join bob.artifact_revisions ar on ar.artifact_id=ah.id and ar.revision=ah.current_revision
    where ah.id=current.artifact_id and ah.project_id=p_project
      and ah.current_revision=current.artifact_revision and not ar.archived;
    if not found then
      raise exception 'Drawing changed. Review the material requirement before Shopping.';
    end if;
  end if;
  if exists(
    select 1
    from bob.material_requirement_stock rs
    join bob.stock_items sh on sh.id=rs.stock_id and sh.project_id=rs.project_id
    join bob.stock_revisions sr on sr.stock_id=sh.id and sr.revision=sh.current_revision
    where rs.requirement_id=p_requirement and rs.requirement_revision=p_expected
      and (sh.current_revision<>rs.stock_revision or sr.archived or sr.status<>'available')
  ) then
    raise exception 'Stock changed. Review the material requirement before Shopping.';
  end if;
  if exists(
    select 1
    from bob.material_requirement_components rc
    join bob.existing_components ch on ch.id=rc.component_id and ch.project_id=rc.project_id
    join bob.component_revisions cr on cr.component_id=ch.id and cr.revision=ch.current_revision
    where rc.requirement_id=p_requirement and rc.requirement_revision=p_expected
      and (ch.current_revision<>rc.component_revision or cr.archived or cr.intent<>'reuse' or cr.quantity is null)
  ) then
    raise exception 'Reusable component changed. Review the material requirement before Shopping.';
  end if;

  qty_text := (
    case when current.purchase_quantity=0 then '0'
      else regexp_replace(regexp_replace(current.purchase_quantity::text,'0+$',''),'\.$','')
    end
  ) || ' ' || case current.unit
    when 'm2' then 'm²'
    when 'm3' then 'm³'
    else current.unit
  end;
  shopping_area_label := coalesce(nullif(current.area_title,''),'Project');
  icon := case lower(current.category)
    when 'timber' then 'tree'
    when 'fasteners & glue' then 'nut'
    when 'electrical' then 'lightning'
    when 'paint & finish' then 'paint-roller'
    when 'sauna & plumbing' then 'drop'
    when 'tools' then 'wrench'
    else 'package'
  end;

  select * into link from bob.material_requirement_shopping
    where requirement_id=p_requirement for update;
  material := coalesce(link.material_id, 'mr_' || p_requirement::text);
  if link.requirement_id is null or link.material_id is null
    or not exists(select 1 from bob.materials m where m.id=material and m.project_id=p_project) then
    if exists(select 1 from bob.materials m where m.id=material) then
      raise exception 'Shopping identity collision. Reload before trying again.';
    end if;
    insert into bob.materials(
      id,project_id,name,qty,area_label,supplier,status,cost,category,category_icon,sort_order
    ) values(
      material,p_project,current.name,qty_text,shopping_area_label,'','needed','',current.category,icon,
      coalesce((select max(m.sort_order)+1 from bob.materials m where m.project_id=p_project),1)
    );
  else
    update bob.materials m set
      name=current.name,
      qty=qty_text,
      area_label=shopping_area_label,
      category=current.category,
      category_icon=icon,
      updated_at=now()
    where m.id=material and m.project_id=p_project;
  end if;

  insert into bob.material_requirement_shopping(
    requirement_id,project_id,material_id,synced_requirement_revision,
    synced_name,synced_qty,synced_area_label,synced_category,
    recorded_by,actor_label,recorded_at
  ) values(
    p_requirement,p_project,material,p_expected,current.name,qty_text,
    shopping_area_label,current.category,uid,actor,clock_timestamp()
  )
  on conflict(requirement_id) do update set
    material_id=excluded.material_id,
    synced_requirement_revision=excluded.synced_requirement_revision,
    synced_name=excluded.synced_name,
    synced_qty=excluded.synced_qty,
    synced_area_label=excluded.synced_area_label,
    synced_category=excluded.synced_category,
    recorded_by=excluded.recorded_by,
    actor_label=excluded.actor_label,
    recorded_at=excluded.recorded_at;

  return jsonb_build_object('id',p_requirement,'revision',p_expected,'material_id',material);
end $$;

revoke all on function bob_private.material_requirement_publish(text,uuid,integer)
  from public,anon,authenticated;
grant execute on function bob_private.material_requirement_publish(text,uuid,integer)
  to authenticated;

create or replace function bob.material_requirement_command(
  p_project text,
  p_action text,
  p_requirement uuid,
  p_expected integer,
  p_data jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_action='publish' then
    if p_data is null or jsonb_typeof(p_data)<>'object' or p_data<>'{}'::jsonb then
      raise exception 'Shopping publish does not accept client-authored fields.';
    end if;
    return bob_private.material_requirement_publish(p_project,p_requirement,p_expected);
  end if;
  return bob_private.material_requirement_command(p_project,p_action,p_requirement,p_expected,p_data);
end $$;

revoke all on function bob.material_requirement_command(text,text,uuid,integer,jsonb)
  from public,anon,authenticated;
grant execute on function bob.material_requirement_command(text,text,uuid,integer,jsonb)
  to authenticated;

notify pgrst,'reload schema';
commit;
