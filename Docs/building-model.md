# Persistent building model

> **Status:** manual Slice 2C implemented, deployed and live-verified on 2026-09-13; broader geometry/import/AI extensions remain planned  
> **Owns:** bob's persistent physical-place model across projects: sites, buildings, levels, spaces, building elements, spatial relationships, project scope, uncertainty and physical-state history  
> **Release order:** `Docs/v1-plan.md` owns sequencing and release gates  
> **Implementation truth:** runtime/schema now persist Site → Building → optional Level → Space, BuildingElements, spatial relationships, Project/Area physical scope, accepted/proposed history and exact measurement snapshots. Later geometry/import/AI work must extend this shipped foundation rather than create a parallel physical model. Release evidence lives in `Docs/foundation-verification.md`.
> **Sharing extension:** the household authority decision in §11.1A is specified and being implemented; it is not yet a deployed/live-verified claim.

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

### 11.1A Household sharing extension

**Status:** specified / implementation in progress, 2026-09-13. The direct-only
accepted-edit rules above describe the deployed 2C baseline. This extension adds
the household editing authority confirmed by the product owner.

- A direct Building member may opt in to sharing that Building with one existing household to which they have active access.
- Effective Building editors are direct members plus active members of its explicitly selected household. They may maintain ordinary accepted/current physical records and accept proposals through the same revisioned commands.
- Managing the Building's household share and actual physical deletion still require direct Building membership. Existing archive/revision/history safeguards remain in force.
- Sharing a Building does not create Site membership or share sibling Buildings merely because they have the same Site.
- Project household sharing is a separate explicit choice: no household audience, one household directly, or following one Building that the project actually targets. A physical reference alone does not share project content. When a project targets several Buildings, only the one selected as its sharing source supplies household access.
- The Building sharing flow may add explicitly checked, accessible linked projects only when their sharing is unconfigured or already follows this same Building. Every other existing choice, including an explicitly private project, must be changed in that project's own sharing card using its current revision. This preserves a concurrent unshare instead of treating an empty audience as permission to overwrite the choice. Future projects require an explicit choice too.
- Household-derived rights are resolved from current active household access and the current share/physical association. Removing one route preserves any independent direct membership or accepted project invitation.
- An invited project friend retains the project's existing physical read/proposal context, including Building-wide reads currently allowed by backend scope. The invitation itself grants no accepted Building editing, physical administration or access to other projects.

