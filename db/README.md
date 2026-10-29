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
| Shown-model feedback | `bob.solution_presentations`, `bob.solution_model_feedback`; [Solution contract](../Docs/solutions.md#form-shown-feedback), [2c release](../supabase/README.md#form-feedback-release), [3D producer release](../supabase/README.md#form-construction-preview-release) |
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

Two of them are read, not trusted, by the data layer:

- `events.spots` — only the capacity half is authoritative. The taken half is
  recomputed from `event_attendees` on every read, because volunteer RSVPs and
  person removals change attendees without rewriting the string.
- `events.day` — the event editor saves an ISO date (`2026-10-11`); older
  authored labels (`Lör 5 juli`, `Sat 5 Jul`) are still parsed. "Next build
  day" is the soonest day on or after today (`src/lib/eventDay.ts`), not the
  first event by `sort_order`.

Area names are unique per project (case-insensitive, archived Areas included)
because `materials.area_label` links Shopping rows to an Area by name. Projects
that already hold two Areas with one name keep their materials untouched when
either Area is renamed or deleted.

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

<a id="material-model"></a>
## Normalized material model — installed 2026-10-29

**Installed 2026-10-29 with the reviewed seed** ([evidence](../Docs/foundation-verification.md#open-issues-closed-install-2026-10-29)). Owner decisions 2026-10-29. Source:
`supabase/migrations/20261029160000_material_model.sql`, the separate reviewed
seed `20261029160100_standard_materials_seed.sql` (generated by
`scripts/build-standard-materials-seed.ts` from `scripts/data/standard-materials.json`)
and the search publication `20261029160200_material_lookup_catalog.sql`. Descriptive
data columns are nullable; unknown stays unknown. Lengths are `*_mm`, weight `weight_kg`.

| Concept | Storage |
|---|---|
| Standard material | `bob.material_types`: name, material-axis category, description, review status. |
| Size | `bob.material_sizes`: label, form-axis category, `length_mm`, `width_mm`, `depth_mm`. Fasteners: `width_mm` is the nominal shank diameter, `length_mm` the length, `depth_mm` null. |
| Combination (material + size) | The existing material definition `bob.catalog_items`, now with `material_type_id`, `material_size_id` (both nullable), `unit_code` (`bob.catalog_units`; st = `pcs`), `weight_kg` and `review_status`. Constructions, cut lists and checks keep pinning its exact revision. One shared combination per material and size. |
| Alias | `bob.material_aliases`: one search word for exactly one material, size or combination (e.g. `2tum4` → the 45 × 95 size). Aliases never convert units. |
| Stock at home | `bob.household_stock`: household-owned row linked to a combination (or a name), nullable quantity, unit and location, revision and last change. Project stock `bob.stock_items` remains the project allocation ledger, unchanged. |
| Stores and prices | `bob.stores`, `bob.store_articles` (store, combination, article number, pack content) and append-only `bob.store_article_prices`. `bob.current_store_prices` gives the latest price per article and `last_changed_at`. `bob.supplier_articles.store_article_id` may name the shared article behind project supplier evidence. |

Shared tables are readable by signed-in callers and written only through
security-definer commands: `bob.add_material_type`, `add_material_size`,
`add_material_alias`, `add_store`, `add_store_article`, `record_store_price`.
Callers must be Bob project participants or active household members; new rows
are `unreviewed`, an equal existing row is reused, and only the service role sets
`reviewed`. Prices are inserted, never updated. `bob.save_household_stock` and
`bob.remove_household_stock` require active access to that household and the
expected revision. `bob.set_catalog_item_spec` links a project definition to a
material, size, unit and weight; shared definitions change only through the
service role. Two all-optional profiles (`roll_stock` on form `roll`, `piece` on
form `piece`) and the categories `mineral`, `mineral.gypsum`, `mineral.concrete`
and `bitumen` cover the starting list.

**Combined lookup (`bob.material_lookup(p_project, p_input)`).** One security-
definer function over base tables, not views on views. Row grain: one row per
combination and purchase place (store article); a combination without a store
article returns exactly one row whose store and price fields are null. Each row
has the definition id and current revision, material, size, unit, weight,
aliases, review flags, the caller's household stock (active households only),
the store, article number, latest price, currency, price unit, pack content,
source and when the price changed. Material, size, aliases and stock repeat on
every row of one combination. Input keys: `query`, `categories`, `after`, `id`.
Pages hold 12 rows at that grain with cursor `<definition>:<article>` or
`<definition>:-`, and the 30,000-byte envelope cap drops trailing rows. The
latest price uses `store_article_prices_article_idx`. Matching is not indexed:
the review measured a per-definition scan of `material_aliases` (15 ms live on
45 definitions, growing faster than linearly in PGlite), so a token index is a
later step if the catalog grows.

**Whole-word matching — installed 2026-10-29 (owner decision; [evidence](../Docs/foundation-verification.md#follow-ups-install-2026-10-29)).**
`20261029240000_material_lookup_matching.sql` replaces substring matching, which
also matched when the query merely contained an alias ("utomhusskruv" returned
indoor screws through "skruv"). Every query word must equal a word of the
definition's name, aliases, material, size label or their aliases, or be the
last part of a compound word in it ("skruv" finds "träskruv"); decimal commas,
`4,0` = `4` and `45x95` = `45 × 95` are normalized and `mm`, `cm`, `st` ignored
(`bob_private.material_tokens`). Definitions whose words all match exactly come
first. The cursor format is unchanged; a cursor whose definition no longer
matches raises `material_lookup_cursor_stale` instead of ending the list.
`stock_at_home` is null when nothing is recorded for the caller's households,
never an empty list that reads as "none at home".
`bob.catalog_read` also matches material, size and alias words, and adds a
`spec` object only to definitions with these links, so other records keep their
exact shape.

**Optional catalog properties — installed 2026-10-29** (owner
decision). `20261029210000_optional_catalog_dimensions.sql` patches
`bob_private.catalog_normalize` in place: a missing required field sets
`has_unknown` (no identity fingerprint) instead of raising
`catalog_missing_property`. Profile fields, revisions and
`bob_private.catalog_profile_immutable` are unchanged. It adds form `bulk`,
profile `bulk` revision 1 (all optional) and category `mineral.aggregate`.
Rationale and consumers: [material catalog](../Docs/material-catalog.md#optional-dimensions).

<a id="db-load-relief"></a>
## Database load relief — installed 2026-10-29

**Installed 2026-10-29** ([evidence](../Docs/foundation-verification.md#open-issues-closed-install-2026-10-29)). Source: `supabase/migrations/20261029190000_bob_db_load_relief.sql`.
The paid box run hit the 8 s statement timeout while the shared instance stalled
(a one-line cron job took 4–7 s at those moments). Bob's own statements caused
the load; measured read-only as the test owner:

| Statement | Before | After |
|---|---|---|
| `bob.bob_checkpoint_steps_page` / `bob_job_steps_page`, 1.8 MB journal, every claim | 460–645 ms (quadratic jsonb append) | ~50 ms (one `jsonb_agg` with a running byte sum) |
| `bob_private.artifact_source_assessment_before_physical`, construction or plain drawing, fresh connection | 100–165 ms planning (1,015-line plan) + 16–40 ms | ~14 ms planning + ~7 ms |

Every function keeps its name, arguments, settings, grants and result:

- The journal pages return the same entries, order, 100-row and 2,000,000-byte
  cut and `next` cursor as the loop they replace.
- `before_physical` and `before_parameters` now dispatch. Revisions with a
  generation, room layout, multifloor plan, stair study or space-measurement
  lineage use the original statements, kept as `..._full`. Every other revision
  uses a slim statement without those detail joins, whose terms are all false
  there.
- `before_construction_drawings` checks physical sources only when the
  construction has a space-measurement source node.

No runtime pin is needed; running and older jobs replay unchanged. Tests:
`tests/bob-db-load-relief.test.ts` (old vs new page for every cursor, size cut,
bootstrap and archived epoch; same signature, settings and grants) and
`tests/support/source-assessment-equivalence.ts`, which compares slim and full for
every revision at fixture states in the stored-status, exact-lookup,
artifact-generation and CAD source-renewal tests. Apply with the owner's OK; it
does not depend on an Edge deploy.

Owner follow-ups, not in this migration:

- `bob_save_turn_checkpoint` was the largest total (467 s in `pg_stat_statements`;
  2,514 calls, mean 186 ms, max 4.4 s on 2026-10-29): it returns the full state
  packet on every save, which the worker only compares with what it sent.
  **Short receipt installed 2026-10-29 (owner decision; `bob-worker` v154, `ask-bob` v186):**
  `20261029230000_bob_checkpoint_receipt.sql` adds
  `bob.bob_save_turn_checkpoint_receipt`, generated from the current private
  save by replacing its three packet returns, so every check and write is
  identical. It answers `{receipt_version, job_id, revision, unchanged}`; the
  worker builds its checkpoint from what it sent. The old function stays for
  older runtimes and the stored format is unchanged. Apply the migration before
  deploying `bob-worker` and `ask-bob`; a runtime without it cannot save.
- `cron.job_run_details` held 274,975 rows (76 MB) from 2026-07-10, shared with
  other apps. **Retention installed 2026-10-29 (owner decision):**
  `20261029220000_cron_run_history_retention.sql` deletes run history older than
  7 days once and then daily at 03:23 UTC (`cron-run-history-retention`). It
  prunes every app's run log in this project, nothing else.

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

`20260930174127_volunteer_instruction_images.sql` adds exact `steps[].images`
and general `contextImages` to `volunteer_task`, including image purpose. The
legacy `images` union is preserved for older clients. Only ready same-project
assets linked to that instruction or the existing task/Area/current-primary-Step
scope are returned; session, byte access and ACL rules are unchanged. Hosted
application and P4 acceptance are recorded in `Docs/foundation-verification.md`.

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


### September 24 review corrections — deployed

The coordinated backend/frontend release is complete.
[Foundation verification](../Docs/foundation-verification.md#september-24-work-and-drawing-release)
owns hosted timestamp mappings, Edge versions, live checks and remaining acceptance.

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


## Area archive and volunteer drawing reader — September 24, deployed

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
by [Artifacts](../Docs/artifacts.md#volunteer-task-drawings--september-24-deployed).
Ordinary guest image access is not widened. Anonymous callers still cannot query
Artifact, physical-model or Storage tables, or edit drawings.

Apply the review migrations first, then these two migrations in timestamp order;
deploy the updated `volunteer-media` function before releasing this frontend. The
prior review's `ask-bob`/`bob-worker` deployment requirements still apply. Repository
checks do not deploy these changes. SQL tests use isolated test participants; browser
fixtures use the real frontend and guest transport at 320/390/1280 px. No real volunteer
acceptance has been claimed; the owner currently has no volunteers available.


### Drawing query planning follow-up

The release's hosted read check exposed planner expansion through the nested source
views. `20260924211243_bounded_drawing_source_planning.sql` puts the same exact-revision
assessment behind `bob_private.artifact_source_assessment`, a stable **security invoker**
function with caller RLS and function-local join planning limits. The public
`artifact_source_status` view retains its API, grants and `security_invoker` setting.
Direct helper calls cannot read another Project or bypass revision scope.
`20260924211440_bounded_volunteer_drawing_planning.sql` bounds planning of the existing
volunteer detail reader's render joins. Capability checks and grants remain unchanged;
no database-wide configuration or API timeout is relaxed. Both follow-ups are deployed;
see the release evidence above.

`20260929045921_bob_drawing_requests.sql` adds private conversation-scoped drawing intake and replay receipts. Service-only `bob_drawing_request` checks the current owner/project/turn claim and optimistic revision; reset cascades working state. No browser grants or project measurement writes. The drawing workflow and release status belong to [CAD adapter](../Docs/cad-adapter.md#drawing-intake-and-complements--september-29-contract).

## CAD parameter lineage release

P1a/P1b were applied and deployed through [PR #160](https://github.com/EmelieHagander/Bob-the-builder/pull/160), extending the existing CAD revision/save/read boundary. Their historical migration order was: `20260929131000_cad_parameter_lineage.sql`, then `20260929170812_cad_physical_source_lineage.sql`. The second replaces the first validator while preserving its trigger identity and adds physical-source freshness to the existing invoker assessment/view. Hosted ledger timestamps may differ; record the filename-to-ledger mapping in the release PR. Never replay the shared migration history.

Before application, recheck main/head, the hosted ledger, active Bob jobs and existing `manifest.bob_lineage` use. Both migrations are transactional, with bounded lock/statement timeouts, and have no data backfill or cross-app schema writes. Apply them before deploying both `ask-bob` and `bob-worker` from the reviewed immutable commit. Preserve each endpoint's existing authentication configuration. The writer still enforces project/turn authority; physical reads additionally require this project's scope. Functions/views remain invoker-based; the trigger helper has no public executable grant.

After application, verify function/trigger/view definitions and permissions, then run `scripts/check-cad-lineage-release.sql`: synthetic identities and project records, authenticated-role source-bound save/read/detail, rejection of stale/denied sources, and unconditional transaction rollback. This validates hosted SQL with RLS, not an actual Auth login or HTTP/model delivery. Confirm no synthetic records persist and verify both deployed endpoints separately. Real user acceptance stays open in [State](../Docs/bob-delivery-flow.md#state).

Rollback is not transparent: an older writer may be blocked from revising tracked CAD or deriving from a tracked parent. Preserve the additive schema and historical metadata; do not drop the validator or strip lineage to restore writes. Diagnose the failing boundary before selecting a reviewed backend version. [CAD adapter](../Docs/cad-adapter.md#accepted-physical-parameter-provenance--p1b) owns the versioned metadata and remaining coverage limits; [building model](../Docs/building-model.md#accepted-physical-measurements-in-cad) owns the accepted physical state.

### CAD lineage concurrency verification

`.github/workflows/cad-lineage-concurrency.yml` runs `scripts/check-cad-lineage-concurrency.ts` on a disposable PostgreSQL 17 service using the same migration installer as PGlite. It requires `BOB_DISPOSABLE_POSTGRES=1`, local `PGHOST`, `PGDATABASE=bob_lineage_concurrency` and an empty database. It never uses hosted credentials. The canonical authenticated-role CAD writer races against measurement revisions, accepted room revisions, scope removal and Building archive in both orders. Independent sessions and an observed blocking PID establish actual overlap; an advisory barrier controls release without relying on sleeps for correctness. Source-first saves must fail without leaving a CAD row. Save-first delivery remains historical after the later change; unrelated delivery stays current.

This verifies the SQL concurrency boundary, not Auth/HTTP, model behavior or load capacity. Add cases here when new parameter dependencies introduce new source locks. Run details belong to [PR #162](https://github.com/EmelieHagander/Bob-the-builder/pull/162).


### Complete CAD parameter graph release

[PR #163](https://github.com/EmelieHagander/Bob-the-builder/pull/163) applied and deployed `20260929184327_cad_parameter_graph.sql` after P1a/P1b. The PR records the hosted ledger mapping, immutable runtime pin and release readback. It adds a private insert validator and strict numeric/frame helpers, extends the existing authorized metadata reader, and replaces the invoker source assessment without changing table authority. Historical rows are not backfilled. New CAD needs complete `bob_parameters`; genuine old detail and lifecycle copies retain `legacy_partial`. The [CAD owner](../Docs/cad-adapter.md#complete-numeric-parameter-graph-and-coordinate-frames--p1) defines the graph and frame semantics.

Before applying, recheck exact reviewed main, CI, pending ledger entry, active jobs and any pre-existing `bob_parameters` namespace. Apply only this pending migration, then deploy both Bob functions pinned to the reviewed merge commit with their existing authentication settings. Run the rollback-only release smoke, check definition/permission readback and verify no synthetic records persist. The concurrency suite now also covers graph-only physical/formula dependencies and referenced-image lifecycle changes. Actual release IDs, migration ledger mapping, endpoint versions and test limits belong in #163. Older runtime writers cannot create new untracked CAD after this migration; do not remove provenance or validators to bypass this boundary.

### P2a request recovery — deployed

`20260929220352_drawing_request_recovery.sql` was applied and deployed through [PR #165](https://github.com/EmelieHagander/Bob-the-builder/pull/165). The filename was generated by the pinned Supabase CLI in [bootstrap run 36637255390](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36637255390); the temporary workflow and pending SQL file were removed. The canonical migration installer now supplies all SQL fixtures. The PR owns the hosted timestamp mapping, runtime versions and verification evidence. Never replay shared migration history.

The migration adds private `saved_receipt`/`saved_input_hash` fields and guards the existing request RPC and CAD writer. It preserves claimed-turn locking, caller project authority, RLS and the original CAD/source/Step validations. Its renamed implementation helpers lose direct execution grants; public wrappers keep their intended service-only or authenticated authority. No public table, broader participant read, user data backfill or other app schema change is included. [CAD adapter](../Docs/cad-adapter.md#p2a--request-recovery) owns behavior and limits.

Before release, verify the exact final diff, green CI, target `yuobtgoidmmmwfqenkau`, pending ledger identity and quiescent Bob jobs. Prove concurrent duplicate writes and request-update/save serialization on disposable PostgreSQL. Apply only the generated reviewed migration, then deploy both `ask-bob` and `bob-worker` pinned to the reviewed merge while preserving endpoint authorization. The rollout requires quiescence: old runtime status-only completion is rejected and the new runtime expects the atomic writer. Verify save/read/replay/rollback under authenticated roles, restore all synthetic data, read back grants/definitions and check security advisors. Preserve additive schema and committed receipts on rollback; do not reopen completed requests or disable the validator to restore old writes. Record deployment evidence in the release PR, never infer it from local tests.


### P2b project drawing lifecycle — deployed

`20260930040222_project_drawing_request_lifecycle.sql` was applied on 2026-09-30 to `yuobtgoidmmmwfqenkau` as hosted ledger `20260930043233`, name `project_drawing_request_lifecycle`. [PR #167](https://github.com/EmelieHagander/Bob-the-builder/pull/167) owns the exact migration hash and release evidence: `ask-bob` v61 (JWT) and `bob-worker` v29 (private capability) both pin merge `de9871f86c64853ebe73ee2358ee112b2410a744`. The pinned CLI generated the name in [bootstrap run 36667057918](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36667057918); the temporary workflow is removed from the release tree. The [conversation owner](../Docs/ask-bob-conversations.md#p2b-project-request-lifecycle) defines privacy, reset, cancellation and the remaining recovery gates.

Only the caller-authorized command creates a stable header. Private claimed-server checkpoints project their status/revision into this operational record, and the existing caller CAD writer commits the header and exact receipt together. The member reader returns an explicit allowlist; no raw-table access, private-payload copying or backfill is introduced. All privileged helpers use an empty search path and explicit grants; renamed implementations cannot be called directly. Reset keeps the old command/claim lock order and fences incomplete roots before the private cascade. Cancellation takes the same actor/request locks as saving; completed/cancelled tombstones are not independently deleted.

For subsequent releases check exact main/head and CI, active jobs/turns and the migration ledger on `yuobtgoidmmmwfqenkau`. Apply only pending reviewed migrations, deploy both Bob functions pinned to the reviewed merge with existing JWT/capability modes, then run the rollback-only release smoke including post-reset receipt replay. Verify no synthetic records remain, read back helper grants and trigger definitions, and compare security advisors against the baseline. The new RLS-enabled private metadata table deliberately has no browser policy or raw browser grants. Preserve headers, receipts and cancellation fences during rollback; never switch to an older runtime that could bypass them for enrolled requests. Record hosted timestamp, source hash, runtime versions and evidence in the PR.

### P2c drawing restoration — deployed

`20260930045742_drawing_request_restoration.sql` was applied on 2026-09-30 to `yuobtgoidmmmwfqenkau` as hosted ledger `20260930052318`, name `drawing_request_restoration`. [PR #169](https://github.com/EmelieHagander/Bob-the-builder/pull/169) owns the exact migration hash and release evidence: `ask-bob` v62 (JWT) and `bob-worker` v30 (private capability) pin merge `54234be93a43fc0f3276e638e3301a925ea542f9`. Pinned Supabase CLI 2.117.0 generated its name in [bootstrap run 36671189503](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36671189503). The temporary bootstrap workflow is excluded from the release tree. [Conversation restoration](../Docs/ask-bob-conversations.md#p2c-explicit-request-restoration) owns the current requirement, privacy and bounded recovery contract.

The additive migration retains private plan/Step reference columns on the existing project header. `restore_drawing_request` is a caller-JWT invoker wrapper over the guarded private command, and `check_drawing_request` provides fresh owner-authorized status/current-plan checks. Restoration holds the existing actor/claim lock, then the request and plan; the canonical writer preserves project-head-before-plan lock order. Private checkpoints and completion reject a changed recovery plan. Raw table grants remain absent, privileged helpers use an empty search path and renamed implementations are not directly executable. No other app schema, credentials or existing budget accounting is modified.

For subsequent releases require final CI, disposable PostgreSQL races and exact tree review. Check target `yuobtgoidmmmwfqenkau`, pending ledger and quiescent Bob jobs/turns. Apply only pending reviewed migrations, then deploy both Bob functions with immutable reviewed source and existing JWT/capability modes. Run the rollback-only smoke including real reset, same-ID canonical restoration and atomic save/replay; read back migration, grants, endpoint versions and unchanged security-advisor baseline. Retain the additive columns and terminal receipts on rollback; do not deploy a runtime that can omit the restoration fences.

### P2 completion — deployed

`20260930062336_drawing_request_completion.sql` was applied on 2026-09-30 to `yuobtgoidmmmwfqenkau` as hosted ledger `20260930074831`, name `drawing_request_completion` (source SHA-256 `8f013db9179c2e78e317d7a8380519096bd07a73dd193a49b610f60090b8bd42`). The pinned CLI generated its filename in [bootstrap run 36677962220](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36677962220); the temporary workflow is absent from the release tree. [PR #171](https://github.com/EmelieHagander/Bob-the-builder/pull/171) owns the release proof, with subsequent code-only boundary repairs through #175. Both Bob runtimes pin reviewed merge `b7fa385fdaa6e69a91b8426980cf7d465385870f`: `ask-bob` v67 retains JWT verification and `bob-worker` v35 retains its existing private capability authentication.

The migration adds request-owned gap identities, deterministic request reuse, canonical Requirement→Task deduplication, model reservations/results, explicit budget grants, project event revisions, expiring sealed authorities and audited event attempts. Raw private-table access remains revoked and RLS enabled. Shared projection readers and owner commands use the caller JWT; service commands manage only private execution/accounting state. No other application's schema is changed. Bob-only shared AI usage receipts may reconcile late charges without resubmitting a model call.

Release order: review the exact tree and pass SQL, Edge, browser and real PostgreSQL concurrency gates; apply the migration; deploy matching `ask-bob` and `bob-worker`; verify authenticated event/receipt recovery and the frontend build. Existing worker signatures remain compatible. Older request charges are not guessed: pre-migration requests require a prospective explicit allocation. The current lifecycle/retention/authority owner is [Ask bob conversations — P2 completion](../Docs/ask-bob-conversations.md#p2-completion-events-gaps-and-request-accounting). Exact deployment and model proof belongs in [PR #171](https://github.com/EmelieHagander/Bob-the-builder/pull/171).


### Drawing budget removed — owner decision 2026-10-18

Drawing work has no application budget. `20261018194500_bob_drawing_budget_removed.sql`
makes every Bob job and owner task run without spending or call allotments,
including automatic drawing jobs for an older owner message (they get the
active catalog pin). `bob.grant_drawing_budget` and the "Add request budget"
UI are removed. `drawing_budgets`, `drawing_budget_periods` and
`drawing_model_calls` remain only as a per-request cost log and to reuse
already paid results; an uncertain pending provider call still blocks a
duplicate paid attempt. The cap and grant sections below are historical.
Expired unlimited jobs pause for credential renewal instead of failing.

### Atomic drawing continuation — 2026-10-18

`20261018121638_drawing_atomic_continuation.sql` makes a successful
`bob_drawing_request(save)` the only owner-turn transition. The existing claim
and request locks cover packet CAS, period archival, origin turn, observed event
and the exact running job's sealed authority in one transaction. A failed save
rolls everything back; load/list and model reservations cannot move ownership.
Read-only `continuation_required` metadata lets CAD checkpoint the retained
packet before reusing an unchanged stop. Only a former cost stop is released;
quality evidence and its no-new-attempt guard survive. Exact write receipts are
bound to their original turn. Ambiguous executions,
changed scope, mismatched packets and archived turns fail with explicit codes.

The canonical request function replaces and drops all five `before_*` delegates
and `begin_drawing_budget_period`. Orphan private packets fail with
`drawing_request_legacy_unsupported`; old source-less requests cannot implicitly
adopt a different construction scope. Migration history and historical saved
Artifacts remain readable. Reset, explicit restoration, cancellation, source
checks and canonical completion receipts retain their existing boundaries.

The event scheduler checks that origin and accounting turn agree before creating
a job. Existing contradictions receive `drawing_continuation_mismatch`; the
migration does not guess a message, credentials or source revision. An ordinary
claimed owner message can recover the same registered request through a valid
save. Automatic jobs cannot reopen an archived owner period.

`drawing_budgets` and `drawing_budget_periods` retain current and historical
accounting; every model reservation belongs to its original numeric period.
Late receipts settle there exactly once, and usable paid results remain reusable.
The current unlimited-work policy still comes from the pinned execution; the
October 12 $3/24 rules are historical, not a new allocation policy. Unknown
provider outcomes remain fenced. Tables retain RLS and no direct client grants.

The old October 12 load-side period switch is superseded. Installation and
verification belong to [release evidence](../Docs/foundation-verification.md#atomic-drawing-continuation--2026-10-18).

### Owner task budget periods — 2026-10-12

Historical migration `20261012090214_drawing_task_budget.sql` introduced period
accounting and the former $3/24 allocation. Its read-side transition is superseded
by [atomic continuation](#atomic-drawing-continuation--2026-10-18); current work
policy is [unlimited](../Docs/ask-bob-conversations.md#active-memory-and-continued-work--2026-10-17).

### Task attempt and submission identity — 2026-10-13

`20261013120145_ai_submission_guard.sql` adds nullable preparation/submission
state to the existing private AI job. The two new service-only RPCs separate
local preparation from one guarded submission intent; terminal state and expiry
are rechecked immediately before POST. Legacy NULL state preserves uncertainty.
The two-minute no-receipt window begins at submission intent for guarded jobs.

`20261013120146_drawing_task_attempt_recovery.sql` adds canonical `input_key`
and an optional `uncertain_prior_key` link under the existing CAD reservation.
An expression index allows one canonical input per request and task period.
Current-task work and active older work remain fenced. After a genuinely new
owner instruction, a terminal unusable older attempt can have a distinct opaque
provider fingerprint. Its old reservation and late pricing stay in the original
period. Completion supports old callers' canonical keys with exact execution
binding; provider recovery retains the actual historical provider fingerprint.
Known never-submitted preparations settle at zero, while legacy missing
receipts remain unknown. Paid usable results are reused and no new owner turn,
budget grant or project result is created by installation.

Install the two cores, deploy their matching Bob/shared closures, then activate
`20261013131820_ai_task_resume_catalog.sql`. It publishes two immutable Bob
definitions, keeping the server ledger out of model guidance and preserving
unrelated settings and pinned manifests. [CAD](../Docs/cad-adapter.md#terminal-attempt-recovery--2026-10-13)
owns the task mandate and [verification](../Docs/foundation-verification.md#integrated-task-recovery--2026-10-13)
owns the release evidence.

### Drawing request allocation — 2026-10-09

Source migration `20261008160000_drawing_budget_3usd.sql` implements the owner's
$3 allocation for a drawing request. It raises the default and tracked open
requests below $3, retaining all calls and charges. A prior cost-stop retry
fingerprint is released and a project event is bumped; saved, cancelled and
legacy-untracked requests are excluded. Grants, uncertain outcomes, caller
authority and canonical save receipts keep their existing boundaries.

The October 9 investigation found the migration absent and the hosted default
still $1. After [PR #234](https://github.com/EmelieHagander/Bob-the-builder/pull/234),
worker 61 was deployed before ask-bob 93, then the exact existing migration was
applied as **20261009194934 / drawing_budget_3usd**. Readback confirms default $3
and two tracked open-request upgrades, preserving spent USD, call counts,
drafts and other working data while clearing their cost-stop retry fingerprints.
[Release evidence](../Docs/foundation-verification.md#drawing-request-loop-budget-release--2026-10-09)
records source hashes and acceptance limits; [CAD budget and review](../Docs/cad-adapter.md#drawing-request-budget-and-review--2026-10-09)
owns the runtime contract. Do not reapply this migration.

### Drawing recovery status — 2026-10-09

`20261009203935_bob_drawing_recovery_status.sql` adds read-only `drawingRecovery`
metadata to the existing caller-only `bob_job_status` API. It scopes proof to
the current member's active private thread and exact originating owner turn.
Completion requires saved Artifact receipts for all linked requests, existing
Artifact revisions and matching completed event replies; fresh event executions
can report queued/running progress. The original ordinary job status, failed
messages, budget and saved project records remain unchanged. No read enqueues
work. Existing invoker wrapper, private helper grants and empty search path are
retained; reset/revoked/foreign access cannot inherit recovery proof.

The reviewed migration was applied as **20261009210458 /
bob_drawing_recovery_status** after
[PR #235](https://github.com/EmelieHagander/Bob-the-builder/pull/235). Private-body
and public-wrapper/OID/grant readback match the reviewed source. A rollback-only
SQL role probe confirmed current queued/completed status, reset isolation,
outsider/anonymous denial and unchanged request, budget, job and message counts.
The old private turn returns no status after the owner's reset; its saved project
Artifact remains. No Edge deployment was required. The
[conversation owner](../Docs/ask-bob-conversations.md#exact-drawing-request-recovery-status--2026-10-09)
owns the released display/retry semantics; [incident and release evidence](../Docs/foundation-verification.md#drawing-recovery-status-investigation--2026-10-09)
owns exact source pins, Pages proof and the remaining ordinary browser acceptance.
Do not reapply this migration.

### P3 screen context and source changes — applied

Migration `20260930112431_bob_p3_context_and_source_changes.sql` adds private `bob_turn_screens` keyed by logical thread/turn, strict pointer validation, claimed-turn capture, v2 enqueue and claim/status recovery. Original focus, including omission, is immutable across retries; JSON object key order does not create a different pointer. Service-only capture/enqueue/claim commands retain actor/generation assertions; private rows have no browser-readable policy. The authenticated status endpoint returns only the initiating user's permitted turn. Screen pointers contain no fact labels, credentials or private assessment prose.

The same migration adds invoker `artifact_source_changes` for bounded revision/hash deltas and makes request-work hydration caller-bound. Shared complement labels resolve canonical Tasks/current Plan requirements and responsibility; private briefs and assessment text are excluded. Physical/media source revocation hides inaccessible identities, preserving the existing RLS boundary. [Artifacts](../Docs/artifacts.md#parameter-sources-changes-and-request-complements--p3-deployed) owns user-facing meaning; [context](../Docs/ask-bob-context.md#implemented-scope-and-remaining-target) owns model consumption.

Applied to `yuobtgoidmmmwfqenkau` as `20260930151621` / `bob_p3_context_and_source_changes` after checking the exact prerequisites. Hosted rollback role/RPC checks and definition/grant readback passed; matching Edge and Pages releases are recorded by [verification](../Docs/foundation-verification.md#p3-hosted-technical-release--2026-09-30). SQL-role and intercepted-browser proof remain distinct from ordinary Auth/model evidence. [State](../Docs/bob-delivery-flow.md#state) retains ordinary named-member background/private-readback acceptance.


### P4 private drawing event delivery — applied

`20261002102040_p4_drawing_event_delivery.sql` adds service-only
`bob_finish_drawing_job` with a guarded private implementation. It completes the
existing event and delivers its runtime answer to the exact private thread in one
transaction, retaining the original user turn. Evidence is derived from the
canonical request receipt. Fresh membership, request status, claim and expiry
checks fence stale delivery; the actor lock and request row lock serialize it.
The old finish command remains the compatible error/cron path. No new raw table
access, Auth identity, shared-app change or model setting is introduced.

Hosted ledger `20261002104656 / p4_drawing_event_delivery` and the matching
`ask-bob` v71 / `bob-worker` v39 release are verified in
[the evidence owner](../Docs/foundation-verification.md#p4-replay-and-event-delivery--2026-10-02).
Rollback retains the additive command and canonical receipts; drain jobs before
replacing workers. Do not replay an old transcript against incompatible inputs.


### Drawing request conflict response

**Applied on 2026-10-02** to `yuobtgoidmmmwfqenkau` as ledger `20261002175325 / drawing_request_conflict_response`; matching `ask-bob` v72 and `bob-worker` v40 pin merge `0aa458cfc00dde62e271da1c91c8bf2e2dc88b26`. CLI-generated
`20261002170009_drawing_request_conflict_response.sql` wraps the existing service-only
`bob_drawing_request` command. Known deterministic drawing conflicts retain their
message but return SQLSTATE `PT409` (HTTP 409), avoiding PostgREST 14's internal
retry loop for custom `40001`. Other serialization failures retain their original
code. Authority, immutable scope, lifecycle, event transaction and receipt replay
remain delegated to the existing implementation; its direct grants are revoked.
No table data, policy, model setting or budget changes.

Review the exact tree and CI/concurrency results, target `yuobtgoidmmmwfqenkau`,
pending ledger and quiescent jobs. Apply only this migration, then release matching
`ask-bob` and `bob-worker` with their existing authentication modes. Verify conflict
code/message, unchanged packet/revision, receipt replay and grants, then read back
both runtimes. Do not undo the transport correction to recover a failed model run
or rewrite the user's request. Hosted evidence and remaining real shelf acceptance
belong to [verification](../Docs/foundation-verification.md#shelf-scope-conflict--2026-10-02).


### Drawing budget diagnostics — K0, applied

`20261002191430_drawing_budget_diagnostics.sql` is CLI-generated and **applied** to
`yuobtgoidmmmwfqenkau` as `20261002194012 / drawing_budget_diagnostics` on October 2.
It replaces the existing service-only `bob.bob_drawing_budget` in place without
changing its signature, claim/access validation, private tables, thresholds,
reservation identity or grants. Blocked results add numeric `budget_stop`
metadata and reasons; existing status strings and stored provider responses stay
compatible. Matching `ask-bob` v73 and `bob-worker` v41 pin reviewed merge
`503e97f2ac3691d8bde94a2281e1c3cce04a7e61`; the code also handles older
database responses as an unknown cause. SQL regressions
exercise stop reasons, replay, cleared context and caller denial. [K0 evidence](../Docs/foundation-verification.md#k0-construction-boundaries--2026-10-02)
owns investigation and release status.

### Versioned construction checkpoints — K1, applied

CLI-generated `20261002203012_construction_drafts.sql` adds the project-RLS
`artifact_construction_revisions` extension under existing Artifact identities,
`read_construction_draft`, and claimed-turn `bob_project_write_v14`. Direct client
writes and service-role grants on the new endpoint/table are absent. The private
write function checks the claim, current request, project/person authority,
expected revision, source locks, canonical target and catalog pins, then records
readback in the existing receipt ledger. Conflict responses use `PT409`, avoiding
PostgREST's automatic serialization retry loop for known domain conflicts.

The migration extracts the existing CAD parameter trigger body into a shared
validator. Existing rendered CAD retains the same validation and archive/detail
exceptions; checkpoints disable historical bypass. A deferred guard prevents any
older Artifact/CAD command from discarding a checkpoint. The existing freshness
view now also assesses catalog/physical pins for construction revisions. All new
functions have empty `search_path`; reads use invoker/RLS authority. No existing
project records, budgets, model configuration, material reservations or orders
are rewritten. See [Artifact contract](../Docs/artifacts.md#k1-construction-checkpoints)
and [verification](../Docs/foundation-verification.md#k1-construction-checkpoints--2026-10-02)
for release state and scope.

K1 applied to `yuobtgoidmmmwfqenkau` as hosted ledger
`20261002220943 / construction_drafts`. Source migration SHA-256:
`38dbed5d3f94caf00726ae82e8cfaf676a6474678ea6ba667be38b1ac41b2992`.
The rollback-only hosted check passed create/read/revise, replay, history,
stale-write rejection and outsider denial. RLS, function grants, tool catalog
and rollback cleanup were read back; security advisors match the pre-release
baseline. The immutable Edge release is recorded by the verification owner.

### K2 construction check registration

`20261002231320_construction_checks.sql` registers the read-only `check_construction_draft` tool and updates the existing save-tool guide. It adds no tables, privileges, RPCs or approved-construction state. The Edge checker reads exact checkpoints/catalog definitions through the existing invoker/RLS boundary and returns transient revision-bound evidence. Invalid checkpoints remain editable drafts. Check results cannot bypass CAD publication or be written as fabrication approval. See [Artifacts](../Docs/artifacts.md#k2--construction-concept-checks) for the checker contract and [verification](../Docs/foundation-verification.md#k2-construction-checks) for release status.

### CAD research execution attribution

`20261003210307_cad_research_execution_role.sql` adds `cad-research` to the existing `bob.execution_events` role constraint. It preserves the original roles, historical `other` rows, RLS and service-only grants. Apply the additive migration before the matching metrics writer. Hosted history records it as `20261003214005`, `cad_research_execution_role`; [verification](../Docs/foundation-verification.md#cad-research-execution-attribution--2026-10-03) owns release/readback evidence and remaining authenticated acceptance.

## K3 checked construction drawing publication

Additive migration `20261004112211_checked_construction_drawings.sql` guards new CAD packets pinned to existing construction revisions. It reuses Artifact identities, full CAD parameter graphs, caller reads and claimed-turn receipts; no new construction/BOM register or write surface is added. Publication locks source/catalog heads and compares the complete recipe apart from requested views, parameters and target/Area. A drawing revision cannot silently drop/change construction identity; exact archive/restore copies keep history. Source assessments include construction/catalog drift. `read_cad_artifact` adds only safe annotation/source-pin metadata under its existing project authority. No auth/RLS policy or model settings are weakened. [Artifact contract](../Docs/artifacts.md#k3--exact-construction-drawing-lineage) owns behavior and [verification](../Docs/foundation-verification.md#k3-checked-construction-drawings--2026-10-04) owns actual migration/release status.

## Construction data authority and remaining extensions

**Release B's bounded command and typed drawing relation are merged, migrated and deployed through [PR #244](https://github.com/EmelieHagander/Bob-the-builder/pull/244).** The earlier [database review](../Docs/foundation-verification.md#database-relationship-review--2026-10-10) records the foundation before this change; [release B verification](../Docs/foundation-verification.md#bounded-construction-changes--release-b) owns exact migration/runtime/catalog readback and remaining real acceptance. [Delivery State](../Docs/bob-delivery-flow.md#state) owns remaining work; [Artifacts](../Docs/artifacts.md#parameter-changes-before-drawing--specified-2026-10-10) owns the bounded-change/version contract. Other extensions below remain planned.

The database already supports separate construction and drawing identities, exact revisions, historical source links and guarded writes. Construction recipes, parameter graphs, material pins and joints are versioned JSONB in `artifact_construction_revisions`. JSONB is suitable for this variable assembly graph: the SQL validators check units, recompute derived values, verify source versions and preserve the meaning of reused identities. Replacing it with one generic row per number would not supply missing semantics or repair the AI handoff.

Material provenance in `material_requirement_construction_sources` and saved `material_cut_plan_revisions` has composite foreign keys to exact construction revisions. Requirement, cut-plan, stock and purchase links also retain exact revisions. Release B adds `artifact_construction_drawings`, keyed by drawing Artifact/revision, with same-project foreign keys to the drawing and exact construction revision and indexes for downstream source lookup. The existing `validate_cad_construction_source` trigger retains source-head locks and equality of saved geometry/parameters. The typed relation derives only from its validated `manifest.bob_construction` pin; a mismatch on update is rejected. Existing pinned history is backfilled without editing CAD/construction records; legacy absence stays explicit. The CAD table's `source_artifact_id/source_revision` still refers to another **CAD** revision and is not reused for this relationship.

`prepare_construction_parameter_change` checks caller authority, active claimed turn, quote, current nonarchived construction and the existing receipt ledger. The guarded writer repeats these checks under the project lock, reconstructs unchanged metadata from the database and delegates to existing construction readiness/parameter/source validators. It consumes one ordinary write receipt, with the canonical delta stored independently of compiled geometry for exact replay. Authenticated callers may read the new relation under project RLS; they cannot mutate it. `read_cad_artifact` returns its typed `construction_source` or null for genuine legacy absence; the runtime consumes that source identity. Install `20261010222601_construction_parameter_changes.sql`, deploy both compatible Bob functions, then activate `20261010222920_ai_construction_parameter_catalog.sql`. Existing immutable AI manifests and all role/model settings are preserved.

**Corrected text with a change — installed 2026-10-29.** `20261029170000_construction_text_updates.sql` lets `prepare_construction_parameter_change`, `prepare_construction_edit` and their writers accept an optional `data.text` `{title, description}` (validated by `bob_private.valid_construction_text`: both strings, title 1–200 and description 1–5,500 characters). Absent or null keeps the saved title and description exactly as before, so existing receipts and replay are unchanged. The migration patches the live definitions in place and stops if any anchor is missing. [Behaviour and the runtime size check](../Docs/artifacts.md#construction-text).

Release C adds `artifact_construction_origins`, keyed by exact legacy drawing ID/revision, with same-project foreign keys to the drawing and initial construction revision. Source and project foreign-key lookups are indexed. Authenticated has project-filtered SELECT only; direct mutation, anon and service table grants are revoked. No historical records are backfilled or rewritten. `read_cad_artifact` exposes nullable `construction_transition`; `construction_source` continues to identify only a rendered K3 revision.

`prepare_legacy_construction_transition` is an authenticated claimed-turn RPC with fixed empty search path, quote/key guards, exact receipt replay, project/head locks, readiness and source checks. The private writer repeats preparation, delegates creation to the existing construction validator or reuses an exact matching checkpoint, then stores one receipt and exact origin atomically. `validate_legacy_construction_transition` requires this origin when a historical CAD identity first acquires a construction pin; the baseline topology/stable IDs survive numeric corrections. Existing K3 guards remain authoritative for current sources, checked geometry and later identity retention. Install `20261011070724_legacy_construction_transition.sql`, deploy both compatible Bob functions, then activate `20261011071316_ai_legacy_transition_catalog.sql`. Old pinned manifests and role/model settings remain unchanged. See [Artifact transition](../Docs/artifacts.md#legacy-drawing-transition--release-c) for gap and history semantics.

| Boundary | Reuse / remaining change |
|---|---|
| Parameter correction | Release B reuses the saved graph, stable node IDs, expected revisions, claimed-turn receipts and checks through the bounded command and downstream exact-checkpoint read. Acceptance/installation evidence lives with verification, not in the schema alone. |
| Meaning of measurements and parts | D adds exact [instance role/quantity policy](#instance-policy-and-change-work--release-d). Measurement property/reference points remain a separate extension. Current source/decision/estimate/derived node roles already distinguish numeric provenance; they do not identify a reference-only part or define what a free-text project measurement measures. Preserve legacy uncertainty. |
| Construction-to-drawing lookup | B supplies the indexed exact rendered reference; C supplies the guarded legacy origin and first-pin transition. D supplies [persisted affected-output continuation](#instance-policy-and-change-work--release-d). |
| Consequence continuation | Reuse existing typed source links, freshness checks and request/receipt recovery. D persists the affected-output work and results so interruption can resume it; a new revision must not silently rewrite reservations, purchases or performed work. Exact storage belongs with the existing domain/workflow owners, not a second universal facts register. |
| Supplier evidence and delivery status | Captured product-source evidence needs a structured reference that extracted fields can cite, plus ingestion/validation. Delivery status already has authoritative receipts; consuming them in code is a runtime fix and does not require another status table. |

These are targeted contract, relationship and workflow extensions. The reviewed findings do not justify replacing Postgres, rebuilding all tables, or treating a schema addition alone as closure of the end-to-end flow.

### Instance policy and change work — release D

`artifact_construction_instance_policies` is an immutable child of the same-project exact construction revision. Version-1 JSON is validated against every recipe instance and fixed role/quantity pairs. A deferred inheritance trigger carries previously classified stable IDs to later constructor revisions; no historical rows are backfilled. The original eight-column constructor table and CAD recipe contract stay unchanged. `read_construction_draft` adds nullable exact `instance_policy`; the CAD reader joins the exact typed drawn source. Legacy reader bodies live in `bob_private`, not as new public RPCs.

`construction_change_sets` uniquely pins one same-project constructor/from/to revision. `construction_change_items` has exactly one typed drawing, requirement, cut-plan or Step identity, with foreign keys to the original and completed exact output versions. The deferred constructor trigger captures linked current outputs after policy inheritance. Normal canonical source writes complete matching pending items; completed revisions/readback and public receipts where available survive interruptions. Steps instead require a current-plan review and preserve performed work. Queue tables have project-filtered SELECT only; direct authenticated/anon/service mutations are revoked.

`prepare_construction_role_change` and `prepare_construction_consequence` bind authenticated project authority, current claimed turn, exact request quote, operation key/replay and project lock. The outer existing v14/v16 writer repeats preparation and delegates data writes to the normal domain commands. Current reservations, Shopping/purchase commitments and allocations return explicit review blockers; there is no automatic release. Role-aware requirement selection and independent SQL cut replay preserve existing identity/quantity/source/capacity guards. Old layouts and version-1 quantity history are not rewritten.

Legacy/manual linked needs are captured without inferring missing model inputs; preparation returns `needs_requirement_model` until explicit canonical derivation supplies a typed exact source. A deferred current-archive trigger can retire a no-longer-required need under the current construction head without inventing a model. Cut-plan reserve/publish wrappers require all current roles to be known, including for historical plans. Unknown roles suppress current coverage without releasing held capacity. Release/withdrawal retain the previous command bodies; old helper aliases have no authenticated execution grant.

Install `20261011090115_construction_instance_roles.sql` and `20261011091128_construction_change_work.sql`, deploy the matching ask-bob and worker closures, then activate `20261011093016_ai_construction_consequences_catalog.sql`. Only the reviewed Bob contracts/catalog rows change; model/role settings and unrelated apps remain untouched. [Artifact](../Docs/artifacts.md#instance-roles-and-affected-outputs--release-d) owns semantics and [verification](../Docs/foundation-verification.md#construction-instance-roles-and-consequences--release-d) owns actual installed versions/readback.

## K4 construction blank requirements

`20261005173845_construction_blank_requirements.sql` adds provenance under existing `material_requirement_revisions` in `bob.material_requirement_construction_sources`, with project RLS and caller SELECT only. The construction-capable `material_requirement_cad_command` uses ordinary project access, current Artifact/catalog source checks, canonical instance counting and the existing material arithmetic/write receipts. New writes cannot forge quantity or deterministic identity. A project lock serializes duplicate-active-source checking, write and reservations; changed source or expected revision conflicts. Historical provenance stays pinned.

The invoker current-requirements view also checks construction source freshness without changing its existing column order, sheet-layer data or Area-scoped target selection. Construction-bound blank needs cannot allocate stock/reuse or publish to Shopping until cut fit is supported; the guard also covers manual requirements with that source. Legacy CAD and other material methods remain available. Only the new read tool and existing derive tool guide are registered; authentication and model settings are unchanged. [Material contract](../Docs/material-planning.md#k4-construction-blank-needs--2026-10-05) owns scope; [verification](../Docs/foundation-verification.md#k4-construction-blank-lists--2026-10-05) owns release status.

## K4 saved cutting plans

`supabase/migrations/20261006094400_construction_cut_plans.sql` is additive: optional structured format on existing stock revisions; versioned material cut plans and exact requirement links; project RLS; independently replayed layouts; invoker reads and caller-claimed `bob_project_write_v15`. Other write kinds delegate unchanged to v14. Plans use the existing receipt/claim budget and project/source locks, current construction/catalog/requirement pins and optimistic revisions. There is no new reservation or Shopping authority. Existing stock revision/lifecycle commands preserve format when omitted; their renamed implementation is no longer directly executable by authenticated clients. New reads/writes have no anon or service-role grant.

Before applying, inspect current main/reviewed migration, hosted prerequisites and ledger, retained fixture/conversation and security/performance advisor baseline. Apply only this migration, then read back definitions, invoker views, grants/RLS and original record counts/digests. Deploy both Bob functions from the same immutable reviewed source before activating the protected saved-plan model workflow. The installed CLI crashed during migration creation; the filename uses the actual UTC fallback, not a claimed successful CLI run. [Material planning](../Docs/material-planning.md#k4-saved-cutting-plans--2026-10-06) owns scope and [verification](../Docs/foundation-verification.md) owns release evidence.

Applied to the existing hosted project as `20261006103025` / `construction_cut_plans`; hosted role/rollback/grant checks and unchanged original record digests passed. Matching immutable Edge releases are recorded in [verification](../Docs/foundation-verification.md#k4-saved-cutting-plans-technical-release--2026-10-06-1031z). Ordinary member/model saving acceptance is separate.

`20261006103941_cut_plan_bounded_read.sql` is the focused readback repair: one shared construction source assessment, direct current Artifact/requirement head checks and the existing effective Area target selector. It changes no data, write authority, reservation logic or statement budget. Apply only after exact-head review/CI; verify the same persisted plan through ordinary repeated HTTP reads, not a replacement paid model turn. [Verification](../Docs/foundation-verification.md#k4-saved-plan-model-outcome-and-readback-repair--2026-10-06) owns the timeout diagnosis and repair status.

The read repair is applied in the existing project as `20261006110059` / `cut_plan_bounded_read` from reviewed #212 merge `be8fad6646464326bf59b0217f53c120c0a79d76`. Exact body/ACL/RLS and unchanged 8-second authenticated budget were read back. Original and saved-plan full-row digests are unchanged; ordinary-password repeated readback of the same completed model plan passed without a new turn. [Verification](../Docs/foundation-verification.md#k4-saved-plan-readback-acceptance--2026-10-06-1103z) records separate initial failure, repair release and final acceptance.

## K4 shared cut-plan reservations — deployed technical boundary

`20261006111116_cut_plan_stock_reservations.sql` adds reservation head/history and whole-sheet allocation links beneath existing cut plans, project RLS/SELECT-only grants, guarded invoker commands and normal claimed-turn v16 writes. Existing needs/layouts are not revised. One private stock sum covers both current manual allocations and explicit held plan reservations, including stale commitments until release. The one older arithmetic stock sum is replaced with an asserted exact body match, preserving OID/ACL and all other behavior. Indexes cover reservation/current/source access and FKs. The installed migration CLI has already aborted in this workspace; actual UTC fallback naming is documented. Apply only after reviewed exact-head CI, ledger/baseline/checkpoint inspection; verify definitions/grants/RLS/advisors and all retained original/plan digests afterward. [Material planning](../Docs/material-planning.md#k4-shared-whole-sheet-reservation--2026-10-06) owns the contract and [verification](../Docs/foundation-verification.md) the release evidence.

The reviewed migration is installed in the existing project as `20261006163926 / cut_plan_stock_reservations`. Exact source/ACL/RLS, the unchanged 8-second authenticated budget, rollback-only reservation/authority behavior and original-data preservation are verified. [Hosted release evidence](../Docs/foundation-verification.md#k4-shared-sheet-reservation-hosted-release--2026-10-06) supersedes the earlier connector blocker; do not reapply the migration.


## K4 catalog-sheet Shopping — deployed technical boundary

`20261006184919_cut_plan_shopping.sql` adds immutable contribution history beneath existing cut plans and compatible-group links to existing Shopping rows, not a second purchase register. Project RLS gives members SELECT only; guarded invoker commands enforce current source/plan/Shopping revisions and serialize aggregate changes under the existing project lock. The deployed v16 writer ABI gains the new kind while retaining its former dispatcher as a private delegate. Migration creation uses the observed UTC filename fallback after the previously recorded native CLI crash. The [material owner](../Docs/material-planning.md#k4-catalog-sheet-shopping-contributions--2026-10-06) owns the exact scope and remaining gates. Applied as `20261006192055 / cut_plan_shopping` on the existing project. Exact function bodies, grants/RLS, unchanged 8-second budget and rollback-only publication/withdrawal/authority behavior passed. [Release evidence](../Docs/foundation-verification.md#k4-catalog-sheet-shopping-release--2026-10-06) owns the verification and remaining ordinary member/model acceptance.


## K4 mixed sheet supply — deployed

`20261006211841_cut_plan_mixed_supply.sql` replaces only the two existing guarded commitment functions and the combined plan reader, then updates the two tool manuals. Stock allocation and Shopping contribution derivation filter actual used sheets by their existing source kind; no new tables, policies, writer ABI or timeout changes. Existing privileges are retained by CREATE OR REPLACE. The CLI again aborted in its native Bun runtime even for `migration new --help`; the filename uses observed UTC. [Material planning](../Docs/material-planning.md#k4-mixed-stockcatalog-supply--deployed) owns independent partial-success semantics and exact coverage fields. Applied as `20261007090620 / cut_plan_mixed_supply`; exact bodies, authority/RLS/manual parity, unchanged 8-second budget, rollback-only mixed behavior and retained-plan member readback are [verified](../Docs/foundation-verification.md#k4-mixed-sheet-supply-hosted-release--2026-10-07).


### Mobile CAD display cache

`20261010070522_cad_viewer_exports.sql` adds a rebuildable `bob.cad_viewer_exports`
sidecar and the service-only invoker RPCs `claim_cad_viewer_export` /
`finish_cad_viewer_export`. The key is immutable CAD revision, recipe hash and
display profile. Project members may read matching rows under RLS; anonymous
reads, member writes and member RPC execution are denied. Claiming serializes
preparation with a finite lease and three explicit attempts; completion fences
old/expired workers. Source rows and Artifact revisions remain unchanged.
[Mobile CAD](../Docs/cad-adapter.md#mobile-cad-viewer--2026-10-10) owns the viewer
and cache contract. [PR #239](https://github.com/EmelieHagander/Bob-the-builder/pull/239) applied this migration as hosted ledger `20261010081013_cad_viewer_exports` and records exact function bodies, RLS/grants and Edge/Modal/Pages readback.


### Common calculator read boundary — 2026-10-12

`20261012060203_project_calculator.sql` adds no tables or domain writer ABI.
Invoker `read_calculation_source` reopens exact project/physical-authorised
multi-floor, stair and material revisions; current readiness is separate from
historical results. Authenticated receives EXECUTE only; anon/service/PUBLIC do
not. Existing RLS/PKs cover exact source reads. Private immutable
`material_purchase_math_v1` is shared by purchase replay and the canonical
writer's asserted unchanged arithmetic block, preserving existing ACL/locks.
The core is installed as `20261012073221 project_calculator`; both reviewed Bob
runtimes precede `20261012073416 ai_calculator_catalog` activation. Do not repeat
these migrations. Earlier AI manifests/model settings
and saved revisions are unchanged. The [tool owner](../Docs/ask-bob-tools.md#common-calculator-v1--implementation-2026-10-12)
owns method coverage and the [verification owner](../Docs/foundation-verification.md#common-calculator--2026-10-12)
owns actual release/readback and remaining model acceptance.


### Server-bound solution actions — technically deployed 2026-10-14

`20261014114416_server_bound_solution_actions.sql` adds the caller-scoped
`read_bob_solution_context` invoker and claimed-turn v18 writer wrapper. Creation
binds an optional existing solution head; selection binds a scope target and
solution revision; evidence additions bind exact measurement revisions or image
timestamps. The existing solution/domain commands remain authoritative. All
operations preserve exact receipts and project serialization, with source checks
after exact retry lookup. Selected evidence updates delegate the atomic v17
solution-plus-target operation. No table, data backfill or global setting change
is introduced. Apply core, deploy both Bob runtimes, then publish
`20261014114816_ai_solution_actions_catalog.sql`. The v17 and v18 slices are installed;
[release evidence](../Docs/foundation-verification.md#server-bound-solution-actions--2026-10-14) separates installation from ordinary-member/model acceptance.


### Server-bound work records — partial installation 2026-10-15

`20261014121359_server_bound_work_records.sql` adds caller-scoped invoker work
snapshots and paged reads, plus the claimed-turn v19 wrapper. The runtime binds
content deltas, creates, relation changes and state actions to complete read
snapshots. The wrapper locks canonical heads/parents, compares relation sets,
recovers exact committed retries before freshness and preserves canonical domain
rules and receipts. Task-assignee/event-Task parent triggers also serialize direct
relation writes with Bob replacements. This does not grant new project authority.
Install core, both runtime endpoints, then `20261014121841_ai_work_records_catalog.sql`.
The separate publication retires thirteen legacy writes only for fresh manifests.
Core, both runtimes and catalog are verified installed as of 2026-10-17.
[Current readback](../Docs/foundation-verification.md#write-conflicts-and-sequential-work--hosted-release-2026-10-17)
supersedes the connector blocker in the [October 15 record](../Docs/foundation-verification.md#server-bound-work-records--2026-10-15-readback).
See [write ownership](../Docs/ask-bob-writes.md) for coverage and remaining families.

### Server-bound plan links — source extension 2026-10-15

`20261015101954_server_bound_plan_links.sql` adds caller-scoped invoker snapshots
and bounded reads for the current approved plan, Steps and Tasks. Claimed-turn
v20 binds focus and Task associations to complete reads, locks plan then Task,
compares link membership and delegates to existing domain commands. Exact retry
receipts precede freshness checks. A plan-parent trigger serializes relation
writes; existing RLS/grants remain in force. Install core, both runtimes, then
`20261015102328_ai_plan_links_catalog.sql`. The publication preserves older
manifests and retires only the two replaced legacy contracts. This slice does not
change plan approval/evidence or claim hosted/model acceptance.

### Bob writer conflict transport — source correction 2026-10-16

Applied as hosted ledger `20261016211843 / bob_write_conflict_transport`; both
runtimes are deployed and verified on 2026-10-17. See [release evidence](../Docs/foundation-verification.md#write-conflicts-and-sequential-work--hosted-release-2026-10-17).

`20261016205152_bob_write_conflict_transport.sql` replaces only the public
v16–v20 writer adapters, preserving signatures, invoker security, empty search
paths and existing ACLs. A serialization failure or deadlock from the delegated
write rolls back inside the adapter and returns `PT409` with its original message.
This prevents PostgREST 14 from repeatedly executing stale application conflicts
(`record_changed`, `turn_not_claimed`) inside one HTTP request. Genuine aborted
transaction conflicts also return to Bob for a fresh read; they are not blindly
retried with stale pins. Validation/permission errors keep their existing codes.
No data or private canonical writer is changed. The pinned Supabase CLI crashed
on both help and migration creation; this UTC filename uses the documented manual
fallback. Apply before deploying both runtimes; hosted ledger/runtime proof belongs
in [foundation verification](../Docs/foundation-verification.md).

## Durable Bob work without application quotas — 2026-10-17

The additive lifecycle migration pins `work_allowance_version` and the AI manifest
on new durable jobs, pages journal reads, removes policy-1 job duration/claim/entry
allowances, and adds authenticated cancellation and session renewal. Old jobs
retain their original policy. The write-receipt migration conditionally removes
all retained per-turn receipt guards only for the exact authorized live job.
Drawing accounting keeps reservation, reconciliation and exact retries while
bypassing price/call enforcement for that same trusted policy. Unknown provider
outcomes remain guarded. Paid usage is still recorded even when its price is not
yet known. Per-entry payload limits remain technical constraints.

Apply those additive migrations before deploying both Bob Edge closures; activate
the continuation catalog only after matching runtime is installed. Schema/SQL
fixture tests are isolated; hosted migration and runtime evidence are separate.

## Shell-plan installation repair — 2026-10-18

**Installed and verified; [coverage release evidence](../Docs/foundation-verification.md#bob-context-coverage-corrections--2026-10-18)
records the migration and hosted readback.** Ordinary owner/model and CAD
acceptance remain in [State](../Docs/bob-delivery-flow.md#state).
`20261018144828_restore_cad_shell_plan_link.sql` restores the omitted
`20261008150000_cad_shell_plan_link.sql` slice without replaying that older
migration after newer writer wrappers. It recognizes only the audited complete
and missing installations, checks exact reader/delegate bodies and required
dependencies, and rejects partial or unknown installations before changing them.

On the missing installation, the existing shell writer becomes
`bob_project_write_before_shell_steps`; the shell-to-Step handler occupies
`bob_project_write_before_consequences`, its original position in the delegation
chain. The v16 construction-consequence wrapper, v17–v20 adapters, public conflict
transport and drawing continuation remain unchanged. A complete installation
keeps the same effective function bodies. One transaction covers validation,
renames, replacement and grants. The repair contains no data writes against
existing drawings, links or receipts; concurrent runtime activity is assessed
separately in the release evidence.

The public shell reader remains a caller-authorized invoker. Internal writers
cannot be called directly by ordinary roles. Shell-to-Step writes retain live
claim/project checks, exact receipt replay, shell-revision checks and canonical
piece links. Active, authorized policy-1 jobs bypass the old receipt-count quota;
historical bounded jobs keep their policy. No new table, user authority or
parallel link store is introduced.

The core repair and both compatible Bob Edge closures were installed before
`20261018144957_ai_context_coverage_catalog.sql` activated the missing tool and
corrected manuals. Do not replay the omitted old migration or repeat this release. The catalog
publication also owns role retirement and new context-policy pins; its sources
and activation contract belong to [the AI owner](../supabase/README.md#ai-definition-catalog-and-model-tiers).
`tests/cad-shell-plan-sql.test.ts` exercises both installation histories, caller
isolation, v20/PT409 routing, ordinary shell delegation, receipt replay, quota
policy, drift rejection and data preservation. Hosted readback and real-model
acceptance are separate evidence.

### Conflict SQLSTATE under PostgREST 14 — 2026-10-20

**Rule:** a Bob function must never raise with `errcode='40001'`
(`serialization_failure`). PostgREST 14, which serves this project, retries
the request's transaction without limit on that code
([Supabase troubleshooting](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b)).
Raise custom conflicts with `errcode='PT409'` (HTTP 409, `error.code
'PT409'` in supabase-js); the edge code already treats both codes as
`conflict`.

**Why:** on 2026-10-20 one stale `bob-worker` claim turned into
`bob_save_job_step`/`bob_yield_job` failing about 1,500 times per second for
the whole day (4.1 million `job_not_claimed` Postgres log lines, 59 million
rolled-back transactions, one PostgREST thread killed by its timeout manager
every minute). The load pushed `read_construction_draft` past the 8 s
`authenticated` statement timeout, so `design_project_cad` reported
`construction_read_unavailable` in the live runs that
`Docs/bob-delivery-flow.md` tracks. The 2026-10-16 write-conflict transport
translated 40001 only at the public write boundaries.

**Migration:** `20261020203000_bob_conflict_sqlstate_pt409.sql` recreates every
installed function in `bob`, `bob_private` and `bob_volunteer_private` whose
source raises with `errcode='40001'` (68 functions, 151 raises at
installation) from its installed definition with `errcode='PT409'`, then fails
if any `40001` remains in those schemas. Messages, bodies, grants and owners
are unchanged; existing `when serialization_failure` handlers keep catching
genuine serialization failures. Requests already looping inside PostgREST stop
on their next retry. `shared.site_command`, `shared.agent_asset_commit` and the
`maidin`/`hearth` functions still raise 40001 and belong to their own apps.

**Evidence to collect after applying:** `job_not_claimed` lines stop in the
Postgres logs, `pg_stat_database.xact_rollback` stops climbing, and the next
live drawing run (`bob.execution_events`) reaches the CAD render.

### Source assessment plan caching — 2026-10-21

`read_construction_draft` spends almost all its time in the artifact source
assessment. Its two innermost layers,
`bob_private.artifact_source_assessment_before_physical` and
`_before_parameters`, were `LANGUAGE sql` functions with `SET` clauses, which
PostgreSQL cannot inline and therefore re-plans on every call: 150 ms planning
against 58 ms execution for one bunk-bed revision. Planning is CPU on the
shared instance and reached the 8 s authenticated statement timeout under
load. `20261021150000_source_assessment_cached_plans.sql` recreates both from
their installed bodies as plpgsql `RETURN QUERY` with
`plan_cache_mode=force_generic_plan` (19 ms per call after the first on a
pooled backend). Signature, result, invoker security, settings and grants are
unchanged; a rollback-only comparison over every hosted artifact revision was
identical. Rule: a hot read function with `SET` clauses should be plpgsql, not
`LANGUAGE sql`.

### Stored source status — 2026-10-22

**Applied 2026-10-23 as ledger `20261023034405`** (file `20261022193000`;
[evidence](../Docs/foundation-verification.md#stored-source-status--2026-10-22)).
Display reads of `bob.artifact_source_status`
(project home cards, drawing Steps, the drawing work list, artifact lists) ran
the assessment for every returned revision on every read and reached the 8 s
authenticated statement timeout under load on 2026-10-21/22.
`20261022193000_stored_source_status.sql` keeps the view's columns and meaning:

- `bob.artifact_source_epochs` holds one change counter per project. An O(1)
  security-definer AFTER trigger (`mark_artifact_source_changed`) bumps it on
  every write to the 18 project-scoped assessment inputs; a shared catalog
  item bumps every project with a construction. Projects are bumped in sorted
  order. Nothing is computed in the writer's transaction.
- `bob_private.drain_artifact_source_states`, scheduled by pg_cron every 30
  seconds (`bob-source-states`, pure SQL), refreshes changed projects within a
  20 s budget. `refresh_artifact_source_states` reads the counter first, then
  stores the live assessment of every revision with that counter value in
  `bob.artifact_source_states` (null state when the assessment returns no row).
- The view returns a stored row only while its counter equals the project's
  current counter; otherwise the live assessment runs for that row only. An
  `OFFSET 0` subquery makes that check a one-time filter, so fresh reads never
  run the assessment (asserted from executed plans in the test).
- The drain runs as owner, so `artifact_source_states_storable` refuses
  projects whose answer can depend on a member's own building or catalog
  access: physical detail rows, multifloor/stair flags, any physical pin in
  construction parameters or CAD manifests, or a pin to another project's
  private catalog item. Those projects stay live. The nine shared
  physical-model tables therefore carry no trigger.
- Members can only select stored rows and counters of their projects; the
  functions are executable by no client role. Write guards keep calling
  `bob_private.artifact_source_assessment` directly.

`tests/stored-source-status-sql.test.ts` derives the assessment's base tables
from the installed function and view definitions
(`tests/support/source-status-inputs.ts`) and fails when an input has neither
the trigger nor the physical gate. Rollout: apply before or without an Edge
deploy (no Edge change); the first drain fills rows within 30 s and reads stay
live until then. Rollback: unschedule `bob-source-states` and restore the
previous view definition; the tables can stay.

### Checkpoint render files — 2026-10-23

**Applied 2026-10-23 as ledger `20261023055027`** (file `20261023050000`;
[evidence](../Docs/foundation-verification.md#checkpoint-render-files--2026-10-23)).
A reviewed CAD candidate's files (about 0.7 MB of base64
STEP/SVG) were copied into every turn checkpoint save after a render, making
each save about 1.2 MB (2026-10-22). The same files already sit in the job's
`cad:render:N` journal step. `20261023050000_checkpoint_render_files.sql` adds
`bob.bob_checkpoint_render_files(p_job, p_claim, p_fingerprint)`:

- Same fence as `bob_checkpoint_steps_page`: checkpoint job, `running`, the
  current claim token and an unexpired lease; otherwise `job_not_claimed`
  (`PT409`). The fingerprint must be 64 lowercase hex characters.
- Returns `result.files` of this job's successful `cad:render:N` steps with
  that exact input fingerprint, never previews, other steps or other jobs.
- Security definer, empty search path, executable by `service_role` only. No
  table, grant or existing function changes. Steps are deleted when the job
  finishes, so nothing is read after that.

The contract lives in
[Ask bob conversations](../Docs/ask-bob-conversations.md#cad-candidate-files-stay-in-their-render-step).
Rollout: apply, then deploy `bob-worker` and `ask-bob` from the same source.
Rollback: an older worker refuses version 2 CAD state; let active checkpoint
jobs finish before rolling the worker back. The function can stay.

### Project rooms and Area rooms — 2026-10-25

**Applied 2026-10-25 as ledger `20261025163923`** (file `20261025133000`; [evidence](../Docs/foundation-verification.md#building-and-room-links--2026-10-25)). Owner decision: a project links a whole Building, then marks
its rooms; Areas map to rooms of that Building
([building model](../Docs/building-model.md#project-rooms-and-area-rooms--owner-decision-2026-10-25)).
`20261025133000_project_room_scope.sql` replaces the body of
`bob_private.physical_scope_command` (ACL and the `bob` wrapper unchanged) and
adds the private helper `project_targets_whole_building(project, building)`
(Building link, or a Site link covering it; executable by no client role):

- Building link: unchanged, requires `can_edit_building`.
- Room/element mark and Area target: project access plus the whole-building
  link; `building_not_linked` (`22023`) otherwise. The Space/Element must belong
  to that Building (`space_not_in_building` / `element_not_in_building`), the Area to the project (`project_denied`).
- Unlink of a Building/Site link deletes this project's Space/Element scope rows
  and Area targets for Buildings no longer covered, in the same transaction.
- Links are idempotent (existing row returned). A per-project advisory lock
  serializes scope changes.

No table, grant or RLS change. Existing rows, including one room-only scope in
production (2026-10-25), are kept. `tests/project-room-scope-sql.test.ts` covers
the rules; two older tests now insert their room-only fixture rows directly.
Rollout: apply; the app keeps working with the old and new rules. Rollback:
restore the previous function body from `20260913213712_household_project_sharing.sql`.

### Bob building scope — 2026-10-25

**Applied 2026-10-25:** core `20261025163936` (file `20261025150000`) and catalog `20261025164051` (file `20261025150500`); [evidence](../Docs/foundation-verification.md#building-and-room-links--2026-10-25). Owner decisions: [building model](../Docs/building-model.md#bob-building-scope--owner-decisions-2026-10-25);
tool contract: [Ask bob writes](../Docs/ask-bob-writes.md#fifth-implementation-building-and-room-scope--source-2026-10-25).
`20261025150000_bob_building_scope.sql` stops unless the room-scope helper
`project_targets_whole_building` exists, then adds:

- `bob.read_bob_building_scope_snapshot(project, resource, id)` and
  `bob.read_bob_building_scope_context(project, resource, building, query, after)`:
  security invoker, executable by `authenticated` only, project access required.
  Buildings are offered only when the caller can edit them or this project
  targets them (Building, Site or room row), never archived. Pages hold 6
  Buildings, 16 rooms of one offered Building or 8 Areas, plus one row that only
  signals a next page. A snapshot does not depend on row security, so the
  writer compares pins with the same function.
- `bob_private.bob_project_write_v21` and the public `bob.bob_project_write_v21`
  (serialization failure or deadlock becomes `PT409`; ACL as v20). Kind
  `bound_building_scope` only; other kinds delegate to v20. Claim, project
  access, quote, strict `{pins, command}` payload, the physical-scope advisory
  lock plus `for key share` on the project row, exact replay before freshness,
  the per-turn receipt quota, pins equal to fresh snapshots (`PT409`), and
  server-resolved link rows. Each target calls the unchanged
  `physical_scope_command`. A whole-Building unlink is refused with
  `building_site_covered` or `building_household_follow` (`22023`); an unlink
  with no whole-Building row raises `building_not_linked`. One receipt per call:
  dataset `building_context`, the Building as `recordId`, `operation: updated`,
  pins as before-record.

No table, existing grant, RLS or data change. `tests/project-building-scope.test.ts`
runs the migrated schema with editors, plain members, another project and an
outsider. Rollout: room-scope migration, this migration, both runtimes, then the
catalog publication ([order](../supabase/README.md#bob-building-scope--source-2026-10-25)).
Rollback: reactivate the previous catalog; these functions can stay.

### Human construction blank basis — 2026-10-26

**Applied 2026-10-26 as ledger `20261026065520`** (file `20261026120000`); Bob
deployed as `bob-worker` v138 / `ask-bob` v170 (PR #332). Owner decision: human text holds only human prose;
references are typed relations
([write contract](../Docs/ask-bob-writes.md#human-text-holds-only-prose--owner-decision-2026-10-26)).
`20261026120000_human_construction_blank_basis.sql` replaces the body of
`bob_private.material_requirement_cad_command` (from
`20261011090115_construction_instance_roles.sql`; ACL unchanged). Only the
`basis` sentence changes: it names the construction drawing's title, the blank
count and size and, for length/area modes, the total, instead of artifact,
definition, material and part IDs with revisions. Those links remain typed in
`material_requirement_construction_sources`. Authority, source freshness,
instance roles, quantities, method key/version and lineage are unchanged.

No table, grant, RLS or data change; existing requirement revisions keep their
saved basis. `tests/construction-requirements.test.ts` checks the new text has no
IDs or codes. Rollout: apply; the app shows a summary for construction blanks
either way. Rollback: restore the previous body from `20261011090115`.

### Room dimensions — 2026-10-26

**Applied 2026-10-26:** `20261026071724_room_dimensions` (file `20261026130000`) and catalog `20261026071817_ai_room_dimensions_catalog` (file `20261026130500`); Barnrum classified by `scripts/classify-barnrum-measurements.sql` ([evidence](../Docs/foundation-verification.md#room-dimensions-and-human-text--2026-10-26)). Owner decisions 2026-10-25/26
([building model](../Docs/building-model.md#room-dimensions--owner-decisions-2026-10-26)):
a room shows its length × width × height read straight from the database, for
the app and Bob alike. `20261026130000_room_dimensions.sql`:

- `bob.measurements` gains nullable `property` (`room_length`, `room_width`,
  `ceiling_height`, `wall_length`, `opening_width`, `opening_height`,
  `sill_height`, `opening_offset`, `other`), `side` (`N`/`E`/`S`/`W`) and
  `reference` (1–120 characters), plus the audit `classified_by`,
  `classified_actor`, `classified_at` (`classified_by` is null only for an
  owner-approved operator script). These sit on the identity, not a revision:
  classifying appends no revision, so pinned drawings stay current. A side or
  reference needs a property.
- Fill-once everywhere: the trigger `guard_measurement_classification` refuses any
  change of an existing classification (`measurement_already_classified`,
  `55000`), whoever writes. To change what a measurement measures, archive it and
  record a new one (the existing rule for identity fields).
- `bob.space_measurements` mirrors the three columns. A `before insert` trigger
  fills them from the identity on every link path (manual link, Bob intake
  carry-forward, acceptance, archive/restore copies); an `after update` trigger
  on `bob.measurements` updates every snapshot of a classified measurement,
  including older room revisions. `current_measurements` and
  `space_measurement_details` append the columns.
- `bob.evidence_command` (body otherwise as in `20260909221503`) gains the action
  `classify` for measurements: caller project access, expected current revision,
  not archived, fields `property`/`side`/`reference` only. Repeating the saved
  classification is a no-op; a different one is refused. `create` and `revise`
  accept the same fields while the measurement is unclassified. Codes:
  `measurement_property_required`, `invalid_measurement_property`,
  `invalid_measurement_side`, `invalid_measurement_reference` (`22023`).
- Bug fix in `physical_node_command` (body otherwise as in `20260913213712`): a
  Space revise or propose that **omits** `measurements` now keeps the snapshots
  of the revision it replaces (an accepted change keeps the accepted revision's,
  a proposal the latest revision's). An explicit array still replaces them, `[]`
  clears, and a non-array is refused (`invalid_space_measurements`). Before, an
  omitted key silently created a revision without measurements.
- `bob.project_room_dimensions` (security invoker, select for `authenticated`
  only): per project room (as `project_spaces`, so a room-only scope sees only
  its rooms and another linked project sees only snapshots, never
  `bob.measurements`) and per property/side/reference, the classified snapshots
  of the room's accepted revision. Strongest truth wins (measured >
  provided_spec > estimated); `status` is `known`, `conflict` (different
  millimetre values at that truth, all listed) or `unknown`. `room_length`,
  `room_width` and `ceiling_height` always have a row. `millimetres` is set only
  when known; nothing is derived.
- `bob.search_bob_project_data_v9`: dataset `room_dimensions`, one record per
  room with room and building names, revision and its dimensions (sources cut to
  300 characters); every other dataset is `v8` unchanged. Security invoker,
  executable by `authenticated`.
- `bob.search_bob_project_data_v10` (`20261029115500_bob_exact_lookup.sql`,
  installed 2026-10-29): returns exactly what v9 returns. For `artifacts` it
  checks each record against the small base tables (`artifact_revisions`,
  `artifacts`, room-layout, multifloor and stair rows) and reads a
  security-invoker detail view only for a record that has that detail. v9's
  v4/v6/v7 layers planned those views for every artifact and took 1–12 s per
  exact read as `authenticated`, hitting the 8 s statement timeout; v10 takes
  about 40 ms with an identical result. Every other dataset is `v9` unchanged.
  Same grants as v9. [Verification](../Docs/foundation-verification.md#controlled-completion-2026-10-29).

`20261026130500_ai_room_dimensions_catalog.sql` (generated by
`scripts/build-ai-room-dimensions-catalog.ts`, `--check` in the SQL test) adds
`room_dimensions` to the dataset enum of `tools.search_project_data` and one
sentence to its description. New jobs pin `roomDimensionsVersion: 1` and call
v9; older journals keep v8.

`tests/room-dimensions-sql.test.ts` covers validation, fill-once, mirroring,
carry-forward, the view's statuses and scope, Bob's dataset, the publication and
the Barnrum script. Rollout: apply the core migration, deploy `ask-bob` and
`bob-worker` from the same source, apply the catalog publication, then run
`scripts/classify-barnrum-measurements.sql` (owner-approved, one transaction,
aborts on any subject or value mismatch, idempotent, prints a summary).
Rollback: reactivate the previous catalog; the columns, view and functions can
stay (the app reads them only through `database.ts`).

### Fastener and glue requirements — 2026-10-26

**Applied 2026-10-26 (PR #337, ledger `20261026114508`).** B3 of the
[joint fastener decisions](../Docs/artifacts.md#joint-fasteners--owner-decisions-2026-10-26);
the [material owner](../Docs/material-planning.md#fastener-and-glue-needs--2026-10-26)
owns the contract. `20261026172000_fastener_requirements.sql`:

- `bob.material_requirement_fastener_sources`: provenance beneath existing
  requirement revisions (sibling of the construction blank table): construction
  artifact/revision, `rule_version`, `kind` (`screw|nail|bolt|glue`),
  `diameter_mm`/`length_mm` (null for glue), `quantity`, `joint_ids` and
  `schedule_complete`. Project RLS, authenticated SELECT only; rows cascade with
  the requirement and the construction revision.
- `bob_private.material_requirement_cad_command` becomes a dispatcher:
  `quantity_mode` `fasteners`/`glue` goes to
  `material_requirement_fastener_command`; everything else to the previous body,
  renamed `material_requirement_cad_before_fasteners` (no client grant). The
  fastener command reads `construction_fastener_schedule` under the project lock
  and source assessment, then calls the arithmetic writer
  `material_requirement_before_construction_fit` directly, so the blank-only
  allocation guard does not apply. Same CAS, receipts and caller authority; no
  new writer version, tool schema or catalog publication.
- `bob_private.material_requirement_command` (manual wrapper from
  `20261005173845`) is recreated unchanged apart from fastener provenance:
  manual revise is refused (`construction_derive_required`), restore is fenced
  (`fastener_requirement_exists`), archive/restore carry the row.
- `bob_private.material_requirement_publish` (guarded replace): fastener needs
  skip the blank guard but need a current construction
  (`construction_source_changed`, PT409). Pack purchases already block only
  blank needs.
- `bob.prepare_construction_consequence` (guarded replace of one statement):
  fastener needs go to `bob_private.fastener_consequence`, which revises the
  same group or archives a vanished one, instead of `needs_requirement_model`.
  The constraint trigger `complete_fastener_requirement` completes saved change
  items, as the blank table's trigger does.
- Helpers `fastener_requirement_taken`, `fastener_consequence` and
  `complete_fastener_change_output` have no client grant.

New codes: `fastener_construction_required`, `fastener_group_not_in_schedule`
(22023), `fastener_requirement_exists` (PT409). `tests/fastener-requirements-sql.test.ts`
covers derivation, duplicates, staleness and continuation, Shopping, stock and
pack purchase versus blank guards, and access. Rollout: apply; the app labels
the new methods either way. Rollback: rename the previous cad body back,
recreate the manual wrapper from `20261005173845`, reverse the two guarded
replacements, then drop the table and helpers.

**Exact counts — applied 2026-10-26 (PR #339, ledger `20261026132718`).** Owner decision
2026-10-26: fastener and glue needs show the exact schedule count, without
waste ([material owner](../Docs/material-planning.md#exact-counts-without-waste--owner-decision-2026-10-26)).
`20261026190000_exact_fastener_needs.sql` makes two guarded replaces from the
installed bodies (a changed body fails loudly):

- `bob_private.material_requirement_fastener_command`: a `waste_percent` that
  is present and not 0 raises `fastener_quantity_exact` (22023) right after the
  input check, before the project lock; the payload to the arithmetic writer
  always carries `waste_percent` 0, so the stored allowance is 0 on create and
  revise. `purchase_increment` stays allowed.
- `bob_private.fastener_consequence`: change work sends `waste_percent` 0
  instead of copying the previous revision's value, so a need saved earlier
  with an allowance is recalculated exact rather than refused.

New code: `fastener_quantity_exact` (22023). Rollback: the reverse guarded
replaces of both snippets.

### Project facts reader — 2026-10-26

**Applied 2026-10-26 (PR #339, ledger `20261026132719`).** Owner decision and product contract:
[project facts at turn start](../Docs/ask-bob-context.md#owner-decision--2026-10-26-project-facts-at-turn-start).
`20261026200000_project_facts.sql` stops unless the stored source status, room
dimensions and fastener migrations are installed, then adds:

- `bob.read_project_facts(project)`: plpgsql, `stable`, security invoker,
  empty search path; `project_denied` (`42501`) first unless the caller has
  project access. Executable by `authenticated` only. Every read runs as the
  caller under row security. Output `version: 1`; every list carries `total`,
  `included`, `omitted` and `items`:
  - **rooms** (24): `project_spaces` rooms with length, width and ceiling height
    from `bob.project_room_dimensions` (status, truth, millimetres, conflicting
    values), marked rooms first. `ok` with a whole-Building or covering Site
    link (even without rooms); `rooms_only` when only single rooms are scoped
    (the legacy room-level link, as live Barnrum has); `not_linked` otherwise.
  - **constructions** (8, newest first): head revision of each current
    construction Artifact; definition, part, joint and open-question counts,
    roles from `artifact_construction_instance_policies` (missing policy: every
    part unknown) and fastener totals from
    `bob_private.construction_fastener_schedule_for`, run for included rows only.
  - **drawings** (8): current CAD Artifacts, their typed construction pin
    (`artifact_construction_drawings`) and `source_status`; `other_artifacts`
    counts current Artifacts that are neither.
  - **drawing_requests** (5): open requests (not `saved`/`cancelled`) with
    their blocking gap count.
  - **materials**: current needs by Shopping state, `changed`,
    `changed_unknown`, fastener and glue needs and `shopping_published`. Routes
    as the publish guards define them: a requirement link to an existing
    Shopping row, a published pack purchase, or a published cut plan.
- `bob_private.project_facts_drawing_requests(project)`: security definer, the
  same access check, executable by `authenticated` only; reads the private
  request and gap tables and returns request ID, status, update time and
  blocking gaps.

**Never a live source assessment.** `artifact_source_status`, and therefore
`current_drawing_overview` and `drawing_request_work`, run
`artifact_source_assessment` for every row without a fresh stored state: always
in a project whose status is never stored (physical pins, multifloor/stair
studies, another project's private catalog item), otherwise for up to 30 s
after any change to the project's inputs.
`current_material_requirements.artifact_changed` runs it for every need on a
construction revision. The reader takes the source status only from
`artifact_source_states` whose `computed_seq` equals the project's counter
(`not_stored` otherwise, `not_assessed` for a stored null) and never reads
`artifact_changed`; a construction need without a fresh stored state counts as
`changed_unknown`. No money, model or chat text, email, diet, Auth or person
fields. `tests/project-facts-sql.test.ts` replaces the assessment with a
tripwire, checks that those views fail on the fixture and that the reader
returns the same facts. Rollout: apply; nothing reads it until the Bob runtime
calls it. Rollback: drop both functions.

<a id="form-concept-persistence--source-only-2026-10-26"></a>
<a id="construction-work-authority"></a>
## Coherent Construction authority — installed, 2026-10-28

`20261028194859_construction_work_operations.sql` adds no project tables or
parallel source register. `read_bob_selected_edit_context` is an authenticated
invoker/RLS read of the exact selected scope using the ordinary editable
Solution snapshot. `prepare_construction_work` and the private commit delegate
to existing claimed-turn, content, Construction and receipt validators under
an empty search path. The public commit is an invoker wrapper. Anonymous and
service-role execution is revoked; the actual caller must have project access
and the live write claim. Direct private invocation retains the same checks.

A project lock serializes the compound commit. Existing domain writes enforce
expected heads, exact selection and source constraints. Both domain revisions
and their ledger rows roll back together on failure. The combined operation
key compares intent before head validation for exact recovery, while a changed
intent conflicts. Serialization/deadlock errors leave the RPC as `PT409`,
preserving the existing PostgREST retry boundary. Bounded part edits also gain
the parameter editor's explicit target reconciliation; old payloads remain valid.

[Writer semantics](../Docs/ask-bob-writes.md#construction-work-write),
[release order](../supabase/README.md#construction-work-release) and
[local and hosted verification](../Docs/foundation-verification.md#construction-work-2026-10-28)
own the adjacent details and separate installation from model acceptance.

## FORM check observations — source only, 2026-10-27

Migration `20261027101807` adds `bob_private.construction_observations`, an
immutable derived cache subordinate to existing Construction revisions. It has
RLS and no direct member/service table grants. A service-only, active-claim RPC
records code-produced checks; the authenticated reader enforces project access
and assesses current sources on every new read. Exact retries deduplicate;
historical results survive private chat reset and never authorize export.
The [Artifact owner](../Docs/artifacts.md#form-scoped-checks) defines predicates,
reuse and limits; the [backend guide](../supabase/README.md#form-checkpoint-release)
owns activation order. Source code is not an applied migration.

## FORM concept persistence — installed, 2026-10-26

Technical installation and remaining acceptance: [release evidence](../Docs/foundation-verification.md#form-concept-loop--local-synthetic-verification-2026-10-26).

`20261026210000_solution_concept_model.sql` extends the existing private intent
validator and `read_design_readiness` in place. No new tables, RLS policies or
write endpoints. The nullable/absent historical model remains readable. New
model data is strictly bounded and cannot assert measured input; conflicted or
unknown concept drafts can be saved but cannot pass construction readiness.
Existing Solution commands and claimed bound writes enforce project authority,
expected revisions, target decisions and idempotent receipts. A revision trigger
preserves component/parameter/view/constraint IDs. A deferred construction trigger
checks exact concept geometry after the existing instance policy has been saved.
Pure invoker helpers have explicit grants; triggers expose no executable API.
The source identity was allocated after the repository migration head because the
pinned CLI failed before creating a file. The hosted managed-ledger identity and
ordinary-caller rollback proof are recorded in the release evidence above. Release order is in [Supabase](../supabase/README.md#form-concept-release--source-only-2026-10-26).

## Construction delivery readback — installed, 2026-10-27

`20261027162750_construction_delivery_readback.sql` adds the authenticated
security-invoker `bob.read_construction_delivery`. It filters exact project,
Construction and revision before paging existing drawing/requirement/cut-plan
relations. It creates no tables, policies or write authority. Public, anonymous
and service-role execution are revoked; normal project access and table RLS
remain required. [Artifact](../Docs/artifacts.md#construction-delivery-discovery)
owns the index/readback distinction and recovery behavior. The migration is
applied; [hosted verification](../Docs/foundation-verification.md#form-delivery-release-2026-10-27)
records its managed version, exact function readback and rollback-only caller
probe. This does not close browser or ordinary model/CAD acceptance.
