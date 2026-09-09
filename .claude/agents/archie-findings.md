# Archie — open findings

> Unresolved documentation/product-contract drift. Resolve or move to an issue when scheduled; keep this as a short navigation aid, not a roadmap.

## FINDING-A01 — Current product thesis still needs an owning contract

**Status:** partially resolved

`Docs/user-stories.md` now captures the current canonical user-story landscape for both bob's original collaborative-build core and the newer workflow: project discovery from photos, measurement collection, solution visualisation, drawings, existing-material inventory, calculated material lists, step-by-step build plans and optional "How do I?" guidance.

`Docs/function-inventory.md` now separately audits what is actually built, partial or missing, so story intent no longer has to double as implementation truth.

The remaining gap is a concise current **product thesis / next-slice scope** that states primary value, north stars/anti-goals and which stories form the next truthful vertical slice.

**Why it matters:** the story landscape and implementation gap map are now preserved outside chat, but architecture should not infer priority from story order or current implementation status.

**Owning follow-up:** create the current product-thesis/scope contract and select the first vertical slice. Preserve the original PRD as historical product intent.

## FINDING-A02 — Built / specified / planned status was not centrally tracked

**Status:** resolved for current capability audit

`Docs/function-inventory.md` is now the owning implementation audit for **what bob materially supports today**, what is partial, what is absent, and which cross-cutting correctness gaps exist. `Docs/index.md` routes current-state questions there.

This does **not** create a speculative roadmap. When a vertical slice is selected, its delivery state should still be tracked in the owning slice/scope contract rather than expanding the inventory into sprint management.

## FINDING-A03 — Major new media workflow needs one owning implementation contract

**Status:** open

`Docs/user-stories.md` defines the user-facing media roles (current-state photos, proposals/mockups, cut-through diagrams, drawings, progress/as-built photos and task guidance). `Docs/function-inventory.md` confirms that current runtime only stores reference-image labels/placeholders rather than real media.

**Why it matters:** without an owning media implementation contract, storage, provenance, project/area/task attachment and UI consumption could still be designed independently.

**Owning follow-up:** define media data/storage/authority/runtime semantics together with the first real-image vertical slice. Coordinate with Vera for UI and with data/auth owners for storage/RLS.
