from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


def insert_before(path: str, marker: str, block: str) -> None:
    p = Path(path)
    text = p.read_text()
    if block.strip() in text:
        raise SystemExit(f"{path}: block already present")
    if marker not in text:
        raise SystemExit(f"{path}: marker not found: {marker!r}")
    p.write_text(text.replace(marker, block + marker, 1))


# V1 execution marker: close 4B2b and move the foundation lane forward.
replace_once(
    "Docs/v1-plan.md",
    "- Slice 4B2a — manual material requirements, revisioned stock/reuse allocation, transparent purchase arithmetic and explicit Shopping handoff.\n",
    "- Slice 4B2a — manual material requirements, revisioned stock/reuse allocation, transparent purchase arithmetic and explicit Shopping handoff;\n- Slice 4B2b — deterministic `stud_wall_net_area` material base quantity from an exact current `stud_wall_opening_v1` drawing, persisted into the existing material-requirement/Shopping path.\n",
)
replace_once(
    "Docs/v1-plan.md",
    "4B1 and 4B2a are also runtime truth. PR #47 delivered the narrow deterministic stud-wall-with-opening generator, PR #49 closed its hosted/live release gate, PR #39 delivered the manual material receiver and PR #50 corrected verification-only method-key drift without changing runtime behavior. The final 4B2a Pages deployment and ordinary hosted Auth/PostgREST foundation check are green; `Docs/foundation-verification.md` owns the exact migration, advisor, browser, live and cleanup evidence.\n",
    "4B1, 4B2a and the first narrow 4B2b calculator are runtime truth. PR #47 delivered the deterministic stud-wall-with-opening generator and PR #49 closed its hosted/live release gate; PR #39 delivered the manual material receiver and PR #50 corrected verification-only method-key drift without changing runtime behavior. PR #54 then added server-owned `stud_wall_net_area` derivation into the same requirement model. Its source migration `20260914084207_deterministic_material_quantities.sql` is applied on hosted Supabase as `20260914090502_bob_deterministic_material_quantities_4b2b`; Pages run `34826249816` and ordinary hosted Auth/PostgREST foundation run `34826249907` are green on merge commit `098ea2b16c04ebbb279130860eceb97d7ea05cd3`. `Docs/foundation-verification.md` owns the exact migration, advisor, browser and live evidence.\n",
)
replace_once(
    "Docs/v1-plan.md",
    "- Slice 4B2b — deterministic geometry-derived material base quantities for supported fixtures, including later fastener/consumable rules where explicitly modelled;\n",
    "- broader deterministic material rules beyond the shipped `stud_wall_net_area` calculator, including fasteners/consumables only where an explicit rule or coverage basis is modelled;\n",
)
replace_once(
    "Docs/v1-plan.md",
    "**Current next implementation milestone:** **Slice 4B2b deterministic material quantities for the supported 4B1 geometry fixture.** New quantity revisions must feed the existing 4B2a `material_requirements` foundation with `source_kind = deterministic`, pinned recipe/input lineage and transparent arithmetic rather than creating a parallel BOM system. Start with quantities that are reproducible from the saved stud-wall recipe; generic fasteners, consumables, catalogue pricing and engineering assumptions remain out until explicitly specified.\n",
    "**Current next release milestone:** complete the hosted rollout and live gates for the already-merged household/friend sharing and name-only volunteer source. After that, the next foundations implementation milestone is **richer task/material/dependency/tool/readiness relations** on top of the persisted target, drawings and material plan. The shipped 4B2b path remains deliberately narrow: broader fastener/consumable/catalogue/engineering rules stay unknown/manual until an explicit deterministic rule is specified.\n",
)
replace_once(
    "Docs/v1-plan.md",
    "1. complete and release-gate explicit household/friend sharing and name-only volunteers, including legacy account isolation, dynamic revocation and project/Building authority boundaries;\n2. add 4B2b deterministic quantity derivation from the supported 4B1 recipe into new 4B2a material-requirement revisions, preserving exact recipe/input provenance;\n3. add richer task/material/dependency/tool/readiness relations on top of the persisted target, drawings and material plan;\n4. add the deferred AI consumers on top of the persisted foundations rather than making AI output the only place those concepts exist;\n5. complete Slice 5 guidance and progress/as-built loops against the same persisted project + physical context.\n",
    "1. complete and release-gate explicit household/friend sharing and name-only volunteers, including legacy account isolation, dynamic revocation and project/Building authority boundaries;\n2. add richer task/material/dependency/tool/readiness relations on top of the persisted target, drawings and material plan;\n3. extend deterministic material rules beyond the shipped net-wall-area calculator only where explicit formulas/coverage rules and provenance are defined;\n4. add the deferred AI consumers on top of the persisted foundations rather than making AI output the only place those concepts exist;\n5. complete Slice 5 guidance and progress/as-built loops against the same persisted project + physical context.\n",
)

