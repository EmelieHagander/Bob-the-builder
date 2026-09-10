# Foundation verification and rollout

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
foundations, generated proposals/guidance, drawing revisions, calculations and full
progress/as-built history remain later scope. Manual 1A/1B, 2A/2B and 3A completion
does not close full Slices 1–3 or the V1 release.
