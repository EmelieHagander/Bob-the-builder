# bob — UI index

> Navigation and frontend ownership contract. This file does not replace product behavior, data contracts or runtime code.

## Read in this order for UI work

1. `CLAUDE.md` — product/session invariants.
2. `.claude/agents/vera.md` — Vera's review contract.
3. The relevant product behavior source (`README.md`, PRD, or current journey contract).
4. For Project/Area lifecycle UI, `Docs/project-phases.md` + `Docs/project-phase-ui.md`.
5. `src/theme.css` — current canonical visual tokens and global responsive rules.
6. `src/components/Layout.tsx` — shell/navigation/Ask bob anatomy.
7. `src/components/ui.tsx`, `src/components/form.tsx`, `src/components/Modal.tsx` — shared UI machinery.
8. The page/component being changed.
9. `.claude/skills/verify/SKILL.md` — runtime verification.

## Current visual language

bob should feel like a warm, practical site office: clear enough to use outdoors, friendly without becoming toy-like, and structured around real work rather than decorative dashboards.

Current implementation anchors:

- `birch` is the default theme; `forest` and `dusk` are supported alternatives.
- `src/theme.css` owns reusable palette, semantic state colors, radii, shadows, shell dimensions and responsive behavior.
- Baloo 2 is used for display character; Hanken Grotesk/system sans is used for working text.
- Semantic status color remains meaningful: green/leaf = ready/done, honey/amber = pending/in progress, clay/red = blocked/warning.
- Cards and pills are compact, practical information containers; they should not become ornamental chrome.
- Phase UI should use text/icon + mostly neutral/brand treatment so lifecycle phase does not compete with readiness/blocker colors.
- The original `Docs/Mockups and initial plans/bob-the-builder.html` is a historical style/composition anchor, not a pixel or behavior specification.

## Surface anatomy

### App shell

Owned by `src/components/Layout.tsx`:

- desktop sidebar;
- active-project entry/account switch;
- mobile bottom navigation;
- floating Ask bob control and drawer host;
- signed-in identity/sign-out affordance.

Do not create another shell/navigation system inside feature pages.

Project phases are **state**, not routes: do not add Concept / Design / Planning / Build / Complete as shell navigation.

### Page frame

Current pages generally compose:

`Layout → .page → .page-head → shared cards/sections → domain content`

Use existing classes/primitives before inventing a local dialect.

### Core work modes

| Surface | Primary user job | Important UI constraint |
|---|---|---|
| Project Home / Dashboard (`/`) | understand overall Project phase, mixed Area phases and what deserves attention next | scan quickly; Project focus must not pretend one global planning step applies to every Area |
| Areas / Area detail | understand each workstream's phase and act locally | Area phase + one primary next action first; Build-oriented progress only dominates when useful |
| Task detail (`/tasks/:taskId`) | follow instructions and illustrated steps | keep required checks visible; lightweight Area context only; do not turn into a phase dashboard |
| Project facts (`/facts`) | record lengths, unknowns and existing parts | reached from Project/Area; source labels and version history stay explicit; phase provides context, not truth promotion |
| Solutions (`/solutions`) | compare alternatives and select an exact target version for the relevant scope | Area-scoped decisions must not overwrite another Area's selected target; decision history remains explicit |
| Plans/drawings (`/artifacts`) | inspect/create target-linked build artifacts | selected target + stale lineage must be evaluated at the same Project/Area scope |
| Material plan (`/material-plan`) | understand requirements, stock/reuse and purchase need | Area/task scope stays visible; target/drawing lineage must not bleed across Areas |
| Building context (`/building`, `/account/buildings`) | maintain persistent physical truth | Building state stays separate from Project/Area lifecycle phase |
| People | understand crew skills/needs | skills and safety-relevant dietary info must be easy to scan |
| Events / Event detail | organise a build day | attendance and day plan must be obvious |
| Today | know what to do now | volunteer-facing, minimal, phone-first; no phase rail/setup controls |
| Shopping | buy what the build needs | checkbox interaction and print cleanliness matter |
| Food | feed the crew safely | allergy/dietary information must never be buried |
| Announcements | share changes with the whole crew | pinned/current updates should dominate old noise |
| Ask bob | ask about the current build | honest working/failure states; phase/current view may guide prompts but must not become hidden authority |
| Account | choose/manage projects | Project phase and schedule are distinct; mixed Area phase summary may appear on project cards |
| Install Bob (`/#/install`) | put Bob on the phone's home screen | public before project/auth loading; reached from account settings and sign-in; Swedish phone steps |

`Docs/project-phase-ui.md` owns the detailed page-by-page lifecycle composition and implementation impact map.

## Frontend invariants

- **Phone and field use are first-class.** Controls must remain usable one-handed and in outdoor conditions.
- **Today is a fast path, not another dashboard.** Do not bury a volunteer's immediate assignment under project-management detail. Phase-aware redesign should also make Today reachable in one tap on mobile.
- **Reuse before invention.** Shared buttons/cards/pills/form/modal machinery should be extended intentionally rather than cloned per page.
- **Tokens before repeated raw values.** If a visual value becomes reusable, add/use a token in `src/theme.css` rather than scattering copies.
- **State must be honest.** Loading, empty, error, permission-denied, not-configured, unclassified phase and saved states should be visibly distinct where relevant.
- **UI is not authorization.** Disabled/hidden controls are UX; backend/RLS/domain commands own permission truth.
- **AI output must show uncertainty when it matters.** A polished card or drawing must not turn an estimate/assessment into a verified fact.
- **Phase is not readiness.** `Design`, `Planning` or `Build` must not be styled as proof that required evidence/materials/checks are ready.
- **Responsive shell must survive feature work.** In particular, do not introduce fixed elements that collide with mobile nav or the Ask bob affordance.
- **Print surfaces stay print-clean.** Shopping/other printable views should not require background colors or interactive chrome to make sense.

