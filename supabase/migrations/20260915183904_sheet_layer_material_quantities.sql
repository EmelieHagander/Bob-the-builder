-- CLI scaffold: 20260915183904_sheet_layer_material_quantities.sql.
-- One revision-pinned sheet layer extends the existing material requirement, not a new BOM.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table bob.material_requirement_revisions add column sheet_layer jsonb;
alter table bob.material_requirement_revisions add constraint sheet_layer_method_shape check (
  (sheet_layer is null and method_key <> 'stud_wall_sheet_layer')
  or (sheet_layer is not null and jsonb_typeof(sheet_layer) = 'object'
    and method_key = 'stud_wall_sheet_layer' and method_version = '1'
    and source_kind = 'deterministic' and unit = 'm2')
);

-- Preserve the deployed view column prefix. New recipe metadata is appended after
-- the existing staleness columns; adding a table column must not shift that prefix.
create or replace view bob.current_material_requirements with(security_invoker=true) as
select h.id,
  r.requirement_id,r.project_id,r.revision,r.name,r.category,r.area_id,r.area_title,
  r.task_id,r.task_title,r.unit,r.required_quantity,r.waste_percent,r.purchase_increment,
  r.required_with_waste,r.stock_quantity,r.component_quantity,r.purchase_quantity,
  r.source_kind,r.method_key,r.method_version,r.basis,r.assumptions,
  r.artifact_id,r.artifact_revision,r.artifact_title,r.target_revision,
  r.solution_id,r.solution_revision,r.solution_title,r.archived,r.change_note,
  r.recorded_by,r.actor_label,r.recorded_at,
  (pt.current_revision is distinct from r.target_revision) as target_changed,
  (r.artifact_id is not null and (
    ah.current_revision is distinct from r.artifact_revision or ar.archived is distinct from false
  )) as artifact_changed,
  exists(
    select 1 from bob.material_requirement_stock rs
    join bob.stock_items sh on sh.id=rs.stock_id and sh.project_id=rs.project_id
    join bob.stock_revisions sr on sr.stock_id=sh.id and sr.revision=sh.current_revision
    where rs.requirement_id=h.id and rs.requirement_revision=h.current_revision
      and (sh.current_revision<>rs.stock_revision or sr.archived or sr.status<>'available')
  ) as stock_changed,
  exists(
    select 1 from bob.material_requirement_components rc
    join bob.existing_components ch on ch.id=rc.component_id and ch.project_id=rc.project_id
    join bob.component_revisions cr on cr.component_id=ch.id and cr.revision=ch.current_revision
    where rc.requirement_id=h.id and rc.requirement_revision=h.current_revision
      and (ch.current_revision<>rc.component_revision or cr.archived or cr.intent<>'reuse' or cr.quantity is null)
  ) as component_changed,
  r.sheet_layer
from bob.material_requirements h
join bob.material_requirement_revisions r
  on r.requirement_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id
left join lateral (
  select p.current_revision from bob.project_targets p
  where p.project_id=h.project_id
    and (p.area_id is not distinct from r.area_id or (r.area_id is not null and p.area_id is null))
  order by case when p.area_id is not distinct from r.area_id then 0 else 1 end
  limit 1
) pt on true
left join bob.artifacts ah on ah.id=r.artifact_id and ah.project_id=h.project_id
left join bob.artifact_revisions ar on ar.artifact_id=ah.id and ar.revision=ah.current_revision;

