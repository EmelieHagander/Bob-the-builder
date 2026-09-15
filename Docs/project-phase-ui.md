# bob — phase-aware UI blueprint

> **Status:** specified UI/product direction / pre-implementation.  
> **Owns:** how ProjectPhase + AreaPhase should appear in the existing UI, which surfaces change, which surfaces intentionally stay simple, progressive disclosure, transition UX, and the frontend/data seams implementation will touch.  
> **Inputs:** `Docs/project-phases.md`, `Docs/domain-dictionary.md`, `Docs/ui-index.md`, `.claude/agents/vera.md`, current runtime code.  
> **Does not own:** exact database migration/API shape, selected-target schema design, physical Building truth, or Bob context/runtime architecture.

## 1. Product goal

Phases should make bob easier to understand, not turn it into heavyweight project-management software.

The user should be able to answer three questions quickly:

1. **Where is the whole Project?** — ProjectPhase.
2. **Where is this Area/workstream?** — AreaPhase.
3. **What is the most useful next action here?** — phase-aware next action/readiness.

The UI must also keep these separate from:

- Task status/readiness;
- Building/Space physical state;
- schedule/calendar state;
- the page the user is currently viewing.

The key mixed-phase case must feel natural:

```text
Renovate upstairs — Project: Build

Bedroom   — Complete
Office    — Build
Guestroom — Design
```

This is one Project, not three Projects.

## 2. UI principles

### 2.1 Phase is orientation, not navigation

Do **not** add Concept / Design / Planning / Build / Complete as top-level routes or sidebar tabs.

The current feature surfaces remain useful:

- Measurements & existing parts;
- Solutions & target;
- Plans & drawings;
- Material plan;
- Areas/tasks;
- People/events/shopping/food/announcements;
- Today.

Phase changes **which of those are foregrounded**, not which data is allowed to exist.

### 2.2 One primary action, full access behind it

Project Home and Area Detail should each surface one strong phase-aware next action plus a short readiness/attention summary.

Secondary tools remain reachable through compact links / “More project tools” rather than six equal-weight buttons.

### 2.3 Mixed phases are first-class

Never derive one global “next planning action” from project-wide measurements/target/drawing when Areas can be at different phases.

Project Home may summarize and prioritize, but Area cards own the local next step.

### 2.4 Phase is explicit human-controlled state

Bob may recommend a phase change. Readiness may explain why. The UI must never silently advance ProjectPhase/AreaPhase.

Backward transitions are valid when evidence changes.

### 2.5 Legacy state is not guessed

Existing Projects/Areas created before phase persistence must not be silently classified from tasks, dates or data volume.

UI direction:

- nullable/unclassified persistence for legacy records;
- show **Set project phase** / **Set area phase**;
- new Projects start in Concept;
- existing users explicitly classify old work;
- an explicit bulk action such as **Set unclassified Areas to Project phase** may be offered, never run silently.

### 2.6 Phase uses neutral visual grammar

Existing leaf/honey/clay colors already communicate ready/in-progress/blocked truth.

Phase should therefore use a mostly neutral/brand visual treatment with text + icon, not a second competing semantic color system.

Readiness/blocker colors retain their current meaning.

### 2.7 Field use stays fast

`Today` and the execution side of `TaskDetail` must not inherit organiser dashboards, phase rails or planning controls.

Build-day rule remains:

> what am I doing, where, with whom, what do I need, can I start?

## 3. Shared UI grammar to add

Prefer one domain-specific component module rather than duplicating phase markup across pages.

### Proposed new file: `src/components/PhaseUI.tsx`

Owns presentational phase components only:

- `PhasePill` — compact `Design`, `Build`, etc.;
- `PhaseRail` — Concept → Design → Planning → Build → Complete;
- `NextActionCard` — one primary action + reason;
- `ReadinessSummary` — short checklist/blocker summary;
- `AreaPhaseSummary` — e.g. `1 Design · 2 Build · 1 Complete`;
- `PhaseTransitionDialog` — review current phase, requested phase, unresolved criteria and reason before save.

Do not put database reads in these components.

### Proposed new file: `src/lib/projectPhase.ts`

Pure product/UI metadata and derivation helpers:

