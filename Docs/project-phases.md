# bob — project phases

> **Status:** specified product direction / pre-implementation.  
> **Owns:** the project-level lifecycle: which phase a project is in, what happens in that phase, what Bob should help with, what the human owns, and the readiness criteria for moving forward.  
> **Does not own:** physical Building truth (`Docs/building-model.md`), detailed Bob context architecture, or the UI composition for each phase. UI alignment is the explicit next discovery step.

## Why phases matter

A project should not be a flat bag of Areas, tasks, images, drawings and materials. It has a maturity state.

`ProjectPhase` should become a first-class project concept so the product can answer:

- what are we trying to achieve **now**?
- what information should exist at this point?
- what is the next useful action?
- which Bob capabilities are relevant right now?
- what must be true before the project moves forward?

The phase is the **whole project's main maturity lens**. Individual Areas/tasks may be ahead, behind or blocked, but that does not require pretending the whole project has several primary phases at once.

## Four context axes — keep them separate

Bob needs more than the page the user happens to be viewing.

```text
PROJECT PHASE
Where is the project in its lifecycle?
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

A user may be looking at a task page while the project is in **Planning**. A proposed veranda may exist while the house's accepted state is still **as-is**. A project may target one wall in one Space while the Building contains much more information.

Bob should eventually receive all relevant axes explicitly rather than infer them from chat history.

## Before a project — Explore

**Explore is not a project phase.** It is the pre-project space where an idea can remain cheap and disposable.

Typical user intent:

- “What do you think about adding a veranda here?”
- “I am thinking about building a chair.”
- “How hard would this be?”
- “What might this look like?”

Bob may use authorised Building context, analyse images, discuss feasibility at an appropriate confidence level, explore alternatives and create illustrative mockups.

Nothing becomes project truth merely because it was discussed or generated here.

**Exit:** the person either drops the idea or explicitly chooses **Create project**. The resulting project starts in **Concept** and may retain deliberately selected source context/mockups.

---

# Phase 1 — Concept

## Purpose

Define **what we want to change, where, and why**, while understanding the existing situation well enough to decide what deserves deeper work.

## What happens

- establish project goal and rough scope;
- connect the project to the relevant Building / Space / Element where applicable;
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
- help turn a vague idea into a clear project intent.

## Human job

- explain desired outcome and priorities;
- choose the physical scope;
- provide initial images/context where useful;
- confirm what is actually known versus assumed;
- decide whether the project should progress.

## Ready to leave Concept when

- the project has a clear enough goal;
- relevant physical scope is known or explicitly still unresolved;
- current state and desired state are not being conflated;
- major unknowns/constraints are visible;
- there is enough confidence to spend effort exploring concrete solutions.

---

# Phase 2 — Design

## Purpose

Turn the concept into an **explicit chosen solution**.

## What happens

- collect relevant measurements and existing-condition evidence;
- analyse components that may be reused/changed;
- explore alternative solutions;
- create mockups/visual proposals when useful;
- compare assumptions, trade-offs and constraints;
- select the target solution/version.

## Bob's job

- ask for missing evidence instead of guessing;
- avoid requesting information already available in the project;
- analyse images and measurements while preserving provenance;
- create/compare alternatives and mockups;
- explain trade-offs;
- tell the user when an idea is only conceptual versus sufficiently grounded;
- help converge on one explicit selected target.

## Human job

- measure/photograph/check the real site when requested;
- review alternatives and assumptions;
- correct Bob where project reality differs;
- make the actual design decision;
- explicitly select the target solution.

## Ready to leave Design when

- one explicit target solution revision is selected;
- important design assumptions are recorded;
- required existing-condition evidence for planning is available or visibly unresolved;
- unresolved items are understood well enough to decide whether planning may proceed conceptually or must wait.

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
- propose an ordered work plan rather than silently making it project truth;
- highlight blockers and what must happen before Build;
- surface phase-appropriate actions such as **Create drawing** or **Create material plan** when the project is ready for them.

## Human job

- verify critical dimensions/conditions;
- review and approve consequential plans;
- correct assumptions;
- choose what will actually be purchased/built;
- edit/confirm the work plan and responsibilities;
- decide when the project is ready to move into Build.

## Ready to leave Planning when

At the fidelity required by the project:

- the intended result is explicit;
- required build information is available and qualified honestly;
- drawings/details needed for the work exist or are intentionally unnecessary;
- material needs and known shortages are understood;
- executable work is decomposed enough to begin;
- blocking unknowns are either resolved or explicitly accepted as reasons not to start affected work.

A project does **not** become Build-ready just because it has a pretty drawing.

---

# Phase 4 — Build

## Purpose

Execute the plan against reality while keeping the project current.

## What happens

- people perform tasks/steps;
- materials, tools and dependencies are checked;
- guidance is consumed where needed;
- progress and evidence are captured;
- problems and deviations are discovered;
- design/planning may be revisited when reality requires it.

## Bob's job

- understand the current Area/task/step and physical target;
- give project-specific how-to guidance using current verified values;
- provide/check relevant drawings and how-to images;
- surface checkpoints, common mistakes and escalation/professional boundaries;
- troubleshoot from project truth + current evidence without inventing certainty;
- identify the best person to involve from crew skills/availability;
- coordinate communication/actions only through explicit proposal/confirmation boundaries;
- notice when a discovered condition means the project must revisit Design or Planning.

## Human job

- perform and supervise the physical work;
- make site-specific judgements;
- capture measurements/photos/checks/deviations;
- confirm consequential actions;
- stop/escalate when professional verification is required;
- update the project when reality differs from the plan.

## Ready to leave Build when

- intended work is materially complete;
- required checks are complete or honestly recorded as outstanding;
- important deviations from plan are captured;
- relevant completion/progress evidence exists;
- remaining defects/punch-list items are resolved or explicitly retained as follow-up.

---

# Phase 5 — Complete / As-built

## Purpose

Close the project against **what was actually built**, not merely what was planned.

## What happens

- reconcile important planned vs actual differences;
- preserve final photos/evidence;
- record accepted/as-built physical changes where appropriate;
- retain the project history, decisions and useful learning;
- leave the Building in a better-known state for future projects.

## Bob's job

- help identify missing completion evidence;
- summarise important deviations and final state;
- help prepare as-built observations for human confirmation;
- explain what project information should update persistent Building knowledge;
- make the completed project understandable later.

## Human job

- confirm what was actually built;
- approve/ascribe final physical truth where authorised;
- record unresolved maintenance/follow-up if any;
- explicitly complete/archive the project.

## Phase complete when

- the project's actual outcome is documented at the required fidelity;
- important deviations are retained rather than erased;
- accepted Building changes are reconciled where appropriate;
- unresolved follow-up is explicit;
- the project can be treated as completed without losing its history.

---

# Phase transitions

Phases are **not an AI guess** and should not become a decorative label.

Target direction:

- one explicit current `ProjectPhase` per project;
- Bob may recommend a transition and explain why;
- the user controls consequential forward/back transitions;
- readiness criteria inform the recommendation but do not silently advance the project;
- projects may move backwards when new evidence invalidates assumptions;
- Areas/tasks may expose their own readiness/status without becoming competing project phases.

The exact persistence/API/transition model is implementation work and is not claimed here.

# What phases should drive

Once implemented, phase should be available to:

- Bob's runtime prompt/process lens;
- project-level “what next?” guidance;
- readiness/missing-evidence logic;
- phase-appropriate actions and creation flows;
- dashboards and project navigation;
- UI emphasis and progressive disclosure;
- evaluations (“does Bob behave correctly for this phase?”).

It should **guide relevance**, not hide valid information or prevent cross-phase questions.

# Explicit next discovery — UI alignment

The next session should map the existing UI to this lifecycle **before restructuring screens**.

Questions to resolve there:

- what is the phase-aware project home/dashboard?
- which current pages belong to which phase versus remaining cross-phase utilities?
- what should become the primary next action in each phase?
- when should actions such as **Create mockup**, **Create drawing**, **Create material plan** and **How do I?** appear?
- how do Building/Space context and project phase stay visible without clutter?
- how do we preserve field-first Build/Today UX while making Concept/Design/Planning understandable?

This document intentionally does **not** answer those UI questions yet. UI alignment should consume this phase model together with `Docs/ui-index.md` and Vera before implementation.