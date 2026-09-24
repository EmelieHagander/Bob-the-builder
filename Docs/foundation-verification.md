# Foundation verification and rollout

## Household and project sharing — deployed foundation

**Read-only status check, 2026-09-24:** the sharing, account boundary and volunteer
migrations are present in the hosted ledger. They are also in `main`. This
supersedes the September 13–14 “prepared source, not deployed” status; it does not
claim a newly performed real household/friend/volunteer acceptance journey.
The [building model](building-model.md#111a-household-sharing-extension) and
[database contract](../db/README.md) own behavior.

| Source migration | Confirmed hosted migration |
|---|---|
| `20260913213712_household_project_sharing.sql` | `20260914172539_bob_household_project_sharing` |
| `20260913214355_household_account_sharing.sql` | `20260914172603_bob_household_account_sharing` |
| `20260914052752_volunteer_project_links.sql` | `20260914172820_bob_volunteer_project_links` |

The existing [CI run 36032936034](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/36032936034)
passed the sharing and volunteer browser flows for the code merged into the
reviewed `main` (`6ee5405`). The new review corrections are tracked in
[PR 137](https://github.com/EmelieHagander/Bob-the-builder/pull/137); their source
migration files are not yet applied. Real participant acceptance remains separate.

### Original implementation evidence — September 13–14

- All 98 tests passed at that implementation checkpoint after integrating the current material-planning main.
  Eleven new sharing/account groups
  replay the actual migrations in PGlite/Postgres with the shared household and
  Hearth friendship schema represented by fixtures. They cover opt-in building
  and project access, family editing, independent direct membership, exact-scope
  inheritance, revocation, pending/accepted/declined invitations, raw-write and
  internal-helper denial, stale choices, email/derived-crew transitions, last
  direct-member protection and guarded account binding.
- Four request-boundary tests cover auth/project changes before an RPC, delayed
  replies after switching away and back, mismatched resource read-back, missing
  authentication and an unavailable backend without false success.
- Seven volunteer database groups prove name-only joining creates no Auth or
  shared-family record, idempotent retry/resume, distinct same-name participants,
  optional allergy collection only with food, private self-only allergy responses,
  paged project-only reads, own task/attendance changes, required checks and
  separate volunteer completion provenance, stale-write rejection, exact media
  linkage, expiry, revocation and denied raw/management/internal-helper access.
  Two volunteer adapter groups prove no Auth/registration call and reject wrong
  project replies; two media HTTP groups prove denied bytes, bounded inputs,
  revocation during download, exact original bytes and no-cache responses.
  A browser-storage contract test proves that persistence contains only the
  separate access credential and confirmation flag, never names or allergies.
- The production TypeScript/Vite build and PWA checks pass. The browser verifier
  scripts pass syntax checks. The new `volunteer-media` function also passes Deno
  typechecking using installed dependencies (`--no-config --cached-only
  --node-modules-dir=manual`). The full Edge check passes in
  [CI 34823288170](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34823288170).
  Its local equivalent is blocked by a pre-existing `esm.sh` import in
  `openai-service.ts`.
- Local manual browser preview is blocked by this environment. The new
  `scripts/check-sharing-browser.mjs` and `scripts/check-volunteer-browser.mjs` are included in CI for production React and
  Supabase-client flows at 320, 390 and 1280px against HTTP fixtures.
  [PR 52](https://github.com/EmelieHagander/Bob-the-builder/pull/52) records the
  original CI/browser evidence. The current baseline is linked above. Household/friend browser checks pass in the run linked above; the
  volunteer check also waits for the refreshed server profile before asserting
  that removed food hides allergies. Screenshots accompany the workflow runs.

### Rollout and remaining live acceptance

For a new database, the original source sequence is:
`20260913213712_household_project_sharing.sql`, then
`20260913214355_household_account_sharing.sql`, then
`20260914052752_volunteer_project_links.sql`. These are already applied to the
hosted database under the identities above; do not replay or rewrite them. Read-only preflight found a pristine legacy account with no notes;
the migration rechecks this under a lock and never guesses its household. If
content appears before rollout, the account migration stops until an explicit
reviewed mapping is supplied. Normal Settings setup can bind only a pristine,
unbound account to a household the caller already actively belongs to.

A new environment needs the separate `volunteer-media` Edge function after its
migration and before the frontend. Its intentional `verify_jwt = false` route requires a valid,
unexpired volunteer capability for each request; no anonymous-Auth enablement or
new user registration is required. A hosted disposable volunteer check must show
unchanged Auth user counts, correct person/optional allergy persistence, original
image read-back, task/attendance/check behavior and denied access after revocation.
The September 24 review did not perform those live fixture mutations, create
household grants, send real project invitations or change hosted records. Fixture proof does not establish live cross-app Auth,
PostgREST, Storage or realtime behavior. After migration and frontend deployment,
verify with separately authorized household and friend identities that one
accepted project is visible, unrelated projects/account notes stay hidden, family
building edits persist and revoked access is denied on the next server request.

## Delivered deterministic material quantity (4B2b)

**Status:** first narrow 4B2b calculator implemented, merged, migrated, deployed and live-verified on 2026-09-14. [PR 54](https://github.com/EmelieHagander/Bob-the-builder/pull/54) merged as `098ea2b16c04ebbb279130860eceb97d7ea05cd3`. [Material planning](material-planning.md) owns behavior and limits.

The shipped method is `stud_wall_net_area` / `4B2b-v1`. It reads one exact current `stud_wall_opening_v1` Artifact revision, derives `(wall width × wall height − opening width × opening height)` in square metres, normalizes upward only to the existing four-decimal requirement precision, and saves a normal `source_kind = deterministic` material-requirement revision with exact target/Artifact lineage and a server-authored formula/basis. Clients cannot supply the deterministic quantity, unit, basis, source or method identity. The calculation then reuses 4B2a allowance, matching-unit stock reservation, purchase rounding, staleness and explicit Shopping publish/update; it creates no parallel BOM store and invokes no AI.

### Automated, migration and advisor evidence

- [PR CI 34825559375](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34825559375) is fully green: all 73 PGlite/regression tests, TypeScript/Vite production build, PWA/install checks, Ask bob isolation, combined foundations browser proof and Building-context browser proof pass. The browser flow covers **Calculate from drawing**, deterministic source/basis read-back, revise/reload and the normal Shopping path at 320/390/1280px.
- Source migration `supabase/migrations/20260914084207_deterministic_material_quantities.sql` was applied to hosted Supabase as `20260914090502_bob_deterministic_material_quantities_4b2b`. Post-DDL security and performance advisors reported no new 4B2b-specific finding; unrelated pre-existing shared-database findings remain outside this release.

### Live Auth/PostgREST proof and deploy

[Pages 34826249816](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34826249816) and [live foundation check 34826249907](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34826249907) both pass on merged `main` commit `098ea2b16c04ebbb279130860eceb97d7ea05cd3`. The ordinary authenticated foundation client consumes the already-persisted 4B1 geometry fixture and proves:

- current generated Artifact revision 4 uses the saved 4200 × 2400 mm wall and 1210 × 1200 mm opening, producing an exact/net persisted base of `8.628 m²`;
- 10% allowance becomes `9.4908 m²`; `2 m²` confirmed stock plus a `1 m²` purchase increment yields `8 m²` to buy;
- the saved revision persists `source_kind = deterministic`, `method_key = stud_wall_net_area`, `method_version = 4B2b-v1` and transparent formula text;
- a forged client `required_quantity` is rejected, an unsigned client is denied, and the disposable member cannot calculate against the real porch project;
- after the generated drawing advances, the requirement reports stale Artifact lineage and Shopping publish is rejected until recalculation;
- recalculation against current Artifact revision 6 creates requirement revision 2; with 0% allowance and the same `2 m²` stock, purchase need becomes `7 m²`;
- explicit Shopping update changes the linked row from `8 m²` to `7 m²` while preserving `delivered` status, supplier `Disposable sheet supplier` and cost `456 kr`.

The same run passes the existing media, steps, facts, solutions, drawings, manual material-planning and Building-context checks. No AI is invoked.

## Delivered manual material planning (4B2a)

**Status:** manual 4B2a implemented, merged, migrated, deployed and live-verified on 2026-09-14. [PR 39](https://github.com/EmelieHagander/Bob-the-builder/pull/39) merged as `1093fafbdbc5fc4ef0e477f0f6741c03bc3860b7`; verification-only [PR 50](https://github.com/EmelieHagander/Bob-the-builder/pull/50) merged as `fd737d45f1804245c31420037f8f12471302a7c5`. [Material planning](material-planning.md) owns behavior and limits.

### Automated, browser and hosted migration evidence

- Pre-merge [CI 34810364646](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34810364646) passes the full schema/domain, TypeScript/Vite, edge, PWA/install, Ask bob, foundation browser and Building-context suite. The Material plan proof runs inside the existing foundation harness at 320/390/1280px and covers stock/reuse, transparent arithmetic, explicit Shopping handoff, persisted delivered status, Update Shopping, reload and project isolation.
- Follow-up #50 [CI 34811122576](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34811122576) is fully green and regression-locks browser/live `method_key = manual` to the server SQL; it changes no schema, arithmetic, Shopping or UI behavior.
- Five additive source migrations were applied in order:

| Source migration | Hosted registry |
|---|---|
| `20260913210000_material_planning.sql` | `20260914053521_bob_material_planning_4b2a` |
| `20260913210100_material_planning_hardening.sql` | `20260914053538_bob_material_planning_4b2a_hardening` |
| `20260913210200_material_planning_publish.sql` | `20260914053605_bob_material_planning_4b2a_publish` |
| `20260913210300_material_planning_reservation_serialization.sql` | `20260914053620_bob_material_planning_4b2a_reservation_serialization` |
| `20260913210400_material_planning_fk_index.sql` | `20260914054215_bob_material_planning_4b2a_fk_index` |

Post-DDL security review reports no new 4B2a-specific security finding. Performance review found one new composite-parent FK covering-index opportunity; the fifth migration adds `material_requirement_revisions_parent_idx(requirement_id, project_id)` and the finding disappears on re-check. Expected fresh-unused-index notices and unrelated shared-database findings remain informational. See the [unindexed-FK remediation guide](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

### Live Auth/PostgREST proof, deploy and cleanup

The first post-merge live run [34810721689](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34810721689) reached the hosted material path and exposed verification drift only: runtime persisted `method_key = manual` while the proof expected `manual_base`. PR #50 aligned the fixtures with the already-deployed server truth and added a regression guard; no production schema/data behavior changed.

Final [Pages 34811372007](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34811372007) and [live foundation check 34811372088](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34811372088) pass on `main` commit `fd737d45f1804245c31420037f8f12471302a7c5`. Through the ordinary authenticated Bob client, the live material proof verifies exact target/drawing/stock/reuse lineage, `4 pcs → 1 stock → 2 reusable → 1 to buy`, a revised `2 to buy`, explicit Shopping publish/update with delivered status/supplier/cost preserved, independent Shopping-edit disclosure, stale-source publish rejection, raw-write denial and project isolation. No AI is invoked.

The shared foundation run also passes facts, solutions, deterministic geometry, drawings and Building context, removes image bytes/metadata/attachments through normal APIs and removes the temporary physical fixture through guarded physical-authority commands. Operator cleanup then deleted the two exact disposable verification projects from the initial proof-drift run and the final green run after checking exact nonce names/descriptions and zero media. A final query reports zero projects, material requirements, stock items, artifacts and media for those two fixture ids.

## Delivered deterministic artifact geometry (4B1)

**Status:** narrow 4B1 implemented, merged, migrated, deployed and live-verified on 2026-09-13. [PR 47](https://github.com/EmelieHagander/Bob-the-builder/pull/47) delivered the generator and persistence; [PR 49](https://github.com/EmelieHagander/Bob-the-builder/pull/49) closed the hosted release proof. [Plans and drawings](artifacts.md) owns geometry behavior and limits.

The release stores deterministic `stud_wall_opening_v1` recipes in `artifact_generations` plus six exact role-mapped `artifact_geometry_inputs`. It pins Building, accepted Space revision, exact Measurement revisions and explicit stud spacing; unknown dimensions fail, estimated inputs remain concept-only, and regeneration creates a new Artifact revision rather than rewriting history. SVG/vector output is recomputed from the versioned recipe; raster output is not truth. It does not itself claim general CAD/BIM or structural header/load-path sizing. The downstream first 4B2b net-wall-area material quantity is delivered separately through the material-planning foundation above.

Source migrations map to hosted history as follows:

| Source migration | Hosted registry |
|---|---|
| `20260913193000_artifact_deterministic_geometry.sql` | `20260913212211_bob_artifact_deterministic_geometry` |
| `20260913193100_artifact_geometry_command_grant.sql` | `20260913212218_bob_artifact_geometry_command_grant` |
| `20260913193200_artifact_geometry_invariants.sql` | `20260913212229_bob_artifact_geometry_invariants` |
| `20260913194000_artifact_generation_space_revision_index.sql` | `20260913213315_bob_artifact_generation_space_revision_index` |

The implementation branch's full CI/browser gate [34775629980](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34775629980) is green. Final [Pages 34784328229](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34784328229) and [live foundation check 34784328249](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34784328249) pass on the 4B1 live-proof `main`. The ordinary Auth/PostgREST run verifies persistent Space target, six exact measurements, recipe read-back, raw-write/RLS denial, unknown/out-of-bounds rejection, regeneration history and archive/restore carry-forward, then detaches its stable physical verification fixture. No AI is invoked.

## Delivered persistent building context (2C)

**Status:** manual 2C implemented, merged, migrated, deployed and live-verified on
2026-09-13. Backend/domain [PR 42](https://github.com/EmelieHagander/Bob-the-builder/pull/42)
merged as `d5dce52e531c271a54d0dbb28a55765d271c1e9b`; app/UI
[PR 43](https://github.com/EmelieHagander/Bob-the-builder/pull/43) merged as
`126a322f9ac59bc110525e2bb7ecd0575d24c3fa`. Hosted cleanup-order follow-up
[PR 45](https://github.com/EmelieHagander/Bob-the-builder/pull/45) merged as
`2562d15b4ffa99b53d15682c24010b87b81f2dbf`. The
[building-model contract](building-model.md) owns Site/Building/Level/Space,
BuildingElement/topology, physical authority, Project/Area scope, accepted/proposed
history and exact measurement-snapshot semantics.

### Automated and browser evidence

- Backend [CI 34762221631](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34762221631)
  passes on the final #42 head. The repository has 42 passing database/data-boundary
  tests, including all four building-model fixtures plus stale/raw/forged authority,
  Area mapping/lifecycle and physical deletion-boundary checks. TypeScript/Vite,
  edge, PWA/install and existing foundation/browser checks also pass.
- UI [CI 34769797360](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34769797360)
  passes on #43 head `74a270d92f8827ebe5b69ac696601ef2f4ae42a7`. The dedicated Building-context
  browser proof passes at 320, 390 and 1280px: create Building; start with one Space;
  project-link; reload/read-back; add a second Space + relationship; switch Buildings
  without stale detail; switch Project; and render explicit denied state instead of
  misrepresenting unread physical context as an empty building.

### Deployment and hosted migration history

Five additive source migrations make up the released 2C database change. Hosted
history records the same changes under deployment timestamps; do not replay the
source timestamps or edit already-applied migrations:

| Source migration | Hosted registry |
|---|---|
| `20260913124500_persistent_building_context.sql` | `20260913141333_bob_persistent_building_context` |
| `20260913135500_expose_physical_proposal_state.sql` | `20260913141342_bob_expose_physical_proposal_state` |
| `20260913140500_physical_identity_delete_boundary.sql` | `20260913141357_bob_physical_identity_delete_boundary` |
| `20260913143000_building_context_fk_indexes.sql` | `20260913142013_bob_building_context_fk_indexes` |
| `20260913144500_building_delete_child_order.sql` | `20260913143018_bob_building_delete_child_order` |

The core migration is additive: existing Areas, measurements, components, solutions
and artifacts are not rewritten. Normal clients read RLS-protected tables through
security-invoker views and mutate physical truth only through guarded `bob.physical_*`
commands. Private authority helpers stay in `bob_private` with explicit execute ACLs.

Post-DDL advisor review introduced the dedicated FK-index follow-up above. The final
security advisor reports no new 2C-specific security finding. The performance advisor
still reports INFO-level covering-index opportunities on several accepted-revision /
composite physical foreign keys plus expected fresh-unused-index notices; these are
performance follow-ups, not release-authority failures. See the
[unindexed-FK remediation guide](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

### Live Auth/PostgREST proof and cleanup

[Live foundation check 34762945539](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34762945539)
passes on `main` after the cleanup-order fix. Through the ordinary authenticated Bob
client it proves persistent Site/Building/Level/Spaces, project and Area scope,
topology, an exact Measurement snapshot, accepted current vs proposal state, explicit
acceptance/history, RLS and raw-write denial. No AI is invoked.

The same run then unlinks project context and removes the disposable physical fixture
through the normal guarded authority commands. The log explicitly confirms
`Live building context fixture removed through guarded physical-authority commands.`
No test Building/Site is left behind by the verifier.

The current merged UI is also deployed: [Pages 34773319558](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34773319558)
passes for current `main` commit `b1c11f194d286775c6125eac46ad894b429bfdc8`.
Area-side physical-target editing remains a later narrow UI follow-up; backend Area
mapping is already covered by database and hosted live checks. Whole-plan import,
generated geometry and AI/vision consumption remain later gates and are not implied
by this 2C release.

## Delivered manual plans and drawings (4A)

**Status:** manual 4A implemented, merged, migrated and live-verified on
2026-09-13. [PR 31](https://github.com/EmelieHagander/Bob-the-builder/pull/31)
merged as `18994f688bccf12c6cb9a63dee66ff46ddccb21b`. The
[artifacts contract](artifacts.md) owns manual plans/drawings, exact target and
measurement lineage, revision history and status semantics. Deterministic drawing
generation, BOM/stock/shopping and task-readiness work remain later Slice 4/5 gates;
this does not close full Slice 4 or V1.

### Automated evidence

- All 35 database/data-boundary tests pass in
  [CI 34504663236](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34504663236)
  on feature head `04b2207e1d930ebe2dbc16bf74a80b93a9c2d138`. Five 4A tests execute the
  actual artifact migration/RLS and cover exact target/measurement revisions,
  stale-target and stale-artifact rejection, cross-project relation denial,
  append-only lineage/actor protection, archive/restore, area/project deletion and
  delayed project-switch results.
- TypeScript/Vite, edge, PWA/install and existing Ask bob isolation checks pass.
- `scripts/artifacts-browser.mjs` extends the existing production-frontend
  foundation harness at 320, 390 and 1280px. It proves manual create, exact
  measurement/image selection, selected-target lineage, visibly stale old drawings,
  conflict input recovery, new revisions, old-version history, archive/restore,
  reload, paging, 44px actions and project switching. Earlier images/steps/facts/
  solutions remain green in the same harness.
- Verification-only follow-ups
  [PR 35](https://github.com/EmelieHagander/Bob-the-builder/pull/35) and
  [PR 37](https://github.com/EmelieHagander/Bob-the-builder/pull/37) make the
  composed browser/live cleanup proofs tolerate legitimate downstream revisions;
  they change no product schema, UI or AI behavior. Their full CI runs
  [34752091765](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34752091765)
  and [34752480811](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34752480811)
  pass the complete foundation/browser suite.

### Deployment and live proof

Source migration: `supabase/migrations/20260910180000_project_artifacts.sql`.
It was applied to the Bob deployment on 2026-09-13; hosted history records the
same applied change as `20260913101509_bob_project_artifacts`. Do not replay the
authoring timestamp or edit the applied migration.

The migration adds `artifacts`, `artifact_revisions` and `artifact_measurements`,
plus invoker views `current_artifacts` and `artifact_measurement_details` and the
guarded `artifact_command` seam. Post-migration inspection found no new artifact
security findings and no missing artifact foreign-key indexes; fresh unused-index
notices are informational before real workload. The new artifact tables were empty
before disposable live verification. Existing Bob project/fact/solution/media rows
remained present; this release did not claim a new full-row checksum baseline.

[Pages 34752619338](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34752619338)
and [live foundation check 34752619293](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34752619293)
pass on final `main` commit `6a927fb60d446c1bf409a5a91ebda4442a2d6bdd`.
The live check uses the ordinary guest Auth client and one disposable project. It
proves the existing image/step/fact/solution chain plus 4A drawings with exact
selected-target/solution/measurement lineage, later-measurement disclosure,
stale target/revision denial, server attribution, archive/restore and denied access
to the real porch project. No AI is invoked.

After normal Storage API removal, measurement, solution and all four drawing
revisions retain their recorded image titles while file references are null. The
solution decision trail and later drawing target decisions remain readable. The log
confirms complete API cleanup of image bytes, metadata and attachments. The operator
then removed only disposable project `p_3a5cdd967ffe4781852410d6c36826dd`, guarded
by nonce `6cd37239-e7aa-4baf-bc87-6ed95ad60162`, exact generated project name and
zero remaining media rows. Storage object metadata was not deleted with SQL.

## Delivered solution alternatives and selected target (3A)

**Status:** manual 3A implemented, merged and deployed on 2026-09-10.
[PR 30](https://github.com/EmelieHagander/Bob-the-builder/pull/30) merged as
`e0562f74d45ed68705948de6f034c73ccbfbe6a5`. The
[solutions contract](solutions.md) owns alternatives, exact measurement evidence,
reference images and project target decisions. Generated proposals/mockups remain
the later 3B gate; this does not close full Slice 3 or V1.

### Automated evidence

- All 30 tests pass locally and in
  [CI 34497470612](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34497470612)
  on feature head `621679ce325fa137590da916e24aa82b0042c316`.
  Eight new checks execute the actual SQL/RLS or data boundary: coexisting
  alternatives, pinned target/evidence, stale edits/decisions, retained selection
  history, anonymous/outsider/dual-project authority, immutable parents/actors,
  atomic invalid-input rejection, archive/restore, file/area/project cleanup and
  delayed decision responses after a project switch.
- TypeScript/Vite, edge, PWA/install and existing Ask bob isolation checks pass.
- `scripts/solutions-browser.mjs` extends the production-frontend foundation
  harness at 320, 390 and 1280px using HTTP fixtures. All widths pass alternative
  creation, reference original viewing, exact measurement links, selected-version
  retention after revision, changed-measurement disclosure, old-version viewing,
  failed-decision input recovery, target replacement/clearing, archive/restore,
  decision history, reload, paging, 44px actions and project switching.
  The picker test waits for the first page to load before deciding to paginate.
  Earlier images/steps/measurements/parts also pass at all three widths.
  Screenshots remain automated CI artifacts, not a manual authenticated phone trial.

### Deployment and live proof

Source migration:
`supabase/migrations/20260910152455_solutions_and_selected_target.sql`.
Applied before its frontend; hosted history records it as
`20260910154029_bob_solutions_and_selected_target`. Do not replay the authoring
timestamp or modify the applied migration. Five new tables have RLS and three
views use invoker authority. No new security or missing-FK-index findings were
reported; unused fresh indexes are informational.

[Pages 34497811576](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34497811576)
and [live foundation check 34497811595](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34497811595)
pass on the merge. `scripts/check-live-solutions.mjs` uses the existing foundation
check's ordinary guest Auth client and single disposable project. It proves two
alternatives, a pinned selected solution version, an earlier estimated measurement
with its newer measured revision visible, stale/forged/raw-write denial, selected
archive denial, archive/restore, three target decisions and denied real-project
access. The existing live images/steps/facts checks also pass. No AI is invoked.

After normal Storage API removal, all four revisions of the first alternative
retain the image title and content with null file references. Its decision trail
remains readable. The log confirms complete API cleanup of image bytes, metadata
and attachments. The operator then removed only disposable project
`p_b848cd705477450f8b9c7ee81d44af9a`, guarded by nonce
`bbecf9fa-bd23-4868-8d20-83f02cc9807b`, exact name/description, sole guest membership
and absence of remaining media/objects. Cascades removed its solution, target and
evidence history. Storage object metadata was not deleted with SQL.

Final checks find two real projects, 36 tasks, two membership rows, 21 measurements
and their 21 revisions, five existing parts and their five revisions. All six
full-row checksums below match preflight and the check immediately after migration.
The 74 task steps now present belong to the retained real projects; no claim about
a preflight step checksum is made. No verification project, solution, target,
solution-evidence link or verification history remains. Project media metadata,
links and private-bucket object counts are zero.

| Preserved table | Rows | Full-row checksum |
|---|---:|---|
| `tasks` | 36 | `704d5cd43312a57ef70d010fb6e34b41` |
| `people` | 2 | `dd2453a80a1391f3b9b2286d4c262454` |
| `measurements` | 21 | `4af93fb4db14cc82cdd95b695a2ca0b7` |
| `measurement_revisions` | 21 | `9c86061c39f79216ac1984ada3e4b6a2` |
| `existing_components` | 5 | `888f10817d41bf2b3ed93226380d1b9b` |
| `component_revisions` | 5 | `80f9fd8115b3bb426e2ff8f72cac8f88` |

Checksum convention: `md5(string_agg(to_jsonb(row)::text, '' order by id))`.
The following dated sections preserve the earlier release evidence.

## Delivered measurements and existing components (2A/2B)

**Status:** manual milestones 2A and 2B implemented, merged and deployed on
2026-09-09. The [project facts contract](project-facts.md) owns behavior.
[PR 29](https://github.com/EmelieHagander/Bob-the-builder/pull/29) merged as
`6b3b3667050d82608abb982f9c8292204593bcbb`. Manual records are available from
Dashboard/Area; Bob/vision consumers and full Slice 2 remain later gates.

### Automated evidence

- All 22 tests pass locally and in
  [CI 34414133902](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34414133902)
  on feature head `5abc1f8b8c8a90e0af0d389b3c62cd95a283bfd5`.
  Eight new tests cover decimal input, exact length conversion, unknown vs known
  values, retained provenance/history, same-project parents and source images,
  actor/raw-write denial, stale edits, archive/restore, deletion/revocation and
  rejection of delayed writes after project switching. SQL/RLS checks execute the
  actual new migration in PGlite/Postgres.
- TypeScript/Vite, edge, PWA/install and existing Ask bob isolation checks pass.
- `scripts/project-facts-browser.mjs` extends the existing foundation harness.
  The production frontend and Supabase client pass at 320, 390 and 1280px against
  HTTP fixtures: unknown → estimate → measured, exact units/source image, To measure
  filtering, history, original viewing, reload, stale-save input recovery, existing
  part creation/archive/restore, linked dimensions, paging and project switching.
  Earlier upload/step flows also pass at all three widths. Screenshots are retained
  as CI artifacts; this is automated browser evidence, not a manual device trial.
- Browser findings fixed shared native-control labels, modals trapped below mobile
  navigation by a transformed page, and unfinished-upload recovery in the source
  picker. Geometry checks wait for page animations; pagination checks await the
  changed rows. The 44px action-target requirement remains intact.

### Deployed database and frontend

Source migration:
`supabase/migrations/20260909221503_measurements_and_existing_components.sql`.
Applied before the frontend; hosted history records the same change as
`20260909224644_bob_measurements_and_existing_components`. Do not replay the
authoring timestamp or edit an already applied migration.

All four new tables have RLS; both current-revision views use invoker authority.
New relations have no security-advisor findings and no missing foreign-key indexes.
Fresh unused-index notices are informational. Original task and membership row
checksums match before deployment and after disposable-fixture cleanup.
[Pages 34414587303](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34414587303)
successfully deploys the merge.

### Live Auth, PostgREST and Storage

[Live foundation release check 34414587288](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34414587288)
passes on the merge. `scripts/check-live-project-facts.mjs` runs inside the existing
image/step check's single disposable project, using the ordinary guest Auth client.
It proves three measurement revisions (unknown, 1.25 m estimate, 1254 mm measured),
exact conversion, linked component dimensions, server attribution, stale/invalid
write denial, component count/intent/archive/restore and denied real-project access.
The full original-byte Storage and illustrated-step checks also pass. No AI is invoked.

After Storage API removal, current records and all three measurement revisions
have null file references while keeping the recorded image title and values/history.
The log confirms complete API cleanup of image bytes, metadata and attachments.
The operator then removed only the printed disposable project
`p_cc2ce9f8ca25476e827bc19e8231a249`, matching nonce
`0039ddaf-a938-4500-85f3-c1e1ce8f6e42`, its exact name/description, sole guest
membership and absence of remaining images/objects. Related facts and revisions
cascaded with that fixture. Storage metadata was not deleted with SQL.

Final read-only checks find the original two projects, 36 tasks, two members,
seven areas, 71 materials and five reference labels. No verification projects,
image bytes/metadata/links, steps, measurements/components or revisions remain
from the fixture. Full-row task checksum `704d5cd43312a57ef70d010fb6e34b41` and
membership checksum `dd2453a80a1391f3b9b2286d4c262454` match preflight.
Both use `md5(string_agg(to_jsonb(row)::text, '' order by id))`; this release's task
checksum includes the instructions column already delivered by 1A/1B.

## Delivered image and step foundation (1A/1B)

**Status:** 1A and 1B implemented, merged and deployed on 2026-09-09.
The [media/step contract](media-and-steps.md) owns behavior. This file owns the
implementation and deployment evidence. Vision remains the later 1C gate;
completing the manual foundation does not close full Slice 1 or the V1 release.

- [PR 27](https://github.com/EmelieHagander/Bob-the-builder/pull/27) records the
  owner's foundations-first delivery order.
- [PR 28](https://github.com/EmelieHagander/Bob-the-builder/pull/28) delivers private
  project images and manual illustrated task steps; merge `c14a4a282a351db3d1e6158f8aed109fe6f12353`.
- Follow-up `fa363071709bbd03b6aeda766eccc32f31991d6c` repairs the PNG verification
  fixture's chunk CRC. It changes test data only, not application or database behavior.

### 1A/1B automated evidence

- All 14 tests pass locally and in
  [CI 34408699848](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34408699848)
  on feature head `b76e9c16e8d3012aed4a2c8fdc6e28c7fc4dd81e`.
  Five tests execute the actual new migration and policies
  in PGlite/Postgres, including deliberately broad pre-existing Storage policies.
- Covered: project/actor boundaries, two-project relation checks, immutable fields,
  reserved uploads, metadata readiness, retries/deletion, membership revocation,
  private-bucket configuration, manual instructions, step ordering/stale edits,
  required checks and keeping original images after detaching/removing steps.
- TypeScript and Vite production build pass.
- `scripts/check-foundations-browser.mjs` drives the production UI and Supabase
  client at 320, 390 and 1280px against HTTP fixtures. All three widths pass:
  upload and original viewing, existing-image attachment, task instructions,
  step editing/order/required completion, persistence after reload, pending-upload
  recovery and project switching while an old image download is in flight.
  Screenshot files are retained as CI artifacts; this is automated browser proof.
- Existing project-switch/Ask bob isolation, install/PWA and edge-function checks
  also pass in that CI run. The new flows make no AI request.
- Browser verification exposed a shared-auth observer bug on reload. The data layer
  now fans out one SDK subscription: mounting another view does not create a new
  initial-session event that incorrectly cancels a current project read.

### 1A/1B deployed database and frontend

Source migration: `supabase/migrations/20260909210642_media_and_task_steps.sql`.
It was applied before the frontend. Hosted history records the same change as
`20260909214606_bob_media_and_task_steps`. Do not replay it under the CLI authoring
timestamp or edit an already applied migration.

- The private `bob-project-media` bucket is deployed with a 6 MiB limit and
  JPEG/PNG/WebP MIME allowlist. All three new domain tables have RLS enabled.
- The original two projects and 36 tasks are preserved. Checksums of the original
  task columns (excluding the added empty instructions column) and existing
  membership rows are identical before and after the additive migration.
- Security review reports no findings on the new Bob tables; all their foreign
  keys have covering indexes. Existing shared-database objects and the public
  app-asset bucket retain their roles.
- Production Pages deployment passes for the merge
  ([34409006000](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34409006000))
  and fixture follow-up
  ([34409586992](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34409586992)).

### 1A/1B live Auth, PostgREST and Storage

[Live foundation release check 34409586950](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34409586950)
passes on `fa363071709bbd03b6aeda766eccc32f31991d6c`. A valid PNG was uploaded,
read back byte for byte and removed through the deployed Storage API. The log
records successful domain/access checks and complete image cleanup. An earlier
run also passed the API checks; the final run uses the corrected PNG fixture.

`scripts/check-live-foundations.mjs` verifies real Auth, PostgREST and Storage with
the existing public guest account in a newly created disposable project. It checks
original-byte read-back, denied public/anonymous access, immutable uploads, actual
embedded links, persisted instructions/steps, required checks and deletion recovery.
It does not invoke AI or grant the guest access to real projects.

The script removes its image bytes via Storage and then metadata/links via the
domain command, including after failure. Client project deletion remains
unavailable, so the operator removes only the exact printed disposable project
after verifying its name, description, sole guest membership and absence of
remaining image metadata or objects. Storage objects are never deleted with SQL.

Both disposable verification projects have been removed after successful API file
cleanup. Final checks find only the two original projects, 36 tasks, two members,
seven areas, 71 materials and five legacy reference labels. No verification
projects, image objects, media metadata/links or steps remain. Original task and
membership checksums still match the preflight after this cleanup.

Checksum convention: `md5(string_agg(row_json::text, '' order by id))`, with
`row_json = to_jsonb(task) - 'instructions'` for original task fields and
`row_json = to_jsonb(person)` for membership rows.

## Evidence limits

PGlite checks actual SQL/RLS but emulates Storage metadata rows; it is not an object
storage server. Browser checks use HTTP fixtures and cannot prove deployed Storage.
The live API script provides that separate deployed-service proof. Do not describe
fixture screenshots as a manual authenticated walkthrough on the owner's phone.
No owner Bob/vision trial was required. Vision, AI consumption of the manual
foundations, generated proposals/guidance, deterministic drawing generation,
calculations, BOM/stock/shopping and full progress/as-built history remain later
scope. Manual 1A/1B, 2A/2B, 3A and 4A completion does not close full Slices 1–4
or the V1 release.
