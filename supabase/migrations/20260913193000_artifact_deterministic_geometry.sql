-- Slice 4B1: deterministic stud-wall elevation recipes.
-- Contract: Docs/artifacts.md. Geometry is recomputed from pinned recipe inputs;
-- the database preserves provenance/authority and never stores raster output as truth.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table bob.artifact_generations (
  project_id text not null references bob.projects(id) on delete cascade,
  artifact_id uuid not null,
  artifact_revision integer not null,
  generator text not null check (generator in ('stud_wall_opening_v1')),
  generator_version integer not null check (generator_version = 1),
  building_id uuid not null references bob.buildings(id),
  space_id uuid not null,
  space_revision integer not null check (space_revision > 0),
  parameters jsonb not null default '{}'::jsonb,
  primary key(artifact_id, artifact_revision),
  foreign key(artifact_id, artifact_revision) references bob.artifact_revisions(artifact_id, revision) on delete cascade,
  foreign key(space_id, space_revision) references bob.space_revisions(space_id, revision),
  check (jsonb_typeof(parameters) = 'object'),
  check (parameters - array['stud_spacing_mm']::text[] = '{}'::jsonb),
  check ((parameters->>'stud_spacing_mm') ~ '^\d+$'),
  check ((parameters->>'stud_spacing_mm')::integer between 200 and 1200)
);
create index artifact_generations_project_idx on bob.artifact_generations(project_id);
create index artifact_generations_physical_idx on bob.artifact_generations(building_id, space_id, space_revision);

create table bob.artifact_geometry_inputs (
  project_id text not null references bob.projects(id) on delete cascade,
  artifact_id uuid not null,
  artifact_revision integer not null,
  role text not null check (role in (
    'wall_width','wall_height','opening_left','opening_sill_height','opening_width','opening_height'
  )),
  measurement_id uuid not null,
  measurement_revision integer not null check (measurement_revision > 0),
  primary key(artifact_id, artifact_revision, role),
  unique(artifact_id, artifact_revision, measurement_id),
  foreign key(artifact_id, artifact_revision) references bob.artifact_generations(artifact_id, artifact_revision) on delete cascade,
  foreign key(measurement_id, measurement_revision) references bob.measurement_revisions(measurement_id, revision)
);
create index artifact_geometry_inputs_project_idx on bob.artifact_geometry_inputs(project_id);
create index artifact_geometry_inputs_measurement_idx on bob.artifact_geometry_inputs(measurement_id, measurement_revision);

alter table bob.artifact_generations enable row level security;
alter table bob.artifact_geometry_inputs enable row level security;
revoke all on bob.artifact_generations, bob.artifact_geometry_inputs from public,anon,authenticated;
grant select on bob.artifact_generations, bob.artifact_geometry_inputs to authenticated;
create policy project_read on bob.artifact_generations for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.artifact_geometry_inputs for select to authenticated
  using (bob_private.has_project_access(project_id));

-- A generation recipe must always have the complete role set. Deferred checking
-- lets artifact_generation_command replace a carried-forward recipe atomically.
create function bob_private.validate_artifact_generation()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  roles text[] := array['wall_width','wall_height','opening_left','opening_sill_height','opening_width','opening_height'];
  present integer;
begin
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
  return null;
end $$;

create constraint trigger artifact_generation_complete
  after insert or update on bob.artifact_generations
  deferrable initially deferred
  for each row execute function bob_private.validate_artifact_generation();

-- Normal Artifact revisions (including archive/restore) carry a generation recipe
-- forward only when each pinned geometry measurement is also carried forward.
-- A manual revise that removes/replaces one of those refs therefore fails the
-- deferred completeness check and must use artifact_geometry_command instead.
create function bob_private.carry_artifact_generation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into bob.artifact_generations(
    project_id,artifact_id,artifact_revision,generator,generator_version,
    building_id,space_id,space_revision,parameters
  )
  select new.project_id,new.artifact_id,new.artifact_revision,g.generator,g.generator_version,
    g.building_id,g.space_id,g.space_revision,g.parameters
  from bob.artifact_generations g
  where g.artifact_id=new.artifact_id and g.artifact_revision=new.artifact_revision-1
  on conflict do nothing;

  insert into bob.artifact_geometry_inputs(
    project_id,artifact_id,artifact_revision,role,measurement_id,measurement_revision
  )
  select new.project_id,new.artifact_id,new.artifact_revision,i.role,i.measurement_id,i.measurement_revision
  from bob.artifact_geometry_inputs i
  where i.artifact_id=new.artifact_id and i.artifact_revision=new.artifact_revision-1
    and i.measurement_id=new.measurement_id and i.measurement_revision=new.measurement_revision
  on conflict do nothing;
  return new;
