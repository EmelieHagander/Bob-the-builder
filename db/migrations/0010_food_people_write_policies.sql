-- ─────────────────────────────────────────────────────────────────────────────
-- bob — migration 0010: write policies for food planning and people editing
--
-- The food section grew its write features (plan meals, tick and add food
-- shopping items, flip dietary flags) and people became editable (role, diet,
-- skills, remove from crew). Migration 0009 covered the build-content tables;
-- this brings the remaining ones in line, same signed-in-member posture:
--
--   * meals, food_groups, food_items — meal plan + food shopping list
--   * diet_columns, diet_flags       — the allergy / dietary matrix
--   * people (update/delete), person_skills — the crew editor
--
-- People INSERT stays reserved for the security-definer functions
-- (invite_person / join_project), and person_emails keeps its deny-all
-- posture — invite emails remain unreadable through the API.
--
-- Apply with:  psql "$DATABASE_URL" -f db/migrations/0010_food_people_write_policies.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

do $$
declare t text;
begin
  foreach t in array array['meals', 'food_groups', 'food_items', 'diet_columns', 'diet_flags', 'person_skills'] loop
    execute format('create policy insert_content on bob.%I for insert to authenticated with check (true)', t);
    execute format('create policy update_content on bob.%I for update to authenticated using (true) with check (true)', t);
    execute format('create policy delete_content on bob.%I for delete to authenticated using (true)', t);
  end loop;
end $$;

-- People rows: edit and remove only — creation stays with the definer functions.
create policy update_people on bob.people for update to authenticated using (true) with check (true);
create policy delete_people on bob.people for delete to authenticated using (true);

-- ─────────────────────────── GRANTS ───────────────────────────
-- Supabase-aware, no-op on a plain Postgres (grant your app role instead).
-- Sequence usage (food_items identity) was granted schema-wide in 0009.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant insert, update, delete on
      bob.meals, bob.food_groups, bob.food_items,
      bob.diet_columns, bob.diet_flags, bob.person_skills
    to authenticated;
    grant update, delete on bob.people to authenticated;
  end if;
end $$;

commit;

-- PostgREST caches schema + grants — reload so the new writes work immediately.
notify pgrst, 'reload schema';
