# P2.2 — Plan evidence must mean completed work (2026-11-04)

**Status:** production-migrated and checked as `20261104093214_p2_verified_plan_task_evidence`; real model acceptance remains separate from code/DB verification.

## Observed failure

During Lilla ladan's source reconciliation on November 4, Bob said both requirements of the active Plan Step were fulfilled. The model had linked one saved Solution revision and one Task as `resolves` evidence. But that Task was still `todo`, while the existing `bob_private.plan_requirement_state` treated every extant linked Task as satisfactory. This was a **code-level false positive**, not proof that `resolution='open'` means incomplete. `open` is the normal evidence-derived resolution mode; the authoritative computed state is `status.state` in `project_plan_read` / `project_plan_briefing`.

## Corrected boundary

- A Task with status `todo` or `doing` is work to perform, not evidence of a completed check. Both direct requirement selectors and historic linked Task evidence remain `missing` until the Task is `done`.
- New `resolves` / `refines` / `supersedes` links to incomplete Tasks are rejected **before writing** with `22023 plan_task_not_completed`. Negative/conflicting links remain possible.
- The returned linked evidence includes its current `task_status`. A successful evidence write also returns an accurate **step_completion** snapshot: total, satisfied, missing, stale, conflicted, and `requirements_ready`. This means Bob receives immediate feedback from server-owned facts without another model or expensive read. `requirements_ready` is not a user signature, a technical safety certificate, or automatic completion of the Step.
- Permission checks, target/source revisions, archived objects and historic evidence links stay in place. We do **not** silently delete linked Tasks, auto-mark Steps completed, or force parallel Steps to become sequential.

## Real verification

In an isolated PostgreSQL transaction using the actual, owner-authorized Ladan data and a pinned test job actor:
1. Before the change, `todo` Task evidence incorrectly appeared as `satisfied`.
2. With the candidate migration, the first requirement became `missing`, while the second (pinned current Solution) remained `satisfied`; the existing Plan briefing reported 1 missing / 1 satisfied.
3. Linking the unfinished Task to `resolves` was rejected without a write.
4. With only a temporary in-transaction Task transition to `done`, the exact evidence writer returned `requirements_ready=true` and 2 satisfied. Switching to `doing` revoked satisfaction.
5. `ROLLBACK` left Ladan with its original `todo` Task, existing evidence, Construction revision 4 and 78 instances. This is *not* a real Bob/AI acceptance test.

A synthetic PGlite integration regression in `tests/living-project-plan.test.ts` also covers selectors, links, reopen, the step-completion receipt, and unauthorized access; it must be run in a complete repository test environment before claiming the automated suite passed.

**After production activation:** a fresh read of `bob.project_plan_briefing` for the real owner returned 1 missing / 1 satisfied. The historic Task remained `todo`, Construction revision 4 retained 78 instances, and no Bob job was queued or running. The deployed SQL is the same exact merged source tested with rollback.

## P2 scope and next acceptance

P2.1's existing catalog adjacency improves the observed tool-navigation overhead, without adding models. P2.2 resolves the demonstrated false-positive completion claim at the authoritative database seam. The old 9/6 construction read counts were **tool calls**, not proved identical requests; no unsafe cross-revision caching is introduced. A new owner-run comparison after P2 will determine the actual model-round and cost improvement. Until that acceptance, no quantified savings or completion of physical construction can be claimed.