[BOB-US-059](user-stories.md#bob-us-059--share-a-building-and-selected-projects-with-my-household)
owns the user goal. [The data/auth contract](../db/README.md#household-and-friend-sharing)
owns shared data dependencies, effective access checks, commands and revocation.
`Docs/foundation-verification.md` owns delivery evidence; this decision alone does
not prove the new rights are deployed.

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

The sharing extension in §11.1A deliberately keeps this physical scope separate
from household audience. A project that follows a Building for sharing must retain
an exact Building/Space/Element scope to that Building. A Site-only scope is not
an implicit household-sharing selection.

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


## 12. Linked two-room drawing pilot (2026-09-19, implementation branch)

The [Artifact owner](artifacts.md#linked-two-room-plan-pilot--implementation-branch-2026-09-19)
now specifies a narrow implemented proposal using two existing accepted Spaces,
one canonical wall BuildingElement and one pinned furniture drawing. It is
stacked on the unmerged 2D drawing work; it is not hosted physical-model delivery.

The plan's local geometry and furniture placement do **not** update accepted
physical dimensions, accept proposals, change levels, move actual walls or turn
project completion into as-built evidence. Existing physical identity, project
scope and revision history remain authoritative. A plan can be shown only with
its explicit current project access; unrelated Building access cannot fill a
missing project scope. Creation from hypothetical/new Spaces and full alternative
or nuläge/as-built packages are not implemented by this pilot.

The larger house/addition/level/room/element relationships and evolution scenarios
in this document remain the direction, not newly claimed runtime. Keep building
part and level as potentially overlapping relationships rather than forcing all
future geometry into a single addition→level→room tree. Exact layout recipe,
change propagation, source refresh, viewer and acceptance rules belong in
`Docs/artifacts.md`; claimed-turn chat authority belongs in `Docs/ask-bob-writes.md`.

## Chat-driven Building intake — implementation branch (2026-09-19)

**Implemented on `feat/bob-building-intake`, stacked after #84; not merged or
hosted-deployed.** The first narrative-to-model slice is canonical **context
capture**, not a complete house geometry or staircase design engine.

`save_building_context` lets Bob save a bounded batch of user-described Building
context through the existing physical commands. The user does not fill out a
Building/Space form. A requested new Building is created and linked to the active
Project in the same transaction; an existing Building must already have an
explicit whole-Building or Site scope in that Project. The tool cannot silently
link an existing unscoped Building or turn room-only scope into whole-house writes.

The batch may create/revise Levels, Spaces (including open use-zones), Elements,
room-to-room Relationships and project Measurements linked to exact Space
revisions. A Building operation appends sourced notes to the existing root; it
cannot erase earlier Building context or move it to a different Site. Ordinary
node updates are patches, preserving unspecified fields and existing measurement
snapshots. Relationship endpoints remain immutable. No parallel identity store,
free-form SQL or new raw-write privilege is introduced.

### Meaning, evidence and partial knowledge

The model is instructed to distinguish a zone from an enclosing wall, adjacency
from a walkable connection, and **above** from identical or vertically aligned
floor outlines. Compass locations and the described outer extent remain labelled
notes at this stage, not invented geometric coordinates. Room lengths use the
canonical Measurement records and exact Space measurement snapshots; estimates
remain estimates. A list of passages becomes `connects_to` edges, not an invented
straight corridor. Current-state observations and remodel proposals are separate.

Each operation names an exact user source quote. It comes from the current user
message or a specified earlier USER sequence in the same private thread; SQL
checks the sequence/role/quote itself. Current-message authorisation is separately
required. Old summaries, assistant messages and project records cannot supply
permission. A matching quote is provenance, **not semantic proof** that the
extraction is correct: the model must still preserve meaning and uncertainty.

New nodes use dependency-ordered `@key` references within the batch. The server
assigns persistent UUIDs. A local measurement reference must use the revision just
saved by that operation; existing identities and revisions must come from fresh
research. Failed later operations roll back the whole batch, including new root
creation/linking, earlier nodes and receipts. Retries reuse the committed receipt
rather than duplicate the Building or rooms. Bounds are 40 operations, 20 links
per Space, existing canonical text lengths and the existing eight-write turn
budget. A narrative requiring additional batches must be reported as partial,
not silently described as fully captured.

### Authority and readback

Existing-state capture requires `can_edit_building`, not merely Project
membership. Project-only collaborators may propose Space/Element/Relationship
changes as `ai_assessment`; they cannot change accepted reality, create Levels,
accept pending proposals or rewrite Building metadata. The batch cannot accept,
archive, delete, change household access or choose a Solution. A pending proposal
blocks an accidental ordinary update of the same identity.

`search_bob_project_data_v5` adds paged, caller-RLS reads for scoped Buildings,
Levels, Relationships, accepted Space measurement snapshots and separate current
Project proposals, and retains the existing Space/Element/drawing research.
Both ends of a returned accepted relationship must be in the active Project's
Space scope. Existing physical snapshots can be preserved after their originating
Project becomes inaccessible; the command copies the immutable snapshot rather
than reaching back into another Project's live records.

The validated `building_context` receipt opens the intended Building in the
normal **Building & spaces** surface and closes the chat. Reload resolves the
same explicit Building id. A missing/unscoped requested id produces an unavailable
state, never a fallback to another house. Accepted context and labelled Project
proposals are shown separately. Ordinary canonical revision history remains the
owner of earlier facts; a Building link opens current context, not a frozen drawing
package. Exact drawing-revision navigation remains unchanged.

### Verification and next geometry boundary

`tests/building-intake-db.test.ts` runs actual migrated PGlite SQL with distinct
Project and Building authorities, source checks, snapshot preservation, stale
updates, rollback, pagination, proposal separation and claimed-turn settlement.
It also exercises the real Bob tool loop with an injected deterministic provider.
`tests/building-intake.test.ts` checks the strict schema, dependency references,
patch semantics and receipt validation. The normal Building browser gate includes
chat-create/readback/reload, a separate proposal and unavailable-target navigation
at 320/390/1280px through production UI/data code with HTTP/provider fixtures.
These tests do **not** prove free-text extraction accuracy with a live model;
CI results, screenshots and hosted/live-model evidence must be recorded separately
on the actual PR/head before making a release claim. Fixtures use a synthetic
building, not a user's real house description.

This slice does not add a numeric Building envelope, per-Level coordinate frame or
elevation, arbitrary room polygons, door geometry, cross-floor projection, stairs,
headroom/circulation checks, a topology constraint solver or generated mockups.
Even complete lengths do not imply that these missing calculations exist.
`geometry_ready: false` in capture readback prevents a saved topology from being
advertised as a measured blueprint. Subsequent work must connect exact length and
height sources to a shared coordinate model, then test staircase endpoints and
clearance against both Levels without rewriting accepted state.

Apply only the additive `20260919172831_bob_building_intake.sql` after the pending
#83/#84 prerequisites, then the matching Edge and frontend. Old RPC versions stay
available for rollback. Do not replay shared migration history. No production
schema or user Project is changed by this implementation branch.
