-- ─────────────────────────────────────────────────────────────────────────────
-- bob — migration 0004: allow creating the FIRST project from the app
--
-- The app shows a "start your project" screen when bob.projects is empty
-- (e.g. right after db/remove_demo_data.sql). The anon key is public, so the
-- insert policy only holds while the table is empty: once a project exists,
-- writes are locked again and the bootstrap window is closed. Everything else
-- stays read-only until real write features (and policies) arrive.
--
-- Apply with:  psql "$DATABASE_URL" -f db/migrations/0004_allow_first_project_insert.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant insert on bob.projects to anon, authenticated;
  end if;
end $$;

create policy insert_first_project on bob.projects
  for insert
  with check (not exists (select 1 from bob.projects));

commit;

-- PostgREST caches grants/policies too — reload so the form works immediately.
notify pgrst, 'reload schema';