# Material planning owner: promote deterministic from reserved future shape to shipped narrow path.
replace_once(
    "Docs/material-planning.md",
    "# Material planning — manual requirement, stock and shopping foundation\n\n**Status:** manual Slice 4B2a implemented, merged, migrated, deployed and live-verified on 2026-09-14. This contract owns the persisted material-requirement, stock-allocation and Shopping handoff foundation. [PR 39](https://github.com/EmelieHagander/Bob-the-builder/pull/39) delivered the foundation and [PR 50](https://github.com/EmelieHagander/Bob-the-builder/pull/50) aligned the release proof with persisted server truth. `Docs/v1-plan.md` owns release order and the later supported geometry calculators / executable-work-plan gates; `Docs/foundation-verification.md` owns release evidence.\n",
    "# Material planning — requirements, stock, deterministic quantities and Shopping\n\n**Status:** manual Slice 4B2a and the first narrow deterministic Slice 4B2b calculator are implemented, merged, migrated, deployed and live-verified on 2026-09-14. This contract owns the persisted material-requirement, stock-allocation, deterministic quantity and Shopping-handoff foundation. [PR 39](https://github.com/EmelieHagander/Bob-the-builder/pull/39) delivered 4B2a, [PR 50](https://github.com/EmelieHagander/Bob-the-builder/pull/50) aligned its release proof with persisted server truth, and [PR 54](https://github.com/EmelieHagander/Bob-the-builder/pull/54) delivered `stud_wall_net_area` 4B2b. `Docs/v1-plan.md` owns release order and later executable-work-plan/broader-calculator gates; `Docs/foundation-verification.md` owns release evidence.\n",
)
replace_once(
    "Docs/material-planning.md",
    "This 4B2a milestone is intentionally manual-first. A person enters the base required quantity. Bob / AI does not derive geometry, choose materials, or mutate Shopping. The server performs only transparent deterministic arithmetic from the entered quantity, allowance, confirmed allocations and purchase increment.\n",
    "4B2a is intentionally manual-first: a person enters the base required quantity and its basis. 4B2b adds one deliberately narrow server-owned calculation from an already-persisted 4B1 drawing. Bob / AI still does not choose materials, infer structural member sizes, or mutate Shopping. The server derives the supported base quantity and then reuses the same transparent allowance, confirmed-allocation and purchase-increment arithmetic.\n",
)
replace_once(
    "Docs/material-planning.md",
    "- **deterministic** — reserved for a later supported calculation method that can reproduce the base quantity from saved inputs.\n\n4B2a creates manual versions only. Persisted manual versions use `method_key = manual` and `method_version = 4B2a-v1`; browser and hosted release proofs are regression-locked to that server identity. The deterministic value exists in the model so later supported calculators can add new requirement revisions rather than replacing the foundation.\n",
    "- **deterministic** — a supported server-owned calculation method reproduced the base quantity from exact saved inputs.\n\nPersisted manual versions use `method_key = manual` and `method_version = 4B2a-v1`; browser and hosted release proofs are regression-locked to that server identity. The first deterministic path uses `method_key = stud_wall_net_area` and `method_version = 4B2b-v1`. Both are normal revisions in the same requirement model; deterministic calculation does not create a second BOM store.\n",
)
replace_once(
    "Docs/material-planning.md",
    "- `required_quantity` — manual base need before allowance or stock;\n",
    "- `required_quantity` — base need before allowance or stock: human-entered for `manual`, server-derived from pinned inputs for supported `deterministic` methods;\n",
)
replace_once(
    "Docs/material-planning.md",
    "- write requirements / Shopping handoff only through `bob.material_requirement_command`.\n",
    "- write manual requirements / Shopping handoff only through `bob.material_requirement_command`;\n- create/revise the supported geometry-derived requirement only through `bob.material_requirement_geometry_command`, which derives quantity/unit/basis/source/method server-side before delegating the shared arithmetic and reservation work.\n",
)
insert_before(
    "Docs/material-planning.md",
    "## Reachable manual workflow\n",
    """## 4B2b deterministic wall-area calculation\n\nThe first supported deterministic quantity method is intentionally narrow:\n\n- source drawing: the exact **current**, active `stud_wall_opening_v1` Artifact revision in the same project and selected-target lineage;\n- method identity: `stud_wall_net_area` / `4B2b-v1`;\n- output unit: `m2`;\n- formula: `(wall_width × wall_height − opening_width × opening_height) / 1,000,000`;\n- persistence: round upward only as needed to the requirement model's four-decimal precision so the saved base quantity never understates the exact calculated area;\n- provenance: the server-authored basis records Artifact title/revision, exact dimensions, formula/result, drawing status and whether any pinned geometry input is an explicit estimate;\n- authority: the client cannot provide `required_quantity`, `unit`, `basis`, `source_kind`, `method_key` or `method_version`; forged deterministic identity/quantity is rejected;\n- downstream arithmetic: explicit waste, matching `m2` material stock, purchase increment, staleness and deliberate Shopping publish/update reuse the existing 4B2a model. Reusable `ExistingComponent` pieces remain a `pcs` concept and are therefore not silently converted into square metres.\n\nThis method calculates **coverage area only**. The user still names the material/requirement and supplies any explicit allowance, purchase increment and assumptions. It does not choose sheet products, infer sheet layout, count studs, size headers, calculate fasteners/consumables or make structural/engineering claims. Estimated geometry remains visibly Concept-level evidence; deterministic arithmetic does not upgrade its certainty.\n\nFrom **Material plan**, **Calculate from drawing** exposes only current generated drawings supported by this method. Save/read-back creates a normal material-requirement revision; when the generated Artifact gets a newer revision the requirement becomes stale until the user recalculates from the current persisted drawing. Shopping remains an explicit separate action.\n\n""",
)
replace_once(
    "Docs/material-planning.md",
    "## Not in 4B2a\n\nThis foundation does not yet provide:\n\n- geometry-derived base quantities for wall/floor fixtures;\n",
    "## Not in 4B2a / first 4B2b calculator\n\nThis foundation still does not provide:\n\n- geometry-derived quantities beyond the shipped `stud_wall_net_area` coverage method, such as stud/member counts, sheet-layout optimization or floor-assembly calculators;\n",
)
replace_once(
    "Docs/material-planning.md",
    "Those remain later Slice 4 gates. The next deterministic calculator can reuse these exact requirement revisions, lineage, allocations and Shopping handoff rather than inventing a second BOM system.\n",
    "Those remain later Slice 4/work-plan gates. Any future deterministic calculator must reuse these exact requirement revisions, lineage, allocations and Shopping handoff rather than inventing a second BOM system.\n",
)
replace_once(
    "Docs/material-planning.md",
    "Before marking 4B2a deployed, prove:\n",
    "Before marking the material-planning foundation delivered, prove the 4B2a requirements below and, for 4B2b, also prove that the supported calculator is reproducible from exact saved geometry and cannot be forged by the client:\n",
)
replace_once(
    "Docs/material-planning.md",
    "- deployed Auth/PostgREST behavior is checked separately from browser HTTP fixtures;\n- no AI call is required for any 4B acceptance path.\n",
    "- deployed Auth/PostgREST behavior is checked separately from browser HTTP fixtures;\n- 4B2b derives the same net area from the same pinned 4B1 inputs after reload, persists `deterministic` / `stud_wall_net_area` / `4B2b-v1`, rejects client-supplied derived identity/quantity, becomes stale after a newer generated Artifact revision, recalculates into a new requirement revision, and uses the unchanged explicit Shopping handoff;\n- no AI call is required for any 4B acceptance path.\n",
)

