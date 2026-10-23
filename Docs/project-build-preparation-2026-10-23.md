# Project build preparation — 2026-10-23

Status: **implemented on review branch, not merged/deployed**. Pull request [#322](https://github.com/EmelieHagander/Bob-the-builder/pull/322). This is a product-facing first slice, **not** a complete, approved manufacturing or shopping plan.

## Source of truth

Reuse the current Bob owners rather than creating a second bill-of-materials or purchase store:

- `bob.read_construction_draft`: current construction head and exact revision with instance roles, definition geometry, bindings, open questions and source-state fencing.
- `bob.catalog_item_revisions`: version-pinned material names and physical properties.
- `constructionInstancePolicy` and `constructionLists`: canonical role-aware concept blank quantities; only instances classified `manufacture` belong to the preliminary cut list.
- `bob.material_requirements`, `bob.material_cut_plans`, `bob.materials`: existing requirement/cutting/Shopping owners. This slice **reads**, but does not create or publish, those records.
- `current_target` for Project **and Area** targets. A construction draft is not a reviewed CAD drawing.

## Audit findings addressed

1. Project and account next-action selectors previously only looked for Project-wide target data. Bunk-bed target is Area-scoped. They now consider both and route to build preparation when a current construction exists.
2. The measurement list was too verbose and marked every mandatory field with a warning. Compact the cards, put provenance/version beneath details, and reserve the warning for `unknown` or `estimated` required measures.
3. The old drawing CSV counted all instances by raw definition. The new preliminary export uses K4's role-aware machinery to avoid treating reference/proxy shapes as physical manufacturing requirements.
4. A single `Kaplista & inköp` page links the existing material plan and Shopping to the current construction. It shows source versions, item counts, outstanding decisions and links to ask Bob to continue the normal workflow.
5. Unit tests cover role exclusions, stale-source fences, missing specs, spreadsheet-safe CSV and Project/Area next-action selection. A browser fixture also exercises the empty build-list route.

## Live read-only check: Barnrum — våningssäng

- Active saved construction is at revision 20 with 53 instances: **24 manufacture**, **29 reference/exclude**.
- Its 10 manufactured definition groups are all box primitives with exact recorded material revision and thickness.
- The latest linked CAD drawing is pinned to construction revision 16; do not call it current.
- Four open questions remain for storage drawers/hardware, slatted bases, anchors/child safety, and ladder ergonomics.
- The project has **no** saved cut plan, material requirement or Shopping item from that construction.

Those counts were confirmed by read-only SQL queries; no user-project data was changed.

## Guardrails

- Always expose **preliminary** status. CSV export is labeled **NOT APPROVED FOR CUTTING**.
- Do not infer sheet counts, raw board lengths, saw order, waste, screws, anchors, material/stock quality, load-bearing capacity or shopping quantities from the 3D blank volume.
- A missing or changed source, unknown manufacturing role, unbound material or unsupported manufactured primitive produces an explicit gap **without** quantities.
- Continue with existing bounded derivation/fit/reservation/shopping commands; don't bypass their authority, permissions, review gates or source freshness.
- Return users to the saved source/normal material/Shopping surfaces; don't pretend an in-browser preliminary preview was saved as an approved cut plan.

## Next release gates

- Run manual CI workflow on `feat/project-build-preparation-20261023` (`npm run build`, unit tests and mobile browser fixtures). The repo intentionally does not run CI on PR/push; the connected GitHub integration cannot dispatch workflows.
- Verify production member read-back of this exact route on a non-destructive session, its mobile scroll/legibility, and that a changed construction invalidates the preliminary display after reopening.
- Finalize unresolved construction/safety issues; save a checked CAD drawing for revision 20 and then use current material and stock/Shopping workflows to create an actual approved build package.
- Expand material preparation for supported length-stock/raw formats, without inventing a parallel shopping engine.
- No production deploy, migration, automatic purchase or stock allocation under this PR.
