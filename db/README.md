# bob — database

bob lives in a **shared Postgres database**, so it keeps strictly to its own
schemas: project data lives in **`bob`**; guarded internal membership helpers
live in non-exposed **`bob_private`**. Nothing touches `public`, every statement is
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
│   ├── 0009_content_write_policies.sql   write policies: areas, tasks, materials, events, sign-ups, announcements
│   └── 0010_food_people_write_policies.sql  write policies: meals, food shopping, diet matrix, people editing
├── seed.sql                              the "Skogsstuga" sample project (mirrors src/data/mockData.ts)
├── remove_demo_data.sql                  delete the demo project again (real data untouched)
└── README.md                             this file
```

## Applying it

```bash
for f in db/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
psql "$DATABASE_URL" -f db/seed.sql        # optional sample data
```

These are the legacy bootstrap migrations. New installations also need the Slice 0
migration below before using the current frontend. The optional seed creates
unlinked demo crew: review member mappings before applying Slice 0.

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
| `TaskDetail`, `TaskStep` | `bob.tasks.instructions`, `bob.task_steps` (milestones 1A/1B migration) |
| `MediaAsset` and attachments | `bob.media_assets`, `bob.media_links`, private `bob-project-media` Storage bucket |
| `Measurement` | `bob.measurements`, append-only `bob.measurement_revisions`, invoker `bob.current_measurements` |
| `ExistingComponent` | `bob.existing_components`, append-only `bob.component_revisions`, invoker `bob.current_components` |
| `Material` | `bob.materials` (`area` → `area_label`) |
| `BuildEvent`, `.attendeeIds` | `bob.events`, `bob.event_attendees` |
| `Meal` | `bob.meals` (linked to its build day via `event_id`) |
| `DietMatrixRow` + `getDietColumns()` | `bob.diet_flags` + `bob.diet_columns` (a flag row = `true`) |
| `FoodGroup` / `FoodItem` | `bob.food_groups`, `bob.food_items` |
| `Announcement` | `bob.announcements` |
| `TodayTask` | `bob.today_tasks` (a view over tasks + areas, not a table) |
| `ChatMessage` (Ask bob) | *not in the DB* — chat stays client-side; answers use the project-scoped read-only Ask seam (`supabase/README.md`) |

Display strings the UI consumes verbatim (`hours: '6h'`, `spots: '12 / 20'`,
`cost: '1 920 kr'`, `day: 'Lör 5 juli'`) are stored as authored text for now,
exactly like the mock data. Normalising them into numeric/date columns is
future work and only touches this schema + `src/data/database.ts`.

## Image and task-step foundation

[`Docs/media-and-steps.md`](../Docs/media-and-steps.md) owns the storage,
attachment, provenance, lifecycle and manual-step contract. The additive source
`supabase/migrations/20260909210642_media_and_task_steps.sql` was applied before
its frontend on 2026-09-09. The hosted history records the same migration as
`20260909214606_bob_media_and_task_steps`; do not replay it under the authoring
timestamp. [Verification and rollout](../Docs/foundation-verification.md) records
the deployed private bucket, unchanged existing data and actual runtime evidence.

Object upload and deletion use the Storage API. Keep the original bytes when
detaching media or deleting an area/task/step. Delete project media explicitly
before deleting a project that owns files. Do not convert the public app-asset
bucket into project storage or delete Storage object metadata with SQL.

## Wiring the app to it

### Manual project facts

[`Docs/project-facts.md`](../Docs/project-facts.md) owns the measurement/component
contract. Source migration
`supabase/migrations/20260909221503_measurements_and_existing_components.sql`
is additive and requires the deployed 1A/1B migration. Apply it before releasing
the new frontend; deployment evidence is pending. Normal clients read under RLS
and use `bob.evidence_command` for revisioned writes. Do not overwrite historical
values or run these source files blindly against the shared migration registry.

Already done — all data access goes through the single module
[`src/data/database.ts`](../src/data/database.ts), which queries these tables
whenever `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set (copy
`.env.example` to `.env.local`). The client is created **scoped to the `bob`
schema** (`{ db: { schema: 'bob' } }`), so table names in queries stay bare.
With no env config the app falls back to the in-memory mock data.

## Slice 0 membership and project policies

> Applied to the shared database on 2026-09-09; see the verification record for release evidence.
> Legacy migrations 0001–0010 describe the previous household-wide policies.

Apply `supabase/migrations/20260909182548_project_scope_and_bounded_lookup.sql`
**after** the ten legacy migrations. It was created with `supabase migration new`.
Do not replay the legacy migrations or use an unreviewed `db push` against this
shared project's migration history.

The hosted migration registry records this rollout as
`20260909200654_bob_project_scope_and_bounded_lookup`. The CLI-created source file
keeps its original authoring timestamp; these are the same applied change, not
two migrations to replay. The deployment supplied the reviewed mapping only in
its transaction-local setting.