- ordered phase list;
- labels/icons/descriptions;
- next/previous phase helpers;
- formatting for mixed Area phase counts;
- deterministic UI recommendation helpers that consume already-loaded readiness data;
- no Supabase calls and no AI guesses.

### `src/theme.css`

Add reusable classes/tokens for:

- phase rail / compact mobile rail;
- phase pill;
- next-action card;
- mixed-phase summary;
- attention/readiness rows;
- responsive Area header/action layout.

Do not introduce a second card/button system.

## 4. Page-by-page blueprint

## 4.1 Account Dashboard — `src/pages/account/AccountDashboard.tsx`

### Current problem

Project cards are dominated by schedule dates and a schedule-derived status. The current label **Building now** can conflict semantically with a future ProjectPhase named Build.

### Desired UI

Each Project card should show, in this order:

1. Project name;
2. `PhasePill`;
3. compact Area phase mix when Areas exist;
4. schedule/date as secondary information;
5. Open action.

Example:

```text
Renovate upstairs                  BUILD
3 Areas · 1 Design · 1 Build · 1 Complete
15 Sep – 4 Oct
[Open]
```

Rename schedule-only language so it cannot be confused with lifecycle phase. Prefer labels such as **Happening now** / **Scheduled now** instead of **Building now**.

### Keep

- account-level project selection;
- notes;
- calendar;
- sharing/account actions.

## 4.2 Project modal — `src/pages/account/ProjectModal.tsx`

Show lifecycle phase and calendar status as two separate facts.

Do **not** make the generic account modal the primary phase-transition control: that would bypass readiness context.

Preferred behavior:

- phase visible in view mode;
- `Open project` remains the route to Project Home;
- Project Home owns **Review/change phase**;
- schedule editor remains schedule-only.

## 4.3 Project creation — `src/pages/StartProject.tsx` + new-project flow in `AccountDashboard.tsx`

Keep creation short.

- do not add a long phase wizard;
- new Project starts as `Concept` automatically;
- explain briefly after creation: “Start by defining what you want to change and what exists today.”

If a later import/onboarding flow creates an already-running Project, that flow may explicitly choose another phase; normal creation should not ask.

## 4.4 App shell — `src/components/Layout.tsx`

### Desktop

The active-project switcher may show a small phase label under/next to project metadata.

Sidebar navigation remains stable. Do **not** add phase entries.

Consider renaming the first navigation label from **Dashboard** to **Project** or **Overview** while keeping `/` as the route. This better matches the new role of the screen as Project Home.

### Mobile

Current mobile tabs expose Dashboard, Areas, People, Events, Account and omit `Today` even though Vera defines Today as the field fast path.

Important UI follow-up:

- make Today reachable in one tap on mobile;
- preferred direction: permanent `Today` tab, with People remaining available through project tools;
- do not make bottom navigation dynamically reorder itself by ProjectPhase.

Stable navigation is more important than saving one phase-specific tap.

## 4.5 Project Home — `src/pages/Dashboard.tsx`

This is the largest change.

### Remove as primary logic

The current project-global sequence:

```text
missing measurement → choose global target → drawing → Areas
```

is useful for a one-scope project but wrong for mixed Area phases.

It must not remain the single project-wide truth once Areas can mature independently.

### New top section

Project Home should begin with:

1. Project identity;
2. Project `PhasePill` + `PhaseRail`;
3. physical Building/Space scope summary when present;
4. one **Project focus** card;
5. explicit **Review phase** action.

Project focus is a summary/recommendation, not an Area replacement. Examples:

- Concept: “Define the work areas and capture the current state.”
- Design: “2 Areas need design decisions; Guestroom still lacks a verified width.”
- Planning: “Office is ready for a drawing; Bedroom material plan needs review.”
- Build: “2 Areas are building; Guestroom is still in Design.”
- Complete: “Record final as-built evidence and close remaining follow-up.”

### Area phase section

Move mixed-phase Area state high on the page.

Each compact Area row/card shows:

- Area name;
- phase;
- local attention/readiness;
- local next action;
- physical target if useful;
- Build progress only when meaningful.

### Lower project-wide information

Keep project-wide collaboration information lower:

- build day;
- announcements;
- crew/assignment stats;
- generic project stats.

The project homepage should answer “where are we and what next?” before “how many records exist?”.

