# Plans and drawings — project artifact foundation

**Status:** manual milestone 4A and narrow deterministic geometry milestone 4B1 are implemented, merged, migrated, deployed and live-verified. The downstream first 4B2b net-wall-area material calculator is also shipped, but its requirement/calculation behavior is owned by [`Docs/material-planning.md`](material-planning.md), not by the Artifact model. [`Docs/foundation-verification.md`](foundation-verification.md) owns release evidence; `Docs/v1-plan.md` owns later calculation/work-plan gates.

## User goal

After choosing an exact project target, keep the drawing or plan the crew is using as durable project truth rather than as a loose image. A drawing version must say which target decision, solution version, physical target and measurement versions it was based on, and later changes must not rewrite that history.

4A established the manual record and lineage boundary. 4B1 adds deterministic geometry for a deliberately narrow supported fixture. It does not turn bob into general CAD and it does not let generated geometry upgrade an estimate into a measured fact.

## Records and lineage

`bob.artifacts` owns drawing identity, project, optional area and current revision. `bob.artifact_revisions` keeps append-only kind, title, description, status, assumptions, optional drawing image, exact target decision, exact solution revision, archive state and server actor/time/reason.

Supported manual kinds are:

- plan;
- elevation;
- section;
- detail.

A drawing version has one explicit truth/readiness label:

- **Concept** — useful for intent/layout, not a measured construction record.
- **Measured** — the author is recording that the drawing is based on measured/provided project dimensions where applicable. It is not engineering certification.
- **Build ready** — the project team has deliberately marked this version as the drawing they consider ready to execute. It is still not structural, permit or professional approval.

The status is a human project decision; Bob does not promote it automatically. Assumptions remain visible at every status.

Each saved version pins the exact current `target_revisions.revision` it was created against. The server derives and stores that decision's exact solution id/revision and a snapshot of its title. The browser may not supply or rewrite solution identity. If the selected project target changes after the editor was opened, the save fails and the user must reload before deciding what the drawing belongs to.

Each version may reference up to 20 exact measurement revisions through `bob.artifact_measurements`. The UI displays their saved values, units, truth states and sources. Later measurement revisions are flagged without replacing the values used by the older drawing.

## Images, areas and history

The optional drawing image reuses the existing authorised `MediaAsset` storage rather than creating another file system. Only a completed image from the same project may be attached. Deleting that image later clears the file reference but keeps its recorded title and the drawing history.

An artifact may optionally belong to an Area. Area deletion keeps the artifact as project-level history. Project deletion cascades the records after the existing media lifecycle has been handled.

Create, revise, archive and restore append revisions. Archive/restore preserve the exact target, solution, measurements and image snapshot from the preceding version. There is no destructive rewrite of earlier high-value versions.

## Authority and concurrency

Use the existing project membership boundary and `database.ts` project/auth generation guard. Clients SELECT under RLS and `security_invoker` views. Only the guarded artifact command boundary may write artifact/generation records.

The private definer checks the authenticated user's project membership and project person identity, validates same-project area/media/measurement relations, derives target/solution lineage server-side and rejects unsupported identity/history fields. Expected artifact revisions prevent lost updates. A project-row lock serializes target changes with artifact saves.

Physical generation also validates that the referenced Building/Space is visible in the explicit project physical context and that the exact accepted physical revision exists. A user being a member of some other building must not broaden the active project's geometry context.

A delayed response after project/auth switching is rejected by the same frontend data boundary used by media, facts and solutions.

## Reachable manual workflow

Project and Area link to **Drawings**. A connected user can:

1. choose a project target in **Solutions & target**;
2. open **Drawings**;
3. create a plan/elevation/section/detail for the project or current area;
4. record title, explanation, assumptions and concept/measured/build-ready status;
5. choose/upload an authorised project image;
6. link exact measurement versions;
7. save and reload the same drawing;
8. revise it later without erasing the old version;
9. see when its target or linked measurements have since changed;
10. archive/restore while keeping history.

If there is no selected target, creation is blocked with a route back to **Solutions & target**. Demo mode may render the surface but does not pretend to persist it.

## K1 construction checkpoints

