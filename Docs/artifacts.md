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