# Vera — open findings

> Unresolved frontend/UX drift and follow-ups. Resolve or move to an issue when work is scheduled; do not turn this into a second roadmap.

Historical findings: [V01 — superseded placeholder-only media finding](archive/vera-findings-2026-10-18.md). Current media behavior is owned by `Docs/media-and-steps.md`.

## FINDING-V13 — Backend sentences still stand in for error codes

**Status:** open (2026-10-25). Screens no longer show raw text, codes or IDs
(`src/lib/userErrors.ts`, `src/lib/labels.ts`). Remaining drift for later steps:
many SQL guards raise English sentences; the frontend matches the important
ones exactly as codes, otherwise shows the kind's copy. Replace them with
stable codes. Deterministic material bases and CAD part names are stored free
text/identifiers: blank bases with UUIDs show only a summary, and CAD part ids
still label the parts table and drawings. `BuildingContextEditor`/`Surface`
are excluded from the scan until their parallel change lands.

## FINDING-V02 — Current visual contract is implicit rather than fully documented

**Status:** sufficiently addressed for Slice 1; broader blueprint deferred

`Docs/ui-index.md` documents current ownership and invariants, and `Docs/function-scope.md` now records the concrete UI-placement decisions needed for the first media/evidence vertical slice. A separate page blueprint is therefore **not required before Slice 1**.

**Why it matters:** the app is growing into new planning/media/instruction surfaces, increasing the chance of local UI dialects.

**Owning follow-up:** create a deeper design/page blueprint only if later slices introduce repeated patterns that cannot be owned cleanly by the existing shell, shared primitives and slice contracts. Do not produce documentation for its own sake.

## FINDING-V03 — Inline visual values are common

**Status:** open / not currently a blocker

Many pages/components use inline layout and visual values alongside shared tokens/classes.

**Why it matters:** repeated new features may increase drift if every screen copies one-off values.

**Owning follow-up:** when a repeated pattern is touched by real feature work, promote it to a shared primitive/token. Avoid a broad refactor with no user-facing goal.

## Usability review — 2026-10-18

**Status:** open findings and proposed directions; no product implementation or new phase policy is approved by this document.

**Baseline:** main `e0ee015`, including performance PR #269 and drawing-continuation PR #270. The frontend and relevant browser fixtures are identical to tested head `40bffc3`. Inspected routed components and 320/390/1280 px screenshots from [CI run 39127570522](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/39127570522). The performance user acceptance in this conversation was positive. This is a source-grounded heuristic review, not an observed usability study with an ordinary owner or volunteer. Prior CI success proves its scripted flows, not ease of use. Screenshots captured during entry animations were used for composition only, not contrast conclusions.

**Acceptance baseline:** the five outcome use cases in [user stories](../../Docs/user-stories.md), the north stars in [CLAUDE.md](../../CLAUDE.md), and the existing [phase UI contract](../../Docs/project-phase-ui.md). Preserve one shared project truth, optional Areas, mixed phases, explicit human-controlled lifecycle transitions, honest uncertainty and a one-tap Today path. Product terminology and hierarchy remain owned by the domain dictionary.

### FINDING-V04 — Delegated work has no coherent return point

**Consequence:** IMPORTANT. The owner has to reconstruct what Bob is doing and what needs their attention after returning to the project. This weakens UC-001 and UC-005.

**Observed:** `Layout.tsx` introduces Bob with “Stuck on something?” and an “Ask bob” launcher. The launcher exposes an unread badge, not ongoing work or the next human contribution. `ProjectHome.tsx` separates the Plan, drawings, drawing requests, evidence and updates. `AskBob.tsx` contains useful live-work/recovery state, but that state is presented inside the private drawer. `DrawingRequests.tsx` exposes internal request identifiers, model-call/cost information and several internal stages in the normal project surface.

**Proposed fix:** a compact “Right now” section on Project Home: current work/result, confirmed saved changes, and the specific measurement, observation or consequential decision needed from the user. One primary action should open that exact work. Use existing authorized work/job/fact sources; do not introduce a parallel plan, infer running status from Bob focus, or share private chat with the crew. Keep technical diagnostics expandable and retain an honest distinction between missing physical evidence and a service failure.

**Owner:** `ProjectHome.tsx`, `Layout.tsx`, `AskBob.tsx`, `DrawingRequests.tsx`; data/AI owners supply any missing authorized projection.

**Acceptance:** return after reload while work is running, waiting for a measurement, completed, failed or session-paused. Identify what happened and the next useful action without rereading the transcript. Unknown activity must remain unknown.

