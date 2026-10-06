# Material planning — requirements, stock, deterministic quantities and Shopping

**Status:** manual Slice 4B2a and the first narrow deterministic Slice 4B2b calculator are implemented, merged, migrated, deployed and live-verified on 2026-09-14. This contract owns the persisted material-requirement, stock-allocation, deterministic quantity and Shopping-handoff foundation. [PR 39](https://github.com/EmelieHagander/Bob-the-builder/pull/39) delivered 4B2a, [PR 50](https://github.com/EmelieHagander/Bob-the-builder/pull/50) aligned its release proof with persisted server truth, and [PR 54](https://github.com/EmelieHagander/Bob-the-builder/pull/54) delivered `stud_wall_net_area` 4B2b. `Docs/v1-plan.md` owns release order and later executable-work-plan/broader-calculator gates; `Docs/foundation-verification.md` owns release evidence.

## User goal

After choosing a project target and recording the drawing the crew intends to use, keep one trustworthy material plan that says:

- what quantity the project currently requires;
- what basis and assumptions that quantity came from;
- what usable stock or reusable components are deliberately reserved against it;
- what waste / purchase increment is being applied;
- what quantity still needs to be purchased;
- which exact project target and optional drawing version this material decision belongs to;
- whether the existing Shopping item is current, out of date or has been edited independently.

4B2a began with manually entered quantities; 4B2b added a narrow saved-wall calculation. The September 25 Bob integration uses those canonical commands for stock, requirements, deliberate allocations and explicit Shopping handoff. AI-supplied quantities retain manual provenance. The new CAD path derives blank quantities on the server from an exact current saved assembly and then reuses the same allowance, confirmed-allocation and purchase-increment arithmetic.

## Bob and saved CAD quantities — September 25, 2026

`read_project_work` exposes paged stock, current requirements and their exact allocations, and Shopping. `manage_project_material` creates/revises/archives/restores stock or requirements and publishes reviewed requirements to Shopping. `derive_cad_material_requirement` derives one definition's used instance count (`pieces`), explicit blank-axis length, or explicit box face area. Tube/cylinder length uses local z. Unused definitions, unsupported quantity modes, stale/archived drawings and caller-supplied quantities/method fields fail. `cad_blank_<mode>` v1 records the Artifact version, definition and instance count in the immutable basis.

Revising keeps the requirement identity. Old quantities do not silently follow new geometry: drawing, target, stock and reused-component changes remain visible and block stale publication. Ordinary requirement edits change provenance back to manual. Stock/reuse specification and fit must be confirmed before allocation; matching units alone does not establish suitability. Publishing creates/updates a planned Shopping item; it never reports a purchase, delivery or task completion. Canonical reservation rules prevent double allocation.

Bob operations use the claimed-turn receipt ledger, exact current-request quote, eight-write budget and optimistic version checks. SQL tests cover the actual CAD → requirement → stock → Shopping chain, idempotency and stale-input failures. Release/deployment and real-model outcomes belong in the release PR; these tests do not establish design quality.

## Truth classes in 4B2a

A requirement version has a `source_kind`:

- **manual** — a human supplied the base required quantity and wrote its basis;
- **deterministic** — a supported server-owned calculation method reproduced the base quantity from exact saved inputs.

Persisted manual versions use `method_key = manual` and `method_version = 4B2a-v1`; browser and hosted release proofs are regression-locked to that server identity. The first deterministic path uses `method_key = stud_wall_net_area` and `method_version = 4B2b-v1`. Both are normal revisions in the same requirement model; deterministic calculation does not create a second BOM store.

The UI must never label a manually supplied base quantity as geometry-derived. Waste, stock deduction and purchase rounding *are* deterministic derived values and expose their arithmetic.

## Normalized quantities

Supported quantity units for this foundation are:

- `pcs`;
- `m`;
- `m2`;
- `m3`;
- `kg`;
- `l`.

A requirement records:

- `required_quantity` — base need before allowance or stock: human-entered for `manual`, server-derived from pinned inputs for supported `deterministic` methods;
- `waste_percent` — explicit percentage, including zero;
- `required_with_waste` — deterministic `required × (1 + waste/100)`;
- `stock_allocated` — sum of exact saved stock/component allocations;
- `purchase_increment` — the package/length/quantity increment used for buying;
- `purchase_quantity` — deterministic shortfall rounded up to the purchase increment.

Arithmetic stays numeric in project truth. The legacy `bob.materials.qty` authored string remains the display / shopping field and is populated only by the explicit Shopping handoff.

Units are not silently converted in 4B. Allocated material stock must use the same unit as the requirement. Existing reusable components may only satisfy `pcs` requirements.

## Material requirements and lineage

`bob.material_requirements` owns requirement identity and current revision. `bob.material_requirement_revisions` is append-only and keeps:

- name/category;
- optional area and task plus recorded titles;
- normalized quantities and derived purchase result;
- source kind, method key/version, basis and assumptions;
- exact current target decision and its exact selected solution revision;
- optional exact project artifact revision and title;
- archive state, server actor/time and reason.

Every create/revise pins the exact selected target revision that the editor read. The server derives the solution id/revision from that decision. A target change while an editor is open rejects the save rather than silently rebinding it.

An optional drawing reference must be the current, active drawing version in the same project and must belong to that same target/solution lineage. A later drawing revision does not rewrite an older requirement; it makes the requirement visibly stale until a person reviews and saves a new material-requirement revision.

A requirement may be project-level, area-level or linked to an existing task. Task/area relations are validated in the same project. Deleting a task/area clears the live relation while preserving the recorded title in requirement history.

## Existing material stock

`bob.stock_items` and append-only `bob.stock_revisions` store material stock separately from Shopping status. A stock version records:

- name/specification;
- normalized quantity/unit;
- status: **available**, **inspect**, or **unavailable**;
- optional area plus recorded area title;
- notes, archive state and server actor/time/reason.

Only a current, active `available` stock revision may be allocated to a newly saved requirement version. Matching units are required. Current non-archived requirements cannot reserve more of one stock item than the current confirmed quantity.

If the stock record changes later, existing requirement versions keep the exact stock revision they used and become visibly stale. Stock changes never silently rewrite purchase quantities.

## Reusable existing components

The already-delivered `ExistingComponent` register remains the owner for windows, doors and other discrete existing parts. A component may satisfy a material requirement only when:

- the requirement unit is `pcs`;
- the exact component revision belongs to this project;
- the current component intent is `reuse`;
- the current quantity is known and the component is not archived.

4B stores the exact component revision and allocated count. Current non-archived requirements cannot reserve more pieces of one component than its known quantity. A later component revision makes the requirement stale until reviewed; reuse intent remains a project decision, not a structural suitability approval.

## Shopping handoff

Shopping remains the single purchase surface. `bob.material_requirement_shopping` links one requirement to the existing `bob.materials` row created/updated by an explicit handoff.

**Send / Update Shopping**:

- requires the requirement to be current, active and not stale against target, drawing, stock or reusable component revisions;
- derives the Shopping quantity string from the saved numeric `purchase_quantity` + unit;
- writes name, quantity, area label and category to the existing material row;
- preserves existing supplier, cost and needed/ordered/delivered/backorder status when updating an existing Shopping row;
- records the exact requirement revision and Shopping snapshot that were last synced.

A later requirement revision marks the handoff out of date. Manual edits of the linked Shopping row are also visible. Updating Shopping is always a deliberate action; a requirement save never silently mutates the shopping list.

Manual Shopping rows remain valid and visually distinguishable from requirement-linked rows. Archiving a requirement never deletes an ordered/delivered Shopping row.

## Authority and concurrency

Use the existing project membership boundary and `database.ts` project/auth generation guard.

Normal clients:

- SELECT protected tables/views under RLS / `security_invoker` views;
- write stock only through `bob.stock_command`;
- write manual requirements / Shopping handoff only through `bob.material_requirement_command`;
- create/revise the supported geometry-derived requirement only through `bob.material_requirement_geometry_command`, which derives quantity/unit/basis/source/method server-side before delegating the shared arithmetic and reservation work.

Private definer functions must check `auth.uid()`, project membership and project person identity; validate same-project target/artifact/area/task/stock/component relations; derive actor, solution lineage and derived arithmetic server-side; and reject unsupported identity/history/derived fields.

Expected revision numbers prevent lost updates. A project-row lock serializes target changes with requirement saves so an open editor cannot silently move to a new target.

## 4B2b deterministic wall-area calculation

The first supported deterministic quantity method is intentionally narrow:

- source drawing: the exact **current**, active `stud_wall_opening_v1` Artifact revision in the same project and selected-target lineage;
- method identity: `stud_wall_net_area` / `4B2b-v1`;
- output unit: `m2`;
- formula: `(wall_width × wall_height − opening_width × opening_height) / 1,000,000`;
- persistence: round upward only as needed to the requirement model's four-decimal precision so the saved base quantity never understates the exact calculated area;
- provenance: the server-authored basis records Artifact title/revision, exact dimensions, formula/result, drawing status and whether any pinned geometry input is an explicit estimate;
- authority: the client cannot provide `required_quantity`, `unit`, `basis`, `source_kind`, `method_key` or `method_version`; forged deterministic identity/quantity is rejected;
- downstream arithmetic: explicit waste, matching `m2` material stock, purchase increment, staleness and deliberate Shopping publish/update reuse the existing 4B2a model. Reusable `ExistingComponent` pieces remain a `pcs` concept and are therefore not silently converted into square metres.

This method calculates **coverage area only**. The user still names the material/requirement and supplies any explicit allowance, purchase increment and assumptions. It does not choose sheet products, infer sheet layout, count studs, size headers, calculate fasteners/consumables or make structural/engineering claims. Estimated geometry remains visibly Concept-level evidence; deterministic arithmetic does not upgrade its certainty.

From **Material plan**, **Calculate from drawing** exposes only current generated drawings supported by this method. Save/read-back creates a normal material-requirement revision; when the generated Artifact gets a newer revision the requirement becomes stale until the user recalculates from the current persisted drawing. Shopping remains an explicit separate action.

## Reachable manual workflow

From the existing **Shopping** page a connected project member can open **Material plan** and:

1. record existing material stock with quantity/unit/status;
2. create a material requirement against the current target;
3. optionally tie it to an area, task and current drawing version;
4. enter the manual base quantity, basis and assumptions;
5. set waste allowance and purchase increment;
6. reserve confirmed material stock and/or reusable existing components;
7. inspect required → allowance → available → to-buy arithmetic;
8. save/reload and retain the exact source versions;
9. revise/archive/restore without destroying old versions;
10. see when target/drawing/stock/component truth changed later;
11. explicitly send or update the purchase shortfall in the existing Shopping list;
12. see in Shopping which rows came from the material plan and whether their source requirement is now out of date or the Shopping row was edited independently.

If there is no selected target, new requirement creation is blocked with a route to **Solutions & target**. Demo mode does not pretend to persist material planning.

## Not in 4B2a / first 4B2b calculator

This foundation still does not provide:

- geometry-derived quantities beyond the shipped `stud_wall_net_area` coverage method, such as stud/member counts, sheet-layout optimization or floor-assembly calculators;
- automatic nails/screws/paint/consumable rules;
- supplier catalogue / prices / pack discovery;
- unit conversion between unlike saved units;
- AI material choices or AI-authored quantities;
- automatic task readiness;
- autonomous Shopping mutation;
- deletion of ordered/delivered Shopping items when a plan changes.

Those remain later Slice 4/work-plan gates. Any future deterministic calculator must reuse these exact requirement revisions, lineage, allocations and Shopping handoff rather than inventing a second BOM system.

## Verification contract

Before marking the material-planning foundation delivered, prove the 4B2a requirements below and, for 4B2b, also prove that the supported calculator is reproducible from exact saved geometry and cannot be forged by the client:

- anonymous/outsider reads and all raw writes are denied;
- members can use commands only inside their project;
- foreign targets, drawings, areas, tasks, stock and components cannot be linked;
- unsupported/forged actor, parent, derived quantity and solution lineage fields fail;
- stale requirement/stock revisions and a changed target reject writes atomically;
- purchase arithmetic is deterministic for zero/non-zero waste, partial/full stock and purchase increments;
- current requirements cannot double-reserve confirmed stock/components;
- old requirement versions retain exact target/drawing/stock/component revisions after later truth changes;
- Shopping handoff is explicit, preserves status/supplier/cost, detects later requirement changes and detects independent Shopping edits;
- archive/restore preserves history without deleting Shopping rows;
- task/area deletion retains honest requirement history; project deletion cascades new records;
- production UI works at 320/390/1280 px with add/revise/history/archive/restore, stock management, arithmetic inspection, Shopping handoff, reload and project-switch isolation;
- deployed Auth/PostgREST behavior is checked separately from browser HTTP fixtures;
- 4B2b derives the same net area from the same pinned 4B1 inputs after reload, persists `deterministic` / `stud_wall_net_area` / `4B2b-v1`, rejects client-supplied derived identity/quantity, becomes stale after a newer generated Artifact revision, recalculates into a new requirement revision, and uses the unchanged explicit Shopping handoff;
- no AI call is required for any 4B acceptance path.

## K4 construction blank needs — 2026-10-05

The first K4 boundary derives a concept BOM and one local box-blank cut row per actual saved instance through `derive_construction_lists`. It reuses K2's exact current caller-scoped checkpoint and catalog check. Assembly dependencies are an explicit design proposal over joint IDs: all joints must appear once, unknown references and dependency cycles are rejected, and legitimate physical joint cycles remain permitted. A valid dependency graph does not establish tool access, clamping or intermediate stability. Missing order, raw-stock format, kerf, grain, hardware products/quantities and access remain explicit gaps. No area sum is treated as a raw-sheet count.

`derive_cad_material_requirement` also accepts a current construction Artifact/revision, without requiring a rendered drawing. It counts actual instances and derives supported blank piece/length/area quantities from canonical computed dimensions using the existing arithmetic and requirement revisions. `construction_blank_*` / version `1` identifies this method. `material_requirement_construction_sources` is provenance under those existing revisions: source Artifact/revision, definition, quantity mode, actual instance IDs, local dimensions and exact material/part pins. It creates no second BOM, stock or Shopping register. The caller reads normal requirements and may inspect this provenance under project RLS.

An active same-construction/definition/mode need cannot be created twice; the existing project lock serializes that check and write. Recalculation revises the same need, retaining its old history and source dimensions. Archive/restore carry the exact provenance forward; restore checks current sources and cannot reintroduce a duplicate active need. Manual revisions cannot strip this deterministic proof; use the derive path for recalculation. A changed construction head or changed catalog/physical source marks the need for review. The UI labels these quantities as **unallocated blanks**, shows the raw-stock fit gap, and disables Shopping; it does not present pieces as buy-ready sheets or route them through the unrelated wall calculator. Bob recalculates through the construction-capable derive path. Stock/reuse allocations and publishing to Shopping are rejected in SQL until a persisted cut plan and current raw-stock capacity can support them, including manual needs pointing to the same construction. Existing CAD/wall/manual material paths retain their own contracts.

This is the first concept list/save/readback outcome, not completion of K4. The next boundary below assesses candidate-sheet layouts. Whole-piece capacity reservations, compatible Shopping contributions, sourced hardware amounts and persistently linked/access-checked assembly work remain subsequent K4 work. [State](bob-delivery-flow.md#state) and [verification](foundation-verification.md#k4-construction-blank-lists--2026-10-05) own release and actual-model status.

### K4 candidate-sheet fit — 2026-10-06

`check_construction_cut_fit` is a read-only, versions-bound assessment of all actual instances from one current checked construction. The existing caller reads/checker supply geometry and exact material/part pins; a fresh non-journalled head/source gate and renewed access check prevent old replay results from claiming current fit. Only uncut rectangular blanks in `sheet_stock` material with exactly one thickness axis are supported. It changes no saved need, revision, allocation or Shopping row.

Inputs explicitly name candidate sheet formats/counts, exact used material revisions, thickness, saw kerf, trim per edge, sheet grain and each definition's local in-plane grain axis. Candidate values retain their `provided_spec` or `design_choice` basis and note; neither is verified physical-stock evidence. Null remains unknown and returns `needs_data`; `none` is an explicit decision that grain imposes no constraint. Thickness/material mismatch, forbidden grain rotation or a blank exceeding every matching usable format cannot pass because area happens to suffice.

The deterministic bounded guillotine search returns each blank's placement/orientation, ordered straight cuts and offcuts in mm. Working geometry uses integer arithmetic at the catalog's six-decimal precision, with full kerf between pieces and pre-removed edge trim. Existing boundary edges need no extra kerf. A positive layout establishes geometric feasibility only for the returned source, inputs and `construction-sheet-guillotine-v1` calculation version. It is not an optimal sheet count, purchase quantity, machine/access approval or proof of stock condition. Limits are 24 blanks, 16 candidate sheets and 20,000 search states; `no_layout_found`/`search_limit` leave fit unresolved for other orders/cutting strategies rather than declaring general impossibility.

The result is not persisted and expires when any source/input changes. **Stock/reuse allocation and Shopping remain blocked in SQL**, including after a positive candidate assessment. The next boundary must persist a canonical cut plan under the existing requirements, pin current physical stock/product formats, reserve whole-piece capacity under concurrency and recheck freshness before publishing compatible Shopping contributions. [State](bob-delivery-flow.md#state) owns the next action; [verification](foundation-verification.md#k4-candidate-sheet-fit--2026-10-06-0826z) distinguishes tests, hosted release and real-member/model acceptance.

### K4 saved cutting plans — 2026-10-06

`save_construction_cut_plan` computes the layout with the existing cut-fit engine and saves a versioned plan under all exact current piece requirements of one current construction. The model supplies candidate formats, grain, need pins and optional format sources; it cannot submit placements or cuts. SQL independently replays every full-span guillotine cut, matches each released blank to canonical geometry/material/grain and checks the remaining offcuts. Initially this supports the same uncut rectangular sheet blanks, zero waste allowance and purchase increment 1. It neither revises the existing needs nor creates a parallel BOM. One plan identity per construction retains immutable revisions and exact need/source pins.

`read_project_work(resource=cut_plan)` lists or reopens saved plans; `read_material_cut_plan` also reads a historical revision. Current need reads link to their saved plan. A changed construction, parameter source, need, material, bound format or capacity produces `source_state=changed`; historical layout and pins stay frozen. Saves use the existing caller/claimed-turn writer, current-request quote, optimistic revision and idempotent receipt ledger. Only project-authorized reads are granted on plan tables; authenticated clients cannot write them directly.

Physical sheet formats belong to existing stock revisions as optional `sheet_format`, including exact material revision, dimensions, grain and explicit measured/provided/estimated basis. Revision omission preserves the format and explicit null removes it; lifecycle/history use the existing stock owner. A candidate may remain explicitly hypothetical, pin matching available same-project stock with unreserved whole-piece capacity, or pin a current readable catalog panel part. Duplicate candidate aliases share the same stock capacity. Catalog format binding does not establish supplier approval, availability or physical inspection. No production stock or product is invented by acceptance fixtures.

**Saving and capacity preview do not reserve stock.** They retain false readiness/approval flags; the explicit reservation extension below is a separate operation. Individual construction blank allocation and Shopping guards remain in force. Compatible raw-sheet Shopping contributions remain a later boundary; hardware quantities/products and assembly/tool access remain separate gaps. Release and ordinary-member/model acceptance belong to [verification](foundation-verification.md); [State](bob-delivery-flow.md#state) owns the next gate.

Saved-plan read freshness shares one construction/source assessment across its need pins; need heads/revisions/archive and the canonical effective target are checked directly. This avoids repeating the graph through the full current-needs projection while retaining all stale-source fences. [Readback repair verification](foundation-verification.md#k4-saved-plan-model-outcome-and-readback-repair--2026-10-06) distinguishes the original ordinary HTTP timeout from the applied fix; [final readback acceptance](foundation-verification.md#k4-saved-plan-readback-acceptance--2026-10-06-1103z) records three passing ordinary reads of the same saved plan without a new model turn.

### K4 shared whole-sheet reservation — 2026-10-06

**Status: hosted technical release complete.** The reviewed migration and both matching Bob endpoints are deployed; rollback-role reservation/authority checks and ordinary read-only reopening of the original hypothetical plan pass. [Hosted release evidence](foundation-verification.md#k4-shared-sheet-reservation-hosted-release--2026-10-06) supersedes the earlier connector blocker. Positive physical-stock/member/model reservation and the later Shopping/hardware/assembly gates remain open.

The existing `manage_project_material` tool adds `resource=cut_plan`, actions `reserve` / `release`. Read the exact saved plan first; `expected_revision` is the plan revision and `data={reservation_revision,change_note}` pins the independent reservation head. The server derives quantities from canonical `layout.used_sheets`, aggregates candidate aliases by the same stock identity and reserves each actual sheet once for all linked blank needs. Unused offered sheets and finished-blank quantities are not allocations. The first scope requires every used sheet to pin matching current available same-project stock. Hypothetical/catalog formats cannot reserve physical stock; registered format basis remains explicit and reservation is not inspection or fabrication approval.

Reservation head/revisions/stock links live beneath the existing plan. They preserve actors, notes, exact plan/stock pins and immutable history; original needs, need history and layouts are unchanged. The existing ordinary caller/claimed-turn ledger handles model writes through v16, delegating all older write kinds unchanged to v15. Direct clients have project-scoped SELECT only and use the guarded invoker command. CAS applies to both plan and reservation revision; receipt replay does not reserve again.

Manual requirements and cut plans use one stock-capacity sum under the existing project/stock locks. Only the current active manual allocation revision is counted; each current explicit plan reservation is counted even when its plan, source or stock pin becomes stale. `stock_reserved=true` means full current stock-bound coverage, while a stale held reservation remains visible but cannot claim current coverage. Explicit release stays available after source changes. A plan with held capacity must be released before a new plan revision; stock revisions never silently free its commitment. Stock reads expose the combined reserved/unreserved whole-sheet quantity.

Individual blank needs remain blocked from raw-stock allocation and Shopping. `shopping_ready`, `fabrication_ready` and `input_evidence_verified` stay false. Compatible purchase contributions, real physical stock/product acceptance, hardware and assembly/tool access remain open. [Verification](foundation-verification.md) owns isolated SQL/tool tests, real PostgreSQL races, hosted installation and ordinary Auth evidence separately; [State](bob-delivery-flow.md#state) owns the next gate. The retained ordinary-member plan is hypothetical and must not be rewritten into invented physical stock for acceptance.


## K4 catalog-sheet Shopping contributions — 2026-10-06

Saved cut plans may explicitly publish actually used catalog-panel sheets to the existing `bob.materials` Shopping rows. The input is the current plan and its Shopping revision plus a change note, never an authored quantity. Every used sheet must have a current exact `catalog_part` binding. Hypothetical sheets, stock-bound sheets and mixed stock/purchase layouts remain rejected by this first handoff. Offered candidate counts, blank counts and area sums are not purchase counts. This does not optimize or combine layouts across constructions.

Contributions with the same project, exact part revision and grain share one Shopping row. Republishing replaces only that plan's current contribution; withdrawing subtracts only that contribution. Historical links retain exact plan/Shopping revisions, whole-sheet quantities and original Shopping identities. Zero-total rows remain as `0 pcs`; nothing ordered or delivered is deleted. Existing supplier, cost and status remain unchanged. Independent name/quantity/category/Area edits, deleted Shopping rows and quantity changes to ordered/delivered rows stop atomically for review; no replacement row silently recreates a purchase. Stale sources retain their commitment until explicit withdrawal. A published plan must withdraw before its layout can be revised.

`manage_project_material(resource=cut_plan, action=publish|withdraw)` uses `{shopping_revision,change_note}` with the exact current plan revision. It extends the existing v16 writer ABI and normal claimed-turn/replay receipts; older commands delegate unchanged. `read_project_work(shopping)` returns bounded contribution provenance and an explicit `source_state=not_checked`; reopen the contributing cut plan to assess all current sources. Shopping displays each contribution and exact construction link, a retryable provenance error and the requirement to verify supplier product and pack size. `shopping_ready` on a reopened plan describes only a current unchanged publication, never product, physical input or fabrication approval.

This is a catalog-format purchase proposal. No supplier availability, price, pack rounding, inspection or hardware/access approval is inferred from a catalog definition. Physical stock/member/model acceptance, mixed stock/purchase fulfillment, product/pack verification, hardware and assembly remain open. The original hypothetical membership acceptance plan is preserved; no new paid model trial is part of this change.

The technical boundary, including the Shopping frontend, is deployed from [PR #214](https://github.com/EmelieHagander/Bob-the-builder/pull/214). [Verification](foundation-verification.md#k4-catalog-sheet-shopping-release--2026-10-06) owns exact CI, migration, Edge and preservation evidence. The previous Pages queue blocker is resolved; the public HTML/JavaScript match the successful published artifact. Browser fixtures and this publication check remain distinct from actual member/model Shopping acceptance. This does not close broader K4.
