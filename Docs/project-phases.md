# bob — project phases

> **Status:** specified product direction / pre-implementation.  
> **Owns:** the lifecycle vocabulary for a Project and its Areas/workstreams: which phase they are in, what happens in each phase, what Bob should help with, what the human owns, and the readiness criteria for moving forward.  
> **Does not own:** physical Building truth (`Docs/building-model.md`), detailed Bob context architecture, or the UI composition for each phase. UI alignment is the explicit next discovery step.

## Why phases matter

A Project should not be a flat bag of Areas, tasks, images, drawings and materials. It has a maturity state.

The same is true inside a larger Project: different coherent workstreams can mature at different speeds.

The target product model is therefore:

```text
Project
  = shared collaboration / goal / schedule container
  = one overall ProjectPhase

Area
  = project-scoped workstream / work zone
  = may have its own AreaPhase

Task
  = executable unit of work inside an Area
  = has task status, not a project phase
```

Both `ProjectPhase` and planned `AreaPhase` use the same lifecycle vocabulary where useful:

`Concept → Design → Planning → Build → Complete / As-built`

This lets the product answer:

- what are we trying to achieve **now** overall?
- which parts of the Project are ahead, behind, complete or deferred?
- what information should exist for this scope at this point?
- what is the next useful action?
- which Bob capabilities are relevant right now?
- what must be true before a Project/Area moves forward?

## Project phase vs Area phase

The **Project phase** is the overall maturity lens and summary of the shared effort.

The **Area phase** is the maturity of one workstream inside that Project.

Example:

```text
Project: Renovate upstairs — Build

Bedroom   — Complete
Office    — Build
Guestroom — Design
```

This is not three Projects merely because the rooms are in different phases.

A large Project can remain useful as one shared container for team, events, access, Shopping and overall goal while Areas progress independently.

The exact rule for how the Project phase is chosen or rolled up from Area phases is still implementation/UI discovery. Do not silently infer it from whichever Area is most advanced or least advanced.

## Why Area is the workstream seam — current-code audit

Current runtime already makes `Area` the strongest fit for this responsibility:

- Tasks belong to Areas.
- Measurements and ExistingComponents may be Area-scoped.
- Solutions may be Area-scoped.
- Artifacts/drawings may be Area-scoped.
- material requirements and stock may reference an Area.
- media can attach to Areas/tasks/steps.
- an Area can already map to a persistent Building / Space / BuildingElement target without becoming that physical object.

So do **not** introduce a parallel `Workstream` object merely to model phase unless later discovery proves Area cannot carry the job.

Area remains a Project work zone/workstream; it must not be redefined as a persistent physical Space.

## Important current limitation — selected target is project-global

The current runtime allows Area-scoped Solutions but stores one selected target for the whole Project. Artifacts and material requirements then pin that project target.

That is insufficient for independently maturing Areas.

Example: Bedroom can be Build-ready against one selected design while Guestroom is still comparing alternatives. Selecting a Guestroom solution must not make Bedroom drawings/material requirements appear stale merely because a global project target changed.

**Implementation implication:** selected target needs an Area-safe scope model (for example Project-level or Area-level target ownership, or an equivalent invariant) before independent Area phases can be considered complete. The exact schema/API is not decided here.

## Four context axes — keep them separate

Bob needs more than the page the user happens to be viewing.

```text
PROJECT / AREA PHASE
Where is this body of work in its lifecycle?
Concept / Design / Planning / Build / Complete

PHYSICAL SCOPE
Where in reality does the work apply?
Site → Building → Level → Space → BuildingElement

BUILDING STATE
What is true about the physical place?
current/as-is → proposed → accepted/as-built

CURRENT VIEW
What is the person looking at right now?
page + focused Area/task/step/drawing/etc.
```

These are different concepts.

A user may be looking at a Task while its Area is in **Build** and another Area in the same Project is still in **Design**. A proposed veranda may exist while the house's accepted state is still **as-is**. An Area may target one wall in one Space while the Building contains much more information.

Bob should eventually receive all relevant axes explicitly rather than infer them from chat history.

The canonical short meanings of `Project`, `Area`, `Task`, `Space`, `Volunteer`, `Selected target` and the other core nouns live in [`domain-dictionary.md`](domain-dictionary.md).

## Before a project — Explore

**Explore is not a project phase.** It is the pre-project space where an idea can remain cheap and disposable.

Typical user intent:

- “What do you think about adding a veranda here?”
- “I am thinking about building a chair.”
- “How hard would this be?”
- “What might this look like?”

Bob may use authorised Building context, analyse images, discuss feasibility at an appropriate confidence level, explore alternatives and create illustrative mockups.

Nothing becomes project truth merely because it was discussed or generated here.

**Exit:** the person either drops the idea or explicitly chooses **Create project**. The resulting Project starts in **Concept** and may retain deliberately selected source context/mockups.

