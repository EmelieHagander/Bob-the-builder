# Persistent building model

> **Status:** manual Slice 2C implemented, deployed and live-verified on 2026-09-13; broader geometry/import/AI extensions remain planned  
> **Owns:** bob's persistent physical-place model across projects: sites, buildings, levels, spaces, building elements, spatial relationships, project scope, uncertainty and physical-state history  
> **Release order:** `Docs/v1-plan.md` owns sequencing and release gates  
> **Implementation truth:** runtime/schema now persist Site → Building → optional Level → Space, BuildingElements, spatial relationships, Project/Area physical scope, accepted/proposed history and exact measurement snapshots. Later geometry/import/AI work must extend this shipped foundation rather than create a parallel physical model. Release evidence lives in `Docs/foundation-verification.md`.

## Why this exists

Bob currently remembers a build primarily through a **Project**. That works for organising one job, but a home, garage, workshop or other physical place outlives any individual project.

A homeowner may measure one room while building a bunk bed, later measure the neighbouring office, later renovate the kitchen, and eventually import a complete floor plan. Each piece of trustworthy information should improve one shared model of the place rather than being trapped inside whichever project happened to collect it.

The product therefore needs two different long-lived concepts:

- **Project** — what people are trying to change or build, with tasks, areas, materials, decisions and build activity.
- **Physical model** — the place the work happens in: buildings, spaces, elements, relationships, observations and history.

Projects may use and change the physical model, but they do not own its lifetime.

This is deliberately **not a CAD/BIM promise**. Bob needs a progressively useful spatial model that can support drawings, mockups, measurements, planning and future reasoning without requiring a complete professional building model first.

---

# 1. Product principles

## 1.1 The physical model is allowed to be incomplete

A valid building model may be:

- only a building name;
- one measured room in an otherwise unknown house;
- several spaces with only adjacency relationships;
- a complete imported plan with room geometry but little knowledge about services;
- a highly detailed model with walls, openings, beams, radiators, outlets, pipes and other known elements.

Bob must never require the user to model the whole house before one useful room or project can be used.

**Progressive fidelity is a core contract.** More evidence can make the model more complete or precise over time without invalidating the earlier partial model.

## 1.2 Project organisation is not the same thing as physical space

The existing `Area` concept remains a **project work-zone container**. It is useful for organising tasks, crew, media and progress inside one project.

A `Space` in the building model is persistent physical context such as a bedroom, kitchen, hall, attic, porch or technical room. A Space can outlive many projects.

They may be linked, but they are not the same record:

- a project Area may map to one Space;
- a project Area may cover several Spaces or Elements;
- several Areas in different projects may refer to the same Space over time;
- an Area can exist for work that is not naturally one room, such as roof work, drainage or a temporary staging zone.

Do not migrate the meaning of `Area` into `Space` by stealth.

## 1.3 Unknown stays unknown

The physical model must preserve bob's existing truth contract.

A wall being shared with a room that contains an electrical outlet may make wiring in that wall **plausible**. It does not make that wiring verified fact.

Use the existing V1 truth vocabulary wherever possible:

- `measured` — user-recorded measurement evidence;
- `provided_spec` — supplied drawing/specification or other explicit source;
- `estimated` — useful estimate with visible uncertainty;
- `ai_assessment` — Bob's interpretation or inference;
- `unknown` — not established.

A derived or AI-inferred relationship may guide a question, caution or proposal. It must not silently upgrade itself to measured/provided truth.

## 1.4 Relations are first-class knowledge

Containment alone is not enough. Bob needs to know relationships such as:

- one Space is adjacent to another;
- two Spaces share a boundary/wall;
- one Space is above or below another;
- a door/opening connects two Spaces;
- an Element belongs to or crosses a boundary;
- an outdoor Space/area connects to a Building;
- a new extension is attached to an existing Building.

These relations may be known precisely, approximately, inferred or unknown.

## 1.5 Change is modeled, not erased

A renovation must not destroy the explanation of how the building used to be.

Bob must distinguish at least:

- **current / as-is** — the best known current physical state;
- **proposed** — a project's intended change;
- **as-built / accepted current** — what was confirmed to have actually happened;
- **historical** — superseded physical state retained for traceability.

A project proposal does not become the building's current state merely because a drawing or mockup exists. Human confirmation or later as-built evidence is required at the product boundary.

---

