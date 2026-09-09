# bob — function difficulty, scope and first vertical slice

> **Status:** current next-phase scope contract  
> **Inputs:** `Docs/user-stories.md` + `Docs/function-inventory.md`  
> **Purpose:** decide what to preserve, what to build next, and what *not* to pull into the first implementation wave

This document applies the project-start-kit method to bob **without pretending bob starts from zero**. The collaboration core already exists. The scope below is for the next product layer: turning real-world project evidence into trustworthy plans, materials, work guidance and shared build memory.

## Difficulty scale

Difficulty describes implementation risk, not product importance.

| Level | Meaning in bob |
|---|---|
| **D1** | Local UI/state or straightforward presentation over existing data. |
| **D2** | Ordinary CRUD/persistence using established bob patterns. |
| **D3** | Several domain concepts, history/provenance, deterministic calculations, cross-surface behavior or non-trivial read models. |
| **D4** | Media pipelines, advanced permissions/RLS, AI + files, revisioned artifact workflows, high-consequence state or complex calculations. |
| **D5** | External provider/integration complexity, offline sync, advanced CAD/geometry/ML, distributed or jurisdiction-heavy behavior. |

## Scope labels

- **BASE** — already materially built; preserve and reuse rather than rebuild.
- **V0-AUTO** — low/medium-risk capability that should normally be included in the next-phase V0 because it closes obvious lifecycle gaps.
- **V0-CORE** — may be difficult, but bob is not the intended product without a narrow truthful version.
- **V0-STRETCH** — valuable and coherent with V0, but the central loop can work without it initially.
- **POST-V0** — intentionally later.

A difficult feature can still be `V0-CORE`; the answer is a **narrow honest implementation**, not a fake demo version.

---

# 1. Existing base — preserve, do not rebuild

| Function | Difficulty if rebuilt | Scope | Notes |
|---|---:|---|---|
| Create/manage multiple projects | D2 | **BASE** | Existing account/project shell and active-project concept. |
| Sign in / join / guest session | D3 | **BASE** | Keep existing Supabase Auth seam; authority rules still need strengthening below. |
| Create/edit areas | D2 | **BASE** | Areas are a good physical/work-zone container. |
| Create/edit basic tasks | D2 | **BASE** | Name, skill level, time, status, assignees already work. |
| Assign people to tasks/areas | D2 | **BASE** | Reuse; later add event-specific scheduling. |
| Crew list + named skills + skill levels | D2 | **BASE** | Strong foundation for future matching. |
| Manual materials CRUD | D2 | **BASE** | Reuse as canonical shopping/material surface. |
| Consolidated checkable material shopping list | D2 | **BASE** | Keep; calculated requirements should feed this rather than replace it. |
| Build events + attendance | D2 | **BASE** | Useful collaboration core. |
| Basic day-of task surface | D2 | **BASE** | Keep lightweight; enrich progressively. |
| Project announcements | D2 | **BASE** | Intentionally not a chat product. |
| Meal planning + diet/allergy matrix + food shopping | D2-D3 | **BASE** | Preserve; deeper automation is later. |
| Ask bob UI + OpenAI seam | D4 | **BASE** | Existing AI foundation; provider decision and project context are owned by `supabase/README.md`. |
| Live Supabase + mock mode | D3 | **BASE** | Preserve single `database.ts` app-facing seam. |
| Responsive shell + print behavior | D2 | **BASE** | Vera remains owner of UI consistency. |

---

# 2. Foundation / trust / authority

These are small in UI surface but shape the correctness of everything after them.

| Function | Difficulty | Scope | Why |
|---|---:|---|---|
| Pass explicit active project id through Ask bob seam | D3 | **V0-CORE** | Current first-row selection can reason about the wrong project. Must be fixed before new project-aware AI workflows. |
| Validate AI project access server-side | D4 | **V0-CORE** | Active project id must be trusted only after membership/authority check. |
| Membership-aware per-project RLS for new evidence/media records | D4 | **V0-CORE** | First new slice stores real project evidence; it cannot rely on client filtering alone. |
| Strengthen existing content RLS by project membership | D4 | **V0-CORE** | Needed before claiming projects are private or allowing AI-authored writes. Can be phased table-by-table but the invariant must be set now. |
| Explicit role authority for high-consequence actions | D4 | **V0-STRETCH** | Needed for e.g. approve selected solution, destructive history, future AI writes; ordinary household CRUD can continue first. |
| Truth/provenance vocabulary (`measured`, `provided`, `estimated`, `AI assessment`, `unknown`) | D2-D3 | **V0-CORE** | Prevents photos/AI/estimates becoming fake fact. Use consistently in new domain objects. |
| Revision/supersession semantics for high-value records | D3 | **V0-CORE** | Measurements/solutions/artifacts need history before they become architecture. |
| Automated unit/domain tests for calculation/truth rules | D2-D3 | **V0-AUTO** | New calculations and provenance should not rely only on browser checking. |
| Browser E2E for the first new vertical slice | D2-D3 | **V0-AUTO** | Must prove upload/write/read-back/AI project scoping across reload. |

### Foundation decision

**Do not give AI broad write authority in the first slice.** V0 should first prove AI can read the correct active project and its authorised evidence. AI may propose structured data; a human confirmation should create high-value project truth until permissions/provenance are fully exercised.

---

# 3. Real media / project evidence

| Function | Difficulty | Scope | Notes |
|---|---:|---|---|
| Upload a real project image/file | D4 | **V0-CORE** | Defining seam for the newly validated product loop. Requires storage + DB metadata + RLS + UI consumption. |
| Persist media metadata and storage identity | D3-D4 | **V0-CORE** | Stable `MediaAsset`, not a reference-image label. |
| Classify media purpose: current state / proposal / section / drawing / guidance / progress / as-built | D2 | **V0-AUTO** | Essential truth separation, simple once media exists. |
| Attach media to project | D2 | **V0-AUTO** | Minimum association. |
| Attach media to area | D2 | **V0-AUTO** | Reuses current area reference-image UX concept. |
| Attach media to task | D2-D3 | **V0-CORE** | Needed to put the right picture where work happens. |
| Project media library / gallery | D2 | **V0-AUTO** | Browse/filter real evidence and artifacts. |
| Render original image after reload | D2-D3 | **V0-CORE** | Upload does not count until runtime consumption is proven. |
| Feed selected authorised image to Ask bob vision context | D4 | **V0-CORE** | Small truthful AI+files seam; central to “show bob what I have”. |
| Multiple files/documents beyond images | D3-D4 | **V0-STRETCH** | Architecture should allow it; first slice can support images only. |
| Video | D4-D5 | **POST-V0** | Not required for the core loop. |

---

# 4. Measurements and existing conditions

| Function | Difficulty | Scope | Notes |
|---|---:|---|---|
| Store a measurement as numeric value + unit + subject | D3 | **V0-CORE** | Required for trustworthy downstream plans/calculations. |
| Store measurement provenance/truth state | D3 | **V0-CORE** | User-measured vs spec vs estimate must remain distinct. |
| Supersede estimate with verified measurement while retaining history | D3 | **V0-CORE** | Do not overwrite provenance. |
| Add measurements manually from a project/area | D2 | **V0-AUTO** | Simple input path; do not require AI. |
| Bob proposes a concrete missing measurement | D3 | **V0-CORE** | “Measure floor to underside of beam”, not vague “need more info”. |
| Measurement checklist for a requested deliverable | D3 | **V0-CORE** | Enables “what do I need before you can draw this?” |
| Existing component register (window/door/bearer/etc.) | D2-D3 | **V0-AUTO** | CRUD with spec/qty/condition/status. |
| Reuse / inspect / remove / replace state | D2 | **V0-AUTO** | Important for renovation rather than greenfield assumptions. |
| Existing stock/material inventory separate from shopping requirement | D3 | **V0-CORE** | Needed to deduct what user already owns. |
| Automatically estimate measurements from images | D4-D5 | **POST-V0** | AI may suggest, but V0 should not treat image-scale estimation as reliable geometry. |

---

# 5. Solutions, options and selected target

| Function | Difficulty | Scope | Notes |
|---|---:|---|---|
| Create a named solution/proposal | D2-D3 | **V0-CORE** | A proposal must be first-class, not buried in chat. |
| Keep multiple alternatives | D2-D3 | **V0-CORE** | A/B/C coexist without overwrite. |
| Store solution assumptions | D3 | **V0-CORE** | Connect proposal to current evidence/measurements. |
| Mark one solution revision as current selected target | D3 | **V0-CORE** | Downstream work needs one shared target. |
| Preserve solution revision history | D3 | **V0-CORE** | Selection changes should not erase prior reasoning. |
| Flag downstream outputs stale when selected solution changes | D3-D4 | **V0-STRETCH** | Important once drawings/BOM/tasks are derived. |
| Generate/edit visual proposal on a real project photo | D4 | **V0-CORE** | Defining product feeling; keep it explicitly illustrative. |
| Carry known component dimensions/aspect ratios into visualisation prompt/context | D3-D4 | **V0-CORE** | Prevent generic “window-shaped” output when actual dimensions are known. |
| Pixel-accurate perspective reconstruction / photogrammetry | D5 | **POST-V0** | Not required; V0 visualisations are design aids, not measured drawings. |

---

# 6. Drawings and artifacts

| Function | Difficulty | Scope | Notes |
|---|---:|---|---|
| Define drawing/artifact record with revision + source solution | D3 | **V0-CORE** | Needed before generation. |
| Generate a simple measured plan/elevation/section from verified inputs | D4 | **V0-CORE** | Narrow honest version; not full CAD. |
| Show verified vs assumed dimensions on artifact | D3 | **V0-CORE** | Key trust requirement. |
| Mark artifact conceptual vs measured/build-ready | D2-D3 | **V0-CORE** | Prevent pretty output being mistaken for construction truth. |
| Link drawing/artifact to relevant tasks | D2-D3 | **V0-CORE** | Makes drawing useful during work. |
| Cut-through assembly diagram with explanation | D3-D4 | **V0-CORE** | Strong user need; can be illustration + structured labels, not CAD. |
| Export printable/PDF work pack | D3 | **V0-STRETCH** | Useful on site once artifact/task model exists. |
| General-purpose CAD/DXF/BIM export | D5 | **POST-V0** | Discovery/integration-heavy and outside current product thesis. |
| Permit/engineering-grade certified drawings | D5 | **POST-V0 / non-goal without professional workflow** | Bob must not imply professional certification. |

---

# 7. Material calculations and stock

| Function | Difficulty | Scope | Notes |
|---|---:|---|---|
| Canonical numeric quantity + unit model for calculated items | D3 | **V0-CORE** | Existing authored strings can remain as display/import fallback. |
| Stable task ↔ material requirement relation | D3 | **V0-CORE** | Needed for BOM and readiness. |
| Derive simple material quantities from verified geometry | D4 | **V0-CORE** | Start with deterministic supported assemblies, not arbitrary AI arithmetic. |
| Store calculation inputs/method/version/result | D3-D4 | **V0-CORE** | User must be able to inspect why quantity exists. |
| Apply explicit waste/spill allowance | D3 | **V0-CORE** | Must be visible and editable, not hidden magic. |
| Deduct existing stock/reused components from purchase requirement | D3 | **V0-CORE** | Directly supports the user need. |
| Feed calculated purchase need into existing shopping list | D3 | **V0-CORE** | Reuse the shopping UX rather than inventing a second list. |
| Calculate fasteners/screws/nails from supported assembly rules | D4 | **V0-STRETCH** | Useful, but “exact count” should remain an explained estimate/allowance where reality varies. |
| Calculate paint/coverage consumables | D3-D4 | **V0-STRETCH** | Deterministic when surface area + coverage/coats are known. |
| Product/catalog price lookup | D4-D5 | **POST-V0** | External data/integration; manual supplier/cost already works. |
| Direct hardware-store ordering | D5 | **POST-V0** | Future integration. |

---

# 8. Executable task plan

| Function | Difficulty | Scope | Notes |
|---|---:|---|---|
| Rich task description / expected result | D2 | **V0-AUTO** | Current task name is too thin. |
| Tool list per task | D2-D3 | **V0-AUTO** | Can start as project-owned/manual data. |
| Task material requirements from canonical relation | D3 | **V0-CORE** | Powers readiness. |
| Explicit task dependencies | D2-D3 | **V0-AUTO** | `Task B depends on A`. |
| Ordered sequence / phase / sort order | D2 | **V0-AUTO** | Needed for practical work plan. |
| Structured blocker/readiness reason | D3 | **V0-CORE** | Distinguish missing material, dependency, measurement, skill, decision. |
| Compute task readiness from dependencies + material + required evidence | D3-D4 | **V0-CORE** | Central to “can we start?” |
| Bob proposes a work breakdown from selected solution | D3-D4 | **V0-CORE** | Human confirms/edits; generated plan is not silently authoritative. |
| Human edit/reorder/add/remove generated tasks | D2 | **V0-AUTO** | AI supports organiser; organiser owns plan. |
| Task-specific estimated crew size | D3 | **V0-STRETCH** | Helpful for build-day planning. |
| Critical-path/Gantt planning | D4-D5 | **POST-V0 / anti-goal** | Too professional/project-management heavy for current Bob. |

---

# 9. “How do I?” task guidance

| Function | Difficulty | Scope | Notes |
|---|---:|---|---|
| Expand a task into detailed guidance on demand | D3 | **V0-CORE** | Keep default task surface simple; deeper help only when requested. |
| Guidance uses project-specific verified dimensions | D3-D4 | **V0-CORE** | Must distinguish those from generic recommendations. |
| Show linked construction/guidance image | D2-D3 | **V0-CORE** | Reuses task media. |
| Generate a task-specific construction diagram | D4 | **V0-CORE** | Example: wall framing before cladding. Label assumptions. |
| Checkpoints before continuing | D3 | **V0-CORE** | e.g. measure diagonals/lod/opening before closing wall. |
| Common mistakes | D2-D3 | **V0-AUTO** | Useful low-risk context. |
| Safety / professional-check boundary | D3 | **V0-CORE** | Bob must say when site-specific/professional verification is needed. |
| Save/version generated guidance artifact | D3 | **V0-STRETCH** | Useful when a whole crew should share the same instruction version. |
| Offline guidance pack | D4-D5 | **POST-V0** | Later on-site enhancement. |

---

# 10. Build together — deepen existing collaboration only where it supports the loop

| Function | Difficulty | Scope | Notes |
|---|---:|---|---|
| Include people skills in Ask bob context | D2-D3 | **V0-AUTO** | Live data already exists; closes an obvious AI-context gap. |
| Event-specific task scheduling | D3 | **V0-STRETCH** | Useful after richer task/readiness model is available. |
| Match attendees to tasks by skill/readiness | D3-D4 | **V0-STRETCH** | Valuable but not required for first planning V0. |
| Explicit crew-lead/supervision relation | D3 | **V0-STRETCH** | Supports novice + expert pairing. |
| True current-user “my tasks today” | D3 | **V0-STRETCH** | Current view shows active project tasks rather than event/user schedule. |
| Build-day readiness summary from canonical blockers | D3 | **V0-STRETCH** | Natural consumer once readiness exists. |
| Push/email assignment notifications | D4-D5 | **POST-V0** | External notification provider. |
| Real-time chat | D4 | **POST-V0 / anti-goal** | Announcements remain the preferred shared-update model. |
| Food recipe/headcount auto-scaling | D3 | **POST-V0** | Good feature, not part of next defining loop. |

---

# 11. Progress and as-built memory

| Function | Difficulty | Scope | Notes |
|---|---:|---|---|
| Per-task progress note/update | D2 | **V0-AUTO** | Original PRD intent; important handover primitive. |
| Add progress photo to task | D2-D3 after media | **V0-AUTO** | Reuses MediaAsset. |
| Before / during / after media grouping | D2 | **V0-STRETCH** | Simple once task media/progress exist. |
| Record actual deviation from selected plan | D3 | **V0-CORE** | “We replaced this bearer” should become project truth, not disappear in chat. |
| Preserve as-built observation with actor/date/media | D3-D4 | **V0-CORE** | Especially valuable before hidden work is closed. |
| Propagate confirmed change to affected plan/BOM/tasks | D4 | **V0-STRETCH** | Requires dependency lineage across artifacts. |
| Keep old revisions available | D3 | **V0-CORE** | New high-value objects should not destructive-overwrite history. |

---

# 12. What is *not* in next-phase V0

The following should not be allowed to expand the first implementation wave:

- full BIM/CAD authoring;
- certified structural engineering;
- permit automation;
- hardware-store ordering integrations;
- external price/catalog scraping as a dependency;
- offline synchronization;
- native mobile apps;
- calendar sync;
- real-time project chat;
- Gantt/critical-path/professional construction-management features;
- general computer-vision measurement that pretends arbitrary photos are survey-grade geometry.

---

# 13. Next-phase V0 product loop

The target V0 should prove this loop truthfully:

```text
show bob the real project
→ preserve the evidence
→ ask for what is missing
→ record verified measurements / existing components
→ explore and select a solution
→ create a measured/concept-labeled artifact
→ derive materials and tasks from the same selected solution
→ put the right plan/image/guidance on the task
→ let people build together using the existing coordination core
→ record what actually happened
```

V0 does **not** need every construction type or every automation. It needs one coherent path where the same project truth survives the whole chain.

---

# 14. First vertical slice — selected

## Slice 1: **Show bob the real project**

**Delivery status (2026-09-09):** manual foundations 1A and 1B are deployed;
[foundation verification](foundation-verification.md) owns the evidence. Image
analysis is the later 1C gate, so this full slice remains open. The V1 plan owns
the foundations-first delivery order.

### User goal

> As a project owner, I can upload a real current-state photo to the project, return later and still see it, and Ask bob can reason about **that photo in the explicitly active project** and tell me one concrete piece of evidence/measurement it needs next without pretending its visual assessment is a measured fact.

### Why this slice first

It validates the two defining seams that the next product layer depends on:

1. **real files/media**, and
2. **AI reasoning over authorised active-project evidence**.

If either boundary is wrong, measurements, visual proposals, drawings, BOM and task guidance will all be built on the wrong skeleton.

### UI alignment — fit the new loop into Bob instead of building a second app

The domain may call the underlying object `MediaAsset`, but the UI should stay human. The user-facing concept for this slice is **“Show bob what you're working with”** / **“Visa Bob projektet”**, not “manage media assets”.

Slice 1 should reuse Bob's existing UI anatomy rather than introduce a new top-level planning studio or media product:

- **Project creation:** keep the current compact project form. After the basic project exists, offer a clear next action such as **Show bob what you're working with** / **Add project photos**. Do not turn project creation into a long AI wizard.
- **Dashboard:** this is the project-understanding surface. It may show a compact project brief/evidence summary and Bob's next concrete request, e.g. “I still need the width of the opening”. It should remain scannable rather than becoming an editor.
- **Area detail:** evolve the existing **Reference images** concept into real project/area images instead of creating a competing media hierarchy. Existing `Tasks / Materials / Reference images` navigation remains a good fit; the image surface grows up rather than moving elsewhere.
- **Ask bob:** keep the existing drawer as the conversational surface. A photo may offer **Ask bob about this**, or the drawer may attach/select an authorised project image, but the drawer is not the media manager.
- **Today:** no new planning/media complexity in Slice 1. Today remains the phone-first “what do I do now?” fast path. Relevant task images can be surfaced later from the task without turning Today into another dashboard.
- **Account/project switcher:** remain account/project administration. Evidence analysis belongs inside the active project, not in the account modal.

### Media presentation rules for Slice 1

- Thumbnail grids may crop for scanning, but opening an image must provide the complete original without forced square cropping.
- Real construction photos, portrait images, sections and drawings must not be treated as if every asset were a square social-media tile.
- Media purpose labels such as **Current state**, **Target**, **Section**, **Guidance**, **Progress** or **As-built** should use neutral/secondary styling. Do not consume Bob's green/honey/clay status colors for media taxonomy; those colors already mean ready/done, pending/in-progress and blocked/warning.
- Purpose/provenance is visible when it matters, but implementation nouns such as `MediaAsset`, storage keys or revision ids stay out of ordinary user copy.
- Loading, upload progress/failure, permission denial and missing-image states must be explicit and recoverable; a placeholder must not imply an upload succeeded.
- Mobile upload/view flows must remain usable one-handed and must not collide with the fixed mobile navigation or floating Ask bob affordance.

### UI placement decision

For Slice 1, **do not add a new top-level “Media”, “Design studio” or “Evidence” navigation item**. The first slice should prove that real evidence naturally lives in the existing project surfaces. A dedicated project-wide media library may be added later only if the volume/journey proves it is needed; until then, Dashboard + Area/Task + Ask bob are the primary consumers.

### Slice 1 end-to-end path

The [V1 delivery order](v1-plan.md#delivery-order--foundations-first-owner-decision-2026-09-09)
owns the updated sequence: 1A media, 1B manual illustrated task steps, then 1C
vision. The path below is the **full Slice 1** acceptance path, not a prerequisite
for merging or continuing the foundation milestones. The owner's Bob trial is
deferred; technical persistence, access and browser verification remain required.

```text
real authenticated session
→ explicit active project
→ upload one image
→ authorised storage write
→ canonical MediaAsset row with purpose = current_state
→ read/render image from project UI
→ reload and image remains
→ open Ask bob for the same active project
→ active project id passed explicitly to backend
→ backend validates project access
→ authorised selected image supplied to AI vision input
→ bob describes observations as assessment, not measurement
→ bob asks for one concrete missing measurement/photo needed next
→ browser E2E proves the path and cross-project denial
```

### Scope included in Slice 1

- reuse the deployed Slice 0 explicit-project AI and membership boundary;
- project-scoped media storage path;
- `MediaAsset` minimum model;
- current-state media type;
- upload UI;
- render/read-back UI;
- project/area/task association, extended to ordered task steps in milestone 1B;
- manually editable task instructions, ordered steps, completion state/checks and step images, as scoped in the V1 delivery order;
- media RLS/project membership proof;
- AI vision input for a selected project image;
- assessment vs fact/measurement language boundary;
- positive E2E + unauthorised/cross-project denial + reload proof.

### Explicitly not in Slice 1

- image generation/mockup editing;
- measurements stored as structured records;
- solution alternatives;
- drawings;
- BOM calculations;
- AI writes to project truth;
- AI-generated task guidance and solution-aware construction diagrams (manual steps and attached images are included in 1B);
- full progress/as-built workflows.

Those are deliberately kept out so the first slice proves the skeleton rather than becoming a mini-rewrite.

### Slice 1 definition of done

Slice 1 is done only when:

1. a normal authenticated user uploads a real image to a project;
2. the image is persisted and actually renderable after reload;
3. another project/user cannot read/write it through the normal API path;
4. Ask bob receives the active project id explicitly rather than selecting `.limit(1)`;
5. Ask bob can consume that authorised image and answer about it;
6. AI output clearly keeps visual observation separate from verified measurement;
7. tests/browser proof cover positive path, denied path and reload/read-back;
8. no UI surface bypasses `database.ts`/the owning media command/read seam;
9. the flow reuses the existing project shell, Dashboard/Area/Ask bob surfaces rather than adding a parallel top-level navigation model;
10. upload, loading, failure, denied and read-back states are honest on both desktop and mobile;
11. opening a stored image exposes the complete original even if a thumbnail preview is cropped;
12. the manual task/step foundation meets the independent 1A + 1B exit in the V1 plan before vision is added.

---

# 15. Proposed follow-on slices

These are ordering proposals, not commitments beyond Slice 1.

### Slice 2 — **Measure what matters**

`MediaAsset → missing measurement request → Measurement record with provenance → verified replacement of estimate → Bob sees the measurement.`

### Slice 3 — **Choose the target**

`current evidence + measurements → proposal A/B → selected SolutionRevision → visual mockup stored as proposal media.`

### Slice 4 — **Turn target into work**

`selected solution → narrow measured section/drawing → deterministic BOM for one supported assembly → task dependencies/material relation → existing shopping list.`

### Slice 5 — **Help me build it**

`task → project-specific dimensions/materials/media → “How do I?” guidance + checkpoints + construction diagram → progress note/photo → as-built observation.`

### Slice 6 — **Make the build day smarter**

`richer task readiness + attendees + skills → event-specific assignment/readiness/matching → true “my tasks today”.`

---

# 16. Pre-build blockers for Slice 1

Track each blocker against its owning contract and delivery gate:

- **BLOCKER-01 — media authority boundary:** resolved by the deployed private media contract in `Docs/media-and-steps.md`; DB relations and Storage policies enforce project membership.
- **BLOCKER-02 — active project AI contract:** resolved by deployed Slice 0; reuse the explicit `projectId` and backend membership validation contract in `supabase/README.md` when adding media consumption.
- **BLOCKER-03 — media provenance and attachment minimum:** resolved by `Docs/media-and-steps.md` and deployed 1A/1B. Server actor/time, immutable file identity, purpose, same-project attachments and upload/deletion recovery are implemented.
- **BLOCKER-04 — truth language:** define how AI visual observations are represented/labeled so they cannot be mistaken for measured facts.
- **BLOCKER-05 — verification:** foundation DB/RLS, browser and live Storage checks pass as recorded in `Docs/foundation-verification.md`. Full vision-loop verification remains a 1C gate.

Everything else above is **slice-gated** or **post-V0** and should not delay Slice 1.

---

# 17. Scope conclusion

The next phase should **not** rebuild bob's coordination product. It should add one new vertical capability at a time onto the existing project/area/task/people/material/event skeleton.

The most important architecture decision is therefore not “what screen comes next?” It is:

> **Can one real piece of project evidence be safely persisted, understood by Bob in the correct project, and remain honest about what it does and does not prove?**

Slice 1 answers that question. If it works, nearly every later user story has a trustworthy place to attach.
