# bob — database

bob lives in a **shared Postgres database**, so it keeps strictly to its own
schema: everything is created inside schema **`bob`** — tables, enums, views,
functions and triggers. Nothing touches `public`, every statement is
schema-qualified, and nothing relies on `search_path`.

## Layout

```
db/
├── migrations/
│   ├── 0001_create_bob_schema.sql        schema `bob` + all tables, enums, view, RLS, grants
│   ├── 0002_add_display_order.sql        sort_order for areas & people (list order is content)
│   ├── 0003_expose_schema_to_api.sql     expose `bob` to PostgREST in SQL (no dashboard step)
│   ├── 0004_allow_first_project_insert.sql  bootstrap policy: create the FIRST project from the app
│   ├── 0005_auth_membership.sql          login: invited emails claim their person, others join as volunteers
│   ├── 0006_account_level.sql            account level: project schedule dates, bob.account, bob.account_notes, write policies
│   ├── 0007_invite_people.sql            bob.invite_person(): the account dashboard's "Invite" button
│   ├── 0008_join_project_race.sql        serialize concurrent join_project() calls (advisory lock)
│   └── 0009_content_write_policies.sql   write policies: areas, tasks, materials, events, sign-ups, announcements
├── seed.sql                              the "Skogsstuga" sample project (mirrors src/data/mockData.ts)
├── remove_demo_data.sql                  delete the demo project again (real data untouched)
└── README.md                             this file
```

## Applying it

```bash
for f in db/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
psql "$DATABASE_URL" -f db/seed.sql        # optional sample data
```

Migrations are numbered and run once, in order. The seed is idempotent —
re-running it is a no-op.

### Going live for real

When you're done demoing, `db/remove_demo_data.sql` deletes the Skogsstuga
sample projects, notes and everything attached to them (known seed ids only —
real rows survive; verified). With the database empty, the app then shows a
**"start your project"** screen and creates your real project from the UI.
(Prefer SQL? The script ends with a commented insert block instead.) Since
migration `0006`, creating and scheduling projects is a normal app feature —
see the security posture below.
The deploy workflow passes `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
from the repo's Actions **Variables** (or Secrets) into the build, so the
published site goes live as soon as those two are set.

### On Supabase

1. Run the migrations in order (SQL editor, or `supabase db push` with the
   files in your migrations dir).
2. That's the whole list — **API exposure is handled in SQL by migration
   `0003`**, not the dashboard. It appends `bob` to the `pgrst.db_schemas`
   setting on the `authenticator` role (never overwriting the other apps'
   entries — shared database) and fires `notify pgrst, 'reload config'` +
   `'reload schema'` so PostgREST picks it up immediately. Re-running it is a
   no-op.
3. The app's client is already scoped to the schema (see below).

If the API ever serves stale table shapes after a future DDL migration, the
fix is the reload notifies from `0003`:

```sql
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
```

## How it maps to the app

The tables mirror `src/data/types.ts` one-to-one. Array fields on the TS types
become join tables:

| TS type / field | Database |
| --- | --- |
| `Project` (incl. `.startDate` / `.endDate`) | `bob.projects` |
| `Account` | `bob.account` (single row, `id = 'account'`) |
| `AccountNote` | `bob.account_notes` |
| `Person`, `Person.skills` | `bob.people`, `bob.person_skills` |
| `Area`, `.crewIds`, `.referenceImages` | `bob.areas`, `bob.area_crew`, `bob.area_reference_images` |
| `Task`, `.assigneeIds` | `bob.tasks`, `bob.task_assignees` |
| `Material` | `bob.materials` (`area` → `area_label`) |
| `BuildEvent`, `.attendeeIds` | `bob.events`, `bob.event_attendees` |
| `Meal` | `bob.meals` (linked to its build day via `event_id`) |
| `DietMatrixRow` + `getDietColumns()` | `bob.diet_flags` + `bob.diet_columns` (a flag row = `true`) |
| `FoodGroup` / `FoodItem` | `bob.food_groups`, `bob.food_items` |
| `Announcement` | `bob.announcements` |
| `TodayTask` | `bob.today_tasks` (a view over tasks + areas, not a table) |
| `ChatMessage` (Ask bob) | *not in the DB* — scripted assistant content stays client-side |

Display strings the UI consumes verbatim (`hours: '6h'`, `spots: '12 / 20'`,
`cost: '1 920 kr'`, `day: 'Lör 5 juli'`) are stored as authored text for now,
exactly like the mock data. Normalising them into numeric/date columns is
future work and only touches this schema + `src/data/database.ts`.

## Wiring the app to it

Already done — all data access goes through the single module
[`src/data/database.ts`](../src/data/database.ts), which queries these tables
whenever `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set (copy
`.env.example` to `.env.local`). The client is created **scoped to the `bob`
schema** (`{ db: { schema: 'bob' } }`), so table names in queries stay bare.
With no env config the app falls back to the in-memory mock data.

## Login & membership

Sign-in uses Supabase Auth (magic link or email + password — enable the
**Email** provider under Authentication → Providers, and set the site URL to
the deployed app so magic links return there). The shared database means
`auth.users` is project-wide; bob links accounts to his own crew via
`bob.people.auth_user_id`, resolved by `bob.join_project()` (security
definer) at sign-in:

- **Invited**: the account dashboard's **Invite** button registers a crew
  member (name + email) via `bob.invite_person()` (security definer,
  migration `0007`); their sign-in then claims that person row. Prefer SQL?
  The manual equivalent is still:

  ```sql
  insert into bob.person_emails (person_id, email) values ('he', 'henrik@example.se');
  ```

  `person_emails` is deliberately unreachable through the API (RLS deny-all,
  no grants), so invite emails are never exposed.
- **Anyone with the link**: an unknown email joins as a fresh Volunteer
  profile, named from the address.
- **Guest**: the sign-in screen's "Continue as guest" uses one shared,
  pre-created auth user (`guest@bob.local`, credentials public by design —
  they live in the client bundle). The guest is an ordinary authenticated
  member named "Guest", so writes still carry an identity. Live mode shows
  the sign-in screen INSTEAD of the app until a session exists; reads stay
  open at the API level (household posture), the gate is UX.

## Security posture

- **RLS is enabled on every table** from day one (shared database).
- Reads: every table carries a public `for select` policy.
- Writes: the account level (migration `0006`) brought the app's first write
  features — create/schedule projects, account notes, account settings — and
  its policies require a **signed-in member** (`authenticated`). Anyone with
  the link can become one via the sign-in page (migration `0005`), so this is
  still the household-tool posture, but writes are gated behind login and
  carry an identity. The one exception is the `0004` bootstrap: creating the
  FIRST project stays open while `bob.projects` is empty, so a fresh install
  works before anyone can sign in. Migration `0009` extends the same posture
  to project content — areas, tasks (and assignees), materials, events (and
  sign-ups), announcements, reference-image labels. People rows are still
  only created via the security-definer functions (`invite_person`,
  `join_project`), and `person_emails` keeps its deny-all posture.
- The grants block in the migration is Supabase-aware (`anon` /
  `authenticated` / `service_role`) and a no-op on a plain Postgres — there,
  grant your app's role instead:

  ```sql
  grant usage on schema bob to bob_app;
  grant select on all tables in schema bob to bob_app;
  alter default privileges in schema bob grant select on tables to bob_app;
  ```