---

# Phase 1 — Concept

## Purpose

Define **what we want to change, where, and why**, while understanding the existing situation well enough to decide what deserves deeper work.

## What happens

- establish Project goal and rough scope;
- identify useful Areas/workstreams where the work is already clear enough;
- connect Project/Areas to the relevant Building / Space / Element where applicable;
- capture useful current-state images and known facts;
- identify major constraints, uncertainty and likely difficulty;
- distinguish existing reality from the desired change;
- decide whether the idea should move into real design work.

## Bob's job

- understand the idea in the context of the real Building;
- analyse available images as observations, not verified measurements;
- surface obvious constraints, risks and major unknowns;
- explain likely complexity in accessible language;
- suggest the most useful next evidence/action;
- help turn a vague idea into clear Project/Area intent.

## Human job

- explain desired outcome and priorities;
- choose/confirm the physical scope;
- provide initial images/context where useful;
- confirm what is actually known versus assumed;
- decide which Areas belong in the Project and whether the work should progress.

## Ready to leave Concept when

For the Project/Area scope being advanced:

- the goal is clear enough;
- relevant physical scope is known or explicitly still unresolved;
- current state and desired state are not being conflated;
- major unknowns/constraints are visible;
- there is enough confidence to spend effort exploring concrete solutions.

Different Areas may cross this boundary at different times.

---

# Phase 2 — Design

## Purpose

Turn the concept into an **explicit chosen solution** for the relevant workstream.

## What happens

- collect relevant measurements and existing-condition evidence;
- analyse components that may be reused/changed;
- explore alternative solutions;
- create mockups/visual proposals when useful;
- compare assumptions, trade-offs and constraints;
- select the target solution/version for the relevant Project/Area scope.

## Bob's job

- ask for missing evidence instead of guessing;
- avoid requesting information already available in the Project/Building;
- analyse images and measurements while preserving provenance;
- create/compare alternatives and mockups;
- explain trade-offs;
- tell the user when an idea is only conceptual versus sufficiently grounded;
- help converge on one explicit selected target for the work being designed.

## Human job

- measure/photograph/check the real site when requested;
- review alternatives and assumptions;
- correct Bob where reality differs;
- make the actual design decision;
- explicitly select the target solution.

## Ready to leave Design when

For the scope moving to Planning:

- one explicit target solution revision is selected;
- important design assumptions are recorded;
- required existing-condition evidence for Planning is available or visibly unresolved;
- unresolved items are understood well enough to decide whether Planning may proceed conceptually or must wait.

An Area still in Design does not automatically block another Area from entering Planning/Build.

---

# Phase 3 — Planning

## Purpose

Turn the selected design into a **build package that can actually be executed**.

## What happens

- verify the measurements needed by drawings/calculations;
- create drawings, sections/details and other artifacts;
- derive transparent material requirements/BOM;
- account for stock/reuse and purchase need;
- create/edit work breakdown, dependencies and readiness;
- connect tasks to drawings, materials, tools and guidance;
- prepare people/build-day coordination.

## Bob's job

- check readiness before producing high-confidence outputs;
- identify exactly which missing measurement/check blocks a drawing or calculation;
- create/explain drawings and sections where supported;
- explain calculation lineage and material arithmetic;
- propose an ordered work plan rather than silently making it Project truth;
- highlight blockers and what must happen before Build;
- surface phase-appropriate actions such as **Create drawing** or **Create material plan** when the relevant Area is ready for them.

## Human job

- verify critical dimensions/conditions;
- review and approve consequential plans;
- correct assumptions;
- choose what will actually be purchased/built;
- edit/confirm the work plan and responsibilities;
- decide which Areas are ready to move into Build.

## Ready to leave Planning when

At the fidelity required by the Project/Area:

- the intended result is explicit;
- required build information is available and qualified honestly;
- drawings/details needed for the work exist or are intentionally unnecessary;
- material needs and known shortages are understood;
- executable work is decomposed enough to begin;
- blocking unknowns are either resolved or explicitly accepted as reasons not to start affected work.

A Project/Area does **not** become Build-ready just because it has a pretty drawing.

### Deferring part of a Project

If two Areas are ready but a third cannot proceed, the default is **not** to split immediately.

The third Area may remain Design/Planning while the others enter Build.

Create a separate Project only when the deferred scope has genuinely become an independent effort — for example a different time horizon, owner/crew, budget, goal or decision boundary.

---

# Phase 4 — Build

## Purpose

Execute the plan against reality while keeping the Project/Areas current.

## What happens

- people perform tasks/steps;
- materials, tools and dependencies are checked;
- guidance is consumed where needed;
- progress and evidence are captured;
- problems and deviations are discovered;
- Design/Planning may be revisited for affected Areas when reality requires it.

## Bob's job

