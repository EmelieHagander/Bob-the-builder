# P2.4 – Safe selected-source reconciliation and Plan focus (2026-11-04)

**Status:** Merged via PR #437; production active 2026-11-04. Source-only and facade semantic guards installed as migrations 20261104113252 and 20261104113311, both Edge functions verified active (ask-bob v223 / bob-worker v191), and catalog followup installed 20261104113817 (`bob.tools` v45, 21 followups). Live AI/window acceptance remains outstanding; no production geometry was changed.

## Confirmed root cause

Lilla ladan had Construction revision 4 with **78 saved part instances**, pinned to selected target 29 / Solution 21. The current selected target is 35 / Solution 27. The later Solution has a newly approved **geometry-dependent window decision** (the choice count grew 3 → 4). The Construction's `source_state` is `changed`.

The first Plan Step's evidence now computes **2 of 2 satisfied**, but `project_plans.focus_step_id` still identifies reconciliation Step 1. The protected facade work requires Step 2. `read_construction_piece_progress` therefore returns `not_focused`.

Without P2.4, the existing `change_construction_parameters` source-only preparation returned **ready** for an empty set of parameter changes and target 35. That would have moved a source pin without building the missing window geometry. The same bypass could occur through an unrelated Construction edit that advances the source with zero affected geometry instances.

## Resolution

1. **P2.3** [PR #437] stops an unfocused handoff *before* paying for Konrad and stops a rejected v4 geometry write after its first canonical conflict. Old pinned jobs retain their behavior.
2. **P2.4 Plan focus:** a new catalog followup loads the *existing* `read_plan_link_context` and `change_plan_focus` tools on the next Bob model step **only** when `ask_structure_worker` returns `needs_verification` for `construction_piece_step_not_focused`. Both remain server-bound, with ordinary policy and active Plan revision checks. It does not silently complete a Step, invent proof, or change focus automatically.
3. **P2.4 source-only guard:** `prepare_construction_parameter_change` checks the old and selected current Solution's exact governing choices/features and identity. With changed decisions, an empty parameter change plus a new target returns `needs_data / source_only_design_decisions_changed`; no save. A genuinely text-only Solution revision with identical governing decisions remains eligible for the already-existing source-only pathway.
4. **P2.4 physical facade guard:** the existing P1 deferred trigger determines **n**, the count of actually affected physical instances, using canonical geometry, definitions, materials, joint endpoints and manufacture roles. If `n=0` and the selected target changes to a Solution with different governing choices/features/identity, the trigger rejects `construction_piece_changed_design_without_geometry`. A real bounded front-facing geometry delta can still advance the selected source *atomically* and records `awaiting_review` for the exact saved facade revision.
5. No new LLM, adapter, duplicated domain tools, automatic FORM mappings or hidden user approvals.

## Verification from actual project database, **all with ROLLBACK**

- Before the source guard, an owner-authorized preparation with `changes=[]`, target 35 returned `ready` despite the new geometry-dependent window choice.
- With the candidate migration loaded transactionally, the identical preparation returned `needs_data / source_only_design_decisions_changed`.
- A cloned version of all 78 parts **and** 78 manufacture-role entries, repinned to target 35 but with unchanged geometry, was rejected by the amended P1 trigger with `construction_piece_changed_design_without_geometry`. The test first uncovered a missing policy-clone in the fixture, which was corrected; the production rules were not weakened.
- A synthetically added **front** box plus the target 35 pin, with temporary Plan focus on the facade Step and cloned role policies, was accepted by the P1 spatial trigger and created a temporary `awaiting_review:front` attempt. This is a **mechanical boundary test**, not a valid real window design, CAD check, or approval.
- The focus-followup catalog migration created 21 correctly bounded followups inside an isolated transaction and was rolled back.
- After all rollbacks: Construction rev 4 with 78 instances and zero review attempts remains untouched. No paid AI invocations.

## Regression tests

- `tests/construction-piece-handoff.test.ts`: pure v4 preflight statuses; its exact Git blob was reproduced and run under native Node TS stripping (3 passing).
- `tests/bob-build-workers.test.ts`: no Konrad model/tool call when focus is wrong.
- `tests/bob-worker-piece-progress.test.ts`: v4-only conflict ends the specialist without another model request; pinned legacy behavior is retained.
- `tests/p24-focused-tool-followup.test.ts`: code-owned next-step policy loading and disabled/old-manifest behavior.
- `tests/construction-source-refresh.test.ts`: text-only refresh remains possible; changed choices block empty source adoption.
- `tests/construction-presentations.test.ts`: an exact cloned older Construction with a new target cannot cross the P1 gate with zero affected physical pieces.
- `tests/delivery-language.test.ts`: recovered unversioned task labels do not display `vnull`.

**Full repository typecheck and PGlite suite are still required before claiming comprehensive green CI.** GitHub Actions are intentionally not triggered.

## Release and next owner test

Merge only after reviewing exact test/diff and verifying a quiet Bob job queue. Deploy both Edge function packages built from the merged commit, preserving original JWT flags, and only then activate the P2.4 catalog after the SQL guards have been applied and checked. Any Supabase migration version assigned by the provider must be synchronized back into GitHub to prevent accidental replay.

During the next live test, Bob should use the current Plan evidence to shift focus via an authorized tool; then Konrad must read the current selected Solution and saved Construction and make **one meaningful window geometry change** with the explicit target pin. The P1 facade limit must stop after the first saved and checked view. Human feedback is still required before any next piece. Report actual tool/model count, cost, time, saved revision and visual review status.

**No production source or geometry repinning was performed as part of this work.**
