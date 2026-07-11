-- ─────────────────────────────────────────────────────────────────────────────
-- bob — migration 0005: login membership (claim-or-join)
--
-- Links Supabase Auth accounts to bob's own crew list. Note the shared
-- database: auth.users is PROJECT-WIDE (shared with the other apps), so bob
-- keeps his own membership in bob.people and only stores the auth user id.
--
-- Model, decided with the organiser:
--   * INVITED people: the organiser registers a person's email in
--     bob.person_emails. Signing in with that email claims the person row.
--   * ANYONE with the link: a sign-in with an unknown email auto-creates a
--     fresh Volunteer profile.
--
-- All of that runs server-side in bob.join_project() (security definer), so
-- invite emails are NEVER exposed through the public API: person_emails has
-- RLS enabled with no policies and no grants.
--
-- On a plain Postgres without Supabase Auth (no auth schema), the auth-
-- dependent parts skip gracefully with a notice.
--
-- Apply with:  psql "$DATABASE_URL" -f db/migrations/0005_auth_membership.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- Which auth account owns this person. Null = not signed in yet / demo row.
alter table bob.people add column auth_user_id uuid;
create unique index people_auth_user_idx on bob.people (auth_user_id) where auth_user_id is not null;

-- Invite list: organiser-managed, private (no API grants, RLS deny-all).
create table bob.person_emails (
  person_id text primary key references bob.people (id) on delete cascade,
  email     text not null
);
create unique index person_emails_email_idx on bob.person_emails (lower(email));
alter table bob.person_emails enable row level security;

comment on table bob.person_emails is
  'Invite emails, matched at sign-in by bob.join_project(). Deliberately NOT exposed through the API.';

do $$
begin
  if to_regclass('auth.users') is null then
    raise notice 'bob 0005: no auth schema here (plain Postgres) — skipping FK and join_project()';
    return;
  end if;

  -- Belt-and-braces integrity when Supabase Auth is present.
  alter table bob.people
    add constraint people_auth_user_fk foreign key (auth_user_id)
    references auth.users (id) on delete set null;

  -- The one entry point for "who am I": claims the invited person matching
  -- the caller's email, or creates a Volunteer profile, and returns it.
  create function bob.join_project() returns jsonb
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
    select id into v_project_id from bob.projects limit 1;
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

  revoke all on function bob.join_project() from public;
  grant execute on function bob.join_project() to authenticated;
end $$;

commit;

notify pgrst, 'reload schema';
