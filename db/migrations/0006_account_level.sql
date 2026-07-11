-- ─────────────────────────────────────────────────────────────────────────────
-- bob — migration 0006: the account level
--
-- The app grew a level above the single project: an account dashboard that
-- shows ALL projects, shared account notes, account settings, and a calendar
-- of scheduled projects (ported from the Djuvanäs farm-portal calendar).
-- This migration adds what that needs:
--
--   * projects.start_date / end_date — the scheduled build window that puts
--     a project on the account calendar (both null while unscheduled)
--   * bob.account — a single settings row (account name, owner, email);
--     there is still no auth, so this is identity, not access control
--   * bob.account_notes — free-form notes that span projects
--   * bob.today_tasks gains project_id so the app can scope it now that
--     several projects can exist side by side
--
-- WRITE POLICIES — a deliberate posture change. Until now only the
-- first-project bootstrap insert was allowed (migration 0004). The account
-- level *is* the app's first real write feature (create projects, schedule
-- them, keep notes, edit settings). Login exists since migration 0005, so
-- these policies require a SIGNED-IN member (authenticated). Anyone with the
-- link can become one via the sign-in page — still the household-tool
-- posture, but writes are gated behind login and carry an identity. The
-- 0004 bootstrap policy stays: creating the FIRST project remains open
-- while bob.projects is empty, so a fresh install works before sign-in.
--
-- Apply with:  psql "$DATABASE_URL" -f db/migrations/0006_account_level.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ─────────────────────────── PROJECT SCHEDULE ───────────────────────────

alter table bob.projects
  add column start_date date,
  add column end_date   date,
  add constraint projects_schedule_check check (
    (start_date is null) = (end_date is null)
    and (start_date is null or end_date >= start_date)
  );

comment on column bob.projects.start_date is
  'First day of the scheduled build window (null while unscheduled — set together with end_date).';
comment on column bob.projects.end_date is
  'Last day of the scheduled build window, inclusive.';

-- ─────────────────────────── ACCOUNT (single row) ───────────────────────────

create table bob.account (
  id         text primary key default 'account' check (id = 'account'),
  name       text not null default 'Your build account',
  owner_name text not null default '',
  email      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table bob.account is
  'The one account that owns all projects. Single row (id = ''account''); no auth yet, so this is identity, not access control.';

insert into bob.account (id) values ('account') on conflict (id) do nothing;

create trigger set_updated_at before update on bob.account for each row execute function bob.set_updated_at();

-- ─────────────────────────── ACCOUNT NOTES ───────────────────────────

create table bob.account_notes (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  pinned     boolean not null default false,
  created_at timestamptz not null default now()
);

create index account_notes_order_idx on bob.account_notes (pinned desc, created_at desc);

-- ─────────────────────────── TODAY VIEW: project scope ───────────────────────────
-- Same view as 0001 with project_id appended, so the app can filter it by
-- the active project.

create or replace view bob.today_tasks as
select
  t.id,
  a.name as area_name,
  t.name,
  t.skill,
  t.status,
  coalesce(
    (select array_agg(ta.person_id) from bob.task_assignees ta where ta.task_id = t.id),
    '{}'
  ) as assignee_ids,
  a.project_id
from bob.tasks t
join bob.areas a on a.id = t.area_id
where t.status in ('todo', 'doing');

-- ─────────────────────────── RLS & POLICIES ───────────────────────────

alter table bob.account       enable row level security;
alter table bob.account_notes enable row level security;

create policy read_all on bob.account       for select using (true);
create policy read_all on bob.account_notes for select using (true);

-- The account row is seeded above and single-row by constraint: update only.
create policy update_account on bob.account for update to authenticated using (true) with check (true);

create policy insert_notes on bob.account_notes for insert to authenticated with check (true);
create policy update_notes on bob.account_notes for update to authenticated using (true) with check (true);
create policy delete_notes on bob.account_notes for delete to authenticated using (true);

-- Projects: signed-in members create and (re)schedule projects as a normal
-- feature. The 0004 bootstrap policy (anon insert while the table is empty)
-- is kept alongside — permissive policies OR together.
create policy insert_projects on bob.projects for insert to authenticated with check (true);
create policy update_projects on bob.projects for update to authenticated using (true) with check (true);

-- ─────────────────────────── GRANTS ───────────────────────────
-- Supabase-aware, no-op on a plain Postgres (grant your app role instead).

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on bob.account, bob.account_notes, bob.today_tasks to anon, authenticated;
    grant update on bob.account to authenticated;
    grant insert, update, delete on bob.account_notes to authenticated;
    grant update on bob.projects to authenticated;  -- insert was granted in 0004
    grant all on bob.account, bob.account_notes to service_role;
  end if;
end $$;

commit;

-- PostgREST caches schema + grants — reload so the new surfaces work immediately.
notify pgrst, 'reload schema';
