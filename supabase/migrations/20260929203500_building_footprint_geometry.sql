-- Minimal accepted Building footprint geometry in millimetres.
-- This extends the persistent physical model without misusing project Artifacts as
-- accepted/as-is Building truth. Akr may map the same Building in metres, but Bob's
-- canonical footprint geometry is explicitly mm.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table bob.building_footprints (
  building_id uuid primary key references bob.buildings(id) on delete cascade,
  current_revision integer not null default 1 check (current_revision > 0),
  unique(building_id, current_revision)
);

create table bob.building_footprint_revisions (
  building_id uuid not null references bob.buildings(id) on delete cascade,
  revision integer not null check (revision > 0),
  geometry jsonb not null,
  truth text not null default 'unknown'
    check (truth in ('measured','provided_spec','estimated','ai_assessment','unknown')),
  source text not null default '' check (char_length(source) <= 2000),
  notes text not null default '' check (char_length(notes) <= 4000),
  change_note text not null check (char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(building_id, revision),
  check (jsonb_typeof(geometry)='object'),
  check (geometry->>'units'='mm'),
  check (geometry->>'type'='polygon'),
  check (jsonb_typeof(geometry->'points')='array'),
  check (jsonb_array_length(geometry->'points') >= 3),
  check (truth='unknown' or char_length(btrim(source)) > 0)
);

alter table bob.building_footprints
  add constraint building_footprint_current_revision_fk
  foreign key(building_id,current_revision)
  references bob.building_footprint_revisions(building_id,revision)
  deferrable initially deferred;

alter table bob.building_footprints enable row level security;
alter table bob.building_footprint_revisions enable row level security;
revoke all on bob.building_footprints,bob.building_footprint_revisions from public,anon,authenticated;
grant select on bob.building_footprints,bob.building_footprint_revisions to authenticated;

create policy building_footprint_read on bob.building_footprints
  for select to authenticated
  using (bob_private.has_building_access(building_id));

create policy building_footprint_revision_read on bob.building_footprint_revisions
  for select to authenticated
  using (bob_private.has_building_access(building_id));

create view bob.current_building_footprints
with (security_invoker=true)
as
select
  h.building_id,
  r.revision,
  r.geometry,
  r.truth,
  r.source,
  r.notes,
  r.change_note,
  r.recorded_by,
  r.actor_label,
  r.recorded_at
from bob.building_footprints h
join bob.building_footprint_revisions r
  on r.building_id=h.building_id
 and r.revision=h.current_revision;

revoke all on bob.current_building_footprints from public,anon,authenticated;
grant select on bob.current_building_footprints to authenticated;

create or replace function bob_private.physical_building_footprint_command(
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
  head bob.building_footprints;
  next_rev integer;
  geom jsonb;
  certainty text;
  src text;
  note text;
  change text;
begin
  if uid is null
     or p_building is null
     or p_data is null
     or jsonb_typeof(p_data)<>'object'
     or p_data - array['geometry','truth','source','notes','change_note']::text[] <> '{}'::jsonb
  then
    raise exception 'Invalid Building footprint command';
  end if;

  if not bob_private.can_edit_building(p_building) then
    raise exception 'building_denied' using errcode='42501';
  end if;

  geom:=p_data->'geometry';
  certainty:=coalesce(p_data->>'truth','unknown');
  src:=btrim(coalesce(p_data->>'source',''));
  note:=btrim(coalesce(p_data->>'notes',''));
  change:=coalesce(nullif(btrim(p_data->>'change_note'),''),'Building footprint updated');

  if geom is null
     or jsonb_typeof(geom)<>'object'
     or geom->>'units'<>'mm'
     or geom->>'type'<>'polygon'
     or jsonb_typeof(geom->'points')<>'array'
     or jsonb_array_length(geom->'points')<3
     or certainty not in ('measured','provided_spec','estimated','ai_assessment','unknown')
     or (certainty<>'unknown' and src='')
  then
    raise exception 'Invalid Building footprint geometry';
  end if;

  actor:=bob_private.physical_actor();

  select * into head
  from bob.building_footprints
  where building_id=p_building
  for update;

  if not found then
    if p_expected is distinct from 0 then
      raise exception 'Building footprint changed. Reload before saving.';
    end if;
    insert into bob.building_footprints(building_id,current_revision)
      values(p_building,1);
    next_rev:=1;
  else
    if p_expected is distinct from head.current_revision then
      raise exception 'Building footprint changed. Reload before saving.';
    end if;
    next_rev:=head.current_revision+1;
  end if;

  insert into bob.building_footprint_revisions(
    building_id,revision,geometry,truth,source,notes,change_note,
    recorded_by,actor_label
  )
  values(
    p_building,next_rev,geom,certainty,src,note,change,uid,actor
  );

  update bob.building_footprints
    set current_revision=next_rev
    where building_id=p_building;

  return jsonb_build_object('building_id',p_building,'revision',next_rev);
end
$$;

create or replace function bob.physical_building_footprint_command(
  p_building uuid,
  p_expected integer,
  p_data jsonb
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select bob_private.physical_building_footprint_command(p_building,p_expected,p_data)
$$;

revoke all on function bob.physical_building_footprint_command(uuid,integer,jsonb)
  from public,anon;
grant execute on function bob.physical_building_footprint_command(uuid,integer,jsonb)
  to authenticated;

comment on table bob.building_footprints is
  'Head pointer for accepted Building exterior footprint geometry. Geometry revisions live in millimetres.';
comment on table bob.building_footprint_revisions is
  'Revisioned accepted Building exterior footprint geometry. Project Artifacts remain separate design/output records.';
comment on function bob.physical_building_footprint_command(uuid,integer,jsonb) is
  'Revisioned accepted Building footprint writer. Geometry must be a polygon with units=mm and preserve truth/source provenance.';

commit;
