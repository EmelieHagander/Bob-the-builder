# Archie — open findings

> Unresolved documentation/product-contract drift. Resolve or move to an issue when scheduled; keep this as a short navigation aid, not a roadmap.

## FINDING-A01 — Current product thesis still needs an owning contract

**Status:** partially resolved

`Docs/user-stories.md` now captures the current canonical user-story landscape for both bob's original collaborative-build core and the newer workflow: project discovery from photos, measurement collection, solution visualisation, drawings, existing-material inventory, calculated material lists, step-by-step build plans and optional "How do I?" guidance.

The remaining gap is a concise current **product thesis / next-slice scope** that states primary value, north stars/anti-goals and which stories form the next truthful vertical slice.

**Why it matters:** the story landscape is now preserved outside chat, but architecture should not infer priority from story order or implementation status.

**Owning follow-up:** after the story landscape is accepted, create the current product-thesis/scope contract and select the first vertical slice. Preserve the original PRD as historical product intent.

## FINDING-A02 — Built / specified / planned status is not centrally tracked

**Status:** open / non-blocking

The repository contains a mix of built runtime, historical PRD scope and newer architecture seams. `Docs/user-stories.md` now labels story-level implementation state as BUILT / PARTIAL / NEW, but there is still no compact delivery-status ledger for the upcoming implementation slice.

**Why it matters:** future sessions may mistake a documented idea for shipped behavior (or overlook capability already implemented).

**Owning follow-up:** when the next implementation slice is selected, add status labels to its owning contract rather than creating a broad speculative roadmap.

## FINDING-A03 — Major new media workflow needs one owning implementation contract

**Status:** open

`Docs/user-stories.md` now defines the user-facing media roles (current-state photos, proposals/mockups, cut-through diagrams, drawings, progress/as-built photos and task guidance). The current data/UI model still stores reference-image labels/placeholders rather than the required real media workflow.

**Why it matters:** without an owning media implementation contract, storage, provenance, project/area/task attachment and UI consumption could still be designed independently.

**Owning follow-up:** define media data/storage/authority/runtime semantics together with the first real-image vertical slice. Coordinate with Vera for UI and with data/auth owners for storage/RLS.