## 4.6 Areas list — `src/pages/Areas.tsx`

### Current problem

Every Area card currently emphasizes one ring derived from Assigned/Materials/Done plus three progress bars. That presentation assumes Build is the universal mode.

### Desired Area card

Always show:

- icon + Area name;
- `PhasePill`;
- short description / physical scope;
- one local next action or attention reason;
- lead/crew compactly.

Phase-specific secondary content:

**Concept**
- scope/current-state evidence;
- major unknown count.

**Design**
- missing required evidence;
- alternatives/selected target status.

**Planning**
- drawing/material-plan/readiness status.

**Build**
- task progress, blockers, material readiness, crew;
- existing progress bars become useful here.

**Complete**
- completion/as-built state;
- unresolved follow-up if any.

Do not show three Build-oriented progress bars as the dominant content for Design/Planning Areas.

## 4.7 Area Detail — `src/pages/AreaDetail.tsx`

This becomes a small phase-aware workstream home while keeping current task/material/image functionality.

### Header

Show:

- breadcrumb;
- Area name;
- Area `PhasePill` + compact `PhaseRail`;
- physical Building/Space/Element target if linked;
- **Review/change phase**;
- one primary phase-aware action.

### Replace equal-weight action cluster

The current header exposes Solutions, Drawings, Measurements, Edit, Add material and Add task at similar weight.

New direction:

- one primary action based on AreaPhase;
- 1–2 secondary contextual links;
- remaining tools in a compact **More tools** group.

Examples:

**Concept**
- primary: `Capture current state` / `Define scope`;
- secondary: Images, Building context.

**Design**
- primary: unresolved evidence → `Measure…`, otherwise `Choose target`;
- secondary: Measurements, Solutions, Images/mockup.

**Planning**
- primary: `Create drawing` / `Build material plan` / `Resolve blocker` depending readiness;
- secondary: Plans, Material plan, Tasks.

**Build**
- primary: `Continue next ready task`;
- secondary: blocked tasks, Materials, crew/help.

**Complete**
- primary: `Record/verify as-built` if incomplete;
- secondary: final evidence/history.

### Existing tabs

Keep Tasks / Materials / Images available below the phase header.

Do not create separate phase routes.

The top phase section may reorder/emphasize the relevant existing content, while tabs remain direct tools.

## 4.8 Measurements & existing parts — `src/pages/ProjectFacts.tsx`

Keep this a focused fact editor.

Add contextual framing when opened from an Area:

- breadcrumb back to Area;
- Area name + phase;
- why this evidence matters to the current next action;
- preserve current `?area=` / `?status=` filtering.

Do not hide measurements because an Area moved beyond Design: old evidence remains inspectable and may need revision during Build.

## 4.9 Solutions & target — `src/pages/Solutions.tsx`

This surface requires a domain/data correction before mixed phases are truthful.

### Required UI direction

When an Area filter exists:

- header shows `Guestroom · Design`;
- alternatives are for that scope;
- selected target is explicitly **Selected for Guestroom**;
- decision history is scope-specific.

Project-level alternatives may still exist, but must be visually separate from Area-level decisions.

### Must not happen

Selecting a Guestroom solution must not replace the target used by Bedroom drawings/material requirements.

The UI must not ship AreaPhase as “working” while target persistence remains project-global underneath.

## 4.10 Plans & drawings — `src/pages/Artifacts.tsx`

Keep this a deep planning surface.

When opened with `?area=`:

- show Area + phase context;
- load/use the selected target for that same scope;
- show stale lineage relative to the same scope, not unrelated Area decisions;
- return to Area is obvious.

The existing concept/measured/build-ready status remains artifact truth and is **not** the Project/Area phase.

## 4.11 Material plan — `src/pages/MaterialPlan.tsx`

Area scope must be first-class.

- stock may remain Project-wide;
- requirements may be Area/task-scoped;
- each requirement must pin the selected target for its own relevant scope;
- changing Guestroom target must not stale Bedroom requirements;
- `?area=` should open the Area-specific material-plan context;
- Shopping remains the one existing purchase surface.

## 4.12 Building context — `src/pages/BuildingContext.tsx`

Building truth remains independent of project phase.

Do not put the Project phase rail inside the Building editor.

