# bob — database

bob lives in a **shared Postgres database**. Bob-owned project data and sharing
records live in **`bob`**; guarded internal authority helpers live in non-exposed
**`bob_private`**. The household/friend sharing extension reads the existing
`shared` family records and `hearth` friendship/profile records through guarded
Bob commands. It does not create another family graph or mutate those apps' data.
Every statement is schema-qualified and nothing relies on `search_path`.

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
| `Solution`, `SolutionVersion` | `bob.solutions`, append-only `bob.solution_revisions`, invoker `bob.current_solutions` |
| `SolutionMeasurement` | `bob.solution_measurements`, invoker `bob.solution_measurement_details` with exact historical measurement versions |
| `TargetDecision` | `bob.project_targets`, append-only `bob.target_revisions`, invoker `bob.current_target` |
| `ProjectArtifact`, `ArtifactVersion` | `bob.artifacts`, append-only `bob.artifact_revisions`, exact `bob.artifact_measurements`, invoker `bob.current_artifacts` / `bob.artifact_measurement_details` |
| deterministic Artifact generation recipe | `bob.artifact_generations`, `bob.artifact_geometry_inputs`, invoker Artifact views + guarded `bob.artifact_geometry_command` |
| `PhysicalSite`, `PhysicalBuilding`, `PhysicalLevel`, `PhysicalSpace` | `bob.sites`, `bob.buildings`, `bob.building_levels`, `bob.building_spaces` + append-only revision tables and security-invoker current/project views |
| `PhysicalElement`, `PhysicalRelationship` | `bob.building_elements`, `bob.spatial_relationships` + append-only revision tables; accepted current state remains separate from latest proposals |
| `ProjectPhysicalScope`, `AreaPhysicalTarget` | `bob.project_physical_scope`, `bob.area_physical_targets` |
| `SpaceMeasurementSnapshot` | `bob.space_measurements`, invoker `bob.space_measurement_details` with exact historical Measurement versions |
| `Material` | `bob.materials` (`area` → `area_label`) |
| material stock / requirement revisions | `bob.stock_items`, `bob.stock_revisions`, `bob.material_requirements`, `bob.material_requirement_revisions` + allocation/shopping-link tables and invoker views; manual `bob.material_requirement_command` plus deterministic `bob.material_requirement_geometry_command` share the same revision model |
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

## Measurement and component foundation

[`Docs/project-facts.md`](../Docs/project-facts.md) owns the measurement/component
contract. Source migration
`supabase/migrations/20260909221503_measurements_and_existing_components.sql`
is additive and requires the deployed 1A/1B migration. It was applied before its
frontend on 2026-09-09; the hosted registry records the same change as
`20260909224644_bob_measurements_and_existing_components`. Do not replay it under
the authoring timestamp or edit the applied migration. The
[verification record](../Docs/foundation-verification.md) owns release evidence.

Normal clients read the four new tables under RLS and their current-revision views
with invoker authority, then use `bob.evidence_command` for revisioned writes.
Historical values remain append-only. A removed source image clears the file link
while preserving its recorded title and the measurement/component history.

## Solution and target foundation (3A)

[`Docs/solutions.md`](../Docs/solutions.md) owns alternatives, exact evidence
references and revisioned target decisions. Source migration
`supabase/migrations/20260910152455_solutions_and_selected_target.sql` adds
`solutions`, `solution_revisions`, `solution_measurements`, `project_targets`
and `target_revisions`, with RLS and invoker views. Applied after 2A/2B and before
its frontend on 2026-09-10, it is recorded in hosted history as
`20260910154029_bob_solutions_and_selected_target`. Do not replay the authoring
timestamp or edit the applied migration. `bob.solution_command` is the only
normal-client write path. [Foundation verification](../Docs/foundation-verification.md)
owns rollout evidence and its limits.

## Plans and drawings foundation (4A)

[`Docs/artifacts.md`](../Docs/artifacts.md) owns the manual project-artifact
contract. Source migration
`supabase/migrations/20260910180000_project_artifacts.sql` adds `artifacts`,
append-only `artifact_revisions`, exact `artifact_measurements`, the invoker views
`current_artifacts` / `artifact_measurement_details` and guarded
`bob.artifact_command`. It was applied on 2026-09-13 after 3A and is recorded in
hosted history as `20260913101509_bob_project_artifacts`. Do not replay the
authoring timestamp or edit the applied migration.