# Artifact owner: close stale 4B1 implementation wording and route downstream calculation truth correctly.
replace_once(
    "Docs/artifacts.md",
    "**Status:** manual milestone 4A is implemented, merged, migrated and live-verified as of 2026-09-13. The first deterministic-geometry follow-up (4B1, stud wall with opening) is specified below and is under implementation on `feat/deterministic-artifact-geometry`. [`Docs/foundation-verification.md`](foundation-verification.md) owns release evidence; `Docs/v1-plan.md` owns release order and later calculation/work-plan gates.\n",
    "**Status:** manual milestone 4A and narrow deterministic geometry milestone 4B1 are implemented, merged, migrated, deployed and live-verified. The downstream first 4B2b net-wall-area material calculator is also shipped, but its requirement/calculation behavior is owned by [`Docs/material-planning.md`](material-planning.md), not by the Artifact model. [`Docs/foundation-verification.md`](foundation-verification.md) owns release evidence; `Docs/v1-plan.md` owns later calculation/work-plan gates.\n",
)
replace_once(
    "Docs/artifacts.md",
    "4A established the manual record and lineage boundary. 4B begins adding deterministic geometry for deliberately narrow supported fixtures. It does not turn bob into general CAD and it does not let generated geometry upgrade an estimate into a measured fact.\n",
    "4A established the manual record and lineage boundary. 4B1 adds deterministic geometry for a deliberately narrow supported fixture. It does not turn bob into general CAD and it does not let generated geometry upgrade an estimate into a measured fact.\n",
)
replace_once(
    "Docs/artifacts.md",
    "**Status:** specified / implementation active. This is the first deterministic geometry fixture, not a general drawing engine.\n",
    "**Status:** implemented, deployed and live-verified. This is the first deterministic geometry fixture, not a general drawing engine.\n",
)
replace_once(
    "Docs/artifacts.md",
    "- calculations or bill of materials;\n- stock deduction or Shopping updates;\n",
    "- general bill-of-materials calculation inside the Artifact model; the separate material-planning foundation now consumes this exact recipe for one narrow `stud_wall_net_area` coverage calculation;\n- stock deduction or Shopping mutation inside the Artifact model; those remain owned by material planning and stay explicit;\n",
)
replace_once(
    "Docs/artifacts.md",
    "Deployed 4A evidence remains recorded in [`Docs/foundation-verification.md`](foundation-verification.md). 4B1 should be added there only after production/live verification; until then its PR/CI evidence is committed-state proof, not deployed proof.",
    "Deployed 4A and 4B1 evidence is recorded in [`Docs/foundation-verification.md`](foundation-verification.md), including hosted migrations, browser proof and ordinary Auth/PostgREST live verification. The downstream 4B2b net-wall-area release is recorded there separately and owned behaviorally by [`Docs/material-planning.md`](material-planning.md).",
)

