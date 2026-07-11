-- ─────────────────────────────────────────────────────────────────────────────
-- bob — migration 0001: create the dedicated `bob` schema
--
-- The database is SHARED with other apps, so bob keeps to its own namespace:
--   * every object lives in schema `bob` — nothing is created in `public`
--   * every reference is schema-qualified — no reliance on search_path
--   * enums are owned by the schema, so names can't collide with other apps
--
-- The tables mirror the domain model in src/data/types.ts one-to-one. Several
-- columns are deliberately kept as authored display text (hours '6h',
-- spots '12 / 20', cost '1 920 kr', day 'Lör 5 juli') because that is exactly
-- what the UI consumes today — normalising them into numeric/date columns is
-- future work and can happen without breaking the data-access layer.
--
-- Apply with:  psql "$DATABASE_URL" -f db/migrations/0001_create_bob_schema.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create schema if not exists bob;

comment on schema bob is
  'bob — community build coordination app. All app objects live here; the database is shared, do not use public.';

-- ─────────────────────────── ENUMS ───────────────────────────
-- Mirror the union types in src/data/types.ts.

create type bob.theme_name      as enum ('forest', 'dusk', 'birch');
create type bob.skill_level     as enum ('novice', 'intermediate', 'expert');
create type bob.task_status     as enum ('todo', 'doing', 'done', 'blocked');
create type bob.material_status as enum ('needed', 'ordered', 'delivered', 'backorder');
create type bob.event_status    as enum ('going', 'open');

-- ─────────────────────────── updated_at helper ───────────────────────────

create function bob.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ─────────────────────────── PROJECTS ───────────────────────────
-- One row per build project (v1 ships with a single project, Skogsstuga,
-- but everything hangs off project_id so multi-project needs no migration).

