# Archie — open findings

> Unresolved documentation/product-contract drift. Resolve or move to an issue when scheduled; keep this as a short navigation aid, not a roadmap.

## FINDING-A01 — No current canonical product thesis/user-story contract for bob's next phase

**Status:** open

The original BuildCoord PRD covers the collaboration/coordination product well, but the newly emerging workflow — project discovery from photos, measurement collection, solution visualisation, drawings, existing-material inventory, calculated material lists, step-by-step build plans and optional "how do I?" guidance — is not yet captured in a current canonical product document.

**Why it matters:** these decisions are now likely to drive schema, media, AI and UI architecture. Leaving them only in conversation risks fragmented implementation.

**Owning follow-up:** create a concise current product-thesis/user-story contract after the user-story landscape is agreed; link it from `Docs/index.md`. Preserve the original PRD as historical product intent.

## FINDING-A02 — Built / specified / planned status is not centrally tracked

**Status:** open / non-blocking

The repository contains a mix of built runtime, historical PRD scope and newer architecture seams, but there is no compact status ledger for the upcoming phase.

**Why it matters:** future sessions may mistake a documented idea for shipped behavior (or overlook capability already implemented).

**Owning follow-up:** when the next implementation slice is selected, add status labels to its owning contract rather than creating a broad speculative roadmap.

## FINDING-A03 — Major new media workflow needs one owning contract

**Status:** open

Reference images exist as a product concept, but the current data/UI model stores labels/placeholders. The next phase expects multiple real media roles: current-state photos, mockups, cut-through diagrams, drawings, progress photos and task-specific guidance images.

**Why it matters:** without an owning media contract, storage, provenance, project/area/task attachment and UI consumption could be designed independently.

**Owning follow-up:** define media semantics together with the first real-image vertical slice. Coordinate with Vera for UI and with data/auth owners for storage/RLS.