When reached from a Project/Area, show enough return/scope context to explain why the place is relevant. Account-level Building access remains possible before any Project exists.

## 4.13 Task Detail — `src/pages/TaskDetail.tsx`

Do not turn this into a phase dashboard.

Add only lightweight workstream context:

- Area name;
- Area phase (small);
- physical target when useful;
- readiness/blocker warning when modeled.

In Build, execution content dominates: instructions, ordered steps/checks, images, future “How do I?”.

In Planning, task editing remains available, but the UI should not imply a task is ready to execute just because it exists.

Task status stays `todo / doing / done / blocked`; phase does not replace it.

## 4.14 Today — `src/pages/Today.tsx`

Keep the page extremely small.

Current readiness behavior (delivered by the executable-work readiness foundation):

- prioritize tasks belonging to Build-phase Areas and ready work;
- do not silently show a Design/Planning task as executable merely because it exists;
- if an explicitly scheduled task is not ready, label the reason rather than hiding it mysteriously.

`current_task_readiness` now supplies this state: blocker-free work remains **unreviewed** until a human confirms Ready, and newer dependency/need/material truth invalidates that review. Today keeps manually Blocked work visible with named reasons.

No phase rail. No project setup controls.

## 4.15 People / Events / Shopping / Food / Announcements

These remain cross-phase project utilities.

Do not duplicate them inside each phase.

Possible contextual changes only:

- Events can show which Areas/tasks are intended for the build day;
- Shopping keeps Area labels;
- People remains the source for skills/crew;
- Food remains safety-first;
- Announcements remains project-wide.

## 4.16 Ask bob — `src/components/AskBob.tsx`

The floating entry stays global.

When the screen-aware context work lands, Bob should receive:

- ProjectPhase;
- focused AreaPhase when applicable;
- Current View;
- physical scope;
- relevant persisted project truth.

Suggested chips/actions should become phase-aware rather than staying the same coordination prompts everywhere.

Examples:

- Concept: `What should we understand first?`
- Design: `What evidence is still missing?`
- Planning: `What blocks this drawing/material plan?`
- Build: `What can we do next?`
- Complete: `What is missing from as-built?`

Phase context guides relevance; it does not grant Bob write authority or make chat history project truth.

## 5. Phase transition UX

## 5.1 Project transition

Project Home owns the primary transition control.

Flow:

1. user chooses **Review phase**;
2. dialog shows current phase and candidate phase;
3. show phase exit criteria/readiness summary;
4. unresolved items remain visible;
5. user confirms and records a short reason;
6. save through a guarded backend command;
7. reload/read-back shows new phase.

Except for final completion rules, readiness is guidance rather than silent automation.

## 5.2 Area transition

Same interaction on Area Detail, scoped to that Area.

Changing an AreaPhase does not automatically change ProjectPhase.

Useful recommendation behavior:

- if all active Areas now support a later Project phase, show `All active Areas are ready — review Project phase`;
- never auto-transition.

## 5.3 Completing the Project

A Project cannot be honestly Complete while an active Area is still Design/Planning/Build.

Completion dialog should list Areas:

```text
Bedroom    Complete
Office     Complete
Guestroom  Design    Needs decision
```

For unfinished Areas, offer only real domain choices when implemented:

- keep Project open;
- defer Area;
- create a future Project from that Area using an explicit lineage-preserving operation.

Do not solve this by deleting the Area or editing `project_id` directly.

## 6. Defer / split UI direction

`Deferred` is **not** another lifecycle phase.

If persisted, it should be a separate Area lifecycle/disposition state from AreaPhase.

Do not expose a “Move to another project” button until the backend domain operation exists and can explain what remains historical vs what is copied/relinked.

Future dialog must preview:

- physical Building/Space target that stays shared;
- old Project history that remains;
- planning records copied/relinked;
- tasks/materials that do or do not move;
- destination Project name/schedule;
- consequence for old Project completion.

## 7. Data/runtime seams affected by implementation

This section is an implementation map, not a claim that these changes are built.

### `src/data/types.ts`

Expected additions:

