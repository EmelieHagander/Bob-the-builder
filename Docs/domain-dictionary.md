# bob — domain dictionary

> **Status:** specified semantic contract / pre-runtime delivery.  
> **Owns:** the canonical product meaning of Bob's core nouns and how those nouns relate to each other.  
> **Does not own:** database column/table names, RLS, page composition, or detailed domain behavior already owned by a specialist contract.

## Why this exists

Bob must not infer the meaning of words such as **Project**, **Area**, **Space**, **Task**, **Volunteer**, **Target** or **As-built** from generic English.

Those words have specific meaning inside bob. The same vocabulary should be understandable by:

- the person using bob;
- Bob's AI runtime;
- UI/product work;
- implementation sessions;
- tests and evals.

This dictionary is therefore **semantic product truth**, not a database catalogue.

Specialist documents still own detailed behavior. This file gives the short definition and points to the owning concept where useful.

## Runtime delivery direction

Do **not** create a mutable database dictionary yet.

The definitions below change with product decisions and code review, not per project. Putting them in a normal app table now would create another source of truth and a migration/admin problem without clear value.

When Bob's context implementation needs this vocabulary at runtime, prefer:

1. a small **server-owned typed domain dictionary** in code for stable machine-readable definitions/relations;
2. a compact **core vocabulary bundle** available to Bob every turn;
3. on-demand lookup for less common definitions when that keeps the prompt smaller.

A database-backed dictionary becomes justified only if definitions later need runtime curation/versioning without deploys. If that happens, it must have one clear owner and version semantics rather than silently diverging from this contract.

---

# Organisation and lifecycle

## Project

A **Project** is the shared container for one intended body of work.

It owns collaboration context such as members/volunteers, Areas, events and project-scoped planning records. A Project may be connected to persistent physical Building/Space/Element context, but the Project is **not the Building itself**.

A Project has one high-level lifecycle phase for the overall effort. Individual Areas may move through that lifecycle at different speeds.

**Not:** a room, a building, a task, or a permanent physical record.

Owner: [`project-phases.md`](project-phases.md) for lifecycle; `db/README.md` / runtime for persistence and authority.

## Project phase

The Project's overall maturity lens:

`Concept → Design → Planning → Build → Complete / As-built`

It tells Bob/UI what the overall project is trying to achieve now. It is not a substitute for Area phase, task status or Building state.

Owner: [`project-phases.md`](project-phases.md).

## Area

An **Area** is a Project-scoped workstream/work zone used to organise a coherent part of the work.

An Area may correspond roughly to a room such as “Kitchen”, but it does not have to. It may instead be “Roof”, “Electrical”, “Porch” or another useful work scope.

An Area can map to a persistent physical Building/Space/Element target without becoming that physical object.

Area is the existing product seam that should carry **workstream-level phase** when different parts of a larger Project mature at different speeds.

**Not:** a persistent Space in the Building model.

Owner: [`project-phases.md`](project-phases.md) for phase semantics; [`building-model.md`](building-model.md) for Area ↔ physical-target distinction.

## Area phase

The lifecycle position of one Area/workstream using the same phase vocabulary as the Project where useful.

Example inside one renovation Project:

- Bedroom — `Complete`
- Office — `Build`
- Guest room — `Design`

The Project may still be broadly `Build` while these Area phases differ.

Area phase is planned product direction; it is not a current persisted runtime field.

## Task

A **Task** is one executable unit of work inside an Area.

Tasks describe work people can perform/assign/track. Their operational state is task status (`todo`, `doing`, `done`, `blocked`), not Project phase.

A Task may later carry richer dependencies, tools, material requirements, guidance and readiness.

**Not:** a Project phase or physical Building element.

## Task step

A **Task step** is an ordered instruction/checkpoint inside one Task.

It can carry instructions, completion state and media. It is more specific than the Task and should not become its own project/workstream lifecycle.

---

# People and collaboration

## Person / project member

A **Person** is a participant represented inside one Project's crew.

A signed-in project member may have authenticated project access. Person records can also represent project participants whose product role is not the same thing as backend authority.

Skills/roles are project information, not proof of professional certification.

## Volunteer

A **Volunteer** is a project participant helping with the work.

Bob currently has two relevant access shapes:

- a normal signed-in Project member/crew participant;
- a prepared name-only, project-limited volunteer flow where the person does not need a full Auth account.

“Volunteer” describes participation, not a universal permission level and not professional competence.

Owner: `Docs/user-stories.md` + `db/README.md` for access behavior.

## Skill

A **Skill** is a project-recorded capability/experience label for a Person.

Bob may use it to help match people to work, but it must not silently promote someone into a licensed/certified professional.

## Event / build day

An **Event** is a Project-scoped planned gathering/build day with attendance context.

It is coordination context, not the Project phase itself.

---

# Physical place

## Site

A **Site** is a persistent physical place that may contain one or more Buildings and may outlive individual Projects.

## Building

A **Building** is the persistent identity of a physical building.

It can accumulate better knowledge across Projects. The Building is not reset when a Project ends.

## Level

A **Level** is an optional grouping inside a Building, such as a floor/storey.

## Space

A **Space** is a persistent physical room/space within a Building.