end $$;

create trigger carry_artifact_generation
  after insert on bob.artifact_measurements
  for each row execute function bob_private.carry_artifact_generation();

create view bob.artifact_revision_details with (security_invoker=true) as
select r.*,g.generator,g.generator_version
from bob.artifact_revisions r
left join bob.artifact_generations g
  on g.artifact_id=r.artifact_id and g.artifact_revision=r.revision;

create or replace view bob.current_artifacts with (security_invoker=true) as
select h.id,h.area_id,r.*,g.generator,g.generator_version
from bob.artifacts h
join bob.artifact_revisions r
  on r.artifact_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id
left join bob.artifact_generations g
  on g.artifact_id=r.artifact_id and g.artifact_revision=r.revision;

create view bob.artifact_generation_details with (security_invoker=true) as
select g.*,sr.name as space_name,br.name as building_name,
  sp.accepted_revision as current_space_revision,
  (sp.latest_revision is distinct from sp.accepted_revision) as space_has_proposal
from bob.artifact_generations g
join bob.space_revisions sr on sr.space_id=g.space_id and sr.revision=g.space_revision
join bob.building_spaces sp on sp.id=g.space_id and sp.building_id=g.building_id
join bob.buildings b on b.id=g.building_id
join bob.building_revisions br on br.building_id=b.id and br.revision=b.current_revision;

create view bob.artifact_geometry_input_details with (security_invoker=true) as
select i.*,r.subject,r.value::text as value,r.unit,r.truth,r.source,
  h.current_revision as latest_revision,c.archived as currently_archived
from bob.artifact_geometry_inputs i
join bob.measurement_revisions r
  on r.measurement_id=i.measurement_id and r.revision=i.measurement_revision and r.project_id=i.project_id
join bob.measurements h on h.id=i.measurement_id and h.project_id=i.project_id
join bob.measurement_revisions c on c.measurement_id=h.id and c.revision=h.current_revision;

revoke all on bob.artifact_revision_details,bob.current_artifacts,bob.artifact_generation_details,bob.artifact_geometry_input_details
  from public,anon,authenticated;
grant select on bob.artifact_revision_details,bob.current_artifacts,bob.artifact_generation_details,bob.artifact_geometry_input_details
  to authenticated;

