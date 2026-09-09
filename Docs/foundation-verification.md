# Milestones 1A/1B — verification and rollout

**Status:** implementation on `feat/media-and-task-steps`; release gates pending.
The [media/step contract](media-and-steps.md) owns intended behavior. This file owns
the evidence for actual implementation and deployment. Vision is the later 1C gate.

## Automated evidence

- All 14 local tests pass. Five tests execute the actual new migration and policies
  in PGlite/Postgres, including deliberately broad pre-existing Storage policies.
- Covered: project/actor boundaries, two-project relation checks, immutable fields,
  reserved uploads, metadata readiness, retries/deletion, membership revocation,
  private-bucket configuration, manual instructions, step ordering/stale edits,
  required checks and keeping original images after detaching/removing steps.
- TypeScript and Vite production build pass.
- `scripts/check-foundations-browser.mjs` drives the production UI and Supabase
  client at 320, 390 and 1280px against HTTP fixtures. CI completion is pending.
- Browser verification exposed a shared-auth observer bug on reload. The data layer
  now fans out one SDK subscription: mounting another view does not create a new
  initial-session event that incorrectly cancels a current project read.

## Deployment gate

Source migration: `supabase/migrations/20260909210642_media_and_task_steps.sql`.
Apply it before deploying the corresponding frontend. Hosted migration identifiers
can differ from the CLI authoring timestamp; record the applied identifier here.
Do not replay a migration already present in this shared database's history.

Preflight found two real projects and 36 existing tasks. New tables and the private
bucket did not exist. Existing task/member data must remain unchanged; compare the
original task columns (excluding the added empty instructions column) and members
after the additive migration. The public app-asset bucket keeps its existing job.

`scripts/check-live-foundations.mjs` verifies real Auth, PostgREST and Storage with
the existing public guest account in a newly created disposable project. It checks
original-byte read-back, denied public/anonymous access, immutable uploads, actual
embedded links, persisted instructions/steps, required checks and deletion recovery.
It does not invoke AI or grant the guest access to real projects.

The script removes its image bytes via Storage and then metadata/links via the
domain command, including after failure. An operator removes only its printed
disposable project afterwards; client project deletion remains unavailable.

## Evidence limits

PGlite checks actual SQL/RLS but emulates Storage metadata rows; it is not an object
storage server. Browser checks use HTTP fixtures and cannot prove deployed Storage.
The live API script provides that separate proof when it passes. Do not describe
fixture screenshots as a manual authenticated walkthrough on the owner's phone.
No owner Bob/vision trial is needed to progress foundation work.