### FINDING-V05 — Project recommendations do not consistently follow the work being advanced

**Consequence:** IMPORTANT. A user can be guided toward project-wide setup even when the relevant work already has its own target and phase. This weakens UC-001 and mixed-phase orientation.

**Observed:** `ProjectHome.tsx` computes “Evidence next” from recorded missing measurements, a Project-level target and Project-level drawing. It does not select the next action from the active Step's complete state. With no Project target, the card recommends choosing one even when independently scoped Areas have targets. The phase explanation is collapsed below the Plan/drawings/tools. `areaNextAction` supplies phase-based defaults; the routed `AreaWorkstream.tsx` already improves Build actions using real task readiness and should be retained as a useful foundation.

**Proposed fix:** orient the top of the page around the goal, relevant scope, current phase and why the next action matters. Draw the action from that work's actual prerequisites and current records. The phase remains orientation, not five navigation tabs or a mandatory linear wizard. A phase change stays an explicit user decision under the current contract; phase must never stand in for readiness.

**Owner:** `ProjectHome.tsx`, `ProjectStepWorkspace.tsx`, `AreaWorkstream.tsx`, `projectPhase.ts`, `PhaseUI.tsx`.

**Acceptance:** one Project in Build with one complete Area, one building Area and one designing Area; no compulsory Project target is invented for independently scoped work. Repeat with a small Project containing root Steps and no Areas. Check missing/stale/failed reads without claiming readiness.

### FINDING-V06 — Visible work and Bob's selected work can diverge

**Consequence:** IMPORTANT. “Help with this” can lack the Step the person is visibly reading. Moving between broad tool doors can also lose the Area context.

**Observed:** in `ProjectStepWorkspace.tsx`, manually opening a `StepCard` changes local `open` state only. `useBobSurface` receives a `planStepId` only when the URL has `?step=...`. Explicit receipt/drawing-request links do carry that parameter and existing fixtures cover them. `ProjectWorkspaceNav.tsx` uses fixed `/project`, `/facts` and `/people` destinations, discarding Area/Step selection. Individual Area tool links already preserve their Area correctly. The unused `AreaDetail.tsx` is not the routed Area screen and is not evidence of a live context bug.

**Proposed fix:** an explicit, visible selected work context and a contextual “Work with Bob here” action. Preserve the relevant selection through navigation where the destination supports it; make returning to the whole Project deliberate. Multiple expanded Steps must not silently select an arbitrary one. Keep frontend navigation pointers separate from server authority.

**Owner:** `ProjectStepWorkspace.tsx`, `ProjectWorkspaceNav.tsx`, `bobSurface.ts`, `AskBob.tsx`.

**Acceptance:** open a Step manually, select work with Bob, send an ambiguous follow-up and inspect the exact pointer. Repeat after navigating to related evidence, returning from a Task, changing Area and retrying an older request. Existing retry context and project isolation must survive.

### FINDING-V07 — The working Task view prioritizes authoring and scatters supporting material

**Consequence:** IMPORTANT. A person doing physical work has to scan editing controls to reach the instruction and its supporting image. UC-003 and UC-004 need different default presentation of the same records.

**Observed:** `TaskDetail.tsx` places editing/status/readiness controls before instructions. Each instruction exposes move up/down, edit, ask Bob and delete controls before its content. Images are behind “Instruction images”; media editing is shown when expanded. Plan Steps contain named drawing links, while the normal Task view renders drawing requests rather than a general list of saved Step-linked drawings. The volunteer Task view already has a dedicated `VolunteerDrawings` reader.

**Proposed fix:** default to an execution view: result to achieve, next instruction, relevant authorized image/drawing, prerequisites and completion check. Put editing/reordering/removal in an intentional edit mode or secondary action. Reuse canonical media/drawing identities and exact revision/source notices; never imply an illustration is a measured drawing. Provide appropriate manual and Bob-assisted attachment actions from the same work.

**Owner:** `TaskDetail.tsx`, `TaskReadinessPanel.tsx`, `ProjectImages.tsx`, `ProjectStepWorkspace.tsx`; reuse drawing renderers and preserve participant permissions.

**Acceptance:** on a 320/390 px phone a named participant can find the current instruction and right drawing, understand a blocker, record a check/photo and return later. An organiser can edit the same instruction without creating duplicate media or losing links. Check stale/revoked sources and the existing volunteer flow.

### FINDING-V08 — Organising a build day and participating in it are not yet coherent journeys

