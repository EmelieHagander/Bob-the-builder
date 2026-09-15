# Material planning — requirements, stock, deterministic quantities and Shopping

**Status:** manual Slice 4B2a and the first narrow deterministic Slice 4B2b calculator are implemented, merged, migrated, deployed and live-verified on 2026-09-14. This contract owns the persisted material-requirement, stock-allocation, deterministic quantity and Shopping-handoff foundation. [PR 39](https://github.com/EmelieHagander/Bob-the-builder/pull/39) delivered 4B2a, [PR 50](https://github.com/EmelieHagander/Bob-the-builder/pull/50) aligned its release proof with persisted server truth, and [PR 54](https://github.com/EmelieHagander/Bob-the-builder/pull/54) delivered `stud_wall_net_area` 4B2b. `Docs/v1-plan.md` owns release order, the remaining executable-work contract and broader-calculator gates; `Docs/foundation-verification.md` owns release evidence.

## User goal

After choosing a project target and recording the drawing the crew intends to use, keep one trustworthy material plan that says:

- what quantity the project currently requires;
- what basis and assumptions that quantity came from;
- what usable stock or reusable components are deliberately reserved against it;
- what waste / purchase increment is being applied;
- what quantity still needs to be purchased;
- which exact project target and optional drawing version this material decision belongs to;
- whether the existing Shopping item is current, out of date or has been edited independently.

4B2a is intentionally manual-first: a person enters the base required quantity and its basis. 4B2b adds one deliberately narrow server-owned calculation from an already-persisted 4B1 drawing. Bob / AI still does not choose materials, infer structural member sizes, or mutate Shopping. The server derives the supported base quantity and then reuses the same transparent allowance, confirmed-allocation and purchase-increment arithmetic.

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
- task-readiness rules inside material planning; the deployed executable-work foundation consumes saved requirement/Shopping truth downstream;
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
