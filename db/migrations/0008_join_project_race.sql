-- ─────────────────────────────────────────────────────────────────────────────
-- bob — migration 0008: serialize concurrent join_project() calls
--
-- Several parts of the UI can ask "who am I" simultaneously right after
-- sign-in; the parallel first-joins raced each other into duplicate-key
-- errors on the volunteer insert. A per-user advisory lock makes the
-- claim-or-join atomic: the first caller does the work, the rest wait and
-- then see the finished membership. Same behaviour as 0005 otherwise.
--
-- Apply with:  psql "$DATABASE_URL" -f db/migrations/0008_join_project_race.sql
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if to_regclass('auth.users') is null then
    raise notice 'bob 0008: no auth schema here (plain Postgres) — nothing to fix';
    return;
  end if;

  create or replace function bob.join_project() returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  declare
    v_uid   uuid := auth.uid();
    v_email text := auth.email();
    v_person bob.people;
    v_project_id text;
    v_name  text;
    v_colors text[] := array['#7E9B52','#5E87A6','#B5675A','#C98B2E','#8A6FA8','#B07F4F','#5E9C68','#C07A4E'];
  begin
    if v_uid is null then
      raise exception 'join_project: not signed in';
    end if;

    -- One join at a time per user: concurrent calls wait here, then find
    -- the membership the first caller created.
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

    -- Already a member?
    select * into v_person from bob.people where auth_user_id = v_uid;
    if found then
      return to_jsonb(v_person);
    end if;

    -- Invited: claim the person row registered under this email.
    select p.* into v_person
    from bob.people p
    join bob.person_emails e on e.person_id = p.id
    where lower(e.email) = lower(coalesce(v_email, ''))
      and p.auth_user_id is null;
    if found then
      update bob.people set auth_user_id = v_uid where id = v_person.id;
      select * into v_person from bob.people where id = v_person.id;
      return to_jsonb(v_person);
    end if;

    -- Unknown email: join as a fresh volunteer.
    select id into v_project_id from bob.projects order by created_at limit 1;
    if v_project_id is null then
      raise exception 'join_project: no project exists yet';
    end if;
    v_name := coalesce(
      nullif(trim(auth.jwt() -> 'user_metadata' ->> 'name'), ''),
      initcap(replace(split_part(coalesce(v_email, 'volunteer'), '@', 1), '.', ' '))
    );
    insert into bob.people (id, project_id, name, initials, color, role, diet, sort_order, auth_user_id)
    values (
      'u_' || substr(replace(v_uid::text, '-', ''), 1, 12),
      v_project_id,
      v_name,
      upper(left(v_name, 2)),
      v_colors[1 + (hashtext(v_uid::text) & 2147483647) % array_length(v_colors, 1)],
      'Volunteer',
      'No restrictions',
      coalesce((select max(sort_order) from bob.people), 0) + 1,
      v_uid
    )
    returning * into v_person;
    return to_jsonb(v_person);
  end
  $fn$;
end $$;

notify pgrst, 'reload schema';
