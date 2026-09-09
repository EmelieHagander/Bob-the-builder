# Vera — open findings

> Unresolved frontend/UX drift and follow-ups. Resolve or move to an issue when work is scheduled; do not turn this into a second roadmap.

## FINDING-V01 — Reference images are labels/placeholders, not real project media

**Status:** open / Slice 1 scoped

The Area UI has a reference-image concept, but current frontend/domain data represents images as labels and renders placeholder tiles rather than real uploaded/renderable media.

**Why it matters:** the emerging bob workflow depends heavily on current-state photos, target mockups, construction cut-throughs, drawings and step-specific instructional images being available when work happens.

**Owning follow-up:** `Docs/function-scope.md` now defines the Slice 1 UI placement: evolve the existing project/Area image surface, keep Ask bob conversational, avoid a new top-level media studio, preserve complete originals, and keep media-purpose styling separate from status colors. Implementation still needs the media data/storage/authority contract plus real runtime consumption. Do not solve this as a cosmetic tile change only.

## FINDING-V02 — Current visual contract is implicit rather than fully documented

**Status:** sufficiently addressed for Slice 1; broader blueprint deferred

`Docs/ui-index.md` documents current ownership and invariants, and `Docs/function-scope.md` now records the concrete UI-placement decisions needed for the first media/evidence vertical slice. A separate page blueprint is therefore **not required before Slice 1**.

**Why it matters:** the app is growing into new planning/media/instruction surfaces, increasing the chance of local UI dialects.

**Owning follow-up:** create a deeper design/page blueprint only if later slices introduce repeated patterns that cannot be owned cleanly by the existing shell, shared primitives and slice contracts. Do not produce documentation for its own sake.

## FINDING-V03 — Inline visual values are common

**Status:** open / not currently a blocker

Many pages/components use inline layout and visual values alongside shared tokens/classes.

**Why it matters:** repeated new features may increase drift if every screen copies one-off values.

**Owning follow-up:** when a repeated pattern is touched by real feature work, promote it to a shared primitive/token. Avoid a broad refactor with no user-facing goal.