A Space is not an Area. Several Projects may touch the same Space over time; one Project Area may point to a Space as its physical target.

## Building element

A **BuildingElement** is a persistent physical component/element such as a wall, opening, door, window or other explicitly modelled element.

## Physical scope

**Physical scope** says which Site/Building/Space/Element a Project or Area applies to.

It answers **where in reality** the work belongs.

Owner: [`building-model.md`](building-model.md).

## Building state

The lifecycle of physical truth for a Space/Element/relationship:

- **current / as-is** — accepted reality now;
- **proposed** — an intended possible change;
- **accepted / as-built** — confirmed physical result after change.

Building state is independent from Project/Area phase.

Owner: [`building-model.md`](building-model.md).

---

# Evidence and design

## Media asset

A **MediaAsset** is a durable Project image with purpose/provenance and optional links to Area/Task/Step.

Purposes include current state, reference, instruction, proposal, progress and as-built.

A photo can be evidence without proving a measurement.

Owner: [`media-and-steps.md`](media-and-steps.md).

## Measurement

A **Measurement** is a revisioned numeric project fact with unit, subject and provenance/truth state.

A measured value, provided specification, estimate and unknown are different truth classes.

Owner: [`project-facts.md`](project-facts.md).

## Existing component

An **ExistingComponent** is a known physical thing already present/owned that may be inspected, reused, removed or replaced.

“Reuse” intent does not itself certify suitability.

Owner: [`project-facts.md`](project-facts.md).

## Solution

A **Solution** is one design alternative for how to achieve the Project/Area intent.

Solutions are revisioned and may keep assumptions, trade-offs, images and pinned evidence.

Owner: [`solutions.md`](solutions.md).

## Selected target

A **Selected target** is the explicit Solution revision the work is currently intended to build toward.

It is an intent/decision pointer, not professional approval.

**Current runtime limitation:** target selection is project-global even though Solutions, Artifacts and facts can be Area-scoped. The phase/workstream model requires this to be revisited so independent Areas can have coherent targets without invalidating each other. Exact schema/API remains implementation work.

Owner: [`solutions.md`](solutions.md) for current behavior; [`project-phases.md`](project-phases.md) for the multi-Area implication.

## Artifact / drawing

An **Artifact** is a revisioned Project planning output such as plan, elevation, section or detail.

It pins the selected target and exact measurement evidence used by that revision and carries concept/measured/build-ready status.

Owner: [`artifacts.md`](artifacts.md).

---

# Materials and execution

## Material requirement

A **MaterialRequirement** is the canonical planning record for how much of something the selected solution/work needs.

It retains basis/method, selected-target lineage, optional drawing lineage, allowance and stock/reuse deductions.

This is different from a Shopping item.

Owner: [`material-planning.md`](material-planning.md).

## Stock item

A **StockItem** is material the Project already has available/inspect/unavailable before new purchasing.

## Shopping item

A **Shopping item** is the existing checkable purchasing surface.

A MaterialRequirement may be explicitly published/updated into Shopping. Shopping remains independently editable and is not the calculation authority.

## BOM / material plan

“BOM” or **material plan** means the set of material requirements derived/recorded for the intended work, including transparent quantity basis and existing stock/reuse where modelled.

It must not be confused with the legacy free-form `materials` records alone.

## Readiness

**Readiness** answers whether a piece of work has enough evidence, decisions, prerequisites/materials/tools/dependencies to proceed at the claimed fidelity.

Readiness is not automatically the same as Project phase, Area phase or Task status.

---

# Bob context words

## Current View

**Current View** is the server-grounded semantic description of what the person is looking at now: page/surface plus the authorised focused Project/Area/Task/Step/etc.

The browser may send pointers; the backend hydrates facts.

Owner: [`ask-bob-context.md`](ask-bob-context.md).

## Project Catalog

The **Project Catalog** is a small navigation inventory telling Bob which kinds of project context exist and where, without loading all record bodies.

Owner: [`ask-bob-context.md`](ask-bob-context.md).

## Project truth

**Project truth** is persisted, authorised information about this Project/Building context with its real provenance/truth state.

Prior Bob conversation and general construction knowledge are never substitutes for fresh Project truth.

## General construction knowledge

Reusable construction methods/guidance that are not facts about this Project.

Future source-backed Building Knowledge Library content belongs to this class and must remain distinct from Project truth.

---

# Relationship summary

```text
Site
└─ Building
   ├─ Level
   ├─ Space
   └─ BuildingElement

Project
├─ ProjectPhase
├─ people / volunteers / events
├─ Area (workstream/work zone)
│  ├─ AreaPhase
│  ├─ physical target → Building / Space / Element
│  ├─ Measurements / ExistingComponents
│  ├─ Solutions / selected target (future Area-safe scoping)
│  ├─ Artifacts / material requirements
│  └─ Task
│     └─ TaskStep
└─ shared project-level records
```

The hierarchy is conceptual, not a promise that every database foreign key follows this exact tree.

# Maintenance rule

When a new first-class Bob concept appears, add it here **only after its product meaning is accepted**.

Do not copy detailed schema or domain rules into this dictionary. Link to the owning contract instead.