- `ProjectPhase = 'concept' | 'design' | 'planning' | 'build' | 'complete'`;
- `Project.phase: ProjectPhase | null` for legacy unclassified state;
- `Area.phase: ProjectPhase | null` (or semantic alias `AreaPhase`);
- optional phase-transition/history read shapes when the backend contract is chosen.

Do not add phase to Task.

### `src/data/database.ts`

Expected changes:

- include phase in Project/Area row mappings;
- new Project creation initializes `concept`;
- expose guarded `setProjectPhase` / `setAreaPhase` (names illustrative until backend contract lands);
- phase updates must go through backend command semantics rather than ad-hoc page `.update()` calls;
- expose any compact phase/readiness summary needed by Account/Project Home without making pages query Supabase directly.

### `src/data/mockData.ts`

Demo fixtures need explicit Project/Area phases so mixed-phase UI can be exercised.

Include at least one fixture with:

- Project = Build;
- one Area Complete;
- one Area Build;
- one Area Design.

### `src/data/solutions.ts`

High-impact change.

Current selected-target API must evolve from project-global semantics to scope-safe semantics.

Likely API direction:

- `getSelectedTarget(projectId, scope?)`;
- `selectTarget(projectId, scope, ...)`;
- scope is either Project or Area.

Exact API/schema remains a data-contract decision.

### `src/data/artifacts.ts`

Artifact reads/writes/stale checks must use the target for the artifact's scope.

### `src/data/materialPlanning.ts`

Material requirement lineage/stale checks must use the target for the requirement's scope.

### `src/data/projectFacts.ts`

No fundamental phase persistence required. Existing Area filtering is reused; UI context may consume current Area phase through normal Area reads.

### `src/data/buildingContext.ts`

No phase truth should be stored here. Physical model remains independent.

### New additive Supabase migration(s)

Do not rewrite applied migrations.

Expected implementation work includes additive migration(s) for:

- nullable current Project/Area phase for legacy compatibility;
- guarded transition command + actor/reason/history semantics;
- scope-safe selected targets and downstream constraints/views;
- any separate Area defer/disposition state only when that feature is actually implemented.

Exact table/function names belong in the later data implementation contract.

### `db/README.md`

When implemented, update table/API mapping, transition authority and selected-target scope semantics.

## 8. Frontend files affected

### Major restructuring

- `src/pages/Dashboard.tsx`
- `src/pages/Areas.tsx`
- `src/pages/AreaDetail.tsx`
- `src/pages/Solutions.tsx`
- `src/pages/Artifacts.tsx`
- `src/pages/MaterialPlan.tsx`

### Moderate changes

- `src/pages/account/AccountDashboard.tsx`
- `src/pages/account/ProjectModal.tsx`
- `src/components/Layout.tsx`
- `src/pages/ProjectFacts.tsx`
- `src/components/AskBob.tsx`

### Small / protective changes

- `src/pages/StartProject.tsx`
- `src/pages/TaskDetail.tsx`
- `src/pages/Today.tsx`
- `src/pages/BuildingContext.tsx`
- `src/App.tsx` — likely no new phase routes; may only need richer project prop/types.

### Shared/new UI code

- new `src/components/PhaseUI.tsx`;
- new `src/lib/projectPhase.ts`;
- `src/components/ui.tsx` only if a truly generic primitive is missing;
- `src/theme.css` for shared responsive phase styles.

## 9. Route/navigation decision

Keep existing routes:

```text
/
/areas
/areas/:slug
/facts
/solutions
/artifacts
/material-plan
/building
/tasks/:taskId
/people
/events
/shopping
/food
/announcements
/today
```

Do **not** add `/concept`, `/design`, `/planning`, `/build` or `/complete` routes.

Phase is state of the Project/Area, not a place in the router.

## 10. Implementation sequence

### UI-0 — domain/data prerequisite

Before claiming phase UI works:

- persist ProjectPhase/AreaPhase;
- legacy unclassified state;
- guarded transition command;
- scope-safe selected-target design specified and implemented far enough that Area Design/Planning cannot corrupt another Area's lineage.

### UI-1 — shared phase grammar

- `projectPhase.ts` metadata;
- `PhaseUI.tsx` primitives;
- theme/responsive styles;
- demo mixed-phase fixtures.

### UI-2 — Project Home + Areas

- Project phase rail/focus;
- mixed Area phase overview;
- phase-aware Area cards;
- transition UI;
- account project-card phase summary.