# 2. Conceptual model

Exact table names, RLS and command shapes belong to the implementation contract when the milestone is built. The product model is:

```text
Site (optional persistent place)
├── Building
│   ├── Level (optional grouping)
│   │   ├── Space
│   │   │   └── BuildingElement
│   │   └── Space
│   └── Space may exist even when Level is not yet known/modelled
└── outdoor/site context may exist without a Building

SpatialRelationship
Observation / evidence / measurement
Physical-state revision / change history

Project
└── ProjectScope → Site / Building / Space / BuildingElement

Area (project work zone)
└── optional mapping → one or more physical targets
```

## 2.1 Site

A `Site` is an optional persistent place that can contain more than one Building and site-level context.

Examples:

- Home;
- community-build property;
- farmyard;
- school grounds.

A Site is useful when a user has a house, garage and separate workshop on the same property, or when a new building project begins on open ground.

Bob must not require a Site for every project. A standalone project/building remains valid.

## 2.2 Building

A `Building` is an independently meaningful structure whose knowledge can survive many projects.

Minimum useful record:

- stable identity;
- human name;
- optional Site association;
- enough history to preserve major changes.

Examples: Main house, Garage, Workshop, Shed.

A Building may be created before any Space is known.

## 2.3 Level

A `Level` groups Spaces when floors/storeys are known and useful.

Examples: Ground floor, First floor, Basement, Attic level.

Level is not a prerequisite for creating the first Space. Progressive capture must not force the user to answer structure questions they do not yet need.

## 2.4 Space

A `Space` is persistent physical volume/context inside or directly attached to a Building.

Examples:

- kitchen;
- children's bedroom;
- office;
- hall;
- bathroom;
- attic;
- porch/veranda;
- technical room.

A Space may have geometry ranging from almost none to a measured outline. It may also have explicit relationships to other Spaces even before full coordinates exist.

## 2.5 BuildingElement

A `BuildingElement` represents a physical part or installation whose identity/location matters to later work.

Examples include:

- wall / shared wall;
- floor/ceiling boundary;
- beam / column;
- door / opening;
- window;
- radiator;
- outlet / switch / light;
- visible cable route;
- water pipe / drain;
- ventilation point;
- fixed component.

The first implementation does not need a giant taxonomy. A small extensible type vocabulary plus description/provenance is preferable to dozens of required fields.

Existing `ExistingComponent` records remain valid project evidence. Later integration may link or promote suitable records into persistent BuildingElements; this document does not claim that migration exists today.

## 2.6 SpatialRelationship

A `SpatialRelationship` records topology that is useful even without complete drawing coordinates.

Likely relationship families include:

- `adjacent_to`;
- `shares_boundary_with`;
- `connects_to`;
- `above` / `below`;
- `inside` / `outside_of`;
- `attached_to`.

A relationship carries provenance/truth state when it is not self-evident from verified geometry.

## 2.7 ProjectScope

A Project may optionally point at physical context.

It may scope to:

- a whole Site;
- one Building;
- several Spaces in one Building;
- specific BuildingElements;
- site context where a new Building does not exist yet.

A project must also remain valid with **no building association** when physical-place context is irrelevant or not yet created.

A project that creates a new structure may begin at Site scope and produce a new Building as part of its accepted/as-built outcome.

---

# 3. Geometry and drawings

The building model must support useful geometry without making complete geometry mandatory.

Possible fidelity levels include:

1. identity only — `Children's room` exists;
2. rough dimensions — length/width/height or selected measurements;
3. relationships — `Office shares west wall with Children's room`;
4. measured outline — enough geometry for a plan view;
5. elements positioned on/within geometry — windows, doors, radiators, outlets, beams, services where known;
6. richer geometry sufficient for deterministic project artifacts.

The exact internal geometry representation is an implementation decision. The product requirement is that Bob can improve the model monotonically from sparse evidence toward measured geometry.

A floor plan, sketch or photograph may be used as source evidence. Parsed geometry remains subject to provenance and review; image recognition does not create survey-grade truth.

---

# 4. Building knowledge and inference

Bob should be able to use known neighbouring context to ask better questions.

Example:

- Children's room and Office are recorded as sharing a wall.
- A verified outlet exists on the children's-room face of that wall.
- Office-side electrical routing is unknown.

Bob may surface:

> Possible electrical services in the shared wall — verify before drilling or opening it.

