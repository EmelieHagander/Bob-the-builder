-- Manual foundation 2C. Contract: Docs/building-model.md.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Persistent place identity is deliberately independent of bob.projects.
create table bob.sites (
  id uuid primary key,
  current_revision integer not null default 1 check (current_revision > 0),
  unique(id, current_revision)
);
create table bob.site_members (
  site_id uuid not null references bob.sites(id) on delete cascade,
  auth_user_id uuid not null,
  member_label text not null default 'Member' check (char_length(member_label) between 1 and 120),
  created_at timestamptz not null default clock_timestamp(),
  primary key(site_id, auth_user_id)
);
create index site_members_user_idx on bob.site_members(auth_user_id, site_id);
create table bob.site_revisions (
  id uuid not null default gen_random_uuid() unique,
  site_id uuid not null references bob.sites(id) on delete cascade,
  revision integer not null check (revision > 0),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  archived boolean not null default false,
  change_note text not null check (char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(site_id, revision)
);
alter table bob.sites add constraint site_current_revision_fk
  foreign key(id, current_revision) references bob.site_revisions(site_id, revision)
  deferrable initially deferred;

create table bob.buildings (
  id uuid primary key,
  site_id uuid references bob.sites(id) on delete set null,
  current_revision integer not null default 1 check (current_revision > 0),
  unique(id, current_revision),
  unique(id, site_id)
);
create index buildings_site_idx on bob.buildings(site_id);
create table bob.building_members (
  building_id uuid not null references bob.buildings(id) on delete cascade,
  auth_user_id uuid not null,
  member_label text not null default 'Member' check (char_length(member_label) between 1 and 120),
  created_at timestamptz not null default clock_timestamp(),
  primary key(building_id, auth_user_id)
);
create index building_members_user_idx on bob.building_members(auth_user_id, building_id);
create table bob.building_revisions (
  id uuid not null default gen_random_uuid() unique,
  building_id uuid not null references bob.buildings(id) on delete cascade,
  revision integer not null check (revision > 0),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  archived boolean not null default false,
  change_note text not null check (char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(building_id, revision)
);
alter table bob.buildings add constraint building_current_revision_fk
  foreign key(id, current_revision) references bob.building_revisions(building_id, revision)
  deferrable initially deferred;

create table bob.building_levels (
  id uuid not null unique,
  building_id uuid not null references bob.buildings(id) on delete cascade,
  current_revision integer not null default 1 check (current_revision > 0),
  primary key(id, building_id),
  unique(id, current_revision)
);
create index building_levels_building_idx on bob.building_levels(building_id);
create table bob.level_revisions (
  id uuid not null default gen_random_uuid() unique,
  level_id uuid not null,
  building_id uuid not null,
  revision integer not null check (revision > 0),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  position integer not null default 0 check (position between -100 and 100),
  notes text not null default '' check (char_length(notes) <= 4000),
  archived boolean not null default false,
  change_note text not null check (char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key(level_id, building_id) references bob.building_levels(id, building_id) on delete cascade,
  primary key(level_id, revision)
);
alter table bob.building_levels add constraint level_current_revision_fk
  foreign key(id, current_revision) references bob.level_revisions(level_id, revision)
  deferrable initially deferred;

-- Spaces, Elements and relationships retain both the newest proposal/history and
-- the accepted/as-is pointer. accepted_revision may be null for a proposed new object.
create table bob.building_spaces (
  id uuid not null unique,
  building_id uuid not null references bob.buildings(id) on delete cascade,
  latest_revision integer not null default 1 check (latest_revision > 0),
  accepted_revision integer check (accepted_revision is null or accepted_revision > 0),
  primary key(id, building_id),
  unique(id, latest_revision)
);
create index building_spaces_building_idx on bob.building_spaces(building_id);
create table bob.space_revisions (
  id uuid not null default gen_random_uuid() unique,
  space_id uuid not null,
  building_id uuid not null,
  revision integer not null check (revision > 0),
  project_id text references bob.projects(id) on delete set null,
  level_id uuid,
  state text not null check (state in ('accepted','proposed')),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  kind text not null default '' check (char_length(kind) <= 80),
  notes text not null default '' check (char_length(notes) <= 4000),
  truth text not null default 'unknown' check (truth in ('measured','provided_spec','estimated','ai_assessment','unknown')),
  source text not null default '' check (char_length(source) <= 2000),
  archived boolean not null default false,
  change_note text not null check (char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (truth='unknown' or char_length(btrim(source)) > 0),
  foreign key(space_id, building_id) references bob.building_spaces(id, building_id) on delete cascade,
  foreign key(level_id, building_id) references bob.building_levels(id, building_id),
  primary key(space_id, revision)
);
alter table bob.building_spaces add constraint space_latest_revision_fk
  foreign key(id, latest_revision) references bob.space_revisions(space_id, revision)
  deferrable initially deferred;
alter table bob.building_spaces add constraint space_accepted_revision_fk
  foreign key(id, accepted_revision) references bob.space_revisions(space_id, revision)
  deferrable initially deferred;
create index space_revisions_building_idx on bob.space_revisions(building_id);
create index space_revisions_project_idx on bob.space_revisions(project_id);
create index space_revisions_level_idx on bob.space_revisions(level_id, building_id);

create table bob.space_measurements (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null,
  building_id uuid not null,
  space_revision integer not null,
  source_project_id text,
  measurement_id uuid not null,
  measurement_revision integer not null,
  subject text not null,
  value numeric,
  unit text not null,
  truth text not null,
  source text not null,
  foreign key(space_id, space_revision) references bob.space_revisions(space_id, revision) on delete cascade,
  foreign key(measurement_id, measurement_revision) references bob.measurement_revisions(measurement_id, revision),
  unique(space_id, space_revision, measurement_id)
);
create index space_measurements_building_idx on bob.space_measurements(building_id, space_id);
create index space_measurements_measurement_idx on bob.space_measurements(measurement_id, measurement_revision);

create table bob.building_elements (
  id uuid not null unique,
  building_id uuid not null references bob.buildings(id) on delete cascade,
  latest_revision integer not null default 1 check (latest_revision > 0),
  accepted_revision integer check (accepted_revision is null or accepted_revision > 0),
  primary key(id, building_id),
  unique(id, latest_revision)
);
create index building_elements_building_idx on bob.building_elements(building_id);
create table bob.element_revisions (
  id uuid not null default gen_random_uuid() unique,
  element_id uuid not null,
  building_id uuid not null,
  revision integer not null check (revision > 0),
  project_id text references bob.projects(id) on delete set null,
  space_id uuid,
  state text not null check (state in ('accepted','proposed')),
  kind text not null check (char_length(btrim(kind)) between 1 and 80),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  truth text not null default 'unknown' check (truth in ('measured','provided_spec','estimated','ai_assessment','unknown')),
  source text not null default '' check (char_length(source) <= 2000),
  archived boolean not null default false,
  change_note text not null check (char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (truth='unknown' or char_length(btrim(source)) > 0),
  foreign key(element_id, building_id) references bob.building_elements(id, building_id) on delete cascade,
  foreign key(space_id, building_id) references bob.building_spaces(id, building_id),
  primary key(element_id, revision)
);
alter table bob.building_elements add constraint element_latest_revision_fk
  foreign key(id, latest_revision) references bob.element_revisions(element_id, revision)
  deferrable initially deferred;
alter table bob.building_elements add constraint element_accepted_revision_fk
  foreign key(id, accepted_revision) references bob.element_revisions(element_id, revision)
  deferrable initially deferred;
create index element_revisions_building_idx on bob.element_revisions(building_id);
create index element_revisions_space_idx on bob.element_revisions(space_id, building_id);
create index element_revisions_project_idx on bob.element_revisions(project_id);

create table bob.spatial_relationships (
  id uuid not null unique,
  building_id uuid not null references bob.buildings(id) on delete cascade,
  subject_space_id uuid not null,
  object_space_id uuid not null,
  latest_revision integer not null default 1 check (latest_revision > 0),
  accepted_revision integer check (accepted_revision is null or accepted_revision > 0),
  check (subject_space_id <> object_space_id),
  foreign key(subject_space_id, building_id) references bob.building_spaces(id, building_id),
  foreign key(object_space_id, building_id) references bob.building_spaces(id, building_id),
  primary key(id, building_id),
  unique(id, latest_revision)
);
create index spatial_relationships_building_idx on bob.spatial_relationships(building_id);
create index spatial_relationships_subject_idx on bob.spatial_relationships(subject_space_id, building_id);
create index spatial_relationships_object_idx on bob.spatial_relationships(object_space_id, building_id);
create table bob.relationship_revisions (
  id uuid not null default gen_random_uuid() unique,
  relationship_id uuid not null,
  building_id uuid not null,
  revision integer not null check (revision > 0),
  project_id text references bob.projects(id) on delete set null,
  state text not null check (state in ('accepted','proposed')),
  relation text not null check (relation in ('adjacent_to','shares_boundary_with','connects_to','above','below','attached_to')),
  truth text not null default 'unknown' check (truth in ('measured','provided_spec','estimated','ai_assessment','unknown')),
  source text not null default '' check (char_length(source) <= 2000),
  notes text not null default '' check (char_length(notes) <= 4000),
  archived boolean not null default false,
  change_note text not null check (char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (truth='unknown' or char_length(btrim(source)) > 0),
  foreign key(relationship_id, building_id) references bob.spatial_relationships(id, building_id) on delete cascade,
  primary key(relationship_id, revision)
);
alter table bob.spatial_relationships add constraint relationship_latest_revision_fk
  foreign key(id, latest_revision) references bob.relationship_revisions(relationship_id, revision)
  deferrable initially deferred;
alter table bob.spatial_relationships add constraint relationship_accepted_revision_fk
  foreign key(id, accepted_revision) references bob.relationship_revisions(relationship_id, revision)
  deferrable initially deferred;
create index relationship_revisions_building_idx on bob.relationship_revisions(building_id);
create index relationship_revisions_project_idx on bob.relationship_revisions(project_id);

create table bob.project_physical_scope (
  id uuid primary key,
  project_id text not null references bob.projects(id) on delete cascade,
  target_kind text not null check (target_kind in ('site','building','space','element')),
  site_id uuid references bob.sites(id) on delete cascade,
  building_id uuid references bob.buildings(id) on delete cascade,
  space_id uuid references bob.building_spaces(id) on delete cascade,
  element_id uuid references bob.building_elements(id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (target_kind='site' and site_id is not null and building_id is null and space_id is null and element_id is null) or
    (target_kind='building' and site_id is null and building_id is not null and space_id is null and element_id is null) or
    (target_kind='space' and site_id is null and building_id is not null and space_id is not null and element_id is null) or
    (target_kind='element' and site_id is null and building_id is not null and space_id is null and element_id is not null)
  ),
  unique(project_id, target_kind, site_id, building_id, space_id, element_id)
);
create index project_physical_scope_project_idx on bob.project_physical_scope(project_id);
create index project_physical_scope_site_idx on bob.project_physical_scope(site_id);
create index project_physical_scope_building_idx on bob.project_physical_scope(building_id);
create index project_physical_scope_space_idx on bob.project_physical_scope(space_id);
create index project_physical_scope_element_idx on bob.project_physical_scope(element_id);

create table bob.area_physical_targets (
  id uuid primary key,
  project_id text not null references bob.projects(id) on delete cascade,
  area_id text not null references bob.areas(id) on delete cascade,
  target_kind text not null check (target_kind in ('building','space','element')),
  building_id uuid not null references bob.buildings(id) on delete cascade,
  space_id uuid references bob.building_spaces(id) on delete cascade,
  element_id uuid references bob.building_elements(id) on delete cascade,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (target_kind='building' and space_id is null and element_id is null) or
    (target_kind='space' and space_id is not null and element_id is null) or
    (target_kind='element' and space_id is null and element_id is not null)
  ),
  unique(area_id, target_kind, building_id, space_id, element_id)
);
create index area_physical_targets_project_idx on bob.area_physical_targets(project_id);
create index area_physical_targets_area_idx on bob.area_physical_targets(area_id);
create index area_physical_targets_building_idx on bob.area_physical_targets(building_id);

-- Persistent-context access helpers. Definer functions never trust client search_path.
create function bob_private.has_site_access(p_site uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from bob.site_members m where m.site_id=p_site and m.auth_user_id=auth.uid()
  )
$$;

create function bob_private.has_building_direct_access(p_building uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from bob.building_members m where m.building_id=p_building and m.auth_user_id=auth.uid()
  )
$$;

create function bob_private.has_building_access(p_building uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (
    bob_private.has_building_direct_access(p_building) or exists(
      select 1
      from bob.project_physical_scope s
      join bob.buildings b on b.id=p_building
      where bob_private.has_project_access(s.project_id)
        and (
          s.building_id=p_building or
          (s.target_kind='site' and s.site_id=b.site_id)
        )
    )
  )
$$;

create function bob_private.has_site_context_access(p_site uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (
    bob_private.has_site_access(p_site) or exists(
      select 1 from bob.buildings b where b.site_id=p_site and bob_private.has_building_access(b.id)
    ) or exists(
      select 1 from bob.project_physical_scope s
      where s.site_id=p_site and bob_private.has_project_access(s.project_id)
    )
  )
$$;

-- RLS/read surface. Normal clients receive SELECT only; commands own mutation.
do $$ declare t text; begin
  foreach t in array array[
    'sites','site_members','site_revisions','buildings','building_members','building_revisions',
    'building_levels','level_revisions','building_spaces','space_revisions','space_measurements',
    'building_elements','element_revisions','spatial_relationships','relationship_revisions',
    'project_physical_scope','area_physical_targets'
  ] loop
    execute format('alter table bob.%I enable row level security',t);
    execute format('revoke all on bob.%I from public,anon,authenticated',t);
    execute format('grant select on bob.%I to authenticated',t);
  end loop;
end $$;

create policy site_read on bob.sites for select to authenticated using (bob_private.has_site_context_access(id));
create policy site_member_read on bob.site_members for select to authenticated using (bob_private.has_site_context_access(site_id));
create policy site_revision_read on bob.site_revisions for select to authenticated using (bob_private.has_site_context_access(site_id));
create policy building_read on bob.buildings for select to authenticated using (bob_private.has_building_access(id));
create policy building_member_read on bob.building_members for select to authenticated using (bob_private.has_building_access(building_id));
create policy building_revision_read on bob.building_revisions for select to authenticated using (bob_private.has_building_access(building_id));
create policy level_read on bob.building_levels for select to authenticated using (bob_private.has_building_access(building_id));
create policy level_revision_read on bob.level_revisions for select to authenticated using (bob_private.has_building_access(building_id));
create policy space_read on bob.building_spaces for select to authenticated using (bob_private.has_building_access(building_id));
create policy space_revision_read on bob.space_revisions for select to authenticated using (bob_private.has_building_access(building_id));
create policy space_measurement_read on bob.space_measurements for select to authenticated using (bob_private.has_building_access(building_id));
create policy element_read on bob.building_elements for select to authenticated using (bob_private.has_building_access(building_id));
create policy element_revision_read on bob.element_revisions for select to authenticated using (bob_private.has_building_access(building_id));
create policy relationship_read on bob.spatial_relationships for select to authenticated using (bob_private.has_building_access(building_id));
create policy relationship_revision_read on bob.relationship_revisions for select to authenticated using (bob_private.has_building_access(building_id));
create policy project_scope_read on bob.project_physical_scope for select to authenticated using (bob_private.has_project_access(project_id));
create policy area_target_read on bob.area_physical_targets for select to authenticated using (bob_private.has_project_access(project_id));

-- Current accepted physical truth. A pending proposal never changes these views.
create view bob.current_sites with (security_invoker=true) as
select s.id,r.revision,r.name,r.notes,r.archived,r.change_note,r.recorded_by,r.actor_label,r.recorded_at
from bob.sites s join bob.site_revisions r on r.site_id=s.id and r.revision=s.current_revision;
create view bob.current_buildings with (security_invoker=true) as
select b.id,b.site_id,r.revision,r.name,r.notes,r.archived,r.change_note,r.recorded_by,r.actor_label,r.recorded_at
from bob.buildings b join bob.building_revisions r on r.building_id=b.id and r.revision=b.current_revision;
create view bob.current_levels with (security_invoker=true) as
select l.id,l.building_id,r.revision,r.name,r.position,r.notes,r.archived,r.change_note,r.recorded_by,r.actor_label,r.recorded_at
from bob.building_levels l join bob.level_revisions r on r.level_id=l.id and r.revision=l.current_revision;
create view bob.current_spaces with (security_invoker=true) as
select s.id,s.building_id,r.revision,r.project_id,r.level_id,r.name,r.kind,r.notes,r.truth,r.source,r.archived,
  s.latest_revision,(s.latest_revision<>s.accepted_revision) as has_proposal,r.change_note,r.recorded_by,r.actor_label,r.recorded_at
from bob.building_spaces s join bob.space_revisions r on r.space_id=s.id and r.revision=s.accepted_revision;
create view bob.current_elements with (security_invoker=true) as
select e.id,e.building_id,r.revision,r.project_id,r.space_id,r.kind,r.name,r.description,r.truth,r.source,r.archived,
  e.latest_revision,(e.latest_revision<>e.accepted_revision) as has_proposal,r.change_note,r.recorded_by,r.actor_label,r.recorded_at
from bob.building_elements e join bob.element_revisions r on r.element_id=e.id and r.revision=e.accepted_revision;
create view bob.current_relationships with (security_invoker=true) as
select x.id,x.building_id,x.subject_space_id,x.object_space_id,r.revision,r.project_id,r.relation,r.truth,r.source,r.notes,r.archived,
  x.latest_revision,(x.latest_revision<>x.accepted_revision) as has_proposal,r.change_note,r.recorded_by,r.actor_label,r.recorded_at
from bob.spatial_relationships x join bob.relationship_revisions r on r.relationship_id=x.id and r.revision=x.accepted_revision;

create view bob.latest_space_proposals with (security_invoker=true) as
select s.id,s.building_id,r.revision,r.project_id,r.level_id,r.name,r.kind,r.notes,r.truth,r.source,r.archived,
  s.accepted_revision,r.change_note,r.recorded_by,r.actor_label,r.recorded_at
from bob.building_spaces s join bob.space_revisions r on r.space_id=s.id and r.revision=s.latest_revision
where r.state='proposed' and s.latest_revision is distinct from s.accepted_revision;
create view bob.latest_element_proposals with (security_invoker=true) as
select e.id,e.building_id,r.revision,r.project_id,r.space_id,r.kind,r.name,r.description,r.truth,r.source,r.archived,
  e.accepted_revision,r.change_note,r.recorded_by,r.actor_label,r.recorded_at
from bob.building_elements e join bob.element_revisions r on r.element_id=e.id and r.revision=e.latest_revision
where r.state='proposed' and e.latest_revision is distinct from e.accepted_revision;
create view bob.latest_relationship_proposals with (security_invoker=true) as
select x.id,x.building_id,x.subject_space_id,x.object_space_id,r.revision,r.project_id,r.relation,r.truth,r.source,r.notes,r.archived,
  x.accepted_revision,r.change_note,r.recorded_by,r.actor_label,r.recorded_at
from bob.spatial_relationships x join bob.relationship_revisions r on r.relationship_id=x.id and r.revision=x.latest_revision
where r.state='proposed' and x.latest_revision is distinct from x.accepted_revision;

create view bob.space_measurement_details with (security_invoker=true) as
select m.* from bob.space_measurements m;

-- Project-filtered read views prevent a multi-building member from accidentally
-- broadening explicit Project context merely because they can access both buildings.
create view bob.project_buildings with (security_invoker=true) as
select distinct s.project_id,b.*
from bob.project_physical_scope s
join bob.current_buildings b on (
  (s.target_kind='site' and b.site_id=s.site_id) or
  (s.target_kind<>'site' and b.id=s.building_id)
);

create view bob.project_spaces with (security_invoker=true) as
select distinct sc.project_id,sp.*
from bob.project_physical_scope sc
join bob.current_spaces sp on sp.building_id=sc.building_id
where sc.target_kind='building'
union
select distinct sc.project_id,sp.*
from bob.project_physical_scope sc
join bob.buildings b on sc.target_kind='site' and b.site_id=sc.site_id
join bob.current_spaces sp on sp.building_id=b.id
union
select distinct sc.project_id,sp.*
from bob.project_physical_scope sc
join bob.current_spaces sp on sc.target_kind='space' and sp.id=sc.space_id;

create view bob.project_elements with (security_invoker=true) as
select distinct sc.project_id,e.* from bob.project_physical_scope sc join bob.current_elements e on sc.target_kind='building' and e.building_id=sc.building_id
union
select distinct sc.project_id,e.* from bob.project_physical_scope sc join bob.buildings b on sc.target_kind='site' and b.site_id=sc.site_id join bob.current_elements e on e.building_id=b.id
union
select distinct sc.project_id,e.* from bob.project_physical_scope sc join bob.current_elements e on sc.target_kind='space' and e.building_id=sc.building_id and e.space_id=sc.space_id
union
select distinct sc.project_id,e.* from bob.project_physical_scope sc join bob.current_elements e on sc.target_kind='element' and e.id=sc.element_id;

create view bob.project_relationships with (security_invoker=true) as
select distinct sc.project_id,r.* from bob.project_physical_scope sc join bob.current_relationships r on sc.target_kind='building' and r.building_id=sc.building_id
union
select distinct sc.project_id,r.* from bob.project_physical_scope sc join bob.buildings b on sc.target_kind='site' and b.site_id=sc.site_id join bob.current_relationships r on r.building_id=b.id
union
select distinct sc.project_id,r.* from bob.project_physical_scope sc join bob.current_relationships r on sc.target_kind='space' and r.building_id=sc.building_id and (r.subject_space_id=sc.space_id or r.object_space_id=sc.space_id);

revoke all on bob.current_sites,bob.current_buildings,bob.current_levels,bob.current_spaces,bob.current_elements,bob.current_relationships,
  bob.latest_space_proposals,bob.latest_element_proposals,bob.latest_relationship_proposals,bob.space_measurement_details,
  bob.project_buildings,bob.project_spaces,bob.project_elements,bob.project_relationships from public,anon,authenticated;
grant select on bob.current_sites,bob.current_buildings,bob.current_levels,bob.current_spaces,bob.current_elements,bob.current_relationships,
  bob.latest_space_proposals,bob.latest_element_proposals,bob.latest_relationship_proposals,bob.space_measurement_details,
  bob.project_buildings,bob.project_spaces,bob.project_elements,bob.project_relationships to authenticated;

create function bob_private.physical_actor() returns text
language sql stable security definer set search_path='' as $$
  select coalesce((select min(name) from bob.people where auth_user_id=auth.uid()), 'Building member')
$$;

create function bob_private.physical_site_command(p_action text,p_site uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); actor text; head bob.sites; old bob.site_revisions; next_rev integer;
begin
  if uid is null or p_site is null or p_action not in ('create','revise','archive','restore') or p_data is null or jsonb_typeof(p_data)<>'object' then
    raise exception 'Invalid site command';
  end if;
  actor:=bob_private.physical_actor();
  if p_action='create' then
    if p_expected is distinct from 0 or exists(select 1 from bob.sites where id=p_site) then raise exception 'Site changed. Reload before saving.'; end if;
    if p_data - array['name','notes']::text[] <> '{}'::jsonb then raise exception 'Unsupported site fields'; end if;
    insert into bob.sites(id) values(p_site);
    insert into bob.site_members(site_id,auth_user_id,member_label) values(p_site,uid,actor);
    next_rev:=1;
    insert into bob.site_revisions(site_id,revision,name,notes,archived,change_note,recorded_by,actor_label)
      values(p_site,next_rev,btrim(p_data->>'name'),btrim(coalesce(p_data->>'notes','')),false,'Initial site',uid,actor);
  else
    if not bob_private.has_site_access(p_site) then raise exception 'site_denied' using errcode='42501'; end if;
    select * into head from bob.sites where id=p_site for update;
    if not found or p_expected is distinct from head.current_revision then raise exception 'Site changed. Reload before saving.'; end if;
    select * into old from bob.site_revisions where site_id=p_site and revision=head.current_revision;
    if p_action='revise' and p_data - array['name','notes','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported site fields'; end if;
    if p_action in ('archive','restore') and p_data <> '{}'::jsonb then raise exception 'Unsupported site fields'; end if;
    next_rev:=head.current_revision+1;
    insert into bob.site_revisions(site_id,revision,name,notes,archived,change_note,recorded_by,actor_label)
      values(p_site,next_rev,
        case when p_action='revise' then btrim(p_data->>'name') else old.name end,
        case when p_action='revise' then btrim(coalesce(p_data->>'notes','')) else old.notes end,
        case when p_action='archive' then true when p_action='restore' then false else old.archived end,
        case p_action when 'archive' then 'Archived' when 'restore' then 'Restored' else btrim(p_data->>'change_note') end,uid,actor);
    update bob.sites set current_revision=next_rev where id=p_site;
  end if;
  return jsonb_build_object('id',p_site,'revision',next_rev);
end $$;

create function bob_private.physical_building_command(p_action text,p_building uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); actor text; head bob.buildings; old bob.building_revisions; next_rev integer; sid uuid;
begin
  if uid is null or p_building is null or p_action not in ('create','revise','archive','restore') or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid building command'; end if;
  actor:=bob_private.physical_actor();
  if p_action='create' then
    if p_expected is distinct from 0 or exists(select 1 from bob.buildings where id=p_building) then raise exception 'Building changed. Reload before saving.'; end if;
    if p_data - array['site_id','name','notes']::text[] <> '{}'::jsonb then raise exception 'Unsupported building fields'; end if;
    sid:=nullif(p_data->>'site_id','')::uuid;
    if sid is not null and not bob_private.has_site_access(sid) then raise exception 'site_denied' using errcode='42501'; end if;
    insert into bob.buildings(id,site_id) values(p_building,sid);
    insert into bob.building_members(building_id,auth_user_id,member_label) values(p_building,uid,actor);
    next_rev:=1;
    insert into bob.building_revisions(building_id,revision,name,notes,archived,change_note,recorded_by,actor_label)
      values(p_building,next_rev,btrim(p_data->>'name'),btrim(coalesce(p_data->>'notes','')),false,'Initial building',uid,actor);
  else
    if not bob_private.has_building_direct_access(p_building) then raise exception 'building_denied' using errcode='42501'; end if;
    select * into head from bob.buildings where id=p_building for update;
    if not found or p_expected is distinct from head.current_revision then raise exception 'Building changed. Reload before saving.'; end if;
    select * into old from bob.building_revisions where building_id=p_building and revision=head.current_revision;
    if p_action='revise' and p_data - array['name','notes','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported building fields'; end if;
    if p_action in ('archive','restore') and p_data <> '{}'::jsonb then raise exception 'Unsupported building fields'; end if;
    next_rev:=head.current_revision+1;
    insert into bob.building_revisions(building_id,revision,name,notes,archived,change_note,recorded_by,actor_label)
      values(p_building,next_rev,
        case when p_action='revise' then btrim(p_data->>'name') else old.name end,
        case when p_action='revise' then btrim(coalesce(p_data->>'notes','')) else old.notes end,
        case when p_action='archive' then true when p_action='restore' then false else old.archived end,
        case p_action when 'archive' then 'Archived' when 'restore' then 'Restored' else btrim(p_data->>'change_note') end,uid,actor);
    update bob.buildings set current_revision=next_rev where id=p_building;
  end if;
  return jsonb_build_object('id',p_building,'revision',next_rev);
end $$;

create function bob_private.project_scopes_building(p_project text,p_building uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select bob_private.has_project_access(p_project) and exists(
    select 1 from bob.project_physical_scope s join bob.buildings b on b.id=p_building
    where s.project_id=p_project and (s.building_id=p_building or (s.target_kind='site' and s.site_id=b.site_id))
  )
$$;

create function bob_private.physical_node_command(
  p_building uuid,p_kind text,p_action text,p_record uuid,p_expected integer,p_data jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); actor text; next_rev integer; project text; direct boolean;
  level_head bob.building_levels; level_old bob.level_revisions;
  space_head bob.building_spaces; space_old bob.space_revisions; space_new bob.space_revisions;
  element_head bob.building_elements; element_old bob.element_revisions; element_new bob.element_revisions;
  rel_head bob.spatial_relationships; rel_old bob.relationship_revisions; rel_new bob.relationship_revisions;
  measure jsonb; mr bob.measurement_revisions;
begin
  if uid is null or p_building is null or p_record is null or p_kind not in ('level','space','element','relationship')
    or p_action not in ('create','revise','archive','restore','propose','accept')
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>30000 then raise exception 'Invalid physical context command'; end if;
  direct:=bob_private.has_building_direct_access(p_building);
  if not bob_private.has_building_access(p_building) then raise exception 'building_denied' using errcode='42501'; end if;
  actor:=bob_private.physical_actor();

  if p_kind='level' then
    if p_action not in ('create','revise','archive','restore') or not direct then raise exception 'building_denied' using errcode='42501'; end if;
    if p_action='create' then
      if p_expected is distinct from 0 or exists(select 1 from bob.building_levels where id=p_record) then raise exception 'Level changed. Reload before saving.'; end if;
      if p_data - array['name','position','notes']::text[] <> '{}'::jsonb then raise exception 'Unsupported level fields'; end if;
      insert into bob.building_levels(id,building_id) values(p_record,p_building); next_rev:=1;
      insert into bob.level_revisions(level_id,building_id,revision,name,position,notes,archived,change_note,recorded_by,actor_label)
        values(p_record,p_building,1,btrim(p_data->>'name'),coalesce((p_data->>'position')::integer,0),btrim(coalesce(p_data->>'notes','')),false,'Initial level',uid,actor);
    else
      select * into level_head from bob.building_levels where id=p_record and building_id=p_building for update;
      if not found or p_expected is distinct from level_head.current_revision then raise exception 'Level changed. Reload before saving.'; end if;
      select * into level_old from bob.level_revisions where level_id=p_record and revision=level_head.current_revision;
      if p_action='revise' and p_data - array['name','position','notes','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported level fields'; end if;
      if p_action in ('archive','restore') and p_data <> '{}'::jsonb then raise exception 'Unsupported level fields'; end if;
      next_rev:=level_head.current_revision+1;
      insert into bob.level_revisions(level_id,building_id,revision,name,position,notes,archived,change_note,recorded_by,actor_label)
        values(p_record,p_building,next_rev,
          case when p_action='revise' then btrim(p_data->>'name') else level_old.name end,
          case when p_action='revise' then coalesce((p_data->>'position')::integer,0) else level_old.position end,
          case when p_action='revise' then btrim(coalesce(p_data->>'notes','')) else level_old.notes end,
          case when p_action='archive' then true when p_action='restore' then false else level_old.archived end,
          case p_action when 'archive' then 'Archived' when 'restore' then 'Restored' else btrim(p_data->>'change_note') end,uid,actor);
      update bob.building_levels set current_revision=next_rev where id=p_record;
    end if;
    return jsonb_build_object('id',p_record,'revision',next_rev);
  end if;

  project:=nullif(p_data->>'project_id','');
  if p_action='propose' then
    if project is null or not bob_private.project_scopes_building(project,p_building) then raise exception 'project_denied' using errcode='42501'; end if;
  elsif p_action='accept' or p_action in ('create','revise','archive','restore') then
    if not direct then raise exception 'building_denied' using errcode='42501'; end if;
  end if;

  if p_kind='space' then
    if p_action in ('create','propose') and p_expected=0 and not exists(select 1 from bob.building_spaces where id=p_record) then
      insert into bob.building_spaces(id,building_id,latest_revision,accepted_revision)
        values(p_record,p_building,1,case when p_action='create' then 1 else null end);
      next_rev:=1;
      space_new.space_id:=p_record; space_new.building_id:=p_building; space_new.revision:=1;
    else
      select * into space_head from bob.building_spaces where id=p_record and building_id=p_building for update;
      if not found or p_expected is distinct from space_head.latest_revision then raise exception 'Space changed. Reload before saving.'; end if;
      select * into space_old from bob.space_revisions where space_id=p_record and revision=coalesce(space_head.latest_revision,space_head.accepted_revision);
      if p_action='accept' then
        if space_old.state<>'proposed' then raise exception 'No current proposal to accept'; end if;
        next_rev:=space_head.latest_revision+1;
        space_new:=space_old; space_new.id:=gen_random_uuid(); space_new.revision:=next_rev; space_new.state:='accepted';
        space_new.recorded_by:=uid; space_new.actor_label:=actor; space_new.recorded_at:=clock_timestamp(); space_new.change_note:='Accepted proposal';
      else
        next_rev:=space_head.latest_revision+1;
        space_new.space_id:=p_record; space_new.building_id:=p_building; space_new.revision:=next_rev;
      end if;
    end if;
    if p_action<>'accept' then
      if p_action in ('archive','restore') then
        if p_data <> '{}'::jsonb then raise exception 'Unsupported space fields'; end if;
        space_new.project_id:=space_old.project_id; space_new.level_id:=space_old.level_id; space_new.state:='accepted';
        space_new.name:=space_old.name; space_new.kind:=space_old.kind; space_new.notes:=space_old.notes; space_new.truth:=space_old.truth; space_new.source:=space_old.source;
        space_new.archived:=(p_action='archive'); space_new.change_note:=case p_action when 'archive' then 'Archived' else 'Restored' end;
      else
        if p_data - array['project_id','level_id','name','kind','notes','truth','source','measurements','archived','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported space fields'; end if;
        space_new.project_id:=case when p_action='propose' then project else null end;
        space_new.level_id:=nullif(p_data->>'level_id','')::uuid;
        if space_new.level_id is not null and not exists(select 1 from bob.building_levels where id=space_new.level_id and building_id=p_building) then raise exception 'building_denied' using errcode='42501'; end if;
        space_new.state:=case when p_action='propose' then 'proposed' else 'accepted' end;
        space_new.name:=btrim(p_data->>'name'); space_new.kind:=btrim(coalesce(p_data->>'kind','')); space_new.notes:=btrim(coalesce(p_data->>'notes',''));
        space_new.truth:=coalesce(p_data->>'truth','unknown'); space_new.source:=btrim(coalesce(p_data->>'source','')); space_new.archived:=coalesce((p_data->>'archived')::boolean,false);
        space_new.change_note:=case when next_rev=1 then case when p_action='propose' then 'Initial proposal' else 'Initial space' end else btrim(p_data->>'change_note') end;
      end if;
      space_new.recorded_by:=uid; space_new.actor_label:=actor; space_new.recorded_at:=clock_timestamp(); space_new.id:=gen_random_uuid();
    end if;
    insert into bob.space_revisions select space_new.*;
    update bob.building_spaces set latest_revision=next_rev,
      accepted_revision=case when space_new.state='accepted' then next_rev else accepted_revision end where id=p_record;
    if p_action='accept' then
      insert into bob.space_measurements(space_id,building_id,space_revision,source_project_id,measurement_id,measurement_revision,subject,value,unit,truth,source)
      select p_record,p_building,next_rev,m.source_project_id,m.measurement_id,m.measurement_revision,m.subject,m.value,m.unit,m.truth,m.source
      from bob.space_measurements m where m.space_id=p_record and m.space_revision=space_old.revision;
    elsif p_action not in ('archive','restore') and jsonb_typeof(coalesce(p_data->'measurements','[]'::jsonb))='array' then
      for measure in select * from jsonb_array_elements(coalesce(p_data->'measurements','[]'::jsonb)) loop
        select * into mr from bob.measurement_revisions where measurement_id=(measure->>'id')::uuid and revision=(measure->>'revision')::integer;
        if not found or not bob_private.has_project_access(mr.project_id) then raise exception 'Measurement unavailable for this building context' using errcode='42501'; end if;
        insert into bob.space_measurements(space_id,building_id,space_revision,source_project_id,measurement_id,measurement_revision,subject,value,unit,truth,source)
          values(p_record,p_building,next_rev,mr.project_id,mr.measurement_id,mr.revision,mr.subject,mr.value,mr.unit,mr.truth,mr.source);
      end loop;
    elsif p_action in ('archive','restore') then
      insert into bob.space_measurements(space_id,building_id,space_revision,source_project_id,measurement_id,measurement_revision,subject,value,unit,truth,source)
      select p_record,p_building,next_rev,m.source_project_id,m.measurement_id,m.measurement_revision,m.subject,m.value,m.unit,m.truth,m.source
      from bob.space_measurements m where m.space_id=p_record and m.space_revision=space_old.revision;
    end if;
    return jsonb_build_object('id',p_record,'revision',next_rev,'state',space_new.state);
  end if;

  if p_kind='element' then
    if p_action in ('create','propose') and p_expected=0 and not exists(select 1 from bob.building_elements where id=p_record) then
      insert into bob.building_elements(id,building_id,latest_revision,accepted_revision) values(p_record,p_building,1,case when p_action='create' then 1 else null end);
      next_rev:=1; element_new.element_id:=p_record; element_new.building_id:=p_building; element_new.revision:=1;
    else
      select * into element_head from bob.building_elements where id=p_record and building_id=p_building for update;
      if not found or p_expected is distinct from element_head.latest_revision then raise exception 'Element changed. Reload before saving.'; end if;
      select * into element_old from bob.element_revisions where element_id=p_record and revision=element_head.latest_revision;
      if p_action='accept' then
        if element_old.state<>'proposed' then raise exception 'No current proposal to accept'; end if;
        next_rev:=element_head.latest_revision+1; element_new:=element_old; element_new.id:=gen_random_uuid(); element_new.revision:=next_rev; element_new.state:='accepted';
        element_new.recorded_by:=uid;element_new.actor_label:=actor;element_new.recorded_at:=clock_timestamp();element_new.change_note:='Accepted proposal';
      else next_rev:=element_head.latest_revision+1;element_new.element_id:=p_record;element_new.building_id:=p_building;element_new.revision:=next_rev; end if;
    end if;
    if p_action<>'accept' then
      if p_action in ('archive','restore') then
        if p_data <> '{}'::jsonb then raise exception 'Unsupported element fields'; end if;
        element_new.project_id:=element_old.project_id;element_new.space_id:=element_old.space_id;element_new.state:='accepted';element_new.kind:=element_old.kind;element_new.name:=element_old.name;
        element_new.description:=element_old.description;element_new.truth:=element_old.truth;element_new.source:=element_old.source;element_new.archived:=(p_action='archive');
        element_new.change_note:=case p_action when 'archive' then 'Archived' else 'Restored' end;
      else
        if p_data - array['project_id','space_id','kind','name','description','truth','source','archived','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported element fields'; end if;
        element_new.project_id:=case when p_action='propose' then project else null end;element_new.space_id:=nullif(p_data->>'space_id','')::uuid;
        if element_new.space_id is not null and not exists(select 1 from bob.building_spaces where id=element_new.space_id and building_id=p_building) then raise exception 'building_denied' using errcode='42501'; end if;
        element_new.state:=case when p_action='propose' then 'proposed' else 'accepted' end;element_new.kind:=btrim(p_data->>'kind');element_new.name:=btrim(p_data->>'name');
        element_new.description:=btrim(coalesce(p_data->>'description',''));element_new.truth:=coalesce(p_data->>'truth','unknown');element_new.source:=btrim(coalesce(p_data->>'source',''));
        element_new.archived:=coalesce((p_data->>'archived')::boolean,false);element_new.change_note:=case when next_rev=1 then case when p_action='propose' then 'Initial proposal' else 'Initial element' end else btrim(p_data->>'change_note') end;
      end if;
      element_new.recorded_by:=uid;element_new.actor_label:=actor;element_new.recorded_at:=clock_timestamp();element_new.id:=gen_random_uuid();
    end if;
    insert into bob.element_revisions select element_new.*;
    update bob.building_elements set latest_revision=next_rev,accepted_revision=case when element_new.state='accepted' then next_rev else accepted_revision end where id=p_record;
    return jsonb_build_object('id',p_record,'revision',next_rev,'state',element_new.state);
  end if;

  if p_kind='relationship' then
    if p_action in ('create','propose') and p_expected=0 and not exists(select 1 from bob.spatial_relationships where id=p_record) then
      if not exists(select 1 from bob.building_spaces where id=(p_data->>'subject_space_id')::uuid and building_id=p_building)
        or not exists(select 1 from bob.building_spaces where id=(p_data->>'object_space_id')::uuid and building_id=p_building) then raise exception 'building_denied' using errcode='42501'; end if;
      insert into bob.spatial_relationships(id,building_id,subject_space_id,object_space_id,latest_revision,accepted_revision)
        values(p_record,p_building,(p_data->>'subject_space_id')::uuid,(p_data->>'object_space_id')::uuid,1,case when p_action='create' then 1 else null end);
      next_rev:=1;rel_new.relationship_id:=p_record;rel_new.building_id:=p_building;rel_new.revision:=1;
    else
      select * into rel_head from bob.spatial_relationships where id=p_record and building_id=p_building for update;
      if not found or p_expected is distinct from rel_head.latest_revision then raise exception 'Relationship changed. Reload before saving.'; end if;
      select * into rel_old from bob.relationship_revisions where relationship_id=p_record and revision=rel_head.latest_revision;
      if p_action='accept' then
        if rel_old.state<>'proposed' then raise exception 'No current proposal to accept'; end if;
        next_rev:=rel_head.latest_revision+1;rel_new:=rel_old;rel_new.id:=gen_random_uuid();rel_new.revision:=next_rev;rel_new.state:='accepted';
        rel_new.recorded_by:=uid;rel_new.actor_label:=actor;rel_new.recorded_at:=clock_timestamp();rel_new.change_note:='Accepted proposal';
      else next_rev:=rel_head.latest_revision+1;rel_new.relationship_id:=p_record;rel_new.building_id:=p_building;rel_new.revision:=next_rev; end if;
    end if;
    if p_action<>'accept' then
      if p_action in ('archive','restore') then
        if p_data <> '{}'::jsonb then raise exception 'Unsupported relationship fields'; end if;
        rel_new.project_id:=rel_old.project_id;rel_new.state:='accepted';rel_new.relation:=rel_old.relation;rel_new.truth:=rel_old.truth;rel_new.source:=rel_old.source;rel_new.notes:=rel_old.notes;
        rel_new.archived:=(p_action='archive');rel_new.change_note:=case p_action when 'archive' then 'Archived' else 'Restored' end;
      else
        if p_data - array['project_id','subject_space_id','object_space_id','relation','truth','source','notes','archived','change_note']::text[] <> '{}'::jsonb then raise exception 'Unsupported relationship fields'; end if;
        rel_new.project_id:=case when p_action='propose' then project else null end;rel_new.state:=case when p_action='propose' then 'proposed' else 'accepted' end;
        rel_new.relation:=p_data->>'relation';rel_new.truth:=coalesce(p_data->>'truth','unknown');rel_new.source:=btrim(coalesce(p_data->>'source',''));rel_new.notes:=btrim(coalesce(p_data->>'notes',''));
        rel_new.archived:=coalesce((p_data->>'archived')::boolean,false);rel_new.change_note:=case when next_rev=1 then case when p_action='propose' then 'Initial proposal' else 'Initial relationship' end else btrim(p_data->>'change_note') end;
      end if;
      rel_new.recorded_by:=uid;rel_new.actor_label:=actor;rel_new.recorded_at:=clock_timestamp();rel_new.id:=gen_random_uuid();
    end if;
    insert into bob.relationship_revisions select rel_new.*;
    update bob.spatial_relationships set latest_revision=next_rev,accepted_revision=case when rel_new.state='accepted' then next_rev else accepted_revision end where id=p_record;
    return jsonb_build_object('id',p_record,'revision',next_rev,'state',rel_new.state);
  end if;
  raise exception 'Unsupported physical context command';
end $$;

create function bob_private.physical_scope_command(
  p_project text,p_kind text,p_action text,p_record uuid,p_data jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); area text; target text; sid uuid; bid uuid; spid uuid; eid uuid;
begin
  if uid is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_kind not in ('project','area') or p_action not in ('link','unlink') or p_record is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid physical scope command'; end if;
  if p_action='unlink' then
    if p_kind='project' then delete from bob.project_physical_scope where id=p_record and project_id=p_project;
    else delete from bob.area_physical_targets where id=p_record and project_id=p_project; end if;
    return jsonb_build_object('id',p_record,'removed',true);
  end if;
  target:=p_data->>'target_kind';sid:=nullif(p_data->>'site_id','')::uuid;bid:=nullif(p_data->>'building_id','')::uuid;spid:=nullif(p_data->>'space_id','')::uuid;eid:=nullif(p_data->>'element_id','')::uuid;
  if target='site' then
    if p_kind<>'project' or sid is null or not bob_private.has_site_access(sid) then raise exception 'site_denied' using errcode='42501'; end if;
  else
    if bid is null or not bob_private.has_building_direct_access(bid) then raise exception 'building_denied' using errcode='42501'; end if;
    if target='space' and not exists(select 1 from bob.building_spaces where id=spid and building_id=bid) then raise exception 'building_denied' using errcode='42501'; end if;
    if target='element' and not exists(select 1 from bob.building_elements where id=eid and building_id=bid) then raise exception 'building_denied' using errcode='42501'; end if;
  end if;
  if p_kind='project' then
    if p_data - array['target_kind','site_id','building_id','space_id','element_id']::text[] <> '{}'::jsonb then raise exception 'Unsupported scope fields'; end if;
    insert into bob.project_physical_scope(id,project_id,target_kind,site_id,building_id,space_id,element_id,created_by)
      values(p_record,p_project,target,sid,bid,spid,eid,uid);
  else
    if target='site' or p_data - array['area_id','target_kind','building_id','space_id','element_id']::text[] <> '{}'::jsonb then raise exception 'Unsupported area target fields'; end if;
    area:=p_data->>'area_id';
    if not exists(select 1 from bob.areas where id=area and project_id=p_project) then raise exception 'project_denied' using errcode='42501'; end if;
    if not bob_private.project_scopes_building(p_project,bid) then raise exception 'Project must target this building before an Area can map into it'; end if;
    insert into bob.area_physical_targets(id,project_id,area_id,target_kind,building_id,space_id,element_id,created_by)
      values(p_record,p_project,area,target,bid,spid,eid,uid);
  end if;
  return jsonb_build_object('id',p_record,'target_kind',target);
end $$;

-- Public wrappers stay invokers; private definers perform authority checks.
create function bob.physical_site_command(p_action text,p_site uuid,p_expected integer,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.physical_site_command(p_action,p_site,p_expected,p_data) $$;
create function bob.physical_building_command(p_action text,p_building uuid,p_expected integer,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.physical_building_command(p_action,p_building,p_expected,p_data) $$;
create function bob.physical_node_command(p_building uuid,p_kind text,p_action text,p_record uuid,p_expected integer,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.physical_node_command(p_building,p_kind,p_action,p_record,p_expected,p_data) $$;
create function bob.physical_scope_command(p_project text,p_kind text,p_action text,p_record uuid,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.physical_scope_command(p_project,p_kind,p_action,p_record,p_data) $$;

revoke all on function bob.physical_site_command(text,uuid,integer,jsonb),bob.physical_building_command(text,uuid,integer,jsonb),
  bob.physical_node_command(uuid,text,text,uuid,integer,jsonb),bob.physical_scope_command(text,text,text,uuid,jsonb) from public,anon;
grant execute on function bob.physical_site_command(text,uuid,integer,jsonb),bob.physical_building_command(text,uuid,integer,jsonb),
  bob.physical_node_command(uuid,text,text,uuid,integer,jsonb),bob.physical_scope_command(text,text,text,uuid,jsonb) to authenticated;

-- Project deletion discards unaccepted proposals/scopes but preserves accepted physical history.
create function bob_private.clear_project_physical_proposals() returns trigger
language plpgsql security definer set search_path='' as $$
declare r record;
begin
  for r in select s.id,s.accepted_revision from bob.building_spaces s join bob.space_revisions v on v.space_id=s.id and v.revision=s.latest_revision where v.state='proposed' and v.project_id=old.id loop
    if r.accepted_revision is null then delete from bob.building_spaces where id=r.id;
    else update bob.building_spaces set latest_revision=r.accepted_revision where id=r.id; delete from bob.space_revisions where space_id=r.id and state='proposed' and project_id=old.id; end if;
  end loop;
  for r in select e.id,e.accepted_revision from bob.building_elements e join bob.element_revisions v on v.element_id=e.id and v.revision=e.latest_revision where v.state='proposed' and v.project_id=old.id loop
    if r.accepted_revision is null then delete from bob.building_elements where id=r.id;
    else update bob.building_elements set latest_revision=r.accepted_revision where id=r.id; delete from bob.element_revisions where element_id=r.id and state='proposed' and project_id=old.id; end if;
  end loop;
  for r in select x.id,x.accepted_revision from bob.spatial_relationships x join bob.relationship_revisions v on v.relationship_id=x.id and v.revision=x.latest_revision where v.state='proposed' and v.project_id=old.id loop
    if r.accepted_revision is null then delete from bob.spatial_relationships where id=r.id;
    else update bob.spatial_relationships set latest_revision=r.accepted_revision where id=r.id; delete from bob.relationship_revisions where relationship_id=r.id and state='proposed' and project_id=old.id; end if;
  end loop;
  return old;
end $$;
create trigger clear_project_physical_proposals before delete on bob.projects
for each row execute function bob_private.clear_project_physical_proposals();

notify pgrst, 'reload schema';
commit;