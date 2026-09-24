# Drawing-derived sheet layers

**Status:** merged and deployed through [PR #131](https://github.com/EmelieHagander/Bob-the-builder/pull/131) on September 24; supersedes closed #76. The existing [material planning contract](material-planning.md) remains the owner of requirements, stock allocation, Shopping handoff and arithmetic. This document specifies its narrow sheet-layer method extension, not a parallel material model.

## User goal and reachable workflow

From **Material plan → Calculate from drawing**, choose **Sheet layer / whole sheets or packs**. Name the material the user has chosen, select an exact current supported wall drawing, enter the number of identical layers, and supply either sheet dimensions or declared coverage per pack. Record the product figures' source and certainty explicitly. The app does not recommend or infer the product.

Existing **Net wall area** and manual requirements remain available. A saved calculation keeps its method in the editor; revising a sheet layer reopens the exact saved product inputs. Current target and drawing checks still reject stale editors. The sheet layer and its drawing must have the same Project/Area scope; any linked task must belong to that scope and Project.

One requirement represents one named material. Different materials require separate requirements; layer count is not an assembly catalog, wall-side model or automatic material selection.

## Recipe and exact arithmetic

The existing `material_requirement_geometry_command` accepts a strict `sheet_layer` input object. The server persists `source_kind = deterministic`, `method_key = stud_wall_sheet_layer`, `method_version = 1`.

Product inputs:

- `layer_count`: whole count 1–20;
- `coverage_kind`: `sheet_dimensions` or `pack_coverage`;
- `coverage_truth`: explicitly chosen `provided_spec`, `measured` or `estimated`;
- `coverage_source`: nonblank explanation of the supplied product figures, at most 1000 characters;
- for sheets: whole millimetre `sheet_width_mm` and `sheet_height_mm`, each 1–20000;
- for packs: positive `pack_coverage_m2`, at most four decimal places.

Sheet coverage is width × height ÷ 1,000,000. Coverage must be exactly representable at the material model's 0.0001 m² precision; it is never rounded upward, because that would overstate the material supplied by each unit. Unrepresentable dimensions are rejected with an explicit error. Pack and sheet fields cannot be mixed. Missing figures, zero coverage and unsupported derived input fields fail rather than becoming defaults.

The calculation uses the exact measurement revisions pinned by one current, active `stud_wall_opening_v1` drawing:

1. Net wall area = wall width × wall height − opening width × opening height, converted to m².
2. Multiply that exact area by the explicit number of layers. Normalize the resulting base upward only to the existing four-decimal requirement precision.
3. Apply the explicit waste/allowance once using the existing canonical requirement arithmetic.
4. Subtract deliberately allocated, current compatible stock in m².
5. Round the positive shortfall to whole sheets/packs using their exact coverage as the existing `purchase_increment`.

The canonical requirement, stock, allowance and purchase quantities remain in **m²**. Stock in `pcs` and reusable component counts are not silently converted to area. The user must establish compatibility and usable coverage of any allocated stock; a matching unit alone is not a suitability assessment.

Example test fixture, not an actual product recommendation:

| Stage | Result |
|---|---|
| Net drawing area | 8.628 m² |
| Two layers | 17.256 m² |
| 10% allowance, once | 18.9816 m² |
| Allocate 2 m² compatible stock | 16.9816 m² shortfall |
| 1200 × 2400 mm sheets | 2.88 m² per sheet |
| Whole purchase units | 6 sheets = 17.28 m² purchasing coverage |

The server owns base quantity, unit, formula/basis, method identity and sheet purchase increment. None can be supplied by a sheet-layer client. No separate BOM or purchase arithmetic is introduced.

## Persistence and history

One nullable `sheet_layer` JSON snapshot extends each existing `material_requirement_revisions` row. It stores the normalized supplied recipe plus server-derived exact net wall area and coverage per purchase unit. The existing requirement also pins target, solution, drawing, stock versions, actor/time and change reason. Current view columns preserve their deployed prefix; the recipe is appended after existing staleness columns.

Old method rows retain null recipes. A sheet-method response missing a valid recipe is unavailable, not silently displayed as a valid manual or net-area calculation. Whole purchase counts are formatted with fixed-point integer arithmetic in the adapter, not floating-point `ceil` in the UI.

Revision, archive and restore retain recipe snapshots. Later drawing revisions make saved requirements stale; recalculation appends a new version without altering older inputs or quantities. Product/source edits likewise produce new requirement versions. Estimates in the drawing or product coverage remain disclosed as estimates; deterministic arithmetic is not a promotion to verified geometry.

## Shopping and readiness

Saving/recalculating a requirement does **not** change Shopping. The existing explicit **Send / Update Shopping** command remains the only handoff.

For sheet layers, the handoff formats both the Shopping quantity and its synchronized snapshot together, for example `6 sheets (17.28 m²)` or `2 packs (8.628 m²)`. A zero shortfall displays zero purchase units. Updating still preserves supplier, cost and needed/ordered/delivered/backorder status. An independently edited Shopping quantity remains detectable rather than falsely appearing synchronized.

Deleting a Shopping item retains the existing missing-link state. A later explicit publish recreates the item; recipe formatting must not prevent the foreign key from clearing that link.

The existing task material-readiness projection continues to use canonical requirements and Shopping status. Ordered is not delivered. Revised source quantities invalidate the Shopping snapshot, and a new material revision requires renewed human readiness review after its blockers are resolved. This extension does not automatically change task status or manufacture a Ready confirmation.

## Limits

This is an **area-based purchase quantity, not a cut or layout plan**. It does not solve offcut reuse, sheet orientation, seam placement, staggered layers, opening cuts, wall-side layout or stock-piece geometry. These can require additional material despite sufficient total area. Product suitability and structural/engineering decisions remain separate.

No fastener, stud, header, consumable or arbitrary assembly rules are inferred. No supplier/catalogue lookup, prices, AI calls, shared-app data changes or automatic purchases are added.

## Verification and rollout

`tests/sheet-layers.test.ts` replays all actual migrations in PGlite and checks arithmetic, strict input validation, recipe/history, archive/restore, stock reservation, Shopping preservation, task-readiness re-review, stale drawing lineage and Project/Area/raw/anonymous boundaries. `tests/sheet-layer-boundaries.test.ts` adds the actual Shopping-trigger deletion/replacement regression, prevents the browser fixture from parsing unrelated multipart uploads, and guards real-project rejection by the prepared hosted helper.

The existing foundation browser harness composes `scripts/sheet-layer-browser.mjs` at 320/390/1280 px. It exercises sheet/pack selection, explicit source/certainty, no forged derived input, save/reload/history, conflict and missing-recipe errors, explicit Shopping preservation and overflow checks against HTTP fixtures. These are not hosted Auth proofs.

`scripts/check-live-sheet-layers.mjs` is wired into the ordinary authenticated foundation runner after material planning and before later fixture changes. It rejects non-fixture projects, preserves prior drawings, and uses no service key or AI calls. The live release workflow watches this helper and its migration; ordinary CI syntax-checks it. The operator's exact-project cleanup includes its task, stock, requirements and Shopping rows.

Source migration: `20260915183904_sheet_layer_material_quantities.sql`, scaffolded by the installed Supabase CLI. Applied once as hosted `20260924105931_bob_sheet_layer_material_quantities`; do not replay it under its source timestamp.

Release evidence for merged runtime `8be361351f97797331ba82f1a457612b12e6c1e6`:
- CI [35990213727](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/35990213727): 460/460 tests; Edge/build/PWA and all browser gates pass, including sheet layers at 320/390/1280 px.
- Live foundation [35991026203](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/35991026203): ordinary Auth/PostgREST sheet/pack arithmetic, stock, explicit Shopping, delivery preservation, history, archive/restore, deletion recovery and access-denial checks pass.
- Pages [35991026206](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/35991026206): successful; public bundle `index-B0zJNeeZ.js` contains the new UI/method.
- Readback confirms the appended view column, invoker security, recipe RLS and denied raw writes. Before/after security/performance advisors show no new findings; unrelated shared-database findings remain.
- Exact fixture `p_99a46022a552412686960c052b684626` was checked against its nonce/name/type/description and zero media before deletion. Follow-up counts for project, requirements, Shopping, stock and people are all zero. No real project was used.

This verifies the deterministic material-planning flow, not new AI material-selection behavior, cut optimization or product suitability.