This slice should deliver visible product value before deep editors are restyled.

### UI-3 — Area Detail + deep planning surfaces

- Area phase header/next action;
- reduce equal-weight action clutter;
- contextual ProjectFacts/Solutions/Artifacts/MaterialPlan;
- finish scope-safe target UX.

### UI-4 — field/shell polish

- Today one-tap mobile access;
- Task Detail lightweight phase/readiness context;
- shell Project phase label;
- schedule-vs-phase wording cleanup;
- Ask bob phase-aware suggested prompts once the context seam exists.

### UI-5 — completion/defer/split

Only after the domain commands exist:

- Area defer state;
- Project completion resolver;
- explicit lineage-preserving future-Project split flow.

## 11. Verification / scripts

### New domain test

Add `tests/project-phases.test.ts` (name recommended) covering:

- new Project starts Concept;
- legacy/null phase remains unclassified rather than guessed;
- authorised Project/Area transitions persist;
- cross-project phase mutation denied;
- backward transitions retained;
- transition actor/reason/history if the chosen backend contract stores history;
- Project completion rule with unfinished active Areas.

### Existing tests that must be extended

- `tests/solutions.test.ts` — Area target isolation;
- `tests/artifacts.test.ts` — drawing lineage only stales against its own target scope;
- `tests/material-planning.test.ts` — same for BOM/material requirements;
- `tests/project-scope.test.ts` — authority/isolation for new commands/data;
- Building tests remain unchanged unless split/defer adds physical-link behavior.

### Browser verification

Add a dedicated script, recommended:

- `scripts/check-project-phases-browser.mjs`

Run at **320px, 390px and 1280px** and prove at least:

1. new Project → Concept;
2. legacy/unclassified prompt is honest;
3. mixed Project/Area phase example renders correctly;
4. phase change → visible read-back after reload;
5. Area Design and Area Build coexist;
6. Area card next action changes by phase;
7. Project Home does not pretend one global planning step applies to all Areas;
8. Area-scoped target selection cannot stale another Area's drawing/BOM;
9. Task/Today remain usable on phone;
10. no mobile collision with bottom nav / Ask bob;
11. schedule status and ProjectPhase are visibly distinct;
12. completion dialog does not silently discard unfinished Areas.

### Existing browser scripts likely touched indirectly

- `scripts/check-project-browser.mjs` — project/account shell expectations;
- `scripts/check-foundations-browser.mjs` — if Dashboard/Area selectors/content are used;
- `scripts/artifacts-browser.mjs` — if target scope changes artifact setup;
- any material/solution browser fixtures that assume one global target.

Do not weaken old verification merely to accommodate new copy/layout.

## 12. Accessibility / responsive requirements

- phase is always expressed in text, never color only;
- phase rail is keyboard-readable and does not require horizontal precision tapping;
- transition control has a clear accessible label;
- one-handed primary CTA target remains generous;
- on 320px, prefer current phase + compact step rail over five large cards;
- no horizontal page overflow from phase rail;
- no fixed phase control near the existing mobile nav / Ask bob collision zone;
- loading/error/denied/unclassified states remain visually distinct.

## 13. What we intentionally do not build

- no Gantt/critical path UI;
- no automatic phase engine;
- no AI-controlled phase transition;
- no phase-specific duplicate pages;
- no new Workstream entity while Area fits;
- no “phase progress %” invented from arbitrary data;
- no target selection that is visually Area-scoped but still project-global underneath;
- no destructive reparent/delete flow masquerading as Project split;
- no database dictionary required for UI phases.

## 14. Definition of done

The phase-aware UI is successful when a person can open a large Project and immediately understand:

```text
where the Project is
+ where each Area is
+ what deserves attention next
+ what they can do here
```

without losing access to cross-phase tools, without confusing schedule/Task/Building state with ProjectPhase, and without adding project-management ceremony to Today/Task execution.

For the canonical mixed-phase fixture:

```text
Project: Renovate upstairs — Build
Bedroom — Complete
Office — Build
Guestroom — Design
```

bob must make this state obvious on Project Home, obvious on Areas, locally actionable inside each Area, truthful through scoped target/drawing/material lineage, and still fast on a phone during Build.