## Stable shared ownership

- Phase-aware Project/Area composition: `Docs/project-phase-ui.md`
- Lifecycle/product meaning: `Docs/project-phases.md`
- Theme/tokens/global layout: `src/theme.css`
- App shell/navigation: `src/components/Layout.tsx`
- Shared UI primitives/hooks: `src/components/ui.tsx`
- Form primitives: `src/components/form.tsx`
- Modal frame: `src/components/Modal.tsx`
- Domain editors: `src/components/editors.tsx`
- AI drawer: `src/components/AskBob.tsx`
- Installation behavior, assets and verification: `README.md` → Install Bob on a phone; public guide in `src/pages/Install.tsx`, account entry in `src/components/InstallSettingsCard.tsx`

A page should compose these pieces and own domain-specific layout/meaning; it should not silently fork their generic behavior.

## Vera review order

For any material frontend change, review in this order:

1. **Honesty** — does UI truth match real state/data/permissions?
2. **User goal** — can the intended person complete the job without unnecessary navigation?
3. **Recovery** — what happens on empty, error, slow or denied states?
4. **Interaction drift** — did a new control duplicate an existing action or convention?
5. **Reuse** — are existing shared components/tokens used where they fit?
6. **Visual system** — hierarchy, typography, density, semantic color, spacing.
7. **Responsive/mobile** — phone layout, touch target, fixed-element collisions, overflow.
8. **Accessibility** — labels, keyboard behavior, contrast, focus and non-color state cues where needed.
9. **Verification** — build + browser flow from `.claude/skills/verify/SKILL.md`.

## UI definition of done

A UI change is not done because the screenshot looks good. For the promised user goal, trace:

`reachable UI → correct state/authority → real read/action → visible success/error/unknown → navigation/reload behavior → browser verification`

For phase-aware work, also prove the mixed-phase case:

`Project = Build + Area A = Complete + Area B = Build + Area C = Design`

without target/readiness/history bleeding between Areas.

If the change is docs-only or purely stylistic, state which parts of that chain do not apply rather than pretending they were tested.


### Multi-floor coordinate study — implementation branch after #85

`Plans & drawings` also renders chat-created multi-floor Concept studies, using
`BuildingPlanDrawing` and the same contained vector/zoom styles as storage-box
views. Floor tabs retain one shared datum and scale. A separate height comparison
is explicitly not a building section. Coordinate tables, unknowns, source warnings
and denied source states remain readable on phones. No manual coordinate editor
or new global navigation is introduced. The source/persistence contract belongs
in `Docs/artifacts.md`; production status and screenshot evidence belong to its PR.

### Stair-study viewer (implementation branch)

Saved chat receipts open the exact stair Artifact revision. The owning
Plans & drawings surface shows lower/upper plans and a developed walking section,
with labelled START/EXIT, numeric coordinates, source revision, contained zoom,
SVG and explicit conflict/unknown states. No manual stair drawing form is required.
The full-view preview fits phone width; readable numbers remain below it. Source
revocation hides geometry but retains the artifact and an honest unavailable state.
See the [stair contract](artifacts.md#stair-geometry-study--implementation-branch-2026-09-19).

## Unified work vocabulary (September 2026)

[Domain dictionary](domain-dictionary.md) owns **Project → optional Area → Step → Task**. In connected projects, `ProjectStepWorkspace` renders one Plan from `project_work_read`: root Steps, Areas with Steps, and saved Tasks still awaiting a primary Step. Task ownership controls counts; related-work links are separate. `TaskDetail` returns to its primary Step and calls its internal `task_steps` instructions/checkpoints. Step phase, execution state and Bob focus are distinct. Areas remain a management surface, not a second plan. Mock data retains its legacy Area view.

Browser coverage: `scripts/check-project-work-browser.mjs` and the existing foundations/phase checks. SQL/RLS and migration coverage: `tests/unified-project-work.test.ts`.

Project home now places `ProjectDrawings` below the phase rail. It previews recent saved drawings and links to their exact versions and related work Steps. A Step shows drawing count even while collapsed, and named drawing links when open. The drawing/work persistence contract is owned by [artifacts](artifacts.md#project-home-drawings-and-work-links--september-24-2026).


### Area history and participant drawings — September 24, pending release

Areas has explicit **Active Areas / Archived Areas** filters. Archive/restore lives in
Area editing and the archived Area notice; it preserves readable history. The Plan
has a collapsible Archived Areas group and exposes no Add Task action there. Exact
Task links keep their Area names. Archive is independent of phase and cannot finish
work implicitly; backend blockers surface in the same dialog.

The name-only participant Task panel embeds `VolunteerDrawings`, using the canonical
renderers with participant wording and no editor navigation. It keeps saved status,
source warnings and assumptions visible, and clears renders on refresh/failure.
Loading, empty, missing-server and revoked states remain in the participant flow.
[Artifacts](artifacts.md#volunteer-task-drawings--september-24-pending-release) owns
render scope; [Data/auth](../db/README.md#area-archive-and-volunteer-drawing-reader--september-24-pending-release)
owns permissions and deployment. Phone/desktop browser proof is in the implementing PR.