**Consequence:** IMPORTANT. UC-002 depends on matching people, timing, prerequisites and practical instructions, not simply having all those pages available.

**Observed:** `Today.tsx` defaults to Everyone, offers My tasks and ranks readiness. The event surface shows attendance and scheduled Tasks; People, Food and Shopping are separate destinations. The guest flow is simpler and requires only a name, but has a separate presentation. Existing Today navigation, event-task links, explicit readiness and guest participation are valuable foundations, not missing capabilities.

**Proposed fix:** two presentations of the same saved work: “My build day” for a participant (what, where, with whom, what to bring, can I start) and “Organise the day” for a lead (attendance, assignments and blockers). Use real identity/assignments and allow an explicit switch; do not create duplicate plans or invent automatic replanning that the backend does not provide. Show food/allergies when relevant.

**Owner:** `Today.tsx`, `EventDetail.tsx`, `People.tsx`, `VolunteerProject.tsx`, shared work/readiness components.

**Acceptance:** three build days with different attendees, one cancellation and one material delay. Participant and organiser see the same work and updates. Name-only guests remain supported, incomplete work remains visible and unknown readiness never becomes ready.

### FINDING-V09 — Competing navigation layers and setup language obscure the primary job

**Consequence:** IMPORTANT, after the work/context fixes. A new user must learn where to look before learning what to do.

**Observed:** desktop has a domain sidebar plus Plan/Reference/Together; mobile has those workspace doors plus Home/Project/Today/Events/Account. Home puts Calendar, Buildings & family, Invite, Settings, Close project and New project in the header before the resume/project list. The initial Project screen already accepts a plain-language idea, but subsequent empty-plan and Area-management surfaces foreground the model rather than a concrete outcome.

**Proposed fix:** keep stable navigation and the existing workspace grouping, but make each door internally coherent. Put continuing/starting a project ahead of household administration. Within a Project, show the relevant work and one useful action first; keep broader tools reachable secondarily. Explain unfamiliar labels where used rather than adding more mandatory setup. Do not turn Areas into a required folder, or add a second work hierarchy.

**Owner:** `Layout.tsx`, `ProjectWorkspaceNav.tsx`, `AccountDashboard.tsx`, `ProjectStart.tsx`, `ProjectStepWorkspace.tsx`.

**Acceptance:** a first-time user starts a small build from plain words without learning Area/Step/Task terminology; a returning user finds their current work; a participant reaches Today in one tap. Check both desktop and mobile without phase-dependent tab rearrangement.

### Recommended review sequence

Start with V04–V06 as one Project/work-context proposal, then the Task execution view in V07. Use those flows to refine the navigation and build-day presentation in V08–V09. Proposed directions require implementation and ordinary-user acceptance; no current finding is closed by this audit. Keep Bob autonomy/prompt and CAD-generation changes with their existing parallel owners.

## Navigation depth review — 2026-10-18

**Status:** proposed access budget and open findings, requested after the usability review. No application change or adopted navigation policy. The baseline and evidence limitations above still apply; main was refreshed and remains `e0ee015`.