# Current inventory: promote 4B2b while keeping broader BOM/work planning open.
replace_once(
    "Docs/function-inventory.md",
    "baseline before Slice 0 and milestones 1A/1B, 2A/2B, 2C, 3A, 4A, 4B1 and 4B2a**.",
    "baseline before Slice 0 and milestones 1A/1B, 2A/2B, 2C, 3A, 4A, 4B1, 4B2a and the first narrow 4B2b calculator**.",
)
replace_once(
    "Docs/function-inventory.md",
    "## Deterministic artifact geometry source status — 2026-09-13\n\nPR #47 merged source for the narrow 4B1 timber stud-wall-with-opening fixture.\nEarlier 4A delta rows below describe the manual foundation and should not be read\nas a claim that no geometry source exists. This sharing work does not establish\n4B1's applied-schema, deployed UI or live-service status; those need their own\nrelease evidence. Broader geometry, BOM, stock/shopping and AI gates remain open\nunder `Docs/v1-plan.md`.\n",
    "## Deterministic geometry/material source status — 2026-09-14\n\nThe narrow 4B1 timber stud-wall-with-opening fixture and first 4B2b `stud_wall_net_area` material calculator are now merged, migrated, deployed and live-verified; the detailed release delta below and `Docs/foundation-verification.md` own exact evidence. Earlier 4A/manual audit rows are historical baseline and must not be read as claims that deterministic geometry or all geometry-derived quantities are absent. Broader geometry/BOM rules, executable work planning and AI gates remain open under `Docs/v1-plan.md`.\n",
)
replace_once(
    "Docs/function-inventory.md",
    "| Full evidence/planning loop | **PARTIAL.** Media/manual steps, measurements/parts, manual solution/target revisions, manual plans/drawings, one deterministic drawing fixture and the manual material/stock/Shopping receiver are delivered in the deltas here. Generated proposals, geometry-derived material quantities, executable-work planning and structured progress/as-built history retain later gates. |",
    "| Full evidence/planning loop | **PARTIAL.** Media/manual steps, measurements/parts, manual solution/target revisions, manual plans/drawings, one deterministic drawing fixture, the manual material/stock/Shopping receiver and one geometry-derived net-wall-area requirement are delivered in the deltas here. Generated proposals, broader material/BOM rules, executable-work planning and structured progress/as-built history retain later gates. |",
)
replace_once(
    "Docs/function-inventory.md",
    "| Stock and calculation integration | **PARTIAL.** 4B2a now stores revisioned material stock and deliberate reusable-component allocations, derives allowance/shortfall/purchase rounding server-side and explicitly propagates the saved purchase need to Shopping. Geometry-derived base quantities remain 4B2b; downstream task readiness remains later. |",
    "| Stock and calculation integration | **PARTIAL / first deterministic calculator BUILT.** 4B2a stores revisioned material stock and deliberate reusable-component allocations, derives allowance/shortfall/purchase rounding server-side and explicitly propagates the saved purchase need to Shopping. 4B2b now derives one supported `m2` net-wall-area base quantity from exact 4B1 geometry into the same requirement model. Broader calculators and downstream task readiness remain later. |",
)
replace_once(
    "Docs/function-inventory.md",
    "| Generated visual proposals and downstream planning | **PARTIAL.** 4A manual drawings, 4B1 deterministic stud-wall geometry and 4B2a manual material/stock/Shopping propagation are delivered. Generated proposal/mockup imagery, geometry-derived material quantities and executable task planning remain later. Selection expresses intent, not engineering approval. |",
    "| Generated visual proposals and downstream planning | **PARTIAL.** 4A manual drawings, 4B1 deterministic stud-wall geometry, 4B2a manual material/stock/Shopping propagation and the first 4B2b net-wall-area quantity are delivered. Generated proposal/mockup imagery, broader material rules and executable task planning remain later. Selection expresses intent, not engineering approval. |",
)
replace_once(
    "Docs/function-inventory.md",
    "| Generated geometry, BOM and downstream work | **PARTIAL.** 4B1 adds one deterministic stud-wall-with-opening drawing recipe and 4B2a adds the manual material receiver, stock/reuse deduction and explicit Shopping propagation. Geometry-derived base quantities/BOM rules (4B2b), fasteners/consumables, task-material links, dependencies/tools/readiness and Bob/vision consumption remain later gates. |",
    "| Generated geometry, BOM and downstream work | **PARTIAL.** 4B1 adds one deterministic stud-wall-with-opening drawing recipe; 4B2a adds the manual material receiver, stock/reuse deduction and explicit Shopping propagation; 4B2b now derives one reproducible net-wall-area requirement from that recipe. Broader BOM rules, fasteners/consumables, task-material links, dependencies/tools/readiness and Bob/vision consumption remain later gates. |",
)
replace_once(
    "Docs/function-inventory.md",
    "**Status:** 4B1 and manual 4B2a are implemented, merged, migrated, deployed and live-verified.",
    "**Status:** 4B1, manual 4B2a and the first narrow 4B2b calculator are implemented, merged, migrated, deployed and live-verified.",
)
replace_once(
    "Docs/function-inventory.md",
    "| Geometry-derived BOM quantities (4B2b) | **GAP / next.** The receiver already reserves `source_kind = deterministic`, but no supported calculator yet turns the 4B1 recipe into material base quantities. That work must create normal material-requirement revisions rather than a second BOM store. |",
    "| Geometry-derived BOM quantities (4B2b) | **BUILT narrowly.** `stud_wall_net_area` / `4B2b-v1` derives net wall coverage in `m2` from the exact current `stud_wall_opening_v1` Artifact revision and persists a normal `source_kind = deterministic` material-requirement revision with a server-authored formula/basis. It reuses 4B2a waste, stock, staleness and explicit Shopping handoff. Stud/member counts, sheet layout, fasteners/consumables and other fixture calculators remain GAP until explicitly modelled. |",
)

