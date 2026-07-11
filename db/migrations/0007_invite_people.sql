-- ─────────────────────────────────────────────────────────────────────────────
-- bob — migration 0007: invite people from the app
--
-- Migration 0005 introduced invites (bob.person_emails) but registering one
-- took a SQL insert. The account dashboard now has an "Invite" button; it
-- calls bob.invite_person(), which creates the person on the project's crew
-- and records their email in one server-side step. person_emails keeps its
-- deny-all posture — invite emails are still never readable through the API.
--
-- The companion GUEST login (the "Continue as guest" link on the sign-in
-- screen) is an ordinary confirmed auth user (guest@bob.local), created via
-- the Auth admin API — not SQL, so it has no migration. Its credentials are
-- public by design: the guest is just a shared signed-in identity.
--
-- Apply with:  psql "$DATABASE_URL" -f db/migrations/0007_invite_people.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

do $$
begin
  if to_regclass('auth.users') is null then
    raise notice 'bob 0007: no auth schema here (plain Postgres) — skipping invite_person()';
    return;
  end if;

  create function bob.invite_person(p_project_id text, p_name text, p_email text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  declare
    v_person bob.people;
    v_colors text[] := array['#7E9B52','#5E87A6','#B5675A','#C98B2E','#8A6FA8','#B07F4F','#5E9C68','#C07A4E'];
  begin
    if auth.uid() is null then
      raise exception 'invite_person: not signed in';
    end if;
    if trim(p_name) = '' or trim(p_email) = '' then
      raise exception 'invite_person: name and email are required';
    end if;
    if not exists (select 1 from bob.projects where id = p_project_id) then
      raise exception 'invite_person: no such project';
    end if;
    if exists (select 1 from bob.person_emails where lower(email) = lower(trim(p_email))) then
      raise exception '% is already invited', trim(p_email);
    end if;

    insert into bob.people (id, project_id, name, initials, color, role, diet, sort_order)
    values (
      'i_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
      p_project_id,
      trim(p_name),
      upper(left(trim(p_name), 2)),
      v_colors[1 + (hashtext(lower(trim(p_email))) & 2147483647) % array_length(v_colors, 1)],
      'Volunteer',
      'No restrictions',
      coalesce((select max(sort_order) from bob.people), 0) + 1
    )
    returning * into v_person;

    insert into bob.person_emails (person_id, email) values (v_person.id, trim(p_email));
    return to_jsonb(v_person);
  end
  $fn$;

  revoke all on function bob.invite_person(text, text, text) from public;
  grant execute on function bob.invite_person(text, text, text) to authenticated;
end $$;

commit;

notify pgrst, 'reload schema';
