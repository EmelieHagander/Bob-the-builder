# P2.3 — Ladan handoff failure and bounded recovery, 2026-11-04

**Status:** Source fix and regression tests in PR, NOT deployed or live-accepted. No new AI jobs or geometry writes in this investigation.

## Observed latest test

The user asked Bob to verify/finish the current reconciliation Step and then construct **one** window on the front facade, showing its saved 3D revision before proceeding.

Live job `5f24b94c-d98e-41b9-83c1-af18467c1cfb` (`09:47:47–09:57:19 UTC`) ended with `bob_jobs.status=completed`, but delivery was **`recovered` / `end_reason=failed`**. This was not successful task completion:
- One Task was updated to `done`; no new construction revision, no 3D rendering, no saved-window review. Construction stayed at revision 4 (78 instances).
- Konrad's first `edit_construction_parts` returned `conflict`, after which the worker used repeated source reads and more model rounds rather than stopping.
- The turn contained 5 main Bob model calls, 10+ Konrad model calls, five context-summary calls and a recovered-language call. Execution cost telemetry totals approximately **$2.68**, not provider invoice reconciliation.
- Worker checkpoint warnings showed around **0.9–1.02 MB** of state, especially the repeated context-continuation and tool-shelf snapshots. This is a symptom accompanying the failed/long handoff, not proof of a memory-quota crash.

## Two independent blockers confirmed with read-only, owner-authorized RPCs

1. `bob.read_construction_piece_progress` returned `status=not_focused`. The approved facade-opening Step is `538598a3-7028-435b-b09e-fb384f618fb0`, while `project_plans.focus_step_id` was still the preceding reconciliation Step. In the pre-P2.3 runtime, the handoff checked `awaiting_review` and various unavailable states but **forgot `not_focused`**. The provider was invoked even though its geometry write was not eligible.
2. `bob.read_construction_draft` returned `source_state=changed` for construction rev 4, pinned to target 29 / solution rev 21 while selected target is 35 / solution rev 27. Even after focus is fixed, this source mismatch needs a separately verified, source-safe reconciliation. This PR deliberately does not repin an old construction without proof that its geometry still matches the new Solution.

The saved reconciliation Task is `done`; the approved Plan's evidence calculation is **2/2 satisfied**, but the Step is still `active` and its focus has not moved. Requirement satisfaction, Step state, focus, source freshness and user approval are distinct concepts.

## Scoped P2.3 correction

- A pure, code-owned `constructionPieceHandoffGate` handles `not_focused` before any specialist model request. It supplies the current and required exact Step identities as data and tells Bob to inspect verified requirements and use the existing authorized `change_plan_focus` path.
- The existing exact visual-review hold remains unchanged. Unknown/failing/changed gate statuses fail closed. `not_configured`, `ready` and `correction_requested` keep their previous behavior.
- In the v4 bounded-review worker, a canonical `conflict` from a construction-writing tool ends that worker run immediately with `needs_verification` and the rejection trace, rather than spending further Opus/context-summary rounds. This **does not** affect older worker protocols without `readBoundedReview`.
- Recovered Task receipts without a numerical revision are rendered without the spurious `vnull` suffix. The server continues to list only truly saved work.

## Tests and release boundary

- Added unit tests for each preflight status, an integration fixture asserting **zero Konrad model calls** when focus is wrong, a v4-only rejected-write stop test with older-manifest control, and a recovery-label regression.
- Before production, run `npm run typecheck`, `node --import tsx --test tests/construction-piece-handoff.test.ts tests/bob-build-workers.test.ts tests/bob-worker-piece-progress.test.ts tests/delivery-language.test.ts`, and assess the complete code delta. Do not run GitHub Actions or a paid AI experiment as part of this patch.
- Release only when **no Bob jobs are running**, with an exact source deployment and readback of `ask-bob` and `bob-worker`, retaining existing JWT settings. Check live gate and the 78-part construction afterward. No automatic Step transition, rebase, or source-refresh is part of deployment.
- **Acceptance still outstanding:** implement/verify the safe reconciliation of the legacy construction to selected Solution without inventing FORM mapping, then run one real owner-initiated window edit and inspect saved 3D view, stop gate, actual cost, and follow-up behavior.
