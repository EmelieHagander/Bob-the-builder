-- ─────────────────────────────────────────────────────────────────────────────
-- bob — migration 0009: write policies for project content
--
-- The app grew its next batch of write features: create areas, add tasks and
-- assign people to them, plan materials (and tick them off the shopping
-- list), create build events and sign up for them, post announcements, and
-- label reference images. Until now those tables were read-only (0001 gave
-- them public SELECT and nothing else).
--
-- Same posture as migration 0006: writes require a SIGNED-IN member
-- (authenticated). Anyone with the link can become one via the sign-in page,
-- so this stays the household-tool posture — writes are gated behind login
-- and carry an identity, not locked to specific roles.
--
-- Apply with:  psql "$DATABASE_URL" -f db/migrations/0009_content_write_policies.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- Content tables the app now writes to. person_emails keeps its deny-all
-- posture, and people are still only created via bob.invite_person() /
-- bob.join_project() (both security definer).
do $$
declare t text;
begin
  foreach t in array array[
    'areas', 'area_crew', 'area_reference_images',
    'tasks', 'task_assignees',
    'materials',
    'events', 'event_attendees',
    'announcements'
  ] loop
    execute format('create policy insert_content on bob.%I for insert to authenticated with check (true)', t);
    execute format('create policy update_content on bob.%I for update to authenticated using (true) with check (true)', t);
    execute format('create policy delete_content on bob.%I for delete to authenticated using (true)', t);
  end loop;
end $$;

-- ─────────────────────────── GRANTS ───────────────────────────
-- Supabase-aware, no-op on a plain Postgres (grant your app role instead).
-- area_reference_images uses an identity column, so inserting also needs
-- usage on its sequence.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant insert, update, delete on
      bob.areas, bob.area_crew, bob.area_reference_images,
      bob.tasks, bob.task_assignees,
      bob.materials,
      bob.events, bob.event_attendees,
      bob.announcements
    to authenticated;
    grant usage, select on all sequences in schema bob to authenticated, service_role;
    alter default privileges in schema bob grant usage, select on sequences to authenticated, service_role;
  end if;
end $$;

commit;

-- PostgREST caches schema + grants — reload so the new writes work immediately.
notify pgrst, 'reload schema';