Every saved drawing version pins the exact current target decision, exact selected
solution revision and any exact measurement revisions it uses. The server derives
target/solution identity and actor/time; stale target or artifact revisions are
rejected. A drawing may reuse an authorised same-project image. File removal clears
the byte reference while retaining its recorded title and revision history.
[Foundation verification](../Docs/foundation-verification.md) owns the deployed
Auth/PostgREST/Storage, browser and cleanup evidence. 4A is manual and does not
claim deterministic geometry, BOM/calculation, stock/shopping or task readiness. Those capabilities extend this foundation in the later sections below.

## Deterministic artifact geometry foundation (4B1)

[`Docs/artifacts.md`](../Docs/artifacts.md) also owns the narrow deterministic geometry extension. Source migrations `20260913193000_artifact_deterministic_geometry.sql`, `20260913193100_artifact_geometry_command_grant.sql`, `20260913193200_artifact_geometry_invariants.sql` and `20260913194000_artifact_generation_space_revision_index.sql` are hosted as `20260913212211_bob_artifact_deterministic_geometry`, `20260913212218_bob_artifact_geometry_command_grant`, `20260913212229_bob_artifact_geometry_invariants` and `20260913213315_bob_artifact_generation_space_revision_index`.

`artifact_generations` owns the versioned generator/physical target/design parameters and `artifact_geometry_inputs` owns the six exact measurement roles. Normal clients read under project RLS and generate/regenerate through guarded `bob.artifact_geometry_command`; ordinary Artifact archive/restore carries complete recipes forward. This foundation is deterministic geometry only, not a material BOM or engineering approval.

## Manual material planning foundation (4B2a)

[`Docs/material-planning.md`](../Docs/material-planning.md) owns revisioned manual requirements, material stock/reuse allocations, deterministic allowance/shortfall/purchase rounding and explicit Shopping handoff. Source migrations and hosted registry entries are:

| Source migration | Hosted registry |
|---|---|
| `supabase/migrations/20260913210000_material_planning.sql` | `20260914053521_bob_material_planning_4b2a` |
| `supabase/migrations/20260913210100_material_planning_hardening.sql` | `20260914053538_bob_material_planning_4b2a_hardening` |
| `supabase/migrations/20260913210200_material_planning_publish.sql` | `20260914053605_bob_material_planning_4b2a_publish` |
| `supabase/migrations/20260913210300_material_planning_reservation_serialization.sql` | `20260914053620_bob_material_planning_4b2a_reservation_serialization` |
| `supabase/migrations/20260913210400_material_planning_fk_index.sql` | `20260914054215_bob_material_planning_4b2a_fk_index` |

Normal clients select RLS-protected tables/security-invoker views and write only through `bob.stock_command` and `bob.material_requirement_command`; private helpers remain in `bob_private`. Manual requirement versions persist `source_kind = manual`, `method_key = manual`, `method_version = 4B2a-v1`. Reservation triggers lock stock/component identities while rechecking capacity so concurrent requirements cannot overbook current confirmed availability. Shopping publish is explicit and preserves existing supplier/cost/status on update. `src/data/materialPlanning.ts` is the domain adapter behind the single `database.ts` UI seam.

[Foundation verification](../Docs/foundation-verification.md) owns CI/browser, hosted migration/advisor, Pages, ordinary Auth/PostgREST and cleanup evidence. 4B2a remains the manual path; 4B2b below extends this same model with a server-owned deterministic source rather than creating a parallel BOM.

## Deterministic material quantity foundation (4B2b)

[`Docs/material-planning.md`](../Docs/material-planning.md) owns the first geometry-derived material method. Source migration `supabase/migrations/20260914084207_deterministic_material_quantities.sql` is applied in hosted history as `20260914090502_bob_deterministic_material_quantities_4b2b`. It adds no new BOM tables: `bob.material_requirement_geometry_command` validates project authority and one exact current `stud_wall_opening_v1` Artifact revision, derives net wall coverage in `m2` from its pinned measurement revisions, and delegates the resulting server-owned base quantity into the existing material-requirement command/arithmetic/reservation path.

