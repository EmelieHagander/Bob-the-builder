# Vera — open findings

> Unresolved frontend/UX drift and follow-ups. Resolve or move to an issue when work is scheduled; do not turn this into a second roadmap.

## FINDING-V01 — Reference images are labels/placeholders, not real project media

**Status:** open

The Area UI has a reference-image concept, but current frontend/domain data represents images as labels and renders placeholder tiles rather than real uploaded/renderable media.

**Why it matters:** the emerging bob workflow depends heavily on current-state photos, target mockups, construction cut-throughs, drawings and step-specific instructional images being available when work happens.

**Owning follow-up:** product/media data contract + storage/runtime consumption + Area/task UI. Do not solve this as a cosmetic tile change only.

## FINDING-V02 — Current visual contract is implicit rather than fully documented

**Status:** partially addressed

`Docs/ui-index.md` now documents the current ownership and invariants, but bob still does not have a separate page blueprint or formal component/design standard beyond `theme.css`, shared components and runtime convention.

**Why it matters:** the app is growing into new planning/media/instruction surfaces, increasing the chance of local UI dialects.

**Owning follow-up:** create a deeper design/page blueprint only when upcoming UI work needs it; do not produce documentation for its own sake.

## FINDING-V03 — Inline visual values are common

**Status:** open / not currently a blocker

Many pages/components use inline layout and visual values alongside shared tokens/classes.

**Why it matters:** repeated new features may increase drift if every screen copies one-off values.

**Owning follow-up:** when a repeated pattern is touched by real feature work, promote it to a shared primitive/token. Avoid a broad refactor with no user-facing goal.