- understand the current Area/task/step and physical target;
- give project-specific how-to guidance using current verified values;
- provide/check relevant drawings and how-to images;
- surface checkpoints, common mistakes and escalation/professional boundaries;
- troubleshoot from Project truth + current evidence without inventing certainty;
- identify the best person to involve from crew skills/availability;
- coordinate communication/actions only through explicit proposal/confirmation boundaries;
- notice when a discovered condition means one Area must revisit Design or Planning without unnecessarily rolling back unrelated Areas.

## Human job

- perform and supervise the physical work;
- make site-specific judgements;
- capture measurements/photos/checks/deviations;
- confirm consequential actions;
- stop/escalate when professional verification is required;
- update the Project when reality differs from the plan.

## Ready to leave Build when

For an Area/workstream:

- intended work is materially complete;
- required checks are complete or honestly recorded as outstanding;
- important deviations from plan are captured;
- relevant completion/progress evidence exists;
- remaining defects/punch-list items are resolved or explicitly retained as follow-up.

One Area can reach `Complete` while the Project remains `Build` because other Areas are still active.

---

# Phase 5 — Complete / As-built

## Purpose

Close the relevant work against **what was actually built**, not merely what was planned.

## What happens

- reconcile important planned vs actual differences;
- preserve final photos/evidence;
- record accepted/as-built physical changes where appropriate;
- retain history, decisions and useful learning;
- leave the Building in a better-known state for future Projects.

## Bob's job

- help identify missing completion evidence;
- summarise important deviations and final state;
- help prepare as-built observations for human confirmation;
- explain what Project information should update persistent Building knowledge;
- make the completed Area/Project understandable later.

## Human job

- confirm what was actually built;
- approve/ascribe final physical truth where authorised;
- record unresolved maintenance/follow-up if any;
- explicitly complete the Area and eventually the Project.

## Area complete when

- that Area's actual outcome is documented at the required fidelity;
- important deviations are retained rather than erased;
- accepted Building changes for that scope are reconciled where appropriate;
- unresolved follow-up is explicit.

## Project complete when

- all Areas/workstreams are Complete **or** explicitly removed/deferred into another accepted scope;
- remaining Project-level follow-up is explicit;
- the Project can be treated as completed without losing history.

---

# Moving an Area to a future Project

A postponed Area should not be moved by casually rewriting `area.project_id` or by deleting/recreating the Area.

Current code has many project-bound records and lineage chains: media, steps, facts, solutions, artifacts, material requirements, people/authority and other records may reference the Project/Area independently.

A future **Move/defer Area to new Project** capability must therefore be an explicit domain operation with defined lineage semantics.

Product intent:

- preserve the same persistent Building / Space / Element identity;
- make clear which records remain historical truth of the old Project;
- deliberately copy/relink only the planning context needed by the new Project;
- never destroy completed/as-built evidence merely to reorganise scheduling;
- show the user what moves versus what stays before confirmation.

Exact migration/command behavior is later implementation work.

# Phase transitions

Phases are **not an AI guess** and should not become decorative labels.

Target direction:

- one explicit current `ProjectPhase` per Project;
- one explicit current `AreaPhase` per Area when Area-phase implementation lands;
- Bob may recommend a transition and explain why;
- the user controls consequential forward/back transitions;
- readiness criteria inform the recommendation but do not silently advance the Project/Area;
- an Area may move backwards when new evidence invalidates assumptions without automatically moving every other Area;
- Task operational state remains task status/readiness rather than another phase layer.

The exact persistence/API/transition/roll-up model is implementation work and is not claimed here.

# What phases should drive

Once implemented, Project/Area phase should be available to:

- Bob's runtime prompt/process lens;
- project-level and Area-level “what next?” guidance;
- readiness/missing-evidence logic;
- phase-appropriate actions and creation flows;
- dashboards and Project/Area navigation;
- UI emphasis and progressive disclosure;
- evaluations (“does Bob behave correctly for this phase and scope?”).

It should **guide relevance**, not hide valid information or prevent cross-phase questions.

# Explicit next discovery — UI alignment

The next session should map the existing UI to this lifecycle **before restructuring screens**.

Questions to resolve there:

- what is the phase-aware Project home/dashboard?
- how are Area phases shown without turning the UI into project-management software?
- how does a user see `Project = Build` while Bedroom = Complete, Office = Build and Guestroom = Design?
- which current pages belong to which phase versus remaining cross-phase utilities?
- what should become the primary next action for each Project/Area phase?
- when should actions such as **Create mockup**, **Create drawing**, **Create material plan** and **How do I?** appear?
- how do Building/Space context and Project/Area phase stay visible without clutter?
- how should **defer / create new Project from this Area** work in the UI?
- how do we preserve field-first Build/Today UX while making Concept/Design/Planning understandable?

This document intentionally does **not** answer those UI questions yet. UI alignment should consume this phase model together with `Docs/ui-index.md` and Vera before implementation.
