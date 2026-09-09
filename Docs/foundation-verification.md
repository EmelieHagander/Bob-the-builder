# Milestones 1A/1B — verification and rollout

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

## Automated evidence

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

## Deployed database and frontend

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

## Live Auth, PostgREST and Storage

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
No owner Bob/vision trial was required. Vision, generated guidance, measurements,
solution/drawing revisions and full progress/as-built history remain later scope.