The authority source remains `bob.people`: a protected `(project_id, auth_user_id)`
link, unique per project. One Auth user can belong to several projects. Editable
crew labels such as Organiser/Volunteer are **not permission roles**. Members
retain collaborative content editing and may invite other people to that project.

- All project tables and children require membership for both reads and writes.
  Both ends of crew, assignment, attendance, lead, author, meal and diet relations
  must belong to the same project, even for callers who belong to both.
- Client grants cannot rewrite row ids, project/parent ids or `auth_user_id`.
  Projects and crew memberships cannot be inserted directly through the API.
- `bob.create_project(p_input)` atomically creates a project and its creator's
  member row. A signed-in newcomer can start their own project.
- `bob.invite_person(project, name, email)` checks membership before creating an
  invitation. Invitation emails are private and unique **within** a project.
- `bob.claim_project_invites()` claims only invitations matching the Auth user's
  confirmed email. Unknown accounts do not join arbitrary existing projects.
  `bob.join_project(project)` returns only an existing membership in that project;
  the old no-argument automatic join is removed.
- Definer helpers live in non-exposed `bob_private`, with empty search paths and
  authenticated-user checks. The exposed wrappers and search RPC are invokers.
- `today_tasks` uses `security_invoker` so it cannot bypass underlying RLS.
- Deleting the last linked member is rejected; arrange another member first.
- A shared guest login only sees projects explicitly linked to that guest.
  Such a project is accessible to everyone using those public guest credentials.

`bob.account` and `bob.account_notes` retain the existing shared-household
semantics. They have no project id and are excluded from Ask bob. This slice
does **not** establish separate private accounts or organiser-only authority.
Other apps' schemas, shared AI tables, and the separately managed `bob.asset`
table are not altered.

### Existing project mapping is a rollout gate

The migration aborts if any existing project lacks an authenticated member.
This avoids silently removing access or guessing ownership. The read-only
deployment check on 2026-09-09 found:

| Project | Before rollout | After rollout |
| --- | --- | --- |
| Bygga in entrén (`p_bygga_in_entren`) | 0 | 1 — reviewed confirmed account |
| Test (`p_test`) | 1 | 1 — original membership preserved |

Review the intended accounts for each project, including guest/collaborator access.
Do not copy a different project's user merely because it is the only linked user.
The user identified the intended confirmed account and it is now linked to both
projects. The original Test membership was preserved. Keep the supplied email and
resolved Auth id out of this public repository.

The migration accepts an operator-reviewed JSON array through the transaction-local
setting `bob.reviewed_member_mapping`, with `project_id`, `email` and `name` per
entry. Set it immediately after `begin` in the deployment transaction. The
migration resolves exactly one confirmed Auth account, requires the target
project to exist, and only adds a member when that project's crew is empty.
Existing matching memberships are preserved; other existing crew require a
separate explicit person-mapping decision. Without a reviewed mapping, orphaned
projects still abort the migration. There is no mapping RPC or client-side setting.

Legacy global Auth uniqueness is replaced before the reviewed insert; mapping,
orphan preflight and policies commit together. Failure rolls back all of them.
Tests cover missing/unconfirmed accounts, occupied crew, rollback of the index
change, and preserving the original membership when adding the second one.
Do not unlink Test or grant the public guest access to the real project.

Preflight (read only):

```sql
select p.id, p.name, count(m.auth_user_id) as linked_members
from bob.projects p left join bob.people m on m.project_id = p.id
group by p.id, p.name order by p.id;
```

Rollout order: verified backup → atomic reviewed mapping/policy migration → edge
deployment → frontend release → live acceptance checks. Use a maintenance window:
the old client uses the retired join RPC, while the new client requires the new
RPCs. A frontend-only merge/deploy is not compatible. Verify a real member,
non-member, multi-project member, invitation claim, project creation and project
switching before declaring Slice 0 live. Failed preflight rolls back atomically;
after data changes, prefer a reviewed forward fix over restoring public policies.

### Verification

`npm test` runs the complete legacy + new migration against PGlite (real Postgres,
with Supabase Auth/roles represented by local fixtures). It exercises RLS as
`anon` and `authenticated`, the static lookup RPC, and the actual edge request/tool
dispatcher with a deterministic provider fixture. It is not a deployed Supabase
Auth/PostgREST test or a live model answer.

See [the verification record](../Docs/slice-0-verification.md) for exact coverage,
limitations and the remaining live/browser gates.

`node scripts/check-restore-snapshot.mjs /absolute/path/to/private-snapshot.json`
checks the affected tables' recovery data against a fresh local Postgres fixture.
Recovery snapshots contain private data and must never be committed to this repo.