Bob must not surface:

> Electrical cable runs here.

The same rule applies to plumbing, structure, ventilation and other hidden conditions.

Inference is useful because it turns accumulated house knowledge into better planning; provenance is what keeps that usefulness safe.

---

# 5. Importing an existing drawing

A user may start from an existing house drawing instead of building the model room by room.

Supported product flow:

1. upload or photograph the drawing;
2. identify it as source/reference for a Building or Level;
3. Bob proposes detected Spaces, boundaries/openings, labels and dimensions that are actually legible;
4. Bob leaves ambiguous elements as questions/unknowns rather than inventing them;
5. the user can confirm/edit the proposal;
6. accepted structure becomes persistent building context;
7. later projects can scope to one or more of those Spaces/Elements.

Useful sources may include:

- a photograph of an old plan;
- PDF plan;
- estate-agent floor plan;
- hand sketch;
- future deterministic/CAD import.

**Important:** proposed extraction from an image is an AI assessment until confirmed. A printed dimension that Bob can read may retain the source drawing as provenance; geometry inferred only from pixels must not be labelled measured.

---

# 6. Project changes and physical-state history

Projects should describe deltas against the physical model rather than destructively editing current reality during planning.

Example: remove the wall between kitchen and living room.

Current state:

```text
Kitchen ┃ Wall A ┃ Living room
```

Project proposal:

```text
- retire/remove Wall A
- change opening/boundary geometry
- possibly create one combined Space
- add/alter beam, electrical or heating elements as required
```

Until accepted/as-built, the old current model remains current.

When the project is confirmed complete:

- accepted physical changes create the next current building state;
- prior state remains historical;
- old photos, measurements, drawings and project records retain their original target identities/revisions;
- newly created/retired Spaces and Elements remain traceable.

This is especially important when:

- two rooms become one;
- one room is split into two;
- an extension adds new volume;
- a porch becomes enclosed/internal space;
- a wall/opening/window/door moves;
- hidden services are discovered during work.

---

# 7. Four acceptance fixtures

These fixtures are the product tests for whether the abstraction is correct. The implementation may arrive in stages, but the model must not need special-case redesign to support them.

## Fixture A — whole house from an existing drawing (top-down)

**Given** the user has a drawing of the full house  
**When** they photograph/upload it and ask Bob to model the house  
**Then** Bob can propose the Building/Level/Spaces and the geometry/elements it can support from the evidence, ask about ambiguities, and let the user correct or add details.

The whole house may exist as Building 1 before any renovation Project is created. Later projects can scope to one or several Spaces without recreating the house.

**Key proof:** physical context exists independently of a project.

## Fixture B — one room first, house grows bottom-up

**Given** the user is building a bunk bed in the children's room  
**When** they measure only that room  
**Then** a valid Building can contain that single Space while the rest of the house remains unknown/unmodelled.

Later, when the Office is added as sharing a wall with the children's room, Bob can use known neighbouring evidence to surface questions or possible hidden conditions (for example electrical/plumbing risk) while keeping them explicitly unverified.

**Key proof:** incomplete models are first-class, relations work without a complete plan, and inference never becomes fact.

## Fixture C — different building on the same site

**Given** the user starts a project in a separate Building on the yard/site  
**When** that Project is scoped to the second Building  
**Then** knowledge from the main house is not treated as relevant physical truth unless explicitly linked.

Shared Site context may still exist, but Building-specific Spaces/Elements/services remain isolated.

**Key proof:** physical context has correct boundaries and does not bleed between structures.

## Fixture D — major remodel / extension

**Given** Spaces already exist in the Building  
**When** a project removes a wall, combines/splits Spaces, or adds an extension/veranda  
**Then** Bob can model the proposed change against the current state, reason about neighbouring affected Spaces/Elements, and later accept the as-built result without erasing the previous state.

**Key proof:** the model supports evolution and identity/history, not only a static floor plan.

---

# 8. V1 narrow boundary

The V1 implementation should prove the architecture without turning Bob into BIM software.

A narrow useful foundation is enough if it can:

- create a Building manually;
- create one or more Spaces with optional Level;
- record basic Space dimensions through existing provenance-aware measurement seams;
- add a small set of BuildingElements;
- record explicit spatial relationships;
- scope a Project and optionally its Areas to physical targets;
- retain unknown/inferred states honestly;
- preserve current vs proposed vs accepted/as-built change history;
- support the four fixtures at the agreed V1 fidelity.

