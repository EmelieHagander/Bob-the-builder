-- Slice 4B2b: derive a narrow material base quantity from one persisted 4B1 recipe.
-- Contract: Docs/material-planning.md. This is not a parallel BOM system:
-- the command writes a normal material_requirement revision and reuses the
-- existing 4B2a allowance, stock allocation, purchase rounding and Shopping path.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function bob_private.material_requirement_geometry_command(
  p_project text,
  p_action text,
  p_requirement uuid,
  p_expected integer,
  p_data jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  allowed text[];
  v_artifact_id uuid;
  v_artifact_revision integer;
  artifact_title text;
  artifact_status text;
  wall_width_mm numeric;
  wall_height_mm numeric;
  opening_width_mm numeric;
  opening_height_mm numeric;
  has_estimate boolean;
  net_area_m2 numeric;
  normalized_area_m2 numeric;
  v_basis text;
  payload jsonb;
  saved jsonb;
  saved_revision integer;
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_requirement is null or p_action not in ('create','revise')
    or p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 30000 then
    raise exception 'Invalid deterministic material requirement command';
  end if;

  allowed := case when p_action='create' then
    array['name','category','area_id','task_id','waste_percent','purchase_increment','assumptions',
      'artifact_id','artifact_revision','target_revision','stock_allocations']
  else
    array['name','category','area_id','task_id','waste_percent','purchase_increment','assumptions',
      'artifact_id','artifact_revision','target_revision','stock_allocations','change_note']
  end;
  if p_data - allowed <> '{}'::jsonb then
    raise exception 'Unsupported deterministic material fields. Quantity, unit, basis, source and method are derived by the server.';
  end if;

  v_artifact_id := nullif(p_data->>'artifact_id','')::uuid;
  v_artifact_revision := nullif(p_data->>'artifact_revision','')::integer;
  if v_artifact_id is null or v_artifact_revision is null then
    raise exception 'Choose a current generated drawing before calculating material quantity';
  end if;

  select ar.title,ar.status into artifact_title,artifact_status
  from bob.artifacts ah
  join bob.artifact_revisions ar
    on ar.artifact_id=ah.id and ar.revision=ah.current_revision
  join bob.artifact_generations g
    on g.artifact_id=ar.artifact_id and g.artifact_revision=ar.revision and g.project_id=ar.project_id
  where ah.id=v_artifact_id and ah.project_id=p_project and ah.current_revision=v_artifact_revision
    and not ar.archived and g.generator='stud_wall_opening_v1' and g.generator_version=1;
  if not found then
    raise exception 'A current stud_wall_opening_v1 drawing version is required for this calculation';
  end if;

  select
    max(case when i.role='wall_width' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    max(case when i.role='wall_height' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    max(case when i.role='opening_width' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    max(case when i.role='opening_height' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    bool_or(r.truth='estimated')
  into wall_width_mm,wall_height_mm,opening_width_mm,opening_height_mm,has_estimate
  from bob.artifact_geometry_inputs i
  join bob.measurement_revisions r
    on r.measurement_id=i.measurement_id and r.revision=i.measurement_revision and r.project_id=i.project_id
  where i.project_id=p_project and i.artifact_id=v_artifact_id and i.artifact_revision=v_artifact_revision;

  if wall_width_mm is null or wall_height_mm is null or opening_width_mm is null or opening_height_mm is null then
    raise exception 'The generated drawing is missing required wall/opening geometry inputs';
  end if;
  net_area_m2 := ((wall_width_mm * wall_height_mm) - (opening_width_mm * opening_height_mm)) / 1000000;
  if net_area_m2 <= 0 then raise exception 'The generated drawing does not contain a positive net wall area'; end if;

  -- Material quantities are stored to four decimal places. Rounding upward by at
  -- most 0.0001 m2 avoids silently understating the geometry-derived base need.
  normalized_area_m2 := ceil(net_area_m2 * 10000) / 10000;
  v_basis := format(
    'Calculated from %s v%s using stud_wall_net_area 4B2b-v1: (%s mm × %s mm − %s mm × %s mm) ÷ 1,000,000 = %s m²; persisted base quantity %s m² after upward normalization to 0.0001 m². Drawing status: %s. Input certainty: %s.',
    artifact_title, v_artifact_revision,
    wall_width_mm, wall_height_mm, opening_width_mm, opening_height_mm,
    net_area_m2, normalized_area_m2, artifact_status,
    case when has_estimate then 'contains explicit estimate' else 'measured/provided inputs only' end
  );

  payload := p_data || jsonb_build_object(
    'unit','m2',
    'required_quantity',normalized_area_m2::text,
    'basis',v_basis,
    'component_allocations','[]'::jsonb
  );
  saved := bob_private.material_requirement_command(p_project,p_action,p_requirement,p_expected,payload);
  saved_revision := (saved->>'revision')::integer;

  update bob.material_requirement_revisions
  set source_kind='deterministic',
      method_key='stud_wall_net_area',
      method_version='4B2b-v1',
      basis=v_basis
  where project_id=p_project and requirement_id=p_requirement and revision=saved_revision;
  if not found then raise exception 'Calculated material requirement was not persisted'; end if;

  return saved;
end $$;

revoke all on function bob_private.material_requirement_geometry_command(text,text,uuid,integer,jsonb)
  from public,anon,authenticated;
grant execute on function bob_private.material_requirement_geometry_command(text,text,uuid,integer,jsonb)
  to authenticated;

create function bob.material_requirement_geometry_command(
  p_project text,
  p_action text,
  p_requirement uuid,
  p_expected integer,
  p_data jsonb default '{}'::jsonb
)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.material_requirement_geometry_command(p_project,p_action,p_requirement,p_expected,p_data)
$$;
revoke all on function bob.material_requirement_geometry_command(text,text,uuid,integer,jsonb)
  from public,anon,authenticated;
grant execute on function bob.material_requirement_geometry_command(text,text,uuid,integer,jsonb)
  to authenticated;

notify pgrst,'reload schema';
commit;