Saved deterministic revisions use `source_kind = deterministic`, `method_key = stud_wall_net_area`, `method_version = 4B2b-v1`. Quantity, unit, formula/basis and method identity cannot be supplied by the normal client. A newer Artifact revision makes the requirement stale through the existing lineage view; recalculation appends a new requirement revision and Shopping still changes only through the explicit publish/update command. The method is coverage-only and does not choose materials, optimize sheet layout, size structural members or infer fasteners/consumables.

## Persistent building context foundation (2C)

[`Docs/building-model.md`](../Docs/building-model.md) owns the persistent physical
place contract. Manual 2C is deployed/live-verified: Site → Building → optional
Level → Space persists independently of Project lifetime; BuildingElements and a
narrow Space relationship vocabulary add topology; Project/Area scope links work
without redefining `Area` as a physical room; accepted current truth remains separate
from Project proposals; and Space revisions can snapshot exact Measurement revisions.

Source migrations and hosted registry entries are:

| Source migration | Hosted registry |
|---|---|
| `supabase/migrations/20260913124500_persistent_building_context.sql` | `20260913141333_bob_persistent_building_context` |
| `supabase/migrations/20260913135500_expose_physical_proposal_state.sql` | `20260913141342_bob_expose_physical_proposal_state` |
| `supabase/migrations/20260913140500_physical_identity_delete_boundary.sql` | `20260913141357_bob_physical_identity_delete_boundary` |
| `supabase/migrations/20260913143000_building_context_fk_indexes.sql` | `20260913142013_bob_building_context_fk_indexes` |
| `supabase/migrations/20260913144500_building_delete_child_order.sql` | `20260913143018_bob_building_delete_child_order` |

Do not replay these source timestamps or edit applied migrations. Physical tables and
history are RLS-protected. `bob_private` owns physical membership/authority helpers;
normal app writes go through the guarded `bob.physical_site_command`,
`bob.physical_building_command`, `bob.physical_node_command` and
`bob.physical_scope_command` wrappers. `src/data/buildingContext.ts` is the app domain
adapter behind the single `database.ts` UI seam. Guarded physical deletion requires
direct authority, a current archived identity and no active Project/Area scope; the
follow-up delete migration removes child identities in explicit safe order while
preserving strong foreign keys.

[Foundation verification](../Docs/foundation-verification.md) owns the exact CI,
320/390/1280 browser, hosted Auth/PostgREST, Pages and self-cleanup evidence. This
foundation does not claim whole-plan import, general CAD/BIM, generated geometry or
AI promotion of uncertain evidence into fact.

## Household and friend sharing

> **Status:** source merged and sharing/account migrations deployed, confirmed
> read-only on 2026-09-24. Source migrations are
> `20260913213712_household_project_sharing.sql` and
> `20260913214355_household_account_sharing.sql`; the hosted ledger uses different
> timestamps. `Docs/foundation-verification.md` records that mapping and separates
> deployed schema, controlled test evidence and remaining real-user acceptance.