# Release evidence: add the exact 4B2b release record before the underlying 4B2a section.
insert_before(
    "Docs/foundation-verification.md",
    "## Delivered manual material planning (4B2a)\n",
    """## Delivered deterministic material quantity (4B2b)\n\n**Status:** first narrow 4B2b calculator implemented, merged, migrated, deployed and live-verified on 2026-09-14. [PR 54](https://github.com/EmelieHagander/Bob-the-builder/pull/54) merged as `098ea2b16c04ebbb279130860eceb97d7ea05cd3`. [Material planning](material-planning.md) owns behavior and limits.\n\nThe shipped method is `stud_wall_net_area` / `4B2b-v1`. It reads one exact current `stud_wall_opening_v1` Artifact revision, derives `(wall width × wall height − opening width × opening height)` in square metres, normalizes upward only to the existing four-decimal requirement precision, and saves a normal `source_kind = deterministic` material-requirement revision with exact target/Artifact lineage and a server-authored formula/basis. Clients cannot supply the deterministic quantity, unit, basis, source or method identity. The calculation then reuses 4B2a allowance, matching-unit stock reservation, purchase rounding, staleness and explicit Shopping publish/update; it creates no parallel BOM store and invokes no AI.\n\n### Automated, migration and advisor evidence\n\n- [PR CI 34825559375](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34825559375) is fully green: all 73 PGlite/regression tests, TypeScript/Vite production build, PWA/install checks, Ask bob isolation, combined foundations browser proof and Building-context browser proof pass. The browser flow covers **Calculate from drawing**, deterministic source/basis read-back, revise/reload and the normal Shopping path at 320/390/1280px.\n- Source migration `supabase/migrations/20260914084207_deterministic_material_quantities.sql` was applied to hosted Supabase as `20260914090502_bob_deterministic_material_quantities_4b2b`. Post-DDL security and performance advisors reported no new 4B2b-specific finding; unrelated pre-existing shared-database findings remain outside this release.\n\n### Live Auth/PostgREST proof and deploy\n\n[Pages 34826249816](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34826249816) and [live foundation check 34826249907](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/34826249907) both pass on merged `main` commit `098ea2b16c04ebbb279130860eceb97d7ea05cd3`. The ordinary authenticated foundation client consumes the already-persisted 4B1 geometry fixture and proves:\n\n- current generated Artifact revision 4 uses the saved 4200 × 2400 mm wall and 1210 × 1200 mm opening, producing an exact/net persisted base of `8.628 m²`;\n- 10% allowance becomes `9.4908 m²`; `2 m²` confirmed stock plus a `1 m²` purchase increment yields `8 m²` to buy;\n- the saved revision persists `source_kind = deterministic`, `method_key = stud_wall_net_area`, `method_version = 4B2b-v1` and transparent formula text;\n- a forged client `required_quantity` is rejected, an unsigned client is denied, and the disposable member cannot calculate against the real porch project;\n- after the generated drawing advances, the requirement reports stale Artifact lineage and Shopping publish is rejected until recalculation;\n- recalculation against current Artifact revision 6 creates requirement revision 2; with 0% allowance and the same `2 m²` stock, purchase need becomes `7 m²`;\n- explicit Shopping update changes the linked row from `8 m²` to `7 m²` while preserving `delivered` status, supplier `Disposable sheet supplier` and cost `456 kr`.\n\nThe same run passes the existing media, steps, facts, solutions, drawings, manual material-planning and Building-context checks. No AI is invoked.\n\n""",
)
replace_once(
    "Docs/foundation-verification.md",
    "It does not claim general CAD/BIM, structural header/load-path sizing or material quantities.\n",
    "It does not itself claim general CAD/BIM or structural header/load-path sizing. The downstream first 4B2b net-wall-area material quantity is delivered separately through the material-planning foundation above.\n",
)