Image/floor-plan ingestion should build on the same model and produce **proposals for confirmation**, not a parallel AI-only representation.

V1 still does not promise:

- arbitrary professional CAD/BIM authoring;
- survey-grade geometry from photographs;
- automatic discovery of hidden wiring/plumbing/structure;
- structural certification;
- complete automatic propagation of every physical change into every downstream artifact.

---

# 9. Integration with existing bob contracts

## Areas and tasks

`Area` remains the project work-zone container. Future implementation adds optional mapping to persistent physical targets rather than replacing Area.

## Measurements and existing components

`Docs/project-facts.md` currently owns implemented project/optional-area facts. The building-model milestone should reuse its provenance/history discipline and eventually allow relevant facts to target Space/BuildingElement identities without rewriting existing verified history.

## Media

`Docs/media-and-steps.md` remains the media/storage owner. Building plans/photos should reuse authorised MediaAssets and gain physical-model associations rather than another file system.

## Solutions and artifacts

`Docs/solutions.md` and `Docs/artifacts.md` remain the selected-target and drawing lineage owners. Building context supplies persistent physical targets and geometry; a project solution/artifact remains a project decision/output with exact lineage.

## Ask bob

Ask bob may reason over authorised physical context only when the backend lookup/authority contract is extended deliberately. Building inference must preserve `unknown` / `ai_assessment` boundaries and source disclosure.

## UI

This contract does not require a new top-level navigation item. Initial building-context surfaces may be reached from project/building context and existing facts/drawing flows. A dedicated Building view can be introduced when the interaction genuinely needs one and should then be reviewed under Vera's UI contract.

---

# 10. Implementation discipline

When this moves from specified to built:

1. write the narrow data/authority contract first;
2. preserve existing project/Area runtime behavior;
3. add persistent physical identity without migrating historical facts destructively;
4. expose all UI access through `src/data/database.ts` or an explicitly documented successor seam;
5. establish manual create/read/update/history before AI import/consumption;
6. extend project lookup only after project/building authorization boundaries are explicit;
7. verify cross-building and cross-project isolation at the backend boundary;
8. test all four acceptance fixtures;
9. update `Docs/function-inventory.md` only when runtime support actually changes.

The first implementation must optimise for **a model that can grow**, not for pretending the model is already complete.

---

# 11. Slice 2C implementation contract

This section owns the first runtime contract for the manual building-context foundation. The product concepts above remain broader than this first schema; later geometry/import/AI work must extend these records rather than introduce a parallel representation.

## 11.1 Authority boundary

Persistent physical context cannot depend on `project_id`, because a Site/Building may exist before any Project. The first implementation therefore gives Site and Building their own membership boundary:

- creating a Site gives the caller a direct Site membership;
- creating a Building requires direct access to its Site when one is supplied and gives the caller direct Building membership;
- a standalone Building remains valid without a Site;
- direct Building members may edit accepted/current physical truth;
- a Project may scope itself to a Site/Building/Space/Element only when the caller has both project access and the required physical access;
- members of a scoped Project may read that Building context and may create Project-tied proposals, but Project membership alone does not grant unrestricted write authority over the persistent accepted Building;
- accepting a proposal into persistent current/as-built truth requires direct Building membership;
- access to one Building never implies access to another Building merely because both share a Site;
- raw client writes to revision/history/membership/scope tables are denied; guarded commands own mutation and server actor/time.

This keeps Fixture C's isolation meaningful while still allowing a project crew to use the context the project explicitly targets.

## 11.2 First persisted objects

The additive 2C schema uses these identities and append-only histories:

- `sites` + `site_revisions` + `site_members`;
- `buildings` + `building_revisions` + `building_members`;
- `building_levels` + `level_revisions`;
- `building_spaces` + `space_revisions`;
- `building_elements` + `element_revisions`;
- `spatial_relationships` + `relationship_revisions`;
- `project_physical_scope` for explicit Project targets;
- `area_physical_targets` for optional work-zone → physical-target mapping;
- `space_measurements` for exact snapshots of existing provenance-aware measurement revisions used by a Space revision.

`Area` remains unchanged. Existing `Measurement`/`ExistingComponent` history is not migrated or rewritten.

## 11.3 Accepted state versus proposals