create function bob_private.artifact_geometry_command(
  p_project text,
  p_action text,
  p_artifact uuid,
  p_expected integer,
  p_data jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  roles text[] := array['wall_width','wall_height','opening_left','opening_sill_height','opening_width','opening_height'];
  allowed text[];
  role text;
  ref jsonb;
  refs jsonb := '[]'::jsonb;
  inputs jsonb;
  seen uuid[] := array[]::uuid[];
  mid uuid;
  mrev integer;
  m bob.measurement_revisions;
  bid uuid;
  sid uuid;
  srev integer;
  spacing integer;
  has_estimate boolean := false;
  artifact_data jsonb;
  saved jsonb;
  next_rev integer;
  artifact_action text;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_action not in ('create','regenerate') or p_artifact is null or p_data is null or jsonb_typeof(p_data)<>'object'
    or octet_length(p_data::text)>30000 then
    raise exception 'Invalid artifact geometry command';
  end if;

  allowed := case when p_action='create' then
    array['title','description','status','assumptions','source_media_id','target_revision','area_id','building_id','space_id','space_revision','stud_spacing_mm','inputs']
  else
    array['title','description','status','assumptions','source_media_id','target_revision','change_note','building_id','space_id','space_revision','stud_spacing_mm','inputs']
  end;
  if p_data - allowed <> '{}'::jsonb then raise exception 'Unsupported artifact geometry fields'; end if;

  bid := nullif(p_data->>'building_id','')::uuid;
  sid := nullif(p_data->>'space_id','')::uuid;
  srev := nullif(p_data->>'space_revision','')::integer;
  if bid is null or sid is null or srev is null then raise exception 'Choose an accepted project Space before generating geometry'; end if;
  perform 1 from bob.project_spaces
    where project_id=p_project and id=sid and building_id=bid and revision=srev and not archived;
  if not found then raise exception 'Physical Space version unavailable in this project' using errcode='42501'; end if;

  if coalesce(p_data->>'stud_spacing_mm','') !~ '^\d+$' then raise exception 'Stud spacing must be a whole number from 200 to 1200 mm'; end if;
  spacing := (p_data->>'stud_spacing_mm')::integer;
  if spacing < 200 or spacing > 1200 then raise exception 'Stud spacing must be a whole number from 200 to 1200 mm'; end if;

  inputs := p_data->'inputs';
  if inputs is null or jsonb_typeof(inputs)<>'object' or inputs - roles <> '{}'::jsonb
    or exists(select 1 from unnest(roles) r where not (inputs ? r)) then
    raise exception 'Every stud-wall geometry role must be mapped exactly once';
  end if;

  foreach role in array roles loop
    ref := inputs->role;
    if jsonb_typeof(ref)<>'object' or ref - array['id','revision']::text[] <> '{}'::jsonb then
      raise exception 'Invalid geometry measurement reference';
    end if;
    mid := nullif(ref->>'id','')::uuid;
    mrev := nullif(ref->>'revision','')::integer;
    if mid is null or mrev is null then raise exception 'Invalid geometry measurement reference'; end if;
    if mid = any(seen) then raise exception 'Use a distinct measurement record for each geometry role'; end if;
    seen := array_append(seen,mid);
    select * into m from bob.measurement_revisions
      where measurement_id=mid and revision=mrev and project_id=p_project;
    if not found then raise exception 'Geometry measurement version unavailable in this project'; end if;
    if m.value is null or m.truth='unknown' then raise exception 'Unknown measurements cannot generate geometry'; end if;
    if m.truth='estimated' then has_estimate := true; end if;
    refs := refs || jsonb_build_array(jsonb_build_object('id',mid,'revision',mrev));
  end loop;

  if has_estimate and p_data->>'status' <> 'concept' then
    raise exception 'Estimated geometry must stay Concept until those dimensions are verified';
  end if;
  if p_data->>'status' not in ('concept','measured','build_ready') then raise exception 'Invalid drawing status'; end if;

  artifact_data := jsonb_build_object(
    'title',p_data->>'title',
    'description',p_data->>'description',
    'kind','elevation',
    'status',p_data->>'status',
    'assumptions',coalesce(p_data->>'assumptions',''),
    'source_media_id',p_data->'source_media_id',
    'target_revision',(p_data->>'target_revision')::integer,
    'measurements',refs
  );
  if p_action='create' then
    artifact_action := 'create';
    artifact_data := artifact_data || jsonb_build_object('area_id',p_data->'area_id');
  else
    artifact_action := 'revise';
    artifact_data := artifact_data || jsonb_build_object('change_note',p_data->>'change_note');
  end if;

  saved := bob_private.artifact_command(p_project,artifact_action,p_artifact,p_expected,artifact_data);
  next_rev := (saved->>'revision')::integer;

  -- A prior generated revision may have been carried forward by the measurement
  -- trigger. Regeneration replaces that carried recipe inside this transaction.
  delete from bob.artifact_geometry_inputs where artifact_id=p_artifact and artifact_revision=next_rev;
  delete from bob.artifact_generations where artifact_id=p_artifact and artifact_revision=next_rev;

  insert into bob.artifact_generations(
    project_id,artifact_id,artifact_revision,generator,generator_version,
    building_id,space_id,space_revision,parameters
  ) values(
    p_project,p_artifact,next_rev,'stud_wall_opening_v1',1,
    bid,sid,srev,jsonb_build_object('stud_spacing_mm',spacing)
  );

  foreach role in array roles loop
    ref := inputs->role;
    insert into bob.artifact_geometry_inputs(
      project_id,artifact_id,artifact_revision,role,measurement_id,measurement_revision
    ) values(
      p_project,p_artifact,next_rev,role,(ref->>'id')::uuid,(ref->>'revision')::integer
    );
  end loop;

  return saved;
end $$;

revoke all on function bob_private.artifact_geometry_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
create function bob.artifact_geometry_command(
  p_project text,
  p_action text,
  p_artifact uuid,
  p_expected integer,
  p_data jsonb default '{}'::jsonb
)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.artifact_geometry_command(p_project,p_action,p_artifact,p_expected,p_data)
$$;
revoke all on function bob.artifact_geometry_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob.artifact_geometry_command(text,text,uuid,integer,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