# DB map: record the new guarded command and hosted migration without inventing new tables.
replace_once(
    "db/README.md",
    "| material stock / requirement revisions | `bob.stock_items`, `bob.stock_revisions`, `bob.material_requirements`, `bob.material_requirement_revisions` + allocation/shopping-link tables and invoker views |\n",
    "| material stock / requirement revisions | `bob.stock_items`, `bob.stock_revisions`, `bob.material_requirements`, `bob.material_requirement_revisions` + allocation/shopping-link tables and invoker views; manual `bob.material_requirement_command` plus deterministic `bob.material_requirement_geometry_command` share the same revision model |\n",
)
replace_once(
    "db/README.md",
    "[Foundation verification](../Docs/foundation-verification.md) owns CI/browser, hosted migration/advisor, Pages, ordinary Auth/PostgREST and cleanup evidence. 4B2a intentionally does not derive base quantities from geometry; the next 4B2b calculator must create normal deterministic-source requirement revisions in this same model.\n",
    "[Foundation verification](../Docs/foundation-verification.md) owns CI/browser, hosted migration/advisor, Pages, ordinary Auth/PostgREST and cleanup evidence. 4B2a remains the manual path; 4B2b below extends this same model with a server-owned deterministic source rather than creating a parallel BOM.\n",
)
insert_before(
    "db/README.md",
    "## Persistent building context foundation (2C)\n",
    """## Deterministic material quantity foundation (4B2b)\n\n[`Docs/material-planning.md`](../Docs/material-planning.md) owns the first geometry-derived material method. Source migration `supabase/migrations/20260914084207_deterministic_material_quantities.sql` is applied in hosted history as `20260914090502_bob_deterministic_material_quantities_4b2b`. It adds no new BOM tables: `bob.material_requirement_geometry_command` validates project authority and one exact current `stud_wall_opening_v1` Artifact revision, derives net wall coverage in `m2` from its pinned measurement revisions, and delegates the resulting server-owned base quantity into the existing material-requirement command/arithmetic/reservation path.\n\nSaved deterministic revisions use `source_kind = deterministic`, `method_key = stud_wall_net_area`, `method_version = 4B2b-v1`. Quantity, unit, formula/basis and method identity cannot be supplied by the normal client. A newer Artifact revision makes the requirement stale through the existing lineage view; recalculation appends a new requirement revision and Shopping still changes only through the explicit publish/update command. The method is coverage-only and does not choose materials, optimize sheet layout, size structural members or infer fasteners/consumables.\n\n""",
)