create or replace function bob_private.material_requirement_geometry_command(
  p_project text, p_action text, p_requirement uuid, p_expected integer, p_data jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  allowed text[];
  v_artifact_id uuid;
  v_artifact_revision integer;
  artifact_title text;
  artifact_status text;
  artifact_area text;
  v_area text;
  v_task text;
  task_area text;
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
  layer_input jsonb;
  layer_snapshot jsonb;
  layers integer := 1;
  coverage_kind text;
  coverage_truth text;
  coverage_source text;
  sheet_width numeric;
  sheet_height numeric;
  coverage numeric;
  v_method text := 'stud_wall_net_area';
  v_version text := '4B2b-v1';
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_requirement is null or p_action is null or p_action not in ('create','revise')
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>30000 then
    raise exception 'Invalid deterministic material requirement command';
  end if;
  allowed := array['name','category','area_id','task_id','waste_percent','assumptions',
    'artifact_id','artifact_revision','target_revision','stock_allocations'];
  if p_action='revise' then allowed := allowed || array['change_note']; end if;
  if p_data ? 'sheet_layer' then
    allowed := allowed || array['sheet_layer'];
    layer_input := p_data->'sheet_layer';
    if jsonb_typeof(layer_input) is distinct from 'object' then
      raise exception 'Supply an explicit sheet layer coverage basis';
    end if;
    coverage_kind := layer_input->>'coverage_kind';
    coverage_truth := layer_input->>'coverage_truth';
    coverage_source := btrim(layer_input->>'coverage_source');
    if coverage_kind is null or coverage_kind not in ('sheet_dimensions','pack_coverage')
      or coverage_truth is null or coverage_truth not in ('provided_spec','measured','estimated')
      or jsonb_typeof(layer_input->'coverage_source') is distinct from 'string'
      or char_length(coverage_source) not between 1 and 1000
      or coalesce(layer_input->>'layer_count','') !~ '^[0-9]{1,2}$' then
      raise exception 'Sheet layers require a whole layer count, coverage type, certainty and source';
    end if;
    layers := (layer_input->>'layer_count')::integer;
    if layers not between 1 and 20 then raise exception 'Use between 1 and 20 layers'; end if;
    if coverage_kind='sheet_dimensions' then
      if layer_input-array['layer_count','coverage_kind','coverage_truth','coverage_source','sheet_width_mm','sheet_height_mm']<>'{}'::jsonb
        or coalesce(layer_input->>'sheet_width_mm','') !~ '^[0-9]{1,5}$'
        or coalesce(layer_input->>'sheet_height_mm','') !~ '^[0-9]{1,5}$' then
        raise exception 'Supply only whole sheet dimensions in mm, not pack coverage or derived values';
      end if;
      sheet_width := (layer_input->>'sheet_width_mm')::numeric;
      sheet_height := (layer_input->>'sheet_height_mm')::numeric;
      if sheet_width not between 1 and 20000 or sheet_height not between 1 and 20000 then
        raise exception 'Sheet dimensions must be between 1 and 20000 mm';
      end if;
      coverage := sheet_width * sheet_height / 1000000;
    else
      if layer_input-array['layer_count','coverage_kind','coverage_truth','coverage_source','pack_coverage_m2']<>'{}'::jsonb
        or coalesce(layer_input->>'pack_coverage_m2','') !~ '^[0-9]{1,9}(\.[0-9]{1,4})?$' then
        raise exception 'Supply only declared pack coverage in m2 with at most four decimal places';
      end if;
      coverage := (layer_input->>'pack_coverage_m2')::numeric;
    end if;
    if coverage<=0 or coverage>1000000000 or coverage<>trunc(coverage,4) then
      raise exception 'Coverage must be positive and exactly representable at 0.0001 m2 precision; it is never rounded up';
    end if;
    v_method := 'stud_wall_sheet_layer';
    v_version := '1';
  else
    allowed := allowed || array['purchase_increment'];
  end if;
  if p_data-allowed<>'{}'::jsonb then
    raise exception 'Unsupported deterministic material fields. Quantity, unit, basis, source, method and sheet purchase increment are derived by the server.';
  end if;

  -- Serialize source validation with other project target/drawing commands.
  perform 1 from bob.projects where id=p_project for no key update;
  v_artifact_id := nullif(p_data->>'artifact_id','')::uuid;
  v_artifact_revision := nullif(p_data->>'artifact_revision','')::integer;
  if v_artifact_id is null or v_artifact_revision is null then
    raise exception 'Choose a current generated drawing before calculating material quantity';
  end if;
  select ar.title,ar.status,ah.area_id into artifact_title,artifact_status,artifact_area
  from bob.artifacts ah
  join bob.artifact_revisions ar on ar.artifact_id=ah.id and ar.revision=ah.current_revision
  join bob.artifact_generations g
    on g.artifact_id=ar.artifact_id and g.artifact_revision=ar.revision and g.project_id=ar.project_id
  where ah.id=v_artifact_id and ah.project_id=p_project and ah.current_revision=v_artifact_revision
    and not ar.archived and g.generator='stud_wall_opening_v1' and g.generator_version=1;
  if not found then
    raise exception 'A current stud_wall_opening_v1 drawing version is required for this calculation';
  end if;
  if layer_input is not null then
    v_area := nullif(p_data->>'area_id','');
    v_task := nullif(p_data->>'task_id','');
    if v_task is not null then
      select t.area_id into task_area from bob.tasks t join bob.areas a on a.id=t.area_id
        where t.id=v_task and a.project_id=p_project;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
      if v_area is not null and v_area is distinct from task_area then
        raise exception 'The material requirement must use its task area.';
      end if;
      v_area := task_area;
    end if;
    if artifact_area is distinct from v_area then
      raise exception 'The sheet layer must use a drawing in the same Project/Area scope';
    end if;
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
  net_area_m2 := ((wall_width_mm*wall_height_mm)-(opening_width_mm*opening_height_mm))/1000000;
  if net_area_m2<=0 then raise exception 'The generated drawing does not contain a positive net wall area'; end if;
  normalized_area_m2 := ceil(net_area_m2*layers*10000)/10000;
  if layer_input is null then
    v_basis := format(
      'Calculated from %s v%s using stud_wall_net_area 4B2b-v1: (%s mm × %s mm − %s mm × %s mm) ÷ 1,000,000 = %s m²; persisted base quantity %s m² after upward normalization to 0.0001 m². Drawing status: %s. Input certainty: %s.',
      artifact_title,v_artifact_revision,wall_width_mm,wall_height_mm,opening_width_mm,opening_height_mm,
      net_area_m2,normalized_area_m2,artifact_status,
      case when has_estimate then 'contains explicit estimate' else 'measured/provided inputs only' end
    );
  else
    layer_snapshot := jsonb_build_object(
      'layer_count',layers,'coverage_kind',coverage_kind,'coverage_truth',coverage_truth,'coverage_source',coverage_source,
      'sheet_width_mm',sheet_width::text,'sheet_height_mm',sheet_height::text,
      'pack_coverage_m2',case when coverage_kind='pack_coverage' then trim_scale(coverage)::text else null end,
      'unit_coverage_m2',trim_scale(coverage)::text,'net_wall_area_m2',trim_scale(net_area_m2)::text
    );
    v_basis := format(
      'Calculated from %s v%s using stud_wall_sheet_layer v1: (%s mm × %s mm − %s mm × %s mm) ÷ 1,000,000 = %s m² net wall area × %s layers = %s m²; persisted base %s m² after upward normalization to 0.0001 m². Coverage: %s m² per %s. Apply allowance once, subtract compatible confirmed m² stock, then round the shortfall to whole purchase units. Drawing status: %s. Input certainty: %s. Product input: %s; source: %s. AREA-BASED ONLY: not a cut/layout plan or product/structural suitability approval. Openings, offcuts, orientation and joints may require additional material.',
      artifact_title,v_artifact_revision,wall_width_mm,wall_height_mm,opening_width_mm,opening_height_mm,
      trim_scale(net_area_m2),layers,trim_scale(net_area_m2*layers),normalized_area_m2,trim_scale(coverage),
      case when coverage_kind='sheet_dimensions' then 'sheet' else 'pack' end,artifact_status,
      case when has_estimate or coverage_truth='estimated' then 'contains explicit estimate' else 'measured/provided inputs only' end,
      coverage_truth,coverage_source
    );
  end if;
  payload := (p_data-'sheet_layer') || jsonb_build_object(
    'unit','m2','required_quantity',normalized_area_m2::text,'basis',v_basis,'component_allocations','[]'::jsonb
  );
  if layer_input is not null then payload := payload || jsonb_build_object('purchase_increment',coverage::text); end if;
  saved := bob_private.material_requirement_command(p_project,p_action,p_requirement,p_expected,payload);
  saved_revision := (saved->>'revision')::integer;
  update bob.material_requirement_revisions
    set source_kind='deterministic',method_key=v_method,method_version=v_version,basis=v_basis,sheet_layer=layer_snapshot
    where project_id=p_project and requirement_id=p_requirement and revision=saved_revision;
  if not found then raise exception 'Calculated material requirement was not persisted'; end if;
  return saved;
end $$;
revoke all on function bob_private.material_requirement_geometry_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob_private.material_requirement_geometry_command(text,text,uuid,integer,jsonb) to authenticated;

-- This trigger runs only inside the existing explicit Shopping handoff. It changes
-- presentation and its sync snapshot together, not canonical quantity or delivery state.
create function bob_private.sheet_layer_shopping_quantity() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  requirement bob.material_requirement_revisions;
  count_units numeric;
  label text;
  quantity_text text;
begin
  -- The existing FK sets material_id to null when a Shopping item is deleted.
  -- Preserve that missing-item state and let a later explicit publish recreate it.
  if new.material_id is null then return new; end if;
  select * into requirement from bob.material_requirement_revisions
    where project_id=new.project_id and requirement_id=new.requirement_id and revision=new.synced_requirement_revision;
  if not found or requirement.method_key<>'stud_wall_sheet_layer' then return new; end if;
  if requirement.sheet_layer is null or requirement.purchase_increment<=0
    or mod(requirement.purchase_quantity,requirement.purchase_increment)<>0 then
    raise exception 'Sheet purchase units are inconsistent';
  end if;
  count_units := requirement.purchase_quantity/requirement.purchase_increment;
  label := case requirement.sheet_layer->>'coverage_kind' when 'sheet_dimensions' then 'sheet' else 'pack' end;
  quantity_text := trim_scale(count_units)::text || ' ' || label ||
    case when count_units=1 then '' else 's' end || ' (' || trim_scale(requirement.purchase_quantity)::text || ' m²)';
  update bob.materials set qty=quantity_text
    where id=new.material_id and project_id=new.project_id;
  if not found then raise exception 'Sheet layer Shopping item unavailable'; end if;
  new.synced_qty := quantity_text;
  return new;
end $$;
revoke all on function bob_private.sheet_layer_shopping_quantity() from public,anon,authenticated;
create trigger sheet_layer_shopping_quantity before insert or update on bob.material_requirement_shopping
  for each row execute function bob_private.sheet_layer_shopping_quantity();

notify pgrst,'reload schema';
commit;