**Status: merged, migrated and deployed; technical read/write acceptance verified.** [Release evidence](foundation-verification.md#k1-construction-checkpoints--2026-10-02) distinguishes this technical K1 boundary from real autonomous model/participant acceptance. `bob.artifact_construction_revisions` extends the existing Artifact revision identity with a shared, explicitly unreviewed draft. It contains the existing CAD recipe and parameter graph, exact catalog material/optional part revisions per definition, typed joints between stable part instances, and explicit open questions. It has no engine files, render receipt, candidate approval or purchase output. The ordinary Artifact status remains **concept**; the server marks its description and readback as a construction draft.

`save_construction_draft` creates or revises that identity through the claimed-turn write ledger (`bob_project_write_v14`). It requires the current selected target and expected Artifact revision. `read_construction_draft` lists current drafts with pagination, or opens one exact current/historical revision. Another authorised project member can read it without the originating private conversation. Quotes, turn/thread IDs and private provenance stay in the existing private write ledger.

The same `compileCadParameters` evaluator and SQL `check_cad_parameter_graph` validate dimensions, units, formulas, source snapshots and complete numeric coverage. The latter is extracted from the existing CAD trigger, which still calls it. Checkpoint writes take the source-head locks that rendered CAD normally takes in its lineage trigger. Old measurements, changed material/part pins, wrong-project sources, stale revisions, bad references and reused identities are rejected atomically. Exact retries return their original receipt. Source changes are reflected by the existing Artifact freshness view and the checkpoint reader; previous revisions remain unchanged.

Stable assembly IDs, instance-to-definition identities, primitive types and joint endpoints cannot be reassigned under an old ID, including after removal/re-addition. Dimensions, placements, material revisions and a joint's proposed method may change in a new revision. Removing a part requires removing its joint references. A physical joint graph may contain cycles; assembly sequencing is a separate later contract.

Supported checkpoint geometry uses the existing box/cylinder/tube primitives and local cuts. Every definition pins a catalog material revision; a catalog part pin is optional and must reference the same material revision. `material_ref` stays null to avoid a competing opaque material identity. Typed joint endpoints currently name a **box's local** `x_min/x_max/y_min/y_max/z_min/z_max` faces. Methods are `screwed_butt`, `glued_butt`, `dowel`, `bolted` or `unresolved`, with a recorded design reason. These are unverified choices; they do not calculate anchors, prove joint fit/strength, choose hardware or establish material-dimension compatibility. Those checks belong to K2.

Unknown controlling dimensions stop numeric compilation rather than becoming zero. Other unresolved matters remain in `open_questions`. Image-frame capture and optional clearance/motion checks are explicitly unsupported by this first checkpoint tool; existing CAD capability remains unchanged. Frames based on project-scoped physical measurements reuse the existing authorised reader and source validator.

Generic Artifact revisions and older CAD saves cannot discard the construction checkpoint. A deferred revision guard enforces this across all existing command paths. Archive/restore copy the exact checkpoint without revalidating historical sources. The [K3 checked drawing path](cad-adapter.md#k3-checked-construction-drawings--2026-10-04) preserves and pins this construction through reviewed publication; K1 does not silently publish through the old CAD tool. K2–K5 and real model/participant acceptance remain in [State](bob-delivery-flow.md#state).

### Parameter changes before drawing — specified 2026-10-10

**Release B merged, migrated and deployed through [PR #244](https://github.com/EmelieHagander/Bob-the-builder/pull/244); real member/mockup/cost acceptance remains in E.** `change_construction_parameters` reuses the shared construction checkpoint, its parameter graph, claimed-turn receipts and K2 checks. The [K3 drawing path](cad-adapter.md#k3-checked-construction-drawings--2026-10-04) consumes an explicit `construction_revision` and renders that checked checkpoint without geometry-design/research calls. Older drawings require the explicit [release C transition](#legacy-drawing-transition--release-c); a complete numeric graph alone does not attach a construction. [Verification](foundation-verification.md#bounded-construction-changes--release-b) owns B's installation and acceptance evidence.

For a request such as “the bed is too high compared with the mockup”, Bob opens the exact drawing, its source construction and the reference pixels, identifies the controlling parameter and explains the proposed change. A height chosen within delegated design authority is a `decision`; a height inferred from an image is an `estimate` unless an independently valid scale/source establishes it. Neither is a new physical measurement. Reuse the solution/design-intent image references; the checkpoint's missing image-frame carrier must be addressed explicitly where geometric image correspondence is needed.

The bounded change command carries the construction Artifact ID, expected construction revision, an idempotency key, change reason and changed parameter nodes by stable ID. Each node retains its existing role and unit. A source change names an exact accessible revision of the same measurement identity/kind; it cannot overwrite its value. A decision/estimate change supplies value, unit and reason. Derived nodes are recomputed from their saved operands and versioned operations. Unknown controlling values return together as gaps before further source reads or any save. Parameter identity must keep its meaning; a length cannot become a width under the same ID. Changing a role, unit, formula or source identity requires the full construction revision contract, rather than a numeric delta.

The server reads the checkpoint itself, applies the delta and uses `compileCadParameters` plus the existing SQL/source guards to compute all affected dimensions and placements. Unchanged geometry topology, bindings, materials and joints are retained. SQL independently compares the changed inputs and permitted numeric recipe fields, recomputes the graph, reads canonical material/joint metadata and checks sources/readiness at commit. Formula/topology changes require an explicit construction revision; the numeric command cannot silently add/remove parts or alter bindings. Commit one new immutable construction revision under its expected-revision guard, then check that exact revision. This is one bounded operation through the existing construction writer and its receipt ledger. Exact retry is checked before source compilation and returns the original receipt even after a later head/source revision.

Only a successful checkpoint receipt supplies the downstream construction ID/revision. Bob passes its revision as `construction_revision`; the drawing job reads that version from the database and follows the checked K3 path. It may select supported views; it cannot choose replacement dimensions. A resumed request keeps its saved version. Old pinned AI manifests that lacked this input capture the canonical version once; they do not follow a newer head on resume. Failed construction checks return concrete issues to Bob on the same construction. Rendering or export failures retain that checkpoint for retry. Independent review and save-time source/construction guards still apply. The caller's drawing reader returns `construction_source` from the typed exact relation described by the [database owner](../db/README.md#construction-data-authority-and-remaining-extensions).

| Version | Meaning | When it advances |
|---|---|---|
| Construction Artifact revision | Saved design values, dependencies, parts, materials and joints | An atomic, validated construction change |
| Drawing Artifact revision | A rendered, reviewed result pinned to one construction revision | A successful guarded drawing save |
| Format/engine version and attempt identity | Interpretation of the recipe/graph and execution evidence | Their own existing contracts; neither is a drawing revision |

The numbers are independent: drawing v3 may represent construction v5. While v5 is being rendered, the app must distinguish the intended construction from the last saved drawing and show its exact source version/freshness. A failed attempt does not advance the drawing. Concurrent changes reject a stale expected revision; they never silently replace a later design. Old construction/drawing versions and performed work remain intact. Duplicate retries reuse receipts; a job for an older construction cannot publish as the current result after a source change.

Before moving a legacy drawing onto this path, inspect its existing geometry, graph, source pins and design intent. Preserve the historical drawing and stable part identities. Establish the missing material/joint/image evidence honestly, create or reuse a valid construction checkpoint, then explicitly attach a new drawing revision to it. Do not infer catalog pins, invent joints or convert unknowns into decisions to force migration. The current K3 contract prevents dropping or switching an existing construction pin; the transition from a legacy drawing needs its own guarded implementation and verification.

Acceptance must cover a dimension-only change and all dependent placements/list values, the exact construction-to-drawing pin after reload, stale/concurrent changes, an invalid or unknown input, a failed render followed by receipt-safe retry, and a legacy transition preserving history. Measure the whole model chain before/after on equivalent work. The expected saving is fewer repeated geometry-design calls and smaller deltas; no percentage or successful mockup match is established by this specification.

### Bounded part changes — prepared 2026-10-19

**Implemented and locally verified on the preparation branch; not deployed.**
`edit_construction_parts` edits an existing construction at an exact expected
revision. It accepts only named upserts/removals of definitions, instances,
parameter nodes/bindings, material pins, joints and instance roles. Each upsert
is a complete changed post; omitted collections and posts remain server-owned.
There are no arbitrary JSON paths, silent dependency removals, metadata changes
or new coordinate-frame types. Existing numeric inputs and role-only changes
retain their smaller dedicated commands.

The claimed-user `prepare_construction_edit` RPC merges against the canonical
current revision. Compilation stays inside the runtime. Commit repeats the merge
under the existing project lock, checks the compiled graph against the exact
requested changes and delegates through the existing construction writer,
source checks, readiness, identity rules and affected-output tracking. A changed
joint endpoint needs a new joint ID. New roles require evidence or explicit
`unknown`/`unknown`; unrecorded historical roles remain unknown.

The existing receipt ledger uses `construction_edit:<key>` for this command.
Exact retries return the same receipt before recompilation, including after a
later source/head change; changed input under the same key conflicts. Access and
turn ownership are checked first. A saved construction is still not a checked,
rendered or reviewed drawing. Complete the affected outputs for its exact revision.

Small diagnostics identify missing fields, self-joints, identity reuse and dangling
dependencies without exposing raw database errors. Existing pinned catalogs keep
their old handlers and full-save diagnostic sequence. [Verification and release
order](foundation-verification.md#bounded-construction-edits--2026-10-19) own the
evidence and rollout limits; [State](bob-delivery-flow.md#state) owns next work.

### Compact repetition and natural pieces — prepared 2026-10-19

**Delivery 3, source-only above #287/#288.** The pinned save-tool metadata
`construction_repeat_version=1` accepts `recipe.arrays`: exact template ID,
definition ID, axis and count, with six start bindings and one spacing binding.
Empty arrays mean ordinary authoring. Server expansion generates stable
`<id>.1`…`<id>.<count>` instances and derived arithmetic nodes before normal
geometry, role, source and parameter validation. SQL independently checks the
expanded canonical graph and geometry under the existing claim/write ledger.
No compact template is stored as a competing construction. Subsequent small
edits operate on saved parameter/part IDs. Roles and joints explicitly name the
expanded instances; omitted roles remain unknown, never manufactured by default.
Duplicate IDs, absent bindings, unknown inputs, unsupported geometry and existing
canonical size limits still reject saving. Old pinned saves do not accept arrays.

For larger new builds, the workflow establishes shared coordinates, interfaces
and exact source revisions, then saves/checks one natural sub-construction before
the next. Carry common interfaces and receipts; reopen relevant bounded views
when needed. The existing part queue checks each pinned construction afresh and
hands each renderer its own source and requirements plus the common brief,
without siblings' raw geometry. It does not design constructions or verify an
otherwise unproven cross-piece fit. Small furniture corrections stay in their
existing construction. No retired designer/candidate path is reintroduced.

Structured data continues through deterministic selectors and compilation; no
remaining mandatory unstructured reading requirement has been established for
this slice, so no additional paid reading model is introduced. Actual model
selection/decomposition and the soft $1 goal remain unverified; see
[release evidence](foundation-verification.md#selective-tools-and-construction-work--2026-10-19).

### Construction views and observed results — prepared 2026-10-19

**Implemented and locally verified above delivery 1; not activated or deployed.**
The new pinned `read_construction_draft` contract returns an overview by default.
It exposes exact revision-bound `parts`, `parameters`, `bindings`, `joints`,
`materials`, `roles`, `notes` and `dependencies` views. Missing historical roles
are reported as unknown. The description and original open questions remain
available in notes; an overview never claims that omitted constraints are resolved.

Named selectors retain canonical IDs, values, truth states, formulas and source
pins. The dependency view follows parameter ancestors/dependents, affected
bindings/parts and directly attached joints/materials/roles. Its declared scope
does not claim to traverse every additional dependency of newly reached neighbor
parts; those can be selected in a further dependency read. Every page identifies
its selection, missing IDs, total selected rows and `next_read`. Pages fit 2,000
serialized content tokens. Jobs whose execution identity pins
`constructionPageVersion: 1` (owner decision A; deployed 2026-10-22 as `ask-bob`
v165 / `bob-worker` v133) give a read up to 6,000 tokens; reads in the same model step share
12,000, never below 2,000 each. Larger pages only cut read steps: selection still
comes from the view and IDs, and the whole construction does not reach the main
model for a partial task. Jobs without the pin keep 2,000, and a cursor continues
exactly at either size. Whole posts are preferred; an oversized post uses
explicit exact JSON fragments with Unicode offsets. Original data is not shortened
or replaced by model-generated text. Cursors cannot move between revisions/views.

Checks, derived lists and cut assessments keep their complete observed output in
the construction-tools checkpoint component. The model receives status/counts,
bounds where available, section names and an exact result reference. Identical
outputs share stored content. All checker findings, including those beyond the
old 200-finding presentation limit, are reachable via `view=result` and a returned
section. Empty collections, explicit unknowns, candidate inputs, quantities and
limitations remain recoverable. Result order and page cursors survive JSONB key
ordering. The active operation journals its observation time so a replay cannot
silently change the next model input.

References are private to the current turn and survive worker restart, not job
completion or a new turn. Reopening verifies current project access and reads
the requested canonical revision; it does not rerun a checker or read catalog
materials again. Historical observation time and current source/head status are
separate. Old results cannot authorize a write, render, stock allocation or
purchase. The drawing gate retains its independent full canonical read/check.

This component owns the original domain assessment. Draft #286's future generic
history will archive the model-visible summaries/pages and references, without
another full construction-result copy. Existing checkpoint storage limits remain;
whole-turn capacity/CPU and real-model cost belong to the final acceptance gate.
[Verification](foundation-verification.md#construction-views--2026-10-19) records
the local evidence, catalog compatibility and release order.

### Instance roles and affected outputs — release D

**Implemented; release installation/readback is tracked in [verification](foundation-verification.md#construction-instance-roles-and-consequences--release-d).** A version-1 `instance_policy` belongs to one exact construction revision. It contains one entry per stable recipe instance ID, an explicit role, its matching quantity policy and a reason. Geometry, definitions and numeric provenance remain in the existing construction; the policy does not alter the CAD recipe contract.

| Role | Quantity policy | Meaning |
|---|---|---|
| `build_part` | `manufacture` | A new manufactured member; counted in blank needs and cuts. |
| `existing_part` | `retain` | A retained member, listed separately; availability/condition remain unverified. |
| `prefabricated_part` | `complete_item` | A complete item, listed separately; procurement and suitability need their own evidence. |
| `reference` | `exclude` | Visible context, excluded from manufacturing and physical-contact checks; clearance remains unverified. |
| `unknown` | `unknown` | Unclassified; quantity lists/needs/cuts stop instead of guessing. |

Missing historical policies remain unknown. No existing owner data is backfilled. Numeric corrections and older full writes inherit previously classified stable IDs into the new revision; new IDs remain unknown. `change_construction_roles` applies only bounded existing-ID deltas while the server preserves geometry, parameters, material pins, joints, metadata and prior versions. Explicit full construction saves may supply a complete policy; null preserves uncertainty/inheritance rather than clearing a known policy. Neither names nor labels establish manufacturing, ownership or stock evidence.

Every subsequent construction revision records the currently linked drawings, blank needs, cutting plans and current linked Steps in saved affected-output work. Exact source pins make all outputs linked to that construction require a fresh pin, even when their dimensions did not change. Other constructions and unrelated work are not selected. `read_construction_changes` reads paged pending/completed work; a superseded construction head fences old pending actions. Original and completed output versions retain typed foreign keys.

`continue_construction_change` processes one item. Code reads the saved need/cutting model and uses the normal domain writer to revise the same identity; it never receives model-computed quantities or placements. Needs precede cutting. Removing a manufacturing need archives that same requirement. With no manufactured members, the cutting consequence becomes inapplicable while the historical plan/layout remains stale and unchanged; its reused receipt does not claim a new layout. Existing reservations, Shopping/purchases and allocations require explicit resolution through their usual commands. Interrupted work and exact retries preserve receipts without duplicate capacity or purchases.

Drawing items return the existing drawing/Step and exact construction pins for K3 rendering. Typed publication completes the item; failed rendering stays pending. Linked work returns a review need. A recorded review pins the exact current plan revision, preserves performed/completed work and states `physical_verification:false`; it is not certification or an automatic work-state change. The [material owner](material-planning.md#role-aware-manufacturing-and-continuation--release-d) and [CAD owner](cad-adapter.md#reference-geometry-and-exact-role-versions--release-d) define their output semantics. Actual bed/mockup/member and cost acceptance remain in E.

### Legacy drawing transition — release C

**Status: merged, migrated and deployed through [PR #245](https://github.com/EmelieHagander/Bob-the-builder/pull/245), 2026-10-11.** [Verification](foundation-verification.md#legacy-drawing-transition--release-c) owns exact installation/readback; real owner/member/mockup/cost acceptance remains E.

`transition_legacy_drawing` prepares a current nonarchived CAD drawing for construction-driven correction. Its input carries the exact drawing ID/revision, selected target revision, one receipt key and change reason. It accepts no recipe, dimension list or parameter plan. The database copies the immutable drawing's geometry, stable assembly/definition/instance IDs and saved parameter graph. Old material labels remain in drawing history; the construction uses explicit catalog revisions and `material_ref:null`.

Creating a checkpoint requires explicit material pins, typed joint choices and open questions. These are current design choices, not recovered historical facts or fabrication approval. A missing graph, material/joint evidence, image-frame carrier or measurement binding returns all known gaps before saving. The ordinary construction tools may establish a matching checkpoint when the graph is absent. Reuse requires exact current construction ID/revision, same project/Area/target, equal geometry apart from views, and equal saved graph when one exists. Metadata inputs must be null in reuse mode; they are never silently ignored.

The claimed-turn command repeats preparation inside the project transaction. The origin relation pins the exact legacy drawing revision and initial construction revision. An exact retry returns its original receipt even after later heads change. A different operation on an already prepared drawing returns the existing checkpoint for readback; concurrent preparation cannot duplicate it. Changed drawing/source heads, revoked access, mismatched construction or reused command keys block the write. Preparation neither modifies a historical drawing nor renders a candidate.

Bob then changes/checks this checkpoint through B and calls `design_project_cad` with the **original drawing ID** and exact current `construction_revision`. The pending origin routes that identity through checked K3 rendering, bypassing geometry-design/research calls. Fresh drawing, construction and readiness reads guard actual render/reviewer dispatch. The reviewed save advances the same drawing ID, records the exact final construction revision and preserves all old packets. The first pin requires this origin and preserves baseline topology and stable IDs while allowing numeric corrections; later saves retain K3's no-switch/no-drop rule. The origin is historical provenance, not a floating dependency on old geometry.

Paused free-design requests retain their original scope and budget; this transition does not silently convert or refill them. A new scoped request can reuse the same drawing identity and checkpoint. Installation evidence belongs in [verification](foundation-verification.md#legacy-drawing-transition--release-c); real bed/mockup, member and cost acceptance remains E, and part roles/consequence continuation remains D.

## 4B1 deterministic geometry — stud wall with opening

**Status:** implemented, deployed and live-verified. This is the first deterministic geometry fixture, not a general drawing engine.

### Product promise

For one project-scoped Space, the user can map exact persisted measurement revisions to a small set of required geometric roles and create a reproducible elevation/framing concept. Bob renders the same geometry again from the saved recipe after reload. If a measurement or the accepted Space revision later changes, the old drawing does not mutate; regenerating creates a new Artifact revision with new pinned inputs.

The generated elevation is a construction-planning aid. It does **not** size structural headers, certify load paths, infer hidden services, or claim permit/engineering approval.

### Recipe, not raster truth

A deterministic drawing revision stores a generation recipe, not an authoritative raster snapshot:

- generator id: `stud_wall_opening_v1`;
- generator contract version;
- exact Building id;
- exact Space id + accepted Space revision;
- exact measurement id + revision for every required role;
- explicit design parameter `stud_spacing_mm`;
- the normal Artifact target/solution lineage and assumptions.

The SVG/vector view is recomputed from this saved recipe by versioned deterministic code. An optional project image can still be attached for human reference, but it is not the generated geometry authority.

### Required measurement roles

The first generator requires six role bindings, all taken from exact persisted measurement revisions:

- `wall_width`;
- `wall_height`;
- `opening_left` — horizontal distance from the drawing's left wall edge to the opening's left edge;
- `opening_sill_height` — vertical distance from floor/bottom wall edge to the opening's bottom edge; use a verified zero measurement for a floor-level door rather than silently assuming zero;
- `opening_width`;
- `opening_height`.

Inputs must have numeric values. `unknown` cannot generate geometry. `estimated` may generate a **Concept** drawing but cannot be presented as Measured/Build ready. `measured` and `provided_spec` remain visibly distinguishable in the evidence list; deterministic derivation does not merge those truth classes.

Unit conversion is deterministic into integer/decimal millimetres before geometry. The generator must reject impossible geometry such as negative dimensions, zero wall/opening size, or an opening extending beyond the wall bounds.

### Explicit design parameter

`stud_spacing_mm` is a project design parameter, not a site measurement. It must be entered explicitly and retained with the generation recipe. The first slice does not silently choose a spacing from generic construction knowledge.

The generator may use the spacing to place regular stud centre-lines plus conceptual opening-edge framing. Member widths/header capacity are not structurally sized by this fixture. The rendered drawing must say that opening framing is conceptual and requires project-specific structural judgement where applicable.

### Physical target pinning

Generation is scoped to one accepted Space revision. The project must already have explicit physical context that grants access to that Building/Space. The recipe pins the accepted Space revision used at generation time so a later remodel/proposal/current-state change cannot silently move old geometry.

A pending Space proposal is not used as current geometry unless/ until the product adds a separately explicit proposed-target generation path. 4B1 generates from accepted physical truth only.

### Revision behavior

Generation creates or revises a normal Artifact; it does not create a parallel drawing silo.

- the first generated version gets normal target/solution lineage plus the recipe;
- regenerate uses the currently selected target, chosen current accepted Space revision and newly chosen exact measurement revisions;
- old Artifact versions keep their old recipe and remain reproducible;
- archive/restore preserve the recipe unchanged;
- manual artifacts remain valid and have no generation recipe.

A generated drawing whose selected target, physical target, or measurements have since changed should show a stale-input warning, not silently recompute against current data.

### UI contract

`Drawings` remains the owning surface. Add a secondary **Generate wall elevation** path rather than new global navigation.

The generation flow should:

1. require an exact selected project target;
2. choose a project-scoped Building/Space;
3. map each required role to an existing measurement version;
4. collect explicit stud spacing;
5. preview a labelled SVG with measured/estimated status visible before save;
6. save/read back the Artifact revision and recipe;
7. render the saved version from the persisted recipe after reload;
8. expose stale target/Space/measurement warnings and honest failure/denied states.

Phone use must keep the preview readable without forcing horizontal page overflow. The generated view may open larger in a modal for inspection.

## Not in 4A / 4B1

The foundation still does not yet provide:

- general CAD or arbitrary freeform geometry;
- the ventilated porch/floor build-up generator (the second narrow fixture);
- automatic structural member/header sizing;
- general bill-of-materials calculation inside the Artifact model; the separate material-planning foundation now consumes this exact recipe for one narrow `stud_wall_net_area` coverage calculation;
- stock deduction or Shopping mutation inside the Artifact model; those remain owned by material planning and stay explicit;
- task-material relations, dependencies, tools or readiness;
- Bob/vision consumption;
- engineering/permit certification.

Those remain later Slice 4/5 gates. Future generated artifacts and BOM/work-plan records must reference the exact selected target and artifact/calculation revisions rather than infer lineage from whichever target is current later.

## Parametric 2D storage box — implementation branch (2026-09-18)

**Status:** implemented in code, not a statement of hosted deployment. Apply the additive
`20260918204949_parametric_storage_box_drawings.sql` before the matching frontend and
`ask-bob` rollout. The delivered 4A/4B1 status above is unchanged. Browser and hosted
release proof must be recorded separately; committing a recipe is not a deployment.

The first editable furniture drawing is deliberately one assembly: an **open-top,
rectangular sheet-material storage box**. It has front elevation, plan, central
section A–A and a finished-part table. `src/lib/storageBox.ts` is the shared,
versioned geometry authority for the browser, exports and Bob's read tool. No 3D,
external CAD service or image generator is required.

The `storage_box_v1` / version `1` recipe holds outside width, overall height,
depth and uniform sheet thickness, all in millimetres. Finite positive dimensions,
maximums and at most three decimals are checked in both TypeScript and SQL.
Arithmetic uses integer micrometres to avoid floating-point cut-list drift;
that numerical precision is **not** a manufacturing tolerance.

Assembly and finished sizes:

- B1: one full bottom, width × depth × thickness.
- S1: two sides, depth × (height − thickness) × thickness, standing on B1.
- F1: front and back, (width − 2 × thickness) × (height − thickness) × thickness,
  between the sides and standing on B1.

There is no lid, runner, rebate, fixing schedule, structural/load rating, site-fit
allowance, stock layout, saw-kerf optimisation or Shopping mutation. This is not a
complete fitted drawer system or a general-purpose CAD editor. The limits remain
visible in the app and print pack. Fixing, material suitability and site fit need
project-specific checking before cutting or assembly.

### One artifact, exact versions

`bob.artifact_parametric_recipes` stores one recipe per existing Artifact revision.
It does not create another project/drawing identity. The guarded
`artifact_box_command` delegates target scope, membership, actor, measurements,
optimistic revision checks and history to the canonical Artifact command. A
revision cannot hold both a wall recipe and a storage-box recipe. Raw writes are
not granted; SELECT remains under project RLS. No shared/hearth table changes.

Create and regenerate save **Concept** revisions. Parameters are chosen design
specifications, not observed Building/Space measurements. Optional linked
measurement revisions are evidence, not implicit parameter bindings: changing a
measurement warns through the existing evidence UI and does not silently resize
the box. Regeneration retains old versions and deliberately does not carry a
possibly obsolete illustration into the new revision. Archive/restore retain the
same recipe. List/history/detail reads fetch the exact version pairs, not a newer
recipe that happens to become current during a concurrent save.

### Reachable UI and Bob tool

`Drawings → Draw storage box` uses the selected target for the current
Project/Area. The initial numbers in the form are explicitly editable examples,
not measurements from the user's project. Width, height, depth and thickness are
editable with live preview. Saving reads back and opens the saved drawing.
**Revise** edits the recipe, saves a new revision and preserves old evidence.

The viewer has three views, labelled dimensions, internal dimensions, a readable
part table, zoom and contained scrolling on phones. SVG, finished-parts CSV and
Print / PDF are available for saved revisions only. Exports identify the revision;
the drawing states **NOT TO SCALE**. Read written dimensions, never a ruler applied
to the screen or a fit-to-page print. The print pack is generated from the same
recipe; it is not a separately authored drawing.

`save_project_drawing` creates/revises this supported assembly through the existing
claimed-turn, caller-JWT, receipt and settlement boundary. The model cannot choose
project authority, status or arbitrary code/SVG. It reads the selected target and
current recipe first. `search_bob_project_data_v3` adds the recipe; the Edge lookup
adds dimensions and parts using the shared generator. Old v2 callers stay valid.
A validated drawing receipt links to its **exact revision** in Bob and closes the
chat to reveal it. See [bounded writes](ask-bob-writes.md) for write authority.

Mockup generation and automatic material-requirement publication are **not** part
of this slice. Future mockups must pin their source Artifact revision and must not
be silently relabelled current when the design changes.

### Branch verification

`tests/storage-box.test.ts` covers geometry, decimal arithmetic, version rejection,
SVG escaping, consistent changes, parser scope, research derivation and receipt
recovery. `tests/storage-box-db.test.ts` applies all migrations in PGlite and checks
real role/RLS behavior, canonical target/measurement lineage, raw-write denial,
stale edits, archive/restore and claimed-turn idempotency/settlement. Existing
wall-generation tests remain intact. `scripts/storage-box-browser.mjs` is included
in the production foundations browser gate at 320/390/1280px and exercises editing,
conflict recovery, reload, exact old-version links and SVG/CSV/print rendering.
These fixtures are not a live AI personality or hosted PostgREST test.

## Linked two-room plan pilot — implementation branch (2026-09-19)

**Status: implemented on `feat/linked-room-drawing-pilot`, stacked on #83; not
merged or deployed.** The owning migration is
`20260919055800_linked_room_drawing_pilot.sql`. The current pilot is not general
house CAD and does not supersede the delivered 4A/4B1 scope above.

### User journey and scope

Bob creates a proposed two-room plan from the conversation. The user does not
have to draw lines, map UUIDs or fill a drawing form. The tool reads the selected
Project/Area target, two existing project-scoped accepted Spaces, one existing
wall BuildingElement and an existing `storage_box_v1` drawing. These records are
prerequisites: the new tool does not create or accept physical building records,
select a target, or generate a bunk-bed construction. The earlier box tool can
create the furniture drawing before the plan is made.

The two rooms are rectangular, share a single straight wall and have the same
depth. One stable furniture instance has its own placement and pins an exact
furniture Artifact revision. The persisted plan uses canonical physical IDs;
there is no second room/wall catalogue. Placement anchors are `shared_wall` or
`outer_wall` on the chosen room side, with a gap, offset and 0/90-degree rotation.
These mean proximity/placement, not a structural attachment.

The recipe contains one fixed inside span across both rooms plus the separating
wall. Right-room width is derived, never independently editable:

`right width = fixed span − left width − wall thickness`

`src/lib/roomLayout.ts` is the shared deterministic authority for UI, SVG and
Bob's calculated read/write results. Dimensions are millimetres; calculations
use integer micrometres. This precision is not a manufacturing tolerance. Local
coordinates are not a surveyed house position, north direction or floor level.

### Change rules and coherent versions

- `create` saves one Concept Artifact revision containing the entire linked plan.
- `move_wall` changes only the left inside width. Both room views and wall-anchored
  placement change together; span, depth and wall thickness stay fixed.
- `place_furniture` changes only the single instance's room/anchor/gap/offset/rotation.
  It never edits its construction, part sizes, quantity or material purchases.
- `refresh_sources` explicitly adopts the read current source revisions and target.
  Parameters and canonical identities remain unchanged. Existing measurement
  identities cannot be silently discarded. Refreshed sources are not proof that
  the chosen dimensions or real site fit have been verified.

For the synthetic acceptance fixture, `3400 + 120 + 2600 = 6120` becomes
`3200 + 120 + 2800 = 6120` after moving the wall. The furniture construction and
its part list remain byte-for-byte unchanged. Moving the furniture to the outer
wall changes placement only. A footprint outside its room may be saved as an
explicit Concept conflict; it is never automatically shrunk to fit.

All views are projections of one atomic saved recipe, not sequential independent
writes. Existing Artifact optimistic revisions, target/solution lineage,
measurement snapshots and archive/restore history remain authoritative. The
command also locks/checks current furniture and physical dependencies through
commit. Changed sources reject normal edits and require explicit refresh. Old
packages retain old source versions and remain reproducible while access exists.

The new `artifact_room_layouts` relation is subordinate to Artifact revisions.
Authenticated project members have SELECT only under RLS; writes use the guarded
command. Source-detail views are security-invoker and require the active
project's physical scope, even if the same caller can access another Building.
Losing that scope yields an unavailable-source state, not a substituted drawing
or use of another project's physical authority. Accepted building state, source
furniture geometry and shared-app tables are never rewritten by this pilot.

### Reading the result in Bob

A verified chat receipt opens the exact saved revision in **Drawings**.
The linked viewer has both-room overview, individual room views, zoom/contained
scroll, readable dimensions, placement explanation, source identities/versions,
and a furniture-construction tab using the pinned existing box viewer. Its link
opens that exact furniture revision. An SVG export identifies the plan revision,
furniture revision, target and scope limitations; the screen/print is not to scale.
Native target/measurement warnings and physical/furniture-source warnings retain
old geometry instead of silently recomputing it. No manual plan-editing form is
required or provided by this slice; Bob owns create/move/place/refresh operations.

The outline check is deliberately **not** a safety/fit/structure assessment. No
doors, windows, services, circulation, ceilings, roof slopes, material load ratings
or connection details are modelled. Mockups, alternate unselected solution
packages, nuläge/as-built drawing modes, arbitrary floor plans, multiple furniture
instances, new hypothetical rooms and automatic stock/material publication remain
later work. This pilot tests coherent relationships before those expansions.

### Verification and deployment boundary

`tests/room-layout.test.ts` covers conservation, micrometre arithmetic, placement,
rotation, unchanged parts, conflicts, source binding, SVG escaping and strict tools.
`tests/room-layout-db.test.ts` applies the actual migration chain in PGlite and
exercises permissions, atomic rollback, revision/source/target conflicts,
archive/restore, explicit adoption and claimed-turn receipt recovery. It also
runs the real Bob tool orchestration against the migrated database with an
injected deterministic provider, not a live model.

`scripts/room-layout-browser.mjs` runs inside the ordinary foundations browser gate
at 320/390/1280px. It exercises chat creation, wall movement, placement-only changes,
unchanged furniture, saved links/reload, warnings, unavailable sources and SVG
export. Production React/data code runs against HTTP/provider fixtures. Passing
results must be recorded on the actual PR/head, not inferred from the script's
presence. Hosted Auth/PostgREST and actual live-model behavior are separate gates.

Stage after #83: apply only its still-pending prerequisites and this new migration,
then deploy the matching Edge and frontend versions. Do not replay the shared
migration history. Research v4/writer v3 preserve their predecessors for rollback.
This source branch does not apply production schema or modify user projects.

## Multi-floor coordinate studies — implementation branch (2026-09-19)

**Implemented on `feat/bob-multifloor-geometry`, stacked after #85; not merged or
hosted-deployed.** This is the geometric bridge after narrative Building intake,
not yet a stair generator. Apply only
`20260919185244_multifloor_coordinate_plans.sql` after the pending prerequisites,
then the matching Edge/frontend. Do not replay shared migration history.

### One frame, several views

`multifloor_v1` / version 1 binds existing canonical Building, Level and Space
identities and their exact accepted revisions. It is an atomic **Concept Artifact**,
not a new physical Building store or an automatic update of accepted building
geometry. `src/lib/buildingPlan.ts` owns the versioned math; `buildingPlanSvg.ts`
projects that same recipe into floor tabs and a separate **height comparison**.

Every included floor uses one explicitly described datum: x east, y north, z up,
in millimetres. Outside rectangular envelopes may be offset but are never
independently recentered. Uniform exterior-wall thickness derives an inside
envelope; this is not surveyed usable/lettable area. Room/zone rectangles represent
inside footprints, not inferred partition walls. Qualitative `above` relationships
do not establish numeric registration or equal footprints.

The bounded study supports 2–6 existing levels, up to 32 existing spaces and 4
projected study areas. Unknown floor elevation, slab thickness and room placement
are explicit nulls. A level's sort position never supplies its height. Numeric
inputs carry supplied-specification or estimate labels and source explanations;
precise arithmetic does not promote them to measured truth. Optional linked
measurement revisions remain separate evidence, not automatic parameter bindings.
The recipe and server-owned source names together are limited to 16 KB so exact
research remains bounded; concise source explanations may be needed on large plans.

### What the calculations establish

A study rectangle is projected vertically at unchanged building x/y between two
floors. The engine reports intersections with mapped room footprints, full
containment versus partial overlap, whether it crosses either inside envelope,
and a signed finished-floor height difference when both elevations are known.
For an upward projection with known destination slab thickness, it also reports
the distance from the lower finished floor to that upper slab's underside.

For the synthetic fixture, 9000 × 5000 mm outside with 300 mm walls produces an
8400 × 4400 mm inside envelope. Floor elevations 0 and 2800 mm with a 250 mm
upper slab give 2800 mm floor difference and 2550 mm to the slab underside.
Changing only the upper floor to 2900 mm produces 2900 / 2650 mm without moving
any room footprints. Translating the study area can change a single contained
room hit into two partial hits without resizing either room.

**This is not a staircase endpoint, travel calculation, along-path headroom check
or approved floor opening.** Empty intersection results mean unmapped coverage,
not an empty physical room. Footprint overlaps are reviewable conflicts (possibly
intentional open zones), not proof of a physical collision. Missing values stay
unknown and invalid shape/precision/identity inputs are rejected. Positive/negative
coordinate and floor differences use integer-micrometre arithmetic; this numeric
precision is not a site-measurement tolerance.

### Bob owns creation and inspection

`save_project_building_plan` creates or revises a saved study through the existing
claimed-turn writer. `inspect_building_projection` is a separate **read-only** tool:
it reads an exact current saved plan and computes a supplied study area without a
new revision, write receipt or alteration of the house. Questions need not cause
unsolicited edits. Current source warnings and estimate labels remain in the
result. Saved research returns compact derived summaries; the inspection tool
returns the full bounded intersections for one area.

The existing receipt opens its exact revision in **Drawings**. The viewer
has floor/height tabs, a full-width overview, contained zoom, readable coordinate
and dimension tables, source versions, explicit conflicts and revision-stamped
SVG export. There is no manual coordinate-plan form. Height comparison is labelled
as such, not as an architectural building section. All SVG is controlled/escaped;
user/model SVG, script, URLs and arbitrary code are not accepted.

### Version and authority boundary

`bob.artifact_multifloor_plans` is a child of Artifact revisions. Raw writes remain
denied. Both raw geometry SELECT and the invoker detail view require current
project membership, access to the Building and **full Building or Site scope** in
that project. Room-only scope cannot be expanded by guessing the Building ID.
The artifact's non-geometric marker remains readable after scope revocation, while
source geometry is withheld and the UI shows unavailable rather than silently
substituting an old browser copy or another house.

Canonical Artifact commands retain exact target/solution/measurement lineage.
Source identities and existing evidence cannot be silently removed on revision.
Changed sources block normal edits; `refresh_sources` explicitly adopts current
revisions while keeping geometry unchanged. Normal edits and source refresh are
separate operations. Archive/restore copy the complete saved recipe; one Artifact
revision cannot simultaneously carry another generator's recipe. Source and target
locks plus expected revisions protect commit-time checks. Old plans preserve their
coordinates, source labels and history while access exists.

Research v6 delegates older datasets to v5, and caller-JWT writer v5 delegates older
write kinds to v4. Claimed-turn ownership, quote audit, eight-write budget,
idempotent retry, atomic readback and settlement fencing are reused; there is no
service-role domain write or new shared-app authority.

### Verification boundary and remaining work

`tests/multifloor.test.ts` checks exact geometry, unknowns, translations, strict
schemas, SVG escaping, and read-only inspection/budgets. `tests/multifloor-db.test.ts`
applies the migration chain to PGlite and checks RLS, raw-write denial, exact source
lineage, stale evidence/targets, refresh, archive/restore, scope revocation, retries
and the real tool loop against SQL using an injected provider response.
`scripts/multifloor-browser.mjs` extends the normal 320/390/1280 foundations gate:
chat create, receipt, floor tabs, height change, moved study area, unknown height,
old-version reload, source warnings/denial and actual SVG download. Results and
screenshot review belong on the exact PR/head, not an assertion from file presence.

These tests do not establish arbitrary narrative-to-coordinate interpretation,
hosted Auth/PostgREST behavior or live-model recommendations. Remaining scope:
actual stairs and their openings/landings, beams/roofs/headroom, door and circulation
geometry, general polygons, unselected alternative and as-built modes, construction
or safety approval, generated mockups and material purchasing. The next stair tool
can consume this datum and source envelope instead of inventing a separate floor
coordinate model.

## Stair geometry study — implementation branch (2026-09-19)

**Not merged or hosted-deployed.** Depends on the multi-floor study above (#86).
`20260919200621_stair_studies.sql` adds a subordinate Artifact recipe, never a new
physical building model. The parent multi-floor Artifact and its exact revision
supply all room coordinates, floor heights, names, measurement evidence and target.
No duplicate floor heights are accepted from the model in a stair command.

### Chat first, not a form

`inspect_stair_options` is a read-only tool for 1–4 candidates. It consumes one
fresh, caller-authorised exact-plan lookup. It returns the calculated first-riser
centre, upper terminal-riser centre, exit direction, upper landing rectangle,
intersected room footprints, rise/count/going, requested headroom checks and
explicit unknowns/conflicts. Unknown floor elevations, a nonascending pair or an
intermediate/unlocated floor prevent a calculation. User questions do not save
anything. Candidate labels are not rankings; Bob must explain a recommendation
using computed results and the user's goal, not infer unmodelled circulation.

`save_project_stair` saves/revises a Concept study on request. The Project/Area and
selected-target lineage are inherited server-side from the source plan. Bob
proposes reasonable reversible dimensions and states their basis. After readback,
the normal receipt opens that exact stair revision in Drawings. Lower and
upper floor views, a developed walking section, numeric results, source links,
zoom and SVG export all derive from the same versioned recipe. No manual stair
editor is introduced; the user's role is to describe/correct, not draw.

### Exact convention and supported shapes

`stair_study_v1` / `1` supports straight stairs and left/right **quarter turns with
a square level landing**. It does not substitute a square landing for rounded
winders, a curved start, a spiral or a U-shaped stair. Unsupported requested forms
need a separate generator and must be described honestly. Coordinates use the
parent's east/north/up datum. Start is the centre of the first riser, looking up.
The exit is the centre of the terminal riser at upper finished floor, not the
centre of the upper landing. That landing extends forward from the exit.

N equal rises span the exact floor-height difference. A straight flight has N−1
horizontal treads. With N1 rises to the turn landing and N2=N−N1 above it there
are (N1−1)+(N2−1) treads plus the turn landing. Overall rise is not rounded per
step; displayed decimal precision is not a construction tolerance. Stair widths,
goings and landing depths are integer millimetres; placements/opening bounds
retain the coordinate plan's 0.001 mm arithmetic. Treads, landings and source
room bounds are evaluated in the same axes, including rotations/reflections.
The developed walking section unfolds the turn and explicitly has independent
horizontal/vertical scales; it is not a structural building section.

### Headroom and footprint checks have explicit limits

Headroom is checked over **complete walking rectangles**, including approach,
turn landing and upper landing, not just sampled centre points. A partially
covered tread still checks the slab on its uncovered area. The only modelled
overhead surfaces are the parent's flat upper slab and an optional flat upper
ceiling with an explicit height. A proposed rectangular opening removes the slab
only inside that rectangle. The upper landing may not overlap the opening.
Unknown ceiling/slab/opening is unknown, not clear space.

`required_headroom_mm` is a saved, explicit study criterion, not an automatically
chosen legal rule. A calculated bounding rectangle for the walking surfaces that
need an opening is a **conservative geometric proposal**, not a minimal opening,
fabrication detail, material takeoff or permission to cut joists. Its envelope
and potential impact on the upper landing still need checking.

Results distinguish `conflict`, `incomplete` and `modelled_checks_only`.
**None means a safe or build-ready stair.** Room footprints are not walls or
verified circulation zones. Doors, beams, existing holes, roof slopes, chimney
clearances, services, railings, stringers, structure, fall/child safety, fire and
accessibility are not checked. The program must not say "the route is clear" or
"approved" from this limited result. A supplied numeric specification is also
not proof of a site measurement. Current Boverket guidance for actual projects
covers substantially more than this study, including landings, free height,
rails and protection; references checked 2026-09-19:
https://www.boverket.se/sv/PBL-kunskapsbanken/regler-om-byggande/sakerhet-anvandning/trappor-ramper/
No regulatory approval or universal regulation preset is added here.

### History, authority and verification boundary

Changing a stair does not change the parent plan or accepted Building state.
Changing the parent plan, its target or physical/measurement inputs marks the
stair's source changed. Normal edits require the current unchanged parent.
`refresh_source` explicitly adopts a newer revision of the SAME parent without
changing any stair parameter. The calculated rise/headroom/room context may still
change because the parent changed; Bob must inspect and explain that result.
Earlier stair versions continue using their exact earlier parent versions.
Archive/restore carries source references and recipe unchanged.

Raw writes are denied, RLS requires both project membership and whole-Building
physical scope, and detail views are security-invoker. A revoked source removes
geometry access while retaining the nongeometric artifact marker. Canonical
Artifact concurrency and physical/measurement locks protect saves. The same
claimed-turn receipt ledger, retry keys, write budget and generation-fenced
settlement are reused by `bob_project_write_v6`; old RPCs remain available.
Research v7 lists a marker and returns the source recipe only for exact lookup.

`tests/stair-study.test.ts` exercises rises, exit positions, all four headings,
reflection, decimal translation, whole-tread headroom and opening/landing
conflicts, unknown inputs, schema/escaping and read-only research. The migrated
`tests/stair-study-db.test.ts` verifies canonical source binding, permissions,
rollback, stale revisions, history, explicit source adoption and the actual
inspect/save tool loop against SQL with an injected provider response.
`scripts/stair-study-browser.mjs` extends the ordinary 320/390/1280 foundations
journey with read-only comparison, chat-save, exact links, source-preserving move,
headroom conflict, unknown ceiling, historic reload, SVG and denied sources.

These tests are not an arbitrary free-text understanding test, hosted
Auth/PostgREST test or a real-model recommendation evaluation. Record actual CI
and screenshot results in the PR; script presence is not passing evidence. Merge,
additive migration application and Edge/frontend deployment are separate release
actions. Apply only the new migration after its prerequisites, never replay the
shared database history. Production/user house data is not changed by this branch.

## Verification contract

A 4A release requires proof that:

- anonymous/outsider reads and all raw writes are denied;
- project members can read and use the guarded command only in their project;
- foreign areas, images, measurements and target lineage cannot be attached;
- stale artifact revisions and stale target decisions fail atomically;
- exact measurement and target lineage remain pinned after later edits;
- image deletion and area deletion retain honest history;
- project deletion cascades the new records;
- production UI works at 320/390/1280 px with create/revise/history/archive/restore/reload and project-switch isolation;
- deployed Auth/PostgREST/Storage behavior is checked separately from browser HTTP fixtures.

A 4B1 CI/browser gate additionally requires:

- a generated recipe cannot reference another project's measurements or an unscoped/denied physical target;
- exact Space and measurement revisions remain pinned after later edits;
- `unknown` inputs fail generation, while estimated inputs remain visibly Concept-only;
- invalid opening geometry fails deterministically;
- the same persisted recipe renders the same normalized geometry after reload;
- regenerating after an input change creates a new Artifact revision and leaves the older geometry reproducible;
- project/building switching cannot leak another structure's generation inputs;
- the generator/preview flow fits 320/390/1280 px and important touch targets remain usable.

Deployed 4A and 4B1 evidence is recorded in [`Docs/foundation-verification.md`](foundation-verification.md), including hosted migrations, browser proof and ordinary Auth/PostgREST live verification. The downstream 4B2b net-wall-area release is recorded there separately and owned behaviorally by [`Docs/material-planning.md`](material-planning.md).
# Project-home drawings and work links — September 24, 2026

Saved, non-archived drawings appear on Project home below the Plan, with a stable **Drawings** entrance in the Project header. The three most recently updated drawings show their title, saved version, fidelity and related work Steps; **All drawings** opens the complete existing archive. CAD previews use one saved SVG view, storage-box previews reuse the deterministic renderer, and image-backed artifacts reuse authorised media. Other artifact kinds open their existing full viewer. A preview is not a new artifact or evidence of measured fit. Loading or preview failure leaves the saved drawing link available.

`artifact_step_links` is the current work relationship for **all** artifact kinds. A drawing can support several Steps without duplicate geometry. `current_drawing_steps` and `current_drawing_overview` are caller/RLS-bound projections of the same links and current, non-archived revisions. Project-home queries do not download CAD recipes or STEP export bytes. The card query returns at most four cards with their one preview SVG/recipe in the same read, so the source check runs once instead of once per card (2026-10-21); only source-image previews are fetched separately, when visible. Links open an exact revision. Existing CAD `step_id` is retained as revision provenance; current CAD links are backfilled and new scoped CAD saves populate the work relationship. Archive/restore copies do not resurrect a deliberately removed work link.

Bob uses `link_project_drawing` to add/remove a work link without re-rendering. It goes through the normal named-member, claimed-turn, current-request quote, revision check and receipt path (`bob_project_write_v11`). Existing links are readable through `read_project_record_section`, dataset `drawing`, Artifact UUID and exact current revision. Steps describe the work; Planning is a phase, so a drawing remains attached when work moves into Build. A project-wide drawing can remain unlinked while still appearing on Project home. Removing a Step from the current plan hides its live link without deleting the drawing/history.

## Drawing access, reader and return

Project and Area headers expose Drawings without opening planning menus. The
Reference workspace keeps its four reference destinations visible and preserves
the Area query. Plan Steps show their named drawings before the Task list. Normal
Tasks consume the same authorized Step workspace projection to show current
primary-Step drawings near the Task header; they do not depend on a saved Bob
request. A failed workspace read is a visible retry state, never an empty-link claim.
The existing volunteer reader and its narrower capabilities remain unchanged.

**Open drawing** consistently opens the exact saved revision. The first reader
shows geometry or the attached authorized image directly, with status, assumptions
and relevant source/target/measurement warnings. No second dialog is required for
the drawing image. **Details** holds description, author/date/reason, target lineage,
generator inputs and pinned measurements. **History** lives inside this reader;
choosing a version updates its exact URL and returns to the drawing view. Creation
tools and record management remain secondary in the library; the expandable drawing
target follows the list, and opens when no target is selected.

Contextual drawing links retain the originating Project/Step/Task, expanded named
sections and scroll position. Close and browser Back return to that originating
entry after its content loads; revision changes within the reader do not add a
second return journey. Reload keeps the origin in the browser history state.
Library scope, archive selection and pagination live in its URL so returning after
a reader reload preserves that selection. External/direct links without origin
state close to the scoped drawing library.
The return pointer is validated against the active Project and never grants data
access. Lazy previews and on-demand 3D remain unchanged; Task drawing access adds
the existing lightweight drawing-link projection, not full drawing downloads.

Browser verification belongs to `check-foundations-browser.mjs`,
`artifacts-browser.mjs` and `storage-box-browser.mjs`, including a 10-Step/60-Task
project, direct Task drawing access, image-first reading, history, stale evidence,
reload and return. CI/release evidence remains separate from ordinary-user acceptance.

Verification: `tests/project-drawing-workspace.test.ts` checks actual SQL/RLS, Bob tool discovery/writes/readback, retries, multiple Steps, archive/restore, unchanged geometry and cross-project denial. The foundations browser flow covers phone/desktop previews, exact-version opening, Step navigation, reload and preview failure. These controlled tests do not claim that an unconstrained live model has created the owner's bunk-bed drawing. Production release evidence belongs in the implementing PR.


## Source freshness corrections — September 24, deployed

`artifact_source_status` assesses each exact revision under the caller's RLS.
It compares the effective Project/Area target, linked measurement revisions and
archive state, physical sources/proposals and source drawing revisions. CAD
details also follow their pinned source chain and its measurements, so a parent
does not appear current merely because its geometry was not re-saved. An
unreadable source or a chain beyond the bounded depth is unavailable. Physical
sources that are no longer accessible produce `unavailable`, not an unchanged
result. `current_drawing_overview`, `current_drawing_steps` and the detail reader
consume this same assessment. Bob’s `read_project_record_section` drawing
metadata also includes `source_state` and `source_reasons`. Preview data is withheld when sources are
unavailable. Saved classifications and history are never rewritten: a recorded
**Build ready** version whose sources changed shows a review warning. A
`current` source assessment is not proof that all required inputs were recorded.

**Stored answers (applied 2026-10-23).** Reading this view no
longer runs the assessment when nothing has changed. Every write to an input
bumps a per-project change counter; a background drain stores the live answer
for every revision of a changed project. A stored row is used only while the
counter still matches, otherwise that row is assessed live as before, so the
answer never differs from the live check, only its cost. Projects whose answer
can depend on a member's own access are never stored and stay live: any
physical-model reference (building, space, element, multifloor, stair, room,
generation or space-measurement pin) or a pin to another project's private
catalog item. Write and render guards still call the live assessment directly.
[Database owner](../db/README.md#stored-source-status--2026-10-22).

Intentional CAD revisions can reattach a previously unlinked Step. The guarded
save writes the relationship and reads back `step_ids` into the durable receipt;
archive/restore do not recreate links. Area drawing links carry their scope into
the exact-version viewer. Regression coverage is in
`tests/review-workflow.test.ts`, the drawing workspace and physical-source tests,
and the foundations browser's navigation/reload/changed/unavailable cases.
These corrections are deployed; [release evidence](foundation-verification.md#september-24-work-and-drawing-release) distinguishes hosted checks from browser fixtures and real-user acceptance.


## Volunteer task drawings — September 24, deployed

The name-only participant Task panel now contains **Drawings for this task**.
It lists only the current, non-archived drawings linked to the Task's current primary
Step. Opening a drawing rechecks that relationship and its exact current revision.
A moved Task, removed link/Step, archived/replaced drawing, expired invitation or
revoked session denies the next read. Refresh discards the previous render before
loading; a failed request never retains geometry from an earlier successful response.

The reader reuses the saved CAD SVG, storage-box, generated-wall, linked-room,
coordinate-plan and stair renderers and the image byte proxy. It shows the recorded
Concept/Measured/Build ready label, description, assumptions and independent source
status. Changed sources keep the saved geometry with a review warning; unavailable
sources hide every render payload. Viewing does not approve fit or construction.
Participant variants stay within the Task instead of linking to authenticated editors
or offering Bob commands. Pinned furniture/source-plan inputs inside a linked drawing
are part of its bounded render; they do not grant browsing of those source records.
CAD manifests/STEP export files and unrelated physical records are excluded.

The authority and release order belong to
[Data/auth](../db/README.md#area-archive-and-volunteer-drawing-reader--september-24-deployed).
Regression coverage: `tests/volunteer-drawings.test.ts` (real migrated PostgreSQL,
current ownership/version, source loss, physical unlink, pagination and denial),
`tests/volunteer-media.test.ts` (exact-revision byte checks), and
`scripts/check-volunteer-browser.mjs` (rendered CAD/parametric/image content, refresh,
reload, changed/unavailable sources and revoked access on phone/desktop). These test
participants provide technical proof, not acceptance by actual volunteers.


## Parameter sources, changes and request complements — P3 deployed

`CadSourceMap` in the existing CAD viewer renders validated saved parameter metadata through `readCadSourceMap`. A complete graph distinguishes measured sources, provided specifications, estimates, design choices, calculations and unknowns; it shows source revisions, affected recipe paths, derivation operands/rounding and recorded coordinate frames. Parameters, recipe paths, truth classes and sources are named through `src/lib/labels.ts`; the screen shows record kinds and saved revisions, never UUIDs or version hashes. Legacy bindings remain partial and bare recipe values remain unknown. Invalid or inaccessible metadata is unavailable, never reconstructed as evidence. Graph coverage does not approve construction or physical fit.

`artifact_source_changes(project, artifact, revision)` complements the existing caller-authorized freshness assessment with at most 200 source deltas. It compares saved/current measurement, Space, source drawing and target revisions, plus image version hashes, and identifies dependent parameter ids where recorded. Revoked physical/image identities are withheld. Truncation, malformed deltas or failed reads produce a visible incomplete/unavailable notice; missing deltas do not make an old drawing current. The exact saved values remain unchanged. Database authority and deployment order belong in [db/README.md](../db/README.md#p3-screen-context-and-source-changes--applied).

Drawing cards show source freshness independently of saved Concept/Measured/Build ready status. Exact-version details state both the revision being viewed and a newer saved head when one exists. Solution cards retain the selected target's exact revision when a newer alternative is saved. Existing Project-home, Step, Task and Plans & drawings surfaces remain the result entry points; opening a saved revision does not select or approve it.

Drawing request cards show shared Task/current Plan requirement names, responsibility and destination Step, with relevant measurement/Task/Step links, waiting/reconnect/budget states and the exact saved drawing link. Shared labels come only from canonical project records, never private conversation briefs or assessments. A missing canonical label is reported rather than replaced with private prose. Ask Bob actions reuse the current project's drawer and surface focus. See [the context owner](ask-bob-context.md#implemented-scope-and-remaining-target) for that boundary and [State](bob-delivery-flow.md#state) for remaining acceptance gates and [verification](foundation-verification.md#p3-hosted-technical-release--2026-09-30) for release proof.

## K2 — construction concept checks

`check_construction_draft` reads one exact saved K1 Artifact revision and its exact catalog revisions through the caller's existing readers. It rechecks the current head, source freshness and project access before returning a result. No model-supplied geometry or catalog record can replace these reads. The report is transient, revision-bound evidence; it does not mutate the checkpoint or grant publication authority.

Checker `orthogonal-butt-v1` supports uncut wooden boxes with rotations that are exact multiples of 90 degrees, and planar `screwed_butt` / `glued_butt` concepts. It reuses CAD's intrinsic XYZ axes, checks declared local face normals, positive contact area, volume collisions, every touching pair's joint, connectivity, exact material thickness/cross-section and dimensioned panel pins. Physical joint cycles are valid. Unsupported geometry/methods, changed sources and missing knowledge stop concept readiness. Precision tolerance is 0.000001 mm, not a fabrication allowance. At most 32 distinct catalog revisions are read; reports cap issue lists while preserving full counts.

`concept_ready` means consistency within these supported checks. Bob must still compare reported bounds and counts against the original requirements. `fabrication_ready` is always false: manufacturer/product applicability, fastener layout/quantity, capacity, stability/tip resistance, grain, stock nesting and manufacturing remain explicit gaps. Declared catalog values and general reference packages never become verified product evidence. Missing arbitrary joints between non-touching parts cannot be inferred; supported fixed assemblies require a connected valid joint graph.

Bob chooses parts and relationships using the existing model/tool loop, saves a checkpoint, checks it and revises the same identities when necessary. No new specialist model or budget change is introduced. The tool guide prevents recreating a checked checkpoint as unrelated CAD; exact annotated rendering/publication belongs to K3. K2's actual model and product-evidence acceptance remains open in [State](bob-delivery-flow.md#state); technical verification belongs to [foundation verification](foundation-verification.md#k2-construction-checks).

## K3 — exact construction drawing lineage

`design_project_cad` must consume one exact current K1/K2 construction Artifact revision for every project drawing and render its exact recipe and parameter graph into a separate Concept drawing. Construction geometry, typed joints and pinned material revisions remain owned by `artifact_construction_revisions`; drawing metadata contains only an exact `bob_construction` source pin and revision-bound check report. It does not create a second editable construction. The existing reviewer approves a candidate before saving; the existing claimed-turn/drawing-request receipt, work link and caller readback prove delivery afterward.

New CAD rows require a construction pin even through older write wrappers or direct privileged inserts. Historical packets are not backfilled or rewritten. Exact archive/restore copies still work; other revisions of an unbound legacy drawing require the explicit legacy transition. Queued pieces each carry and recheck their own source ID/revision.

SQL publication guards reject stale/archived construction, changed catalog/measurement inputs, altered geometry/parameters, different target/Area, absent check evidence or incomplete annotations. A saved drawing's source assessment includes the construction head and its original sources. Historical drawing packets survive later source revisions unchanged. The caller CAD reader exposes safe annotation/source-pin metadata without export bytes; the existing drawing viewer still reads saved SVG/STEP through the canonical data layer. [CAD adapter](cad-adapter.md#k3-checked-construction-drawings--2026-10-04) owns annotation limits and routing; [verification](foundation-verification.md#k3-checked-construction-drawings--2026-10-04) owns actual release/acceptance.

### K4 concept lists from construction checkpoints

`derive_construction_lists` consumes the exact current checked K2 revision and creates no geometry or Artifact mutation. Its BOM counts each explicitly classified manufacturing instance once; local blank dimensions come from the already compiled parameter graph. Delbeteckningar retain the same instance-order P-numbering as K3 annotations. Joints keep their saved IDs/methods/endpoints. A separate explicit assembly dependency graph is validated and ordered as a concept proposal, never inferred from the cyclic physical joint graph or promoted to verified access/strength.

Saved blank needs pin this same Artifact/revision through the existing material requirement contract; see [K4 material owner](material-planning.md#k4-construction-blank-needs--2026-10-05). Reading derived lists alone is not a saved delivery. Raw-stock cutting and product/assembly checks remain gaps.
