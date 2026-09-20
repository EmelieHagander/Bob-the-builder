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

Dashboard and Area link to **Plans & drawings**. A connected user can:

1. choose a project target in **Solutions & target**;
2. open **Plans & drawings**;
3. create a plan/elevation/section/detail for the project or current area;
4. record title, explanation, assumptions and concept/measured/build-ready status;
5. choose/upload an authorised project image;
6. link exact measurement versions;
7. save and reload the same drawing;
8. revise it later without erasing the old version;
9. see when its target or linked measurements have since changed;
10. archive/restore while keeping history.

If there is no selected target, creation is blocked with a route back to **Solutions & target**. Demo mode may render the surface but does not pretend to persist it.

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

`Plans & drawings` remains the owning surface. Add a secondary **Generate wall elevation** path rather than new global navigation.

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

`Plans & drawings → Draw storage box` uses the selected target for the current
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

A verified chat receipt opens the exact saved revision in **Plans & drawings**.
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

The existing receipt opens its exact revision in **Plans & drawings**. The viewer
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
the normal receipt opens that exact stair revision in Plans & drawings. Lower and
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