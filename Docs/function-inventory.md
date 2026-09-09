# bob — current capability & gap inventory

> **Status:** current implementation audit  
> **Source of truth for:** what bob materially supports today vs what is partial or missing  
> **Audited against:** current `main` runtime/schema/code after the user-story contract was added  
> **Related product intent:** `Docs/user-stories.md`

> **Slice 0 release delta (2026-09-09):** project membership/RLS, explicit-project
> read-only lookup, direct OpenAI tools and source disclosure are implemented with
> local and CI tests. OpenAI is the permanent provider; Launchpad is retired. The
> backend and frontend are deployed; the numbered audit below is the **historical
> baseline before Slice 0 and milestones 1A/1B**. Read both release deltas and their
> verification records before treating an old gap as current.
> [Verification evidence and limits](slice-0-verification.md) own the evidence.

## Media and task foundation release delta — 2026-09-09

**Status:** 1A and 1B are implemented, merged and deployed. The
[verification record](foundation-verification.md) owns SQL/RLS tests, browser
checks at three widths, live Auth/PostgREST/Storage evidence and its limits.

| Foundation | Verified status |
|---|---|
| Private project images | **BUILT.** `bob-project-media`, `media_assets` and membership-guarded commands store JPEG/PNG/WebP originals up to 6 MiB, with purpose, actor, time and immutable file identity. Authenticated read-back, interrupted-upload recovery and retryable deletion are supported. Public app assets retain their separate role. |
| Project/area photos | **BUILT.** Dashboard and Area images upload and display real project files. Originals open without cropping. Existing reference labels remain clearly labelled notes. |
| Task details and ordered steps | **BUILT.** Task instructions, editable ordered steps, completion state and required checks persist. Revision checks reject stale edits; required checks also guard normal API completion. |
| Images on tasks or steps | **BUILT.** Upload or attach an existing project image to a task/step. Same-project relations are enforced. Removing an attachment or step keeps the original in the project gallery. |
| Generated guidance and image analysis | **GAP.** Manual illustrated steps work without AI. Images/steps are not yet supplied to OpenAI; the existing lookup allowlist is unchanged. Vision remains 1C. |
| Full evidence/planning loop | **PARTIAL.** Real media and manual task guidance now exist. Measurements, component records, solution/drawing revisions, calculations and structured progress/as-built history retain their later gates. |

The [V1 delivery order](v1-plan.md#delivery-order--foundations-first-owner-decision-2026-09-09)
prioritises persistent foundations before new AI consumers. No owner Bob trial
was required to deliver these milestones.

This inventory is deliberately stricter than a feature wishlist. A capability is only marked **BUILT** when the current runtime/data model materially supports the user goal. **PARTIAL** means useful pieces exist but an important part of the target journey is missing. **GAP** means the target capability has no meaningful current implementation.

The current product has a strong collaboration/coordination core. The biggest missing layer is the new **understand the real build → measure → choose solution → drawings → calculated materials → executable guidance → as-built memory** loop.

## Historical audit — before Slice 0 and milestones 1A/1B

The executive summary and numbered sections below preserve the original audit.
They are not current claims where the release deltas above supersede them.

### Executive summary

### Strongly built today

bob already has a useful project-coordination product:

- multi-project account/project shell;
- areas/work zones;
- basic tasks with skill, estimated time, status and assignees;
- derived area progress from real tasks/material delivery state;
- manual materials CRUD and one consolidated checkable/printable shopping list;
- people, skills and dietary information;
- invitations and sign-in flows;
- build events with attendance/capacity;
- a simple day-of active-task view;
- project announcements;
- meal planning, allergy/diet matrix and food shopping;
- an Ask bob assistant seam with direct OpenAI and Launchpad backends;
- Supabase live mode plus mock/demo mode;
- responsive desktop/mobile shell and printable list surfaces.

### The large gaps

The new product loop is mostly not implemented yet:

1. **Real media** — photos/files are not actually stored/rendered; reference images are labels/placeholders.
2. **Measurements & evidence** — no measurement model, provenance, missing-measurement checklist or existing-condition register.
3. **Solution/version model** — no alternatives, selected target, revisioning or stale-output tracking.
4. **Drawings** — no measured plan/elevation/section generation or drawing revisions.
5. **Calculated BOM** — materials are manually authored; no geometry-derived quantities, stock deduction, fixings/paint calculations or calculation provenance.
6. **Executable work plan** — tasks exist, but not ordered dependencies, tool lists, project-specific work cards, readiness reasons or generated sequence.
7. **How-do-I guidance** — no task-level detailed instructions, framing diagrams, checkpoints, common mistakes or contextual guidance.
8. **As-built/project memory** — no task progress log, progress photos, hidden-work/as-built record, change propagation or revision history.
9. **AI authority/context** — Ask bob cannot update project truth, does not receive most of the new planning context, and currently chooses the first database project rather than the explicit active project.
10. **Authority isolation** — the app has auth and project scoping in the client, but current RLS is still a household-style posture: reads are public and project-content writes are allowed to any authenticated user rather than enforced per project/role.

---

# 1. Account, project shell and persistence

| Capability | Status | What exists today | Gap / limitation |
|---|---|---|---|
| Create project | **BUILT** | Fresh install can create a project; account dashboard can create additional projects. | New project intake is form-first; no photo-first conversational intake. |
| Multiple projects | **BUILT** | Account dashboard lists projects and an active project is selected for normal app reads. | AI context is not reliably tied to this active project; see Ask bob section. |
| Project scheduling | **BUILT** | Projects can have start/end dates; account calendar/dashboard uses them. | Build-event dates themselves are still authored display strings rather than normalized scheduling objects. |
| Account notes/settings | **BUILT** | Account notes, settings and account-level dashboard exist. | Notes are not a substitute for structured project evidence/decisions/history. |
| Live persistence | **BUILT** | Supabase mode persists project data through the single `database.ts` seam. | Several planned new concepts have no schema yet. |
| Mock/demo mode | **BUILT** | In-memory Skogsstuga data supports UI/dev without env setup. | Mock writes reset on reload by design. |
| Return later to same project truth | **PARTIAL** | Existing project/area/task/material/people/event/food data persists in live mode. | No persisted measurements, solution decisions, media files, drawings, guidance, progress/as-built evidence or Ask bob conversation. |

**Foundation already worth preserving:** all UI data access runs through `src/data/database.ts`; this is a good seam for adding new domain concepts without teaching every screen about Supabase directly.

---

# 2. Authentication, membership and authority

| Capability | Status | What exists today | Gap / limitation |
|---|---|---|---|
| Sign in | **BUILT** | Supabase Auth supports email/password and magic link; live mode gates the app behind sign-in. | — |
| Guest access | **BUILT** | Shared authenticated Guest identity is supported. | Household posture, not strong private-project isolation. |
| Invite a person | **BUILT at UI/workflow level** | Invite flow registers a crew member/email; later sign-in claims the person. | Project access is not fully enforced through membership-aware RLS. |
| Join as volunteer | **BUILT** | Unknown signed-in emails can join as a volunteer profile. | Role/permission model remains permissive. |
| Per-project read authority | **GAP / foundation risk** | Client queries normally filter by active project. | Database read policies are public (`read_all`). API-level project privacy is not enforced. |
| Per-project write authority | **GAP / foundation risk** | Writes require an authenticated session. | Content RLS uses `with check (true)` / `using (true)` for authenticated users: membership/project/role is not enforced server-side. |
| Role-specific authority | **GAP** | Person roles exist as data/display. | Organiser/Volunteer/Food manager do not currently translate into meaningful server-enforced action permissions. |

**Important:** this does not mean the current household app is unusable. It means future claims such as “private project”, “only organisers may approve solution changes”, or “AI can write safely” need an authority upgrade before they are true.

---

# 3. Areas / work zones

| Capability | Status | What exists today | Gap / limitation |
|---|---|---|---|
| Create/edit/delete areas | **BUILT** | Area modal supports name, description, icon, lead and delete. | — |
| Area lead | **BUILT** | One person can be designated lead. | No richer crew-lead/supervision rules. |
| Area crew | **PARTIAL** | `area_crew` exists and area shows crew. | UI/flows are less developed than task assignment; no event-specific area crew planning. |
| Area progress | **BUILT for basic readiness** | Assigned %, materials-delivered % and done % are derived from actual tasks/materials rather than trusting stale seed fields. | Readiness does not include dependencies, tools, measurements, permits/unknowns or event-specific readiness. |
| Area reference images | **PLACEHOLDER / PARTIAL** | Areas contain `referenceImages` and UI has an Images tab. | Values are only text labels; no real image bytes/storage/runtime rendering. |

---

# 4. Tasks and work ownership

## Built task model today

A current task supports:

- area;
- name;
- skill requirement: novice / intermediate / expert;
- estimated time as authored text;
- status: todo / doing / done / blocked;
- one or more assignees;
- an authored `materials` readiness fraction string.

CRUD, assignment and status changes are wired through the live/mock data layer.

## Gap inventory

| Capability | Status | What exists today | Gap / limitation |
|---|---|---|---|
| Create/edit/delete task | **BUILT** | Full basic CRUD. | Task shape is intentionally very small. |
| Set skill requirement | **BUILT** | novice/intermediate/expert. | No actual trade/skill requirement list per task, only one coarse level. |
| Estimated duration | **BUILT / weak model** | Authored string such as `3h`. | No numeric duration, crew-size assumptions or estimate provenance. |
| Task status | **BUILT** | todo/doing/done/blocked. | Blocked does not carry a structured blocker reason/type. |
| Assign people | **BUILT** | Multiple assignees supported. | No event-specific assignment or staffing schedule. |
| Task description/scope | **GAP** | Name is the only work instruction. | Need practical scope, expected result and notes. |
| Tools per task | **GAP** | No Tool domain concept. | Cannot prepare/consolidate tools for a build day. |
| Materials linked to task | **GAP** | Material belongs to a project and area label; task has only an authored `x / y` string. | Cannot calculate/read exact task BOM or readiness from canonical task-material links. |
| Ordered work sequence | **GAP** | Tasks are listed; status order exists in AI briefing. | No explicit work order/sequence. |
| Dependencies | **GAP** | `blocked` status exists. | No `Task B depends on Task A`, no dependency graph, no automatic readiness. |
| Readiness reason | **PARTIAL** | Area-level percentages and task blocked status. | Cannot say “blocked because sill plate not done / missing 12 screws / missing measurement”. |
| Task media/drawing | **GAP** | No task-media relation. | The exact image needed during work cannot live on the task. |
| Task progress notes | **GAP** | Original PRD mentions them, but current Task type/schema has no update/comment log. | Need per-task progress/history. |
| “How do I?” guidance | **GAP** | Ask bob can answer generic questions separately. | No task-aware structured detail, steps, checkpoints or contextual construction image. |

---

# 5. Materials and shopping

## What works today

Material records support:

- name;
- authored quantity string;
- area label;
- supplier;
- status: needed / ordered / delivered / backorder;
- authored cost string;
- category + icon.

The shopping screen consolidates all project materials by category, supports adding items, ticking delivered/not-delivered, shows progress, prints, and calculates a rough total by extracting digits from the authored cost string.

| Capability | Status | What exists today | Gap / limitation |
|---|---|---|---|
| Manual material CRUD | **BUILT** | Add/edit/delete material. | — |
| Material status flow | **BUILT** | needed/ordered/delivered/backorder. | “used”, reserved, returned etc. not modeled. |
| Consolidated shopping list | **BUILT** | Grouped, checkable and printable. | Not generated from a construction plan. |
| Estimated total | **PARTIAL** | Rough sum from strings like `1 920 kr`. | No numeric amount/currency model; fragile across formats/currencies. |
| Material linked to area | **BUILT / weak relation** | Uses area **name** string. | No stable area id relation; rename is specially followed through in code. |
| Material linked to task | **GAP** | — | Required for task BOM/readiness. |
| Existing stock / “we already have this” | **GAP** | Delivered can mean acquired, but there is no separate initial-stock/reuse truth. | Cannot distinguish “already owned”, “bought for project”, “reused component”, condition or reservation. |
| Geometry-derived BOM | **GAP** | — | No automatic timber/board/insulation quantities from measurements. |
| Fasteners/consumables calculation | **GAP** | Can be manually entered like any material. | No derived screws/nails/tape/paint/membrane quantities. |
| Calculation provenance | **GAP** | — | Cannot explain formula, waste allowance, coverage or source assumption. |
| Waste/spill allowance | **GAP** | — | Needed for honest purchase quantities. |
| Normalized quantity/unit | **GAP** | `qty` is authored text. | Cannot safely perform arithmetic/conversions. |

---

# 6. People, skills and collaboration

| Capability | Status | What exists today | Gap / limitation |
|---|---|---|---|
| Crew list | **BUILT** | People page with roles/skills/diet. | — |
| Skills per person | **BUILT** | Named skill tags with novice/intermediate/expert level. | Ask bob's AI briefing currently does not include these skill records. |
| Edit person | **BUILT** | Role, diet, skills can be edited. | Server-side role authority not enforced. |
| Assign task | **BUILT** | Assignees appear on task/area/day surfaces. | No AI skill match/supervision logic. |
| Lead less experienced helpers | **PARTIAL concept only** | Area lead + multiple assignees can represent this informally. | No explicit supervision relationship or rule that makes a task safe/startable. |
| Skill-based suggestions | **GAP** | — | No matching engine for “these people are coming; these tasks fit them”. |

---

# 7. Build events and day-of use

| Capability | Status | What exists today | Gap / limitation |
|---|---|---|---|
| Create/edit/delete build event | **BUILT** | Title/day/time/place/capacity/food. | Day/time are authored strings; no normalized event scheduling model. |
| Join/leave build day | **BUILT** | Attendance and capacity update. | — |
| See attendees | **BUILT** | Avatars/counts in events/dashboard. | — |
| Day-of task surface | **PARTIAL** | `/today` shows all active todo/doing tasks for the active project with skill/status/assignees. | It is not a true event-specific or current-user task schedule; the DB view is simply all active project tasks. |
| “My tasks today” | **PARTIAL** | UI language/navigation implies personal day-of context. | Data source does not filter by current participant or selected build event. |
| Event-specific task assignment | **GAP** | — | Task ownership is general, not scheduled to a specific event/day. |
| Build-day readiness | **PARTIAL** | Dashboard has “needs attention”; area basic readiness is derived. | No dependency/tool/measurement/skill-capacity readiness calculation for a specific event. |
| Automatic crew/task matching | **GAP** | — | No matching by attendance + skill + task need + supervision. |
| Handover to next build day | **PARTIAL** | Persisted task/material statuses allow continuation. | No structured “what changed last time / what is newly ready / progress evidence” handover. |

---

# 8. Announcements and communication

| Capability | Status | What exists today | Gap / limitation |
|---|---|---|---|
| Project announcements | **BUILT** | Post updates, pin/unpin, react, delete. | — |
| Shared source for day-of changes | **BUILT** | Dashboard previews announcements; project feed exists. | No push/email notification. |
| Announcement comments | **PLACEHOLDER / GAP** | `comments` count exists in type/data. | No visible comment thread workflow. |
| Per-task discussion/update log | **GAP** | — | Important for work handoff and progress. |
| Real-time chat | **INTENTIONALLY NOT BUILT** | Original product intentionally uses announcement board instead of chat. | Not currently a product gap unless strategy changes. |

---

# 9. Food coordination

| Capability | Status | What exists today | Gap / limitation |
|---|---|---|---|
| Meal plan | **BUILT** | Meals can be added/edited and linked to project/event data. | — |
| Dietary/allergy matrix | **BUILT** | Editable flags per participant. | — |
| Food shopping list | **BUILT manual** | Checkable food groups/items. | Ingredients are not generated/scaled from recipes/headcount. |
| Use confirmed attendance | **PARTIAL** | App has both attendance and food data and shows summary context. | No deterministic recipe/headcount auto-scaling of food shopping. |

---

# 10. Ask bob / AI

## Built today

- floating Ask bob drawer on every project surface;
- direct OpenAI synchronous backend when configured;
- Launchpad async backend with polling, reports/artifacts and mid-run clarification handling;
- fallback behavior when AI backend is unavailable;
- compact live briefing containing project, areas, tasks, materials, events and people/diet context;
- requests use the caller's JWT for project data reads in the edge function.

## Gaps / risks

| Capability | Status | Current reality | Gap / limitation |
|---|---|---|---|
| Answer questions about project data | **BUILT** | AI gets a bounded briefing. | Briefing does not yet contain the new planning objects. |
| Active-project correctness | **PARTIAL / BUG** | Client has an explicit active project. | Server `buildContext()` currently queries `projects.limit(1)` and picks the first row instead of receiving the active project id. Multi-project answers can therefore use the wrong project. |
| People skills in AI context | **GAP** | People name/role/diet are included. | `person_skills` are not included, so Bob cannot reliably do skill matching from live data. |
| Media/image context | **GAP** | — | No real images/media available to Ask bob from project storage. |
| Measurement/evidence context | **GAP** | — | No domain model yet. |
| Selected solution/drawing context | **GAP** | — | No domain model yet. |
| Ask bob writes project data | **GAP** | Assistant can answer; UI action handler explicitly says it cannot perform the action yet. | Need bounded propose/confirm/write commands with authority/provenance. |
| Persist Ask bob conversation | **GAP** | Chat/extra messages are client state; DB README explicitly says `ChatMessage` is not persisted. | Important decisions can disappear unless separately captured. |
| AI provenance/truth classes | **GAP** | Some runtime failures are honest; user-story contract defines the desired boundary. | No persisted FACT / DERIVED / ASSESSMENT / UNKNOWN/provenance model. |
| Image generation inside bob | **GAP** | — | The veranda visualisation workflow currently exists outside bob, not in the app. |
| Drawing generation inside bob | **GAP** | — | — |

---

# 11. Media, photos and visual project memory

This is currently the clearest implementation gap relative to the new product direction.

| Capability | Status | Current reality | Gap / limitation |
|---|---|---|---|
| Upload real photo/file | **GAP** | No storage/upload runtime. | Need asset storage + metadata + RLS + render path. |
| Current-state photo | **GAP** | — | Need media type + project/area relation. |
| Target/mockup image | **GAP** | — | Need proposal/version semantics. |
| Cut-through/section image | **GAP** | — | Need guidance/drawing type. |
| Task guidance image | **GAP** | — | Need task-media relation. |
| Before/during/after progress photos | **GAP** | — | Need task/area progress timeline. |
| As-built hidden-work photo | **GAP** | — | Need durable as-built classification and later discoverability. |
| Reference image label | **BUILT placeholder** | `area_reference_images` stores `label`, and UI renders placeholder tiles. | This is not a real media implementation. |

---

# 12. Measurements and existing conditions

There is no current first-class model for any of the following:

- measurements;
- unit + numeric value;
- what a measurement describes;
- measured vs estimated vs provided specification;
- measurement provenance/actor/date;
- superseding an estimate with a verified value;
- required-measurement checklist;
- existing structural element register;
- component condition;
- reuse / inspect / remove / replace state;
- owned reusable components such as windows/doors;
- linking existing components to a solution/task.

**Status: GAP across this whole domain.**

This is a foundation for trustworthy drawings and quantities; it should not be simulated with free-text notes if Bob is expected to calculate from it later.

---

# 13. Solutions, alternatives and design decisions

There is no current first-class concept for:

- solution/proposal;
- alternative A/B/C;
- selected/current target;
- approval/decision;
- solution revision;
- assumptions attached to a solution;
- generated mockup provenance;
- stale downstream output when the target changes.

**Status: GAP.**

Today the closest equivalents are project description, free text, historical mockup/reference labels and conversation. None provide a safe canonical selected design.

---

# 14. Drawings

No current domain/UI/runtime support exists for:

- plan drawings;
- elevations;
- sections;
- dimensions on drawings;
- drawing revisions;
- verified vs assumed annotations;
- linking drawings to solution revision;
- linking drawings to tasks/material calculations;
- declaring an output conceptual vs measured/build-ready.

**Status: GAP.**

---

# 15. Work guidance — “How do I?”

Current task UI is intentionally lightweight, which is useful for build-day scanning. The deeper layer does not exist yet.

Missing capabilities include:

- expandable task instructions;
- step-by-step execution;
- task-specific construction diagram;
- framing/opening detail;
- tool list;
- exact project dimensions surfaced in the guide;
- checkpoints before moving on;
- common mistakes;
- safety / “stop and get professional check” boundary;
- separate generic guidance vs project-specific verified dimensions;
- saved guidance artifact/version.

**Status: GAP**, while basic task cards are **PARTIAL foundation**.

---

# 16. Progress, as-built truth and change propagation

| Capability | Status | Current reality | Gap / limitation |
|---|---|---|---|
| Mark task status | **BUILT** | todo/doing/done/blocked. | — |
| Area progress recalculates | **BUILT** | Derived from actual task assignment/completion + material delivery. | Does not include richer readiness. |
| Record task progress note | **GAP** | — | Original PRD desired this but schema/type lacks it. |
| Progress photo | **GAP** | — | — |
| Before/during/after timeline | **GAP** | — | — |
| Record actual deviation from plan | **GAP** | — | Need change/event or revision semantics. |
| As-built record | **GAP** | — | Need durable record of what is hidden/actually installed. |
| Update downstream plan after change | **GAP** | — | No dependency lineage from solution → drawing → BOM → tasks. |
| Preserve previous revision/history | **GAP** | Existing tables mainly overwrite current record values. | Need deliberate history for high-value design/evidence objects. |

---

# 17. UI, mobile and quality foundation

| Capability | Status | Current reality | Gap / limitation |
|---|---|---|---|
| Desktop shell | **BUILT** | Sidebar + project switcher. | — |
| Mobile navigation | **BUILT** | Fixed bottom navigation and responsive rules. | New photo/field/guidance flows will need Vera review for one-hand use. |
| Themes/design tokens | **BUILT** | Birch/forest/dusk tokens in `src/theme.css`. | Design system is implemented pragmatically, not yet split into the template's `src/design/` contracts. |
| Print support | **BUILT on list surfaces** | Shopping lists and no-print handling. | Drawings/work packs/PDF exports not built. |
| Type/build gate | **BUILT** | `npm run build` and `typecheck`. | — |
| Automated unit/component/E2E suite | **GAP** | Verify skill describes manual/browser verification; package has no test runner. | Increasing domain calculation/authority complexity will need deterministic tests. |
| Home-screen installation / PWA | **BUILT** | Public Swedish phone guide, installation entry in account settings/sign-in, manifest and original tree icon bundle. See `README.md` → Install Bob on a phone. | Final installation is controlled by the phone/browser; existing login and project authority still apply. |
| Offline project work | **GAP / later** | A public connection/retry page is available when navigation loses the network. | No offline project/media cache or queued writes; offline work packs remain later scope. |

---

# 18. Data-model gaps that block the new loop

The current model is excellent for simple coordination but too thin for the new planning/guide loop. New first-class concepts will likely be required for at least:

1. **MediaAsset** — file/storage identity, type/purpose, project/area/task association, provenance.
2. **Measurement** — numeric value, unit, subject, source/truth state, history.
3. **ExistingComponent / StockItem** — reusable physical thing, quantity/spec/condition/status.
4. **Solution / SolutionRevision** — alternative, selected target, assumptions, decision history.
5. **Drawing / ArtifactRevision** — plan/elevation/section/guidance, revision, source solution.
6. **Task dependency / sequencing** — predecessor/readiness relation.
7. **Task detail/guidance** — scope, tools, materials, guidance artifact, checkpoints.
8. **Task material relation** — canonical link from work to BOM/readiness.
9. **Calculation / QuantityDerivation** — inputs, formula/method/version, waste/coverage assumptions, result.
10. **Progress / Observation / AsBuilt** — what actually happened, actor/date/media, deviation from plan.
11. **Decision / provenance/truth class** — where AI/human conclusions become or do not become project truth.

The exact schema should be designed after the next vertical slice is selected; this inventory should not be treated as a migration spec.

---

# 19. Cross-cutting correctness gaps to fix before deepening the product

These are more important than their visual size suggests.

## F-01 — Ask bob uses the wrong project selection mechanism

**Current:** normal app reads use the active project, but `bob-context.ts` selects the first project with `.limit(1)`.

**Impact:** once an account has several projects, Ask bob can reason about the wrong build.

**Recommendation:** make active project id an explicit trusted input to the AI seam and validate the caller may access it.

## F-02 — Project authority is client-scoped, not server-enforced

**Current:** reads are public at RLS level and generic content writes allow any authenticated user.

**Impact:** role/project privacy claims are stronger than actual authorization.

**Recommendation:** before high-consequence AI writes or genuinely private multi-project use, introduce membership-aware RLS/domain commands and explicit role authority.

## F-03 — Important authored strings cannot support reliable calculations

**Current:** task hours, material quantity, material cost, event day/time/capacity are largely authored display strings.

**Impact:** calculations such as exact BOM, costs, duration/capacity scheduling and unit conversion cannot safely build on these fields.

**Recommendation:** add canonical numeric/unit/date fields for calculation-heavy concepts while preserving human-readable display formatting at the UI edge.

## F-04 — No persisted provenance/history for the new high-consequence truth

**Current:** current-state CRUD mostly overwrites values; new measurement/solution/drawing/calculation concepts do not exist.

**Impact:** Bob cannot later answer “why did this measurement/quantity/plan change?”

**Recommendation:** design append/supersede/revision semantics for measurements, selected solutions, drawings, calculations and as-built evidence before those features are built.

---

# 20. What the existing skeleton gives the next phase

We are **not** starting from zero. The next phase can reuse a lot:

```text
AUTH / SESSION
    already exists

ACCOUNT + ACTIVE PROJECT
    already exists

PROJECT SHELL + MOBILE NAV
    already exists

AREAS
    already exists

BASIC TASKS + ASSIGNMENTS + STATUS
    already exists

MATERIAL CRUD + SHOPPING LIST
    already exists

CREW + SKILLS + EVENTS + FOOD + ANNOUNCEMENTS
    already exists

ASK BOB AI SEAM
    already exists

SINGLE DATABASE MODULE
    already exists
```

The new product layer can therefore be added vertically rather than by rewriting bob.

A likely shape is:

```text
existing Bob coordination core
        +
real media/evidence
        +
measurements/existing conditions
        +
selected solution/revisions
        +
calculations/drawings
        +
richer task plan/guidance
        +
as-built observations
```

That is a substantially smaller and safer problem than building an entire coordination product again.

---

# 21. Current gap map by user-story epic

| Epic | Current coverage | Audit summary |
|---|---|---|
| A — Start from real project | **Low / partial foundation** | Projects persist, but photo-first intake/media/evidence loop is missing. |
| B — Measurements & existing conditions | **Very low** | No measurement/existing-component domain model. |
| C — Explore/choose solution | **Gap** | No proposal/version/selected-target model or in-app visualisation flow. |
| D — Buildable drawings | **Gap** | No drawing model/generator/revisions. |
| E — Know what we need | **Medium foundation** | Manual material/shopping system is useful; calculations/stock/task linkage are missing. |
| F — Executable work sequence | **Medium-low foundation** | Basic tasks/status/assignees exist; sequencing/dependencies/tools/guidance are missing. |
| G — Build together | **High functional coverage** | Crew, skills, events, assignments, day view, announcements, food exist; event-specific scheduling/matching/readiness and strict authority are incomplete. |
| H — Capture what happened | **Low** | Task status/material status persist, but progress notes/photos/as-built/revisions are missing. |
| I — Trustworthy Bob | **Partial AI foundation** | Real AI seam exists; active-project bug, limited context, no writes/provenance/truth model. |

---

# 22. Inventory conclusion

The existing app already solves much of **“organise people and work around a build”**.

It does **not yet solve** the part we validated with the veranda conversation:

> “Here is what I have. Help me understand it, tell me what you still need to know, show me options, turn the chosen option into trustworthy build information, calculate what we need, then put that knowledge directly in the hands of the people doing each task.”

That is the primary product gap — and it can be built on top of the existing Bob rather than replacing it.

## Next product step

Use this inventory plus `Docs/user-stories.md` to create the **function difficulty/scope matrix** (`D1–D5`, V0-AUTO / V0-CORE / STRETCH / POST-V0) and then choose one end-to-end vertical slice.