`Building`, Site and Level metadata are ordinary revisioned accepted records. Spaces, Elements and Relationships need an additional boundary so Project planning cannot silently replace current reality.

Their identity rows keep two revision pointers:

- **latest revision** — the newest recorded accepted or proposed state;
- **accepted revision** — the state currently treated as physical/as-is truth; nullable for a brand-new proposed object that does not exist physically yet.

Manual capture of known current reality appends an accepted revision and advances both pointers. A Project proposal appends a proposed revision and advances only `latest_revision`; current read views continue to resolve `accepted_revision`. Explicit acceptance appends a new accepted/as-built revision from the proposal and advances both pointers. Earlier accepted and proposed revisions remain readable.

Archive/remove follows the same rule: proposing removal must not make the accepted object disappear until that proposal is accepted.

## 11.4 Truth, source and measurements

Space/Element/Relationship revisions reuse the existing truth vocabulary: `measured`, `provided_spec`, `estimated`, `ai_assessment`, `unknown`. Non-unknown claims require a visible source note; AI/import proposals remain `ai_assessment` until a person deliberately records/accepts stronger evidence.

Space dimensions continue to use the existing `Measurement` seam rather than a second free-form numeric system. When a Space revision links dimensions, the command validates the caller can access the exact project measurement revision and stores an immutable snapshot in `space_measurements`: measurement id + exact revision + subject/value/unit/truth/source + source project. Later measurement edits do not rewrite the older Space revision.

A later Project can therefore target the same stable Space identity while the provenance of the earlier dimension remains explainable.

## 11.5 Narrow topology and elements

The first runtime relationship vocabulary is deliberately small: `adjacent_to`, `shares_boundary_with`, `connects_to`, `above`, `below`, `attached_to`. Slice 2C initially records topology between Spaces; BuildingElements carry a stable Building identity and optional Space location. This is enough to prove the children's-room/office shared-wall case without pretending the first migration is a general graph/BIM engine.

Initial Element kinds are open text constrained to a short label rather than a giant enum. UI suggestions may include wall, opening, window, door, beam, column, radiator, outlet, switch, pipe, drain, ventilation and fixed component.

## 11.6 Project/Area scope

A Project can have zero or more explicit physical targets. A target row points to exactly one Site, Building, Space or Element. Space/Element targets always retain their owning Building in the row so project/building isolation can be checked without inference.

An Area can optionally map to one or more of the Project's physical Building/Space/Element targets. Removing an Area removes only that mapping; it never deletes persistent physical context. Removing a Project removes its scopes/proposals, not the Building/Spaces themselves.

## 11.7 First UI surface

2C gets a focused **Building context** page reachable from existing project/Area surfaces, not a new top-level navigation family. It must let a connected user:

1. create/select an accessible Site/Building;
2. link the current Project to that physical context;
3. add an optional Level and one or more Spaces without modelling the rest of the house;
4. link exact existing measurements to a Space revision;
5. add a small BuildingElement and a Space↔Space relationship with visible truth/source state;
6. map a project Area to a physical target;
7. record a Project proposal for a Space/Element/relationship and see that current/as-is remains unchanged;
8. explicitly accept a proposal when authorised and inspect retained history.

Demo mode may render an honest not-persisted state; it must not pretend the building model was saved.

## 11.8 2C verification gate

Before 2C may be called deployed, prove in SQL/RLS/data-boundary/browser/live checks:

- Fixture A architecture: a Site/Building/Level/Spaces can exist before a renovation Project and can later be scoped by one;
- Fixture B: one Space is valid alone, a later neighbouring Space and `shares_boundary_with` relation work without a complete plan, and `ai_assessment` remains visibly non-factual;
- Fixture C: separate Buildings on one Site do not leak Spaces/Elements/relations across project or backend reads;
- Fixture D: proposed change does not replace accepted current state; explicit acceptance creates the next accepted revision while prior state/history remains;
- raw writes, actor spoofing, foreign targets and stale revisions are denied;
- exact measurement snapshots remain pinned after later fact edits;
- project/Area deletion only removes scopes/mappings, while explicit Building deletion/revocation follows the physical authority boundary;
- 320/390/1280px UI covers create/read/revise/propose/accept/history/reload/project-switch recovery;
- deployed Auth/PostgREST behavior is proven separately from browser HTTP fixtures;
- no AI/import call is required for this manual foundation.
