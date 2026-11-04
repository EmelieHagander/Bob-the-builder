# P2.5 — Live Ladan acceptance: long-member anchor and outer handoff stop

**Status (2026-11-04):** Candidate fix prepared; **not yet merged, migrated or deployed**. Issue #438 remains open until the real saved window has been checked, shown in 3D and reviewed by the owner.

## Production evidence, read-only

- The live Ladan turn started 11:52 UTC, completed 12:12 UTC. It made **40 model calls**, **three `ask_structure_worker` handoffs**, cost telemetry approximately **$6.01**, and **no new Construction revision**. The saved draft remains revision **4**, 78 instances, pinned to target **29** / Solution **21**; the selected design is target **35** / Solution **27**. The correct Plan focus was saved to the facade-opening Step.
- Konrad first attempted the new front hen-room window as eleven new geometry instances, with local window studs, double header, sill and cripple studs. The edit specified target **35**. `prepare_construction_edit` returned `ready`, then the canonical writer rejected it with PostgreSQL `PT409: construction_piece_too_spread_out` (recorded in the claimed job journal). No partial revision was committed.
- The new window's added joints connect local parts to two **unchanged** existing front members: `bp_front_l` (2,450 mm long) and `tp_front` (6,000 mm long). The P1 trigger includes *both ends of every changed joint* in its affected-part span. It therefore measured the full through-member length against a **2,200 mm** per-workpiece limit. A single local opening was counted as 6 m of facade work.
- Later retries also hit human-text validation, then `construction_source_refresh_blocked/design_target_changed` when Konrad fell back to the **old target 29** instead of selected target 35. These are separate safeguards and should not be disabled to make the test green.
- P2.3 v4 correctly stopped an inner Konrad chain after its first canonical conflict, but Bob delegated the blocked window two more times **in the same owner turn**. The final answer acknowledged this, but the repeated provider work is a real orchestration gap.

## Proposed narrow correction

1. Keep P1's existing `max_affected_instances`, exact facade match, Plan focus, original `max_piece_run_mm`, review hold and P2.4 semantic source guard.
2. Count an unchanged through-member touched by a joint as affected and require it to belong to exactly one facade, but exclude its *entire longitudinal span* only if **every** changed joint touching it is a newly added joint to a genuinely **new** piece whose axis-aligned box physically touches it. Changed long geometry, changed manufacture roles, removed/replaced joints, old-to-old joints, non-contacting anchors, cross-facade parts and multiple spaced new openings still use the original rejection path.
3. Persist a new per-turn marker after `construction_piece_write_conflict`. If Bob calls Konrad again in that same turn, return `needs_verification` without starting a new model chain. Ordinary provider-failure markers retain their original behavior; old pinned workers stay unchanged.

## Verification plan

- Static TS parsing and `git diff --check` on the patch.
- PGlite regression: old-to-old joint must fail; two widely separated new attachments must fail; non-contacting anchor must fail; actual change to the long member must fail; one local touching new attachment must create exactly one `awaiting_review` facade hold.
- Run isolated `BEGIN; ... ROLLBACK` verification on the current function definition and a cloned actual Ladan revision, with **no live Bob write jobs**. Compare saved counts, geometry and source pin before and after; do not count a synthetic edit as construction acceptance.
- Focused worker test: two Bob handoffs in one turn after a canonical conflict must produce **one** paid Konrad chain, and the second result must name the per-turn block.
- Run owner-initiated live test only after database migration and both Edge functions are verified against the same merged commit; check exact Construction revision, check output, 3D facade view and owner feedback hold. No automatically initiated paid model tests or full CI.

## Separate entrance observation

The simultaneously run `Bygga in entrén` turn completed with a saved **new concept Construction rev 1**, 31 part instances, 44 joints and selected target/solution 7. Bob asked the owner to reconcile the old **174 cm** depth with the proposed **265 cm** depth. It is not a checked build-ready or CAD-delivered design; no new Construction-linked drawing artifact was present at this inspection. Subsequent owner work on entrance mockup images is separate and must not be interrupted by this fix.
