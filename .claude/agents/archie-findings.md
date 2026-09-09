# Archie — open findings

> Unresolved documentation/product-contract drift. Resolve or move to an issue when scheduled; keep this as a short navigation aid, not a roadmap.

## FINDING-A01 — Current product thesis / release boundary needed one owning contract

**Status:** resolved for V1 planning

`Docs/v1-plan.md` now owns the current V1 product thesis, release boundary, golden-path acceptance, slice sequence and release gates. It builds on the existing owners rather than duplicating them:

- `Docs/user-stories.md` — user goals and acceptance intent;
- `Docs/function-inventory.md` — built / partial / gap audit;
- `Docs/function-scope.md` — difficulty/prioritisation buckets and first-slice detail;
- `Docs/ui-index.md` — general UI/front-end contract.

The V1 plan also clarifies naming: the `V0-*` terms in `function-scope.md` are next-phase scope labels created before the release was named V1; they are not separate app releases.

**Why this closes the finding:** future product trade-offs now have one release-level owner for primary value, anti-goals, what V1 must prove, and what is explicitly later.

Do not create another thesis/roadmap document for V1 unless this owner is intentionally superseded.

## FINDING-A02 — Built / specified / planned status was not centrally tracked

**Status:** resolved for current capability audit

`Docs/function-inventory.md` is the owning implementation audit for **what bob materially supports today**, what is partial, what is absent, and which cross-cutting correctness gaps exist. `Docs/index.md` routes current-state questions there.

`Docs/function-scope.md` separately owns function difficulty/prioritisation, and `Docs/v1-plan.md` owns the V1 release boundary/order, so the inventory does not need to become a speculative roadmap.

## FINDING-A03 — Major new media workflow needs one owning implementation contract

**Status:** open / Slice 1 blocker

`Docs/user-stories.md` defines the user-facing media roles (current-state photos, proposals/mockups, cut-through diagrams, drawings, progress/as-built photos and task guidance). `Docs/function-inventory.md` confirms that current runtime only stores reference-image labels/placeholders rather than real media. `Docs/function-scope.md` selects real authorised current-state media as the first vertical slice, and `Docs/v1-plan.md` makes that slice part of the V1 release gate.

**Why it matters:** storage, provenance, project/area/task attachment, RLS and runtime consumption must be one coherent contract before implementation; otherwise the first defining new domain object can fork immediately.

**Owning follow-up:** before coding Slice 1, define the minimum media data/storage/authority/runtime contract. Coordinate with Vera for upload/read-back UI and with data/auth owners for storage/RLS. Keep the contract narrow to the selected slice rather than designing every future artifact type in advance.
