-- Defence in depth for deterministic geometry. The UI previews with the same
-- rules, but persisted project truth must not rely on UI validation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function bob_private.validate_artifact_generation()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  roles text[] := array['wall_width','wall_height','opening_left','opening_sill_height','opening_width','opening_height'];
  present integer;
  wall_width numeric;
  wall_height numeric;
  opening_left numeric;
  opening_bottom numeric;
  opening_width numeric;
  opening_height numeric;
  has_estimate boolean;
  artifact_status text;
begin
  -- A carried recipe may be deleted/replaced later in the same regeneration
  -- transaction. Only validate the recipe that still exists at commit time.
  if not exists(
    select 1 from bob.artifact_generations g
    where g.artifact_id=new.artifact_id and g.artifact_revision=new.artifact_revision
  ) then return null; end if;

  select count(*) into present from bob.artifact_geometry_inputs i
  where i.artifact_id=new.artifact_id and i.artifact_revision=new.artifact_revision;
  if present <> 6 or exists(
    select 1 from unnest(roles) role
    where not exists(
      select 1 from bob.artifact_geometry_inputs i
      where i.artifact_id=new.artifact_id and i.artifact_revision=new.artifact_revision and i.role=role
    )
  ) then
    raise exception 'Generated drawing inputs changed. Use Regenerate so every geometry role is explicit.';
  end if;

  select
    max(case when i.role='wall_width' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    max(case when i.role='wall_height' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    max(case when i.role='opening_left' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    max(case when i.role='opening_sill_height' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    max(case when i.role='opening_width' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    max(case when i.role='opening_height' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    bool_or(r.truth='estimated')
  into wall_width,wall_height,opening_left,opening_bottom,opening_width,opening_height,has_estimate
  from bob.artifact_geometry_inputs i
  join bob.measurement_revisions r
    on r.measurement_id=i.measurement_id and r.revision=i.measurement_revision and r.project_id=i.project_id
  where i.artifact_id=new.artifact_id and i.artifact_revision=new.artifact_revision;

  if wall_width is null or wall_height is null or opening_left is null or opening_bottom is null
    or opening_width is null or opening_height is null then
    raise exception 'Unknown measurements cannot generate geometry';
  end if;
  if wall_width <= 0 or wall_height <= 0 then raise exception 'Wall width and height must be greater than zero'; end if;
  if opening_width <= 0 or opening_height <= 0 then raise exception 'Opening width and height must be greater than zero'; end if;
  if opening_left < 0 or opening_bottom < 0
    or opening_left + opening_width > wall_width
    or opening_bottom + opening_height > wall_height then
    raise exception 'The opening must fit completely inside the wall dimensions';
  end if;

  select r.status into artifact_status from bob.artifact_revisions r
  where r.artifact_id=new.artifact_id and r.revision=new.artifact_revision;
  if has_estimate and artifact_status <> 'concept' then
    raise exception 'Estimated geometry must stay Concept until those dimensions are verified';
  end if;
  return null;
end $$;

commit;