create table bob.projects (
  id          text primary key,
  slug        text not null unique,
  name        text not null,
  description text not null default '',
  location    text not null default '',
  type        text not null default '',
  theme       bob.theme_name not null default 'birch',
  start_label text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────── PEOPLE ───────────────────────────

create table bob.people (
  id         text primary key,
  project_id text not null references bob.projects (id) on delete cascade,
  name       text not null,
  initials   text not null,
  color      text not null default '#7E9B52',
  role       text not null default 'Volunteer',
  diet       text not null default 'No restrictions',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index people_project_idx on bob.people (project_id);

create table bob.person_skills (
  person_id text not null references bob.people (id) on delete cascade,
  name      text not null,
  level     bob.skill_level not null,
  primary key (person_id, name)
);

-- ─────────────────────────── AREAS ───────────────────────────

create table bob.areas (
  id           text primary key,
  project_id   text not null references bob.projects (id) on delete cascade,
  slug         text not null,
  name         text not null,
  description  text not null default '',
  icon         text not null default 'hammer',
  lead_id      text references bob.people (id) on delete set null,
  assigned_pct integer not null default 0 check (assigned_pct between 0 and 100),
  materials_pct integer not null default 0 check (materials_pct between 0 and 100),
  done_pct     integer not null default 0 check (done_pct between 0 and 100),
  task_summary text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, slug)
);

create index areas_project_idx on bob.areas (project_id);

create table bob.area_crew (
  area_id   text not null references bob.areas (id) on delete cascade,
  person_id text not null references bob.people (id) on delete cascade,
  primary key (area_id, person_id)
);

create table bob.area_reference_images (
  id         bigint generated always as identity primary key,
  area_id    text not null references bob.areas (id) on delete cascade,
  label      text not null,
  sort_order integer not null default 0
);

create index area_reference_images_area_idx on bob.area_reference_images (area_id);

-- ─────────────────────────── TASKS ───────────────────────────

create table bob.tasks (
  id         text primary key,
  area_id    text not null references bob.areas (id) on delete cascade,
  name       text not null,
  skill      bob.skill_level not null default 'novice',
  hours      text not null default '',              -- authored, e.g. '6h'
  status     bob.task_status not null default 'todo',
  materials  text not null default '',              -- authored 'x / y' ready fraction
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_area_idx on bob.tasks (area_id);
create index tasks_status_idx on bob.tasks (status);

create table bob.task_assignees (
  task_id   text not null references bob.tasks (id) on delete cascade,
  person_id text not null references bob.people (id) on delete cascade,
  primary key (task_id, person_id)
);

-- ─────────────────────────── MATERIALS ───────────────────────────

create table bob.materials (
  id            text primary key,
  project_id    text not null references bob.projects (id) on delete cascade,
  name          text not null,
  qty           text not null default '',           -- authored, e.g. '48 st'
  area_label    text not null default '',           -- area name or 'Several'
  supplier      text not null default '',
  status        bob.material_status not null default 'needed',
  cost          text not null default '',           -- authored, e.g. '1 920 kr'
  category      text not null default '',
  category_icon text not null default 'package',
  sort_order    integer not null default 0,         -- keeps first-seen category grouping stable
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index materials_project_idx on bob.materials (project_id);
create index materials_status_idx on bob.materials (status);

-- ─────────────────────────── EVENTS ───────────────────────────

create table bob.events (
  id         text primary key,
  project_id text not null references bob.projects (id) on delete cascade,
  slug       text not null,
  title      text not null,
  day        text not null default '',               -- authored, e.g. 'Lör 5 juli'
  time       text not null default '',               -- authored, e.g. '09:00–16:00'
  place      text not null default '',
  spots      text not null default '0 / 0',          -- authored 'taken / capacity'
  status     bob.event_status not null default 'open',
  food       text not null default '',
  sort_order integer not null default 0,             -- soonest first; drives "next build day"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

create index events_project_idx on bob.events (project_id);

create table bob.event_attendees (
  event_id  text not null references bob.events (id) on delete cascade,
  person_id text not null references bob.people (id) on delete cascade,
  primary key (event_id, person_id)
);

-- ─────────────────────────── FOOD ───────────────────────────

create table bob.meals (
  id         text primary key,
  project_id text not null references bob.projects (id) on delete cascade,
  event_id   text references bob.events (id) on delete set null,  -- which build day this plan belongs to
  meal       text not null,                          -- 'Breakfast' / 'Lunch' / …
  time       text not null default '',
  icon       text not null default 'cooking-pot',
  dish       text not null default '',
  notes      text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meals_project_idx on bob.meals (project_id);

-- Columns of the allergy / dietary matrix, in display order.
create table bob.diet_columns (
  id         text primary key,
  project_id text not null references bob.projects (id) on delete cascade,
  name       text not null,
  sort_order integer not null default 0,
  unique (project_id, name)
);

-- Presence of a row = that person has that dietary flag set.
create table bob.diet_flags (
  person_id text not null references bob.people (id) on delete cascade,
  column_id text not null references bob.diet_columns (id) on delete cascade,
  primary key (person_id, column_id)
);

create table bob.food_groups (
  id         text primary key,
  project_id text not null references bob.projects (id) on delete cascade,
  category   text not null,
  icon       text not null default 'basket',
  sort_order integer not null default 0
);

create index food_groups_project_idx on bob.food_groups (project_id);

create table bob.food_items (
  id         bigint generated always as identity primary key,
  group_id   text not null references bob.food_groups (id) on delete cascade,
  name       text not null,
  qty        text not null default '',
  note       text not null default '',
  checked    boolean not null default false,
  sort_order integer not null default 0
);

create index food_items_group_idx on bob.food_items (group_id);

-- ─────────────────────────── COMMUNICATION ───────────────────────────

create table bob.announcements (
  id         text primary key,
  project_id text not null references bob.projects (id) on delete cascade,
  author_id  text references bob.people (id) on delete set null,
  time_label text not null default '',                -- authored, e.g. '2h ago'
  pinned     boolean not null default false,
  text       text not null,
  reacts     integer not null default 0,
  comments   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index announcements_project_idx on bob.announcements (project_id, pinned desc, created_at desc);

-- ─────────────────────────── DERIVED: TODAY BOARD ───────────────────────────
-- The day-of "what needs doing today" view: active (todo/doing) tasks with
-- their area name and assignees, matching the TodayTask shape in types.ts.

create view bob.today_tasks as
select
  t.id,
  a.name as area_name,
  t.name,
  t.skill,
  t.status,
  coalesce(
    (select array_agg(ta.person_id) from bob.task_assignees ta where ta.task_id = t.id),
    '{}'
  ) as assignee_ids
from bob.tasks t
join bob.areas a on a.id = t.area_id
where t.status in ('todo', 'doing');

-- ─────────────────────────── updated_at triggers ───────────────────────────

create trigger set_updated_at before update on bob.projects      for each row execute function bob.set_updated_at();
create trigger set_updated_at before update on bob.people        for each row execute function bob.set_updated_at();
create trigger set_updated_at before update on bob.areas         for each row execute function bob.set_updated_at();
create trigger set_updated_at before update on bob.tasks         for each row execute function bob.set_updated_at();
create trigger set_updated_at before update on bob.materials     for each row execute function bob.set_updated_at();
create trigger set_updated_at before update on bob.events        for each row execute function bob.set_updated_at();
create trigger set_updated_at before update on bob.meals         for each row execute function bob.set_updated_at();
create trigger set_updated_at before update on bob.announcements for each row execute function bob.set_updated_at();

-- ─────────────────────────── ROW LEVEL SECURITY ───────────────────────────
-- The database is shared, so RLS is on from day one. v1 of the app is
-- read-only, so each table gets a public read policy and nothing else —
-- writes stay blocked until proper auth-based policies are added.

do $$
declare t text;
begin
  foreach t in array array[
    'projects', 'people', 'person_skills', 'areas', 'area_crew',
    'area_reference_images', 'tasks', 'task_assignees', 'materials',
    'events', 'event_attendees', 'meals', 'diet_columns', 'diet_flags',
    'food_groups', 'food_items', 'announcements'
  ] loop
    execute format('alter table bob.%I enable row level security', t);
    execute format('create policy read_all on bob.%I for select using (true)', t);
  end loop;
end $$;

-- ─────────────────────────── GRANTS ───────────────────────────
-- On Supabase, expose the schema to the API roles (also add `bob` under
-- API settings → "Exposed schemas"). On a plain shared Postgres, grant the
-- app's role instead. The block is a no-op where the roles don't exist.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant usage on schema bob to anon, authenticated, service_role;
    grant select on all tables in schema bob to anon, authenticated;
    grant all on all tables in schema bob to service_role;
    alter default privileges in schema bob grant select on tables to anon, authenticated;
    alter default privileges in schema bob grant all on tables to service_role;
  end if;
end $$;

commit;