**Conclusion:** drawings are often only one or two actions away, but their entrances are buried, inconsistently named and separated from the current Task. Count discovery, first usable content and returning to work as well as forward navigation. [Nielsen Norman Group's review of the three-click rule](https://www.nngroup.com/articles/3-click-rule/) explains why a universal click maximum is not supported by research. The numbers below are a proposed Bob product budget derived from its everyday work, to validate with users.

### Proposed access budget

**Owner clarification:** the limit must name its starting point. Choosing which Project to enter, and then which work to focus on, can be useful actions before opening its material. Assess context selection and access within that context separately, while retaining the full journey count. An optional phase-oriented view is an idea to explore, not an approved requirement to traverse phases.

| Starting point / need | Proposed budget |
| --- | --- |
| Project list: choose the intended Project | One direct selection for a visible Project; measure searching separately. This precedes the within-Project budget. |
| Open Project: choose the relevant work context | Normally one or two meaningful selections, depending on scope: for example an Area/Step, or an optional phase view followed by the work. Small Projects should need fewer. |
| Open work surface: current scope, next action and relevant blocker | Visible without expanding another section. |
| Open Task or selected Step/work context: its relevant drawing/instruction image | At most one action to a usable reader; show a named entrance beside the work. Do not ask the user to choose the Project or work again. |
| Open Project overview: commonly needed Project-wide reference material | At most two actions, with the entrance visible in the opening viewport on supported phones. This does not require every Task-specific drawing in a large Project to be two actions from the Project list. |
| Relevant work/reference surface: occasional history or technical detail | Aim for at most three actions. Deeper exceptions need a concrete user task and a clear return path. |

For example, Project list → Deck Project → optional Build view → Assemble railing → drawing is four forward actions in total, including useful context selection. From the already open Assemble railing work, the same drawing should be one action away. Show the current Project and work context, retain it on return, and offer resume/deep links so repeat visits do not require reselection. "More tools", "Details" and an extra image dialog do not establish a new work context or restart the budget.

If explored, choosing a phase view only filters or foregrounds work; it does not change the saved lifecycle phase. Drawings retain their identity and remain reachable across phases. Mixed-phase Areas/Steps must stay understandable. This idea must be reconciled with the existing phase UI contract before implementation; no new phase container, mandatory phase route or lifecycle transition is introduced by this audit.

Count route changes, compulsory accordion expansion and compulsory image-opening actions. Additional filtering/pagination adds effort; the shortest path is not proof that a large project meets the budget. Measure scrolling, wrong turns and time to the first usable view separately. Optional zoom, choosing another projection or rotating 3D is interaction with material already reached, rather than a hidden navigation level.

Primary work material should have no more than one disclosure layer and no compulsory dialog inside a dialog. Keep a compact status/version/source-warning summary with the drawing; put detailed provenance, author history and technical checks in an intentional secondary view. Do not hide changed/unavailable sources, unknown dimensions or consequential assumptions to meet a viewport target. A stable entry can remain visible even when the warning itself needs more space.

The existing Project → optional Area → Step → Task model describes relationships, not a mandatory path users must traverse. Contextual links should jump to the same authorized drawing and recorded revision. Keep one shared truth, optional Areas, stable workspace navigation and the one-tap Today path. Do not add a global tab for every kind of content or load all full drawings eagerly.

### Observed paths

These are minimum forward actions from code, for an available item on the current list page. They are not user-test timings. CAD/parametric readers show geometry inside the version dialog; an image-based drawing requires the additional “View drawing image” action shown below.

| Start and path | Current actions | Discovery / context cost |
| --- | --- | --- |
| Project → visible recent drawing card | 1 to geometry; 2 to drawing image | The three recent cards follow the entire Plan; recency does not identify the current Task's drawing. |
| Project → All drawings → open item | 2 to geometry; 3 to drawing image | All drawings also follows the Plan. Creation controls and target information precede the library list. |
| Open Step → named drawing link | 1 to geometry; 2 to drawing image | Links follow Tasks and secondary work controls. A collapsed Step adds one action. |
| Normal Task without a matching saved request → primary Step backlink → drawing | 2 to geometry; 3 to drawing image | No general saved Step-drawing reader in TaskDetail. A matching saved DrawingRequest already offers a direct link and is a useful exception. |
| Area header → More tools → Drawings → item | 3 to geometry; 4 to drawing image | A separate Planning tools link gives a two-action geometry path, but follows the main content on a narrow screen. |
| Open volunteer Task → View drawing | 1 to geometry or drawing image | A useful existing contextual reader, but its entrance follows all instructions/checks. |
| Current instruction → Instruction images | 1 to preview; 2 to original | Expansion exposes media management as well as the image; whether the preview is readable depends on the actual image. |
| Project → Reference → measurement list | 1 to current values | Values are directly visible; Source and notes adds one expansion. Reference has no onward Drawings link. |

Drawing history is already a separate optional path: from the drawing list, History → selected version is two actions before any additional image action. Technical source details are normally collapsed. The `cad-drawing-390.png` fixture explicitly expands Parameter sources before capture; it is not evidence that every CAD reader starts with that panel open.

### FINDING-V10 — Drawing entrances are buried and the Reference door is incomplete

**Consequence:** IMPORTANT; sharpens V07 and V09. A short route is difficult to find when it follows a growing Plan or sits behind an unexpected label.

**Observed:** `ProjectHome.tsx` renders `ProjectStepWorkspace` before `ProjectDrawings`. The latter remains visible in Build, while the separate tool shortcut is inside collapsed Planning tools. `AreaWorkstream.tsx` offers drawings through More tools or the lower Planning tools panel. `ProjectWorkspaceNav.tsx` highlights Reference for drawings but sends that door to `ProjectFacts.tsx`, which offers Measurements and Existing parts without a Drawings destination. Normal TaskDetail lacks the general reader already available to volunteers.

**Proposed fix:** a stable, named Drawings entrance near the Project heading/current work, contextual drawing links beside the selected Step/Task, and coherent destinations within the existing Reference workspace. Preserve Area/Step scope. Derive relevance from saved links, not just latest-modified order. If no linked drawing exists, say so and offer the appropriate next action.

**Owner:** `ProjectHome.tsx`, `ProjectWorkspaceNav.tsx`, `ProjectDrawings.tsx`, `ProjectStepWorkspace.tsx`, `AreaWorkstream.tsx`, `TaskDetail.tsx`.

### FINDING-V11 — Opening a drawing does not consistently reveal the drawing

**Consequence:** IMPORTANT. The user must recognize an evidence-management action and sometimes open a second dialog to see the requested material.

**Observed:** the list action in `Artifacts.tsx` says “Open drawing” for some recipes but “View evidence” for ordinary image-based and CAD records. `VersionDetails` places description, assumptions, actor/date and target lineage before geometry. For image-based records it puts measurements before “View drawing image”, which opens a second Modal. `GeneratedDetails` also puts generation/input details before the generated wall view. CAD's optional source-map disclosure is already closed by default.

**Proposed fix:** use a consistent “Open drawing” action and show the saved drawing in the first reader with compact qualification/status information. Offer detailed evidence/history as secondary content in that reader. Viewing an attached drawing image must not require another dialog. Keep exact revisions, authorization and stale/unavailable-source behavior; never substitute an unqualified image or silently upgrade Concept to build-ready.

**Owner:** `Artifacts.tsx`, shared drawing renderers, `ProjectImages.tsx`.

### FINDING-V12 — Closing a contextual drawing does not return to the originating work

**Consequence:** IMPORTANT. Repeated drawing ↔ instruction checks require reconstructing context, even after a short forward path.

**Observed:** Step/project deep links correctly identify the drawing and revision, but `ConnectedArtifacts.close()` closes the dialog and removes its query parameters, leaving the drawing library. There is no originating Task/Step return target. Browser Back may reach the prior route; that is distinct from the reader's Close action. List-open dialogs also use local state rather than a version URL.

**Proposed fix:** preserve an explicit originating work context and make Close/Back return predictably to that Task/Step and reading position. Direct links opened without an origin should retain a clear library/project return. Keep the canonical artifact/revision URL and never treat a navigation pointer as access authority.

**Owner:** `Artifacts.tsx`, drawing-link callers and route/scroll restoration.

### Acceptance and first implementation slice

Start with contextual drawing access plus the reader/return loop (V07, V10–V12). This gives the proposed depth budget a concrete first application before changing broader navigation.

- Use 320/390 px phones and desktop with a small root-Step project and a larger mixed-phase project containing at least 10 Steps, 60 Tasks and 12 drawings. The drawing entrance must not move below the full Plan as data grows.
- Name the start and destination for each test: Project list → intended work/drawing, open Project → work/drawing, and open Task → drawing. Record context-selection actions, access actions and the complete journey. Repeat through a resume link; known context should not require reselection. Any phase-view experiment must leave the saved phase and cross-phase drawing access unchanged.
- From a normal Task with no saved DrawingRequest card, open its linked drawing in one action and return to the same instruction/position. Repeat for a Step, volunteer Task and Project overview.
- Cover CAD, generated geometry and an attached drawing image. First opening presents the material and relevant status, with no second dialog required to see the image. Check missing, changed, unavailable and historical sources and exact revisions.
- Ask an unfamiliar owner and participant to find the right drawing and resume work without coaching. Record success, time to usable content, taps, scrolling and wrong turns; check that they understand the version/status. These user observations are still outstanding.

**Verification of this audit:** source inspection and existing matching CI screenshots only; no new interactive browser run or implementation tests claimed. Documentation links/whitespace are checked locally. Implementation must use the repository's normal browser and release gates and preserve the performance improvements from PR #269.

### Implementation follow-up — first drawing-access cleanup

The owner requested implementation of the cleanup after clarifying context-relative
depth. V10–V12 and the drawing-access portion of V07 are addressed in source on
`ux/drawing-access-and-history-20261018`, based on main `f9e6498`. The current behavior
has one owner in [the artifact contract](../../Docs/artifacts.md#drawing-access-reader-and-return).
This does not implement the broader Task edit/execution separation, phase-view idea
or V04–V09 as a whole. Browser/release proof and ordinary-user acceptance remain
required before closing the relevant findings.