[`Docs/user-stories.md`](../Docs/user-stories.md) owns BOB-US-038 and BOB-US-059.
[`Docs/building-model.md` §11.1A](../Docs/building-model.md#111a-household-sharing-extension)
owns the physical authority decision. This section owns its data/command mapping
and the effective project-access contract, extending the deployed Slice 0 baseline
below when the new migration is applied.

### Shared inputs and Bob-owned records

| Source | Use in Bob |
|---|---|
| `shared.households` + `shared.household_access` | Existing household identity and current audience: the Auth user must have access with `status = 'active'`. |
| `shared.members` | Display names for authorised household crew identity; a family member record alone is not a login entitlement. |
| `hearth.friendships` + `hearth.profiles` | Accepted friendships in either direction and minimal friend display names. Friendship alone never grants a Bob project. |
| `bob.building_household_shares` | Opt-in household audience for one Building, with a conflict revision. |
| `bob.project_household_shares` | One explicit project choice: no household, one direct household, or one exactly linked Building as the household source. |
| `bob.project_friend_invitations` | Bob-local pending/accepted/declined/revoked project invitation state. |
| `bob.people.access_origin` | Distinguishes existing direct membership from a derived crew projection. The client cannot create or change the grant origin. |
| `bob.account.household_id` | Explicit household boundary for the existing account/notes singleton; an unbound account is inaccessible. |

The browser uses Bob's guarded directory and sharing RPCs. It never directly
queries another app's household tables, profiles or friendship graph.

### Effective authority and revocation

`bob_private.has_project_access` accepts the union of these independent routes:

| Route | Current authority check |
|---|---|
| Direct project membership | A protected `bob.people` row links this user/project with `access_origin = 'direct'`. Existing memberships keep this origin. |
| Direct household share | This project explicitly selects a household and the user currently has active access to it. |
| Follow one Building | This project explicitly selects that Building, retains an exact Building/Space/Element scope to it, and the user has active access to the Building's currently shared household. Site-only association does not qualify. |
| Accepted friend invitation | This user has an accepted Bob invitation for this exact project. |

`bob.join_project(project)` may project an already entitled caller into a stable
crew row. `access_origin = 'derived'` never grants access by itself, so later
revocation does not leave a permanent grant hidden in the crew list. Retained
crew identity supports existing assignments/history. The last direct linked
project member remains protected against deletion.

Project members retain the existing collaborative editing and invitation model;
Organiser/Volunteer labels do not confer separate permission roles. Project
household choice is guarded by current project access plus active access to the
selected household. "No household sharing" preserves independent project members
and invitations; it does not remove everyone else from the project.

`bob.can_edit_building` resolves direct Building membership or current active
access to the Building's chosen household for ordinary physical editing and
proposal acceptance. Building household administration and actual physical deletion
still require direct Building membership. Friend invitation alone only provides
the project's existing physical-context read/proposal access, whose Building-wide
backend scope is described in the building contract.

Household departure/inactivation, disabling or changing a share, and removing the
selected Building association revoke the affected inherited route on subsequent
authorisation checks. Independent direct membership, another valid household
route or an accepted project invitation continues to work. No household members
are copied into permanent direct Bob grants.

### Guarded commands and invitation lifecycle

| Bob RPC | Contract |
|---|---|
| `sharing_directory` | Returns only the caller's active households and accepted friends with minimal display data. |
| `project_sharing_state`, `building_sharing_state` | Return the exact requested context, current sharing revision and permitted choices. |
| `set_project_household` | Selects the project's household source using its expected revision. A stale choice is rejected. |
| `set_building_household` | Requires direct Building authority and the Building's expected sharing revision. The optional explicit linked-project checklist is additive and atomic: only untouched project sharing or an existing follow of this same Building is accepted. Other existing choices, including explicit private sharing, require the project card and its current revision. |
| `invite_project_friend` | Creates a pending in-app invitation only for a current accepted friend; no email or message is sent. |
| `project_invitations`, `respond_project_invitation` | Show the recipient's pending invitations and accept/decline them. Acceptance rechecks friendship and the inviter's current project authority. Pending/declined invitations grant no project-content access. |
| `revoke_project_invitation` | Lets a current project member revoke this Bob invitation or lets its recipient leave that invitation's grant. Other independent access routes remain intact. |

The bulk Building checklist accepts an unconfigured project (`revision = 0`) or
one already following that same Building. A stored explicit private choice
(`revision > 0` with both source IDs null) is an existing user decision, even
though its current audience is empty. Bulk opt-in must reject it just like a
different household/Building source; changing it requires that project's own
revision-checked command. This also prevents an older Building form from silently
undoing a concurrent project unshare.

An accepted Bob grant survives later friendship deletion; friendship is checked at
invitation and acceptance, while subsequent removal is an explicit Bob revoke/leave
action. Existing confirmed-email `invite_person` / `claim_project_invites` remains
a separate flow and is not converted into a social friendship or an email-delivery
service. New projects require an explicit household choice; physical links alone
never enrol their household audiences.

Raw client mutation of sharing, invitation state, authority origin and actor/time
is denied. `database.ts` guards requests against stale auth/project responses;
missing server RPCs must produce an unavailable state rather than a fake saved
share. Media and Ask bob continue through the same backend project-access boundary.

### Legacy account boundary — release gate

The original `bob.account` / `bob.account_notes` singleton predates private project
authority and had broad legacy access. The account-sharing migration replaces
that boundary. Source is
`supabase/migrations/20260913214355_household_account_sharing.sql`; hosted
application is confirmed in the September 24 verification record.

The migration removes the broad legacy policies and limits account/settings/notes
reads and allowed writes to active access in the account's explicitly bound
`shared.households` record. Project membership and friend invitations grant no
account access. The existing pristine singleton remains unbound and inaccessible
until an authenticated user explicitly calls `bob.bind_account_household(p_household)`
for a household they can actively access. This command binds only an untouched,
empty account and cannot reassign one that already belongs to another household.

`src/pages/account/AccountSettings.tsx` offers this explicit choice through
`database.ts::bindAccountHousehold`, then reads the account back. A missing,
denied or unreadable result must remain an honest failure/unavailable state. This
setup does not share Buildings or projects.

If legacy settings are configured or any notes exist, migration requires the
transaction-local reviewed mapping `bob.reviewed_account_household`; without it,
the migration aborts. The read-only rollout baseline found no configured legacy
account content and no notes. That baseline never chooses a household: there is
no first-user, first-project or first-household fallback. Hosted application is
confirmed; it alone does not prove normal-user binding/read-back, denied access
or the complete cross-app participant journey.

## Name-only volunteer access

**Deployed foundation, confirmed read-only 2026-09-24.** The owner requires a
project link and a name, with optional allergies only when the project has food.
There is no email, password, manual registration, anonymous Auth signup or shared
Guest-account login in this journey. `BOB-US-038` owns the user goal;
`Docs/foundation-verification.md` owns the tests and rollout status.

`20260914052752_volunteer_project_links.sql` follows the two sharing migrations.
`bob.volunteer_links` owns expiring, revocable multi-use project invitations;
`bob.volunteer_sessions` binds a separate browser capability to exactly one link,
one project and one `bob.people` row. The person has `auth_user_id = null`, a
Volunteer display label and derived origin. No Auth/shared-family/friend record
is created. Ordinary project RLS and `has_project_access` never treat this row as
an authenticated project grant.

Both the shared invitation and individual session use distinct 256-bit random
secrets. Only SHA-256 hashes are stored in the database. The invitation is in the
URL fragment; request bodies carry session credentials, never a selectable actor
or project. The browser remembers only its random credential, not names or
allergy data. A retry with the same credential reuses the person; the same name
with another credential creates a distinct person. Neither names nor knowledge
of a project ID can restore another person's session.

The new `bob_volunteer_private` schema confines capability-checked definers. Bob
exposes exact invoker wrappers; anonymous callers receive no new access to
`bob_private`, base tables, Auth or shared-app tables. New tables have RLS and no
normal-client raw read/write grants, including no read access to secret hashes.

| Command | Authority and result |
|---|---|
| `volunteer_links_state`, `create_volunteer_link`, `revoke_volunteer_access` | Current signed-in project access required. Manage link/participant metadata without exposing credentials. |
| `volunteer_preview` | Valid active invitation reveals only project name/ID, food availability and expiry before joining. |
| `volunteer_join` | Active invitation plus separate new browser secret creates/reuses a project person by name. No identity matching by name or email. |
| `volunteer_state`, `volunteer_profile` | Active session reads or changes only its own name/allergies. Profile saves compare the current person timestamp. |
| `volunteer_feed`, `volunteer_task` | Paged tasks, build days, updates and meals; task instructions/checks and ready linked image metadata. No other participants' allergy notes, account settings, private physical inventory or other project feeds. |
| `volunteer_rsvp`, `volunteer_task_action` | Own attendance and task assignment only. Task status/check writes require current own assignment, preserve required-check rules and reject stale changes. No task/instruction creation or editing. |
| `volunteer_media` | Exact active session + same-project task + ready task/step/area-linked image resolve the sole permitted Storage object for the media proxy. |

Food availability is derived from an existing meal or nonempty build-event food
description. Merely having a Food navigation item does not count. Allergy input
is optional and limited to 1000 characters; nonempty allergy writes without food
are rejected server-side. Notes live only in that person's project-local `diet`
field, are shown to the signed-in crew in People/Food, and are never included in
other volunteer feeds. Removing food hides the field and its own-profile response;
it does not silently erase an earlier crew record. Empty values are not labelled
"No restrictions".

Step completion uses `task_steps.completed_by_volunteer` for the Bob person ID,
mutually exclusive with the existing Auth `completed_by`. Authenticated reopens
or completions clear the volunteer actor field. Historical IDs are retained; an
Auth UUID is never manufactured for a name-only participant.

Links belong to the project independently of the creator's later membership.
Default expiry is 30 days, selectable from 1–90 days server-side (7/30/90 in UI).
A project can have at most 10 active links and each link at most 200 registrations.
Every guest request checks expiry and link/session revocation; row locks serialize
revocation with writes. Revoking a link ends all its sessions. Revoking one session
does not identify or ban that human: anyone retaining a still-active shared link
can register again. Revoke that link to stop new registrations. Deleting the
project person cascades its session; the crew controls retained task/attendance
records. Forgetting access on a browser clears its stored credential, not saved
project work or the server-side participant record.

`/#/volunteer/:token` renders before the regular sign-in gate and uses an isolated,
nonpersisting Supabase client. `volunteer-media` is an explicitly public Edge
entrypoint (`verify_jwt = false`) whose session capability is checked before and
after a private Storage download. It streams original bytes with `no-store`,
without public URLs, bucket-policy changes or exposing the service key. Deploy
this function after the migration and before the frontend; global anonymous Auth
does not need enabling. Loaded bytes already received cannot be recalled.

## Wiring the app to it

Already done — all data access goes through the single module
[`src/data/database.ts`](../src/data/database.ts), which queries these tables
whenever `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set (copy
`.env.example` to `.env.local`). The client is created **scoped to the `bob`
schema** (`{ db: { schema: 'bob' } }`), so table names in queries stay bare.
With no env config the app falls back to the in-memory mock data.

## Slice 0 membership and project policies

> Applied to the shared database on 2026-09-09; see the verification record for release evidence.
> Legacy migrations 0001–0010 describe the previous household-wide policies.
> This section records the deployed Slice 0 baseline. The deployed household/friend extension above supersedes this earlier authority baseline; use its current contract and verification record.

Apply `supabase/migrations/20260909182548_project_scope_and_bounded_lookup.sql`
**after** the ten legacy migrations. It was created with `supabase migration new`.
Do not replay the legacy migrations or use an unreviewed `db push` against this
shared project's migration history.

The hosted migration registry records this rollout as
`20260909200654_bob_project_scope_and_bounded_lookup`. The CLI-created source file
keeps its original authoring timestamp; these are the same applied change, not
two migrations to replay. The deployment supplied the reviewed mapping only in
its transaction-local setting.

Slice 0 established `bob.people` as the authority source: a protected `(project_id, auth_user_id)`
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

At Slice 0, `bob.account` and `bob.account_notes` retained the legacy broad
singleton semantics. They have no project id and are excluded from Ask bob. This slice
does **not** establish separate private accounts or organiser-only authority.
Other apps' schemas, shared AI tables, and the separately managed `bob.asset`
table are not altered. The household/friend sharing release has an explicit
[account-isolation gate](#legacy-account-boundary--release-gate) above.

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

## Bob working-context extension (September 2026)

`20260918194106_ask_bob_context_memory.sql` adds a private thread-cascaded summary and service-only claimed-turn load/save/search commands. `20260918194147_ask_bob_research_pages.sql` adds the caller-RLS paged research RPC without altering legacy callers. No cross-app tables or project-content migrations. Current semantics and release gates: [Ask bob conversations](../Docs/ask-bob-conversations.md). Hosted registry timestamps can differ; apply only the reviewed new SQL and record the mapping in the release PR.

## Unified work ownership (September 2026)

`20260924135637_unified_project_work.sql` aligns the [domain dictionary](../Docs/domain-dictionary.md) with persistence. Deployment evidence and the hosted migration mapping are recorded in [PR #135](https://github.com/EmelieHagander/Bob-the-builder/pull/135).

| Concept | Persistence / API |
|---|---|
| Task Project ownership and access | Required `tasks.project_id`; caller RLS uses this directly |
| Primary Step | Nullable `tasks.primary_step_id`, same-Project stable identity FK |
| Optional Area | Nullable `tasks.area_id`, derived from the primary Step when present |
| Related work | `project_plan_step_tasks`; never a second Task owner |
| Step phase / parallel execution | Nullable revisioned `project_plan_steps.phase`; multiple `active` Steps allowed |
| Bob focus | `project_plans.focus_step_id`, independent of Step state |
| Common Plan read | `project_work_read`, including unorganised Tasks |
| Manual Task creation | Caller-authorised `create_work_task`, with plan/Task ownership validation |
| Staged Task ownership | `project_plan_revisions.task_links`; atomic approval checks Task timestamps |

The migration preserves Task identities and dependent records. Only a unique current same-Area link is backfilled as primary; ambiguous work remains visible for deliberate organisation. Existing Area-only inserts remain compatible. Task research, readiness, Today, evidence/media/materials and volunteer paths no longer depend on a non-null Area. Area deletion preserves Tasks, but current **and historical** plan references prevent deletion. Moving current Steps does not remove historical references. The Area archive extension below provides a reversible alternative to deletion. No other app's schemas or access policies change.


### September 24 review corrections — source changes, pending release

`20260924183706_review_workflow_integrity.sql` makes intentional CAD saves update
`artifact_step_links` in the guarded writer, and records the actual current
`step_ids` in the receipt. Archive/restore carry provenance without recreating
removed links. Task readiness uses named dependencies, materials, tools,
information and manual blockers; phase alone never blocks a Task. A Task with
no blockers stays unreviewed until readiness is explicitly confirmed.

The volunteer task and media capability functions now include images on the
Task's **current primary Step**. Moving that Task, removing the current Step,
removing media or revoking the capability removes that access. No raw-table or
cross-project volunteer access is granted. The bounded drawing reader below extends
this same capability boundary; real participant acceptance remains separate.

`20260924183913_drawing_source_status.sql` adds the caller/RLS-bound exact-revision
source assessment consumed by Project cards, Steps and the drawing detail. Its
source and preview behavior is owned by `Docs/artifacts.md`.

Release order for these corrections: double-check and apply both new migrations
in timestamp order, deploy the updated `ask-bob` and `bob-worker` bundles (shared
vocabulary and drawing reader), then release the frontend. Check ordinary-member
reads and volunteer revocation after deployment. No migration should classify
existing unorganised Tasks or rewrite saved drawing history automatically.


## Area archive and volunteer drawing reader — September 24, pending release

`20260924194300_area_archiving.sql` adds `areas.archived_at`, the guarded
`area_lifecycle_command` and project-scoped `area_lifecycle_events`. Archive/restore
compares the Area timestamp and records the named member. Archiving preserves the
Area identity, phase, completed Tasks, media and all current/historical plan references.
Unfinished Tasks, unfinished current Steps and pending proposals using the Area block
archiving. New/moved/reopened unfinished work cannot enter an archived Area; restore
it first. The database serialises competing plan/task and lifecycle changes. Archived
Areas no longer block Project phase completion. Permanent deletion keeps its older
history guards; archive never deletes evidence.

`project_work_read` and Bob's Area lookup include archive metadata. The Areas page
has active/archived filters; the Plan puts archived Areas in a separate group.
Historical Area and Task URLs remain readable. Active selectors exclude archives.

`20260924195744_volunteer_task_drawings.sql` adds the following capability endpoints:

| Endpoint | Boundary |
|---|---|
| `volunteer_drawings` | Active session + same-project Task; at most 20 current, non-archived drawings linked to its **current primary Step**, with an opaque UUID cursor. No geometry in the list. |
| `volunteer_drawing` | Same boundary plus exact current drawing revision; returns allowlisted metadata/render inputs and saved status/source warnings. No history browsing, raw-table grants or writes. |
| `volunteer_drawing_media` | Service-only byte-proxy authorisation for that Task, drawing revision and exact ready source image. Rechecked after download. No signed URL. |

The definer also checks explicit Project physical scope before releasing coordinate
or stair geometry; household/direct Building membership is not assumed or impersonated.
Room/wall and generated-wall sources retain the Project source checks. Unavailable
sources return metadata and `content: null`. CAD output includes only saved SVG views
and part dimensions, excluding manifests and STEP files. The render contract is owned
by [Artifacts](../Docs/artifacts.md#volunteer-task-drawings--september-24-pending-release).
Ordinary guest image access is not widened. Anonymous callers still cannot query
Artifact, physical-model or Storage tables, or edit drawings.

Apply the review migrations first, then these two migrations in timestamp order;
deploy the updated `volunteer-media` function before releasing this frontend. The
prior review's `ask-bob`/`bob-worker` deployment requirements still apply. Repository
checks do not deploy these changes. SQL tests use isolated test participants; browser
fixtures use the real frontend and guest transport at 320/390/1280 px. No real volunteer
acceptance has been claimed; the owner currently has no volunteers available.
