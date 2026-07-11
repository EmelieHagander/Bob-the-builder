-- ─────────────────────────────────────────────────────────────────────────────
-- bob — remove the demo data (the "Skogsstuga" sample project)
--
-- Deletes ONLY the seeded sample content from db/seed.sql, identified by its
-- known ids — real data added since is untouched unless it was attached to the
-- demo project (everything cascades from bob.projects). Safe to re-run.
--
-- ⚠ The app needs at least one row in bob.projects to run in live mode.
--   Edit and uncomment the "YOUR REAL PROJECT" block below (or insert your
--   project some other way) before/right after removing the demo.
--
-- Apply with:  psql "$DATABASE_URL" -f db/remove_demo_data.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

do $$
declare
  demo_people int;
  demo_areas  int;
begin
  select count(*) into demo_people from bob.people where project_id = 'p_skogsstuga';
  select count(*) into demo_areas  from bob.areas  where project_id = 'p_skogsstuga';
  raise notice 'bob demo removal: deleting project p_skogsstuga (% people, % areas, and everything attached)',
    demo_people, demo_areas;
end $$;

-- One delete: people, areas, tasks, materials, events, meals, diet columns,
-- food groups/items and announcements all cascade from the project row.
delete from bob.projects where id = 'p_skogsstuga';

-- Local-verification sentinel, in case it was ever seeded anywhere real.
delete from bob.people where id = 'zz';

-- ───────────────────────── YOUR REAL PROJECT ─────────────────────────
-- Edit the values and uncomment. theme is one of: 'forest' | 'dusk' | 'birch'.
--
-- insert into bob.projects (id, slug, name, description, location, type, theme, start_label)
-- values (
--   'p_myproject',                    -- stable id, used as project_id everywhere
--   'myproject',                      -- url-friendly slug
--   'My project',                     -- display name
--   'What we are building, in a sentence.',
--   'Town, Country',
--   'House extension',                -- free-text project type
--   'birch',
--   'Sat 1 Aug'                       -- start label shown on the dashboard
-- );

commit;
