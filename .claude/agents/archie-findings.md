# Archie — open findings

> Unresolved documentation/product-contract drift. Resolve or move to an issue when scheduled; keep this as a short navigation aid, not a roadmap.

## FINDING-A01 — Current product thesis still needs an owning contract

**Status:** narrowed / non-blocking for Slice 1

`Docs/user-stories.md` now captures the current canonical user-story landscape for both bob's original collaborative-build core and the newer workflow: project discovery from photos, measurement collection, solution visualisation, drawings, existing-material inventory, calculated material lists, step-by-step build plans and optional "How do I?" guidance.

`Docs/function-inventory.md` separately audits what is actually built, partial or missing. `Docs/function-scope.md` now owns D1–D5 difficulty, next-phase V0 scope and the selected first vertical slice (`Show bob the real project`).

The remaining documentation gap is a concise current **product thesis** that states primary value and anti-goals in one owning product contract. The repo already has useful north stars in `CLAUDE.md`, but they are session invariants rather than a full product-thesis document.

**Why it matters:** a thesis will help resolve future product trade-offs, but the lack of one no longer blocks the selected Slice 1 because current stories, inventory, scope and slice blockers are explicit.

**Owning follow-up:** create a concise product-thesis contract before a future scope disagreement makes the missing owner material. Preserve the original PRD as historical product intent.

## FINDING-A02 — Built / specified / planned status was not centrally tracked

**Status:** resolved for current capability audit

`Docs/function-inventory.md` is now the owning implementation audit for **what bob materially supports today**, what is partial, what is absent, and which cross-cutting correctness gaps exist. `Docs/index.md` routes current-state questions there.

`Docs/function-scope.md` now separately owns next-phase scope and slice order, so the inventory does not need to become a speculative roadmap.

## FINDING-A03 — Major new media workflow needs one owning implementation contract

**Status:** open / Slice 1 blocker

`Docs/user-stories.md` defines the user-facing media roles (current-state photos, proposals/mockups, cut-through diagrams, drawings, progress/as-built photos and task guidance). `Docs/function-inventory.md` confirms that current runtime only stores reference-image labels/placeholders rather than real media. `Docs/function-scope.md` selects real authorised current-state media as the first vertical slice and names the authority/provenance blockers.

**Why it matters:** storage, provenance, project/area/task attachment, RLS and runtime consumption must be one coherent contract before implementation; otherwise the first defining new domain object can fork immediately.

**Owning follow-up:** before coding Slice 1, define the minimum media data/storage/authority/runtime contract. Coordinate with Vera for upload/read-back UI and with data/auth owners for storage/RLS. Keep the contract narrow to the selected slice rather than designing every future artifact type in advance.