# Index: route future sessions to the shipped material/drawing truth.
replace_once(
    "Docs/index.md",
    "| material requirements, stock/reuse and Shopping handoff | `Docs/material-planning.md` |\n",
    "| material requirements, deterministic quantities, stock/reuse and Shopping handoff | `Docs/material-planning.md` |\n",
)
replace_once(
    "Docs/index.md",
    "- `Docs/material-planning.md` — **implementation-active 4B2a material-planning contract** for manual requirements, stock/reuse allocation, transparent purchase arithmetic and explicit Shopping handoff. Geometry-derived base quantities remain 4B2b.\n",
    "- `Docs/material-planning.md` — **deployed 4B2a + first 4B2b material-planning contract** for manual requirements, the narrow `stud_wall_net_area` deterministic quantity, stock/reuse allocation, transparent purchase arithmetic and explicit Shopping handoff. Broader BOM/fastener/consumable rules remain later scope until explicitly modelled.\n",
)
replace_once(
    "Docs/index.md",
    "- `Docs/artifacts.md` — owning manual plan/drawing, exact target/solution lineage and measurement-evidence contract for milestone 4A; its own status distinguishes implementation from deployment.\n- `src/data/artifacts.ts` — project-artifact reads and commands behind `database.ts`.\n",
    "- `Docs/artifacts.md` — owning manual 4A plan/drawing and deployed narrow 4B1 deterministic-geometry contract, including exact target/solution/physical/measurement lineage.\n- `src/data/artifacts.ts` — project-artifact reads and commands behind `database.ts`.\n- `Docs/material-planning.md` + `src/data/materialPlanning.ts` — deployed manual 4B2a receiver and first narrow 4B2b deterministic material quantity, using the existing stock/reuse/Shopping path behind `database.ts`.\n",
)
replace_once(
    "Docs/index.md",
    "- `Docs/foundation-verification.md` — media/steps, measurements/components, solution/target, plans/drawings and persistent building-context release evidence, deployed migrations, live Auth/PostgREST/Storage checks and limitations.\n",
    "- `Docs/foundation-verification.md` — media/steps, measurements/components, solution/target, plans/drawings, deterministic material planning and persistent building-context release evidence, deployed migrations, live Auth/PostgREST/Storage checks and limitations.\n",
)

# Final stale-marker guard: these current docs must no longer present shipped 4B2b as a future/GAP item.
checks = {
    "Docs/v1-plan.md": ["Current next implementation milestone:** **Slice 4B2b", "- Slice 4B2b — deterministic geometry-derived material base quantities"],
    "Docs/material-planning.md": ["reserved for a later supported calculation method", "geometry-derived base quantities for wall/floor fixtures"],
    "Docs/function-inventory.md": ["Geometry-derived BOM quantities (4B2b) | **GAP / next."],
    "Docs/index.md": ["Geometry-derived base quantities remain 4B2b."],
    "Docs/artifacts.md": ["specified / implementation active"],
    "db/README.md": ["the next 4B2b calculator must create"],
}
for path, stale in checks.items():
    text = Path(path).read_text()
    for marker in stale:
        if marker in text:
            raise SystemExit(f"{path}: stale release marker remains: {marker!r}")

print("4B2b release documentation synchronized")
