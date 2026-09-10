# bob — UI index

> Navigation and frontend ownership contract. This file does not replace product behavior, data contracts or runtime code.

## Read in this order for UI work

1. `CLAUDE.md` — product/session invariants.
2. `.claude/agents/vera.md` — Vera's review contract.
3. The relevant product behavior source (`README.md`, PRD, or current journey contract).
4. `src/theme.css` — current canonical visual tokens and global responsive rules.
5. `src/components/Layout.tsx` — shell/navigation/Ask bob anatomy.
6. `src/components/ui.tsx`, `src/components/form.tsx`, `src/components/Modal.tsx` — shared UI machinery.
7. The page/component being changed.
8. `.claude/skills/verify/SKILL.md` — runtime verification.

## Current visual language

bob should feel like a warm, practical site office: clear enough to use outdoors, friendly without becoming toy-like, and structured around real work rather than decorative dashboards.

Current implementation anchors:

- `birch` is the default theme; `forest` and `dusk` are supported alternatives.
- `src/theme.css` owns reusable palette, semantic state colors, radii, shadows, shell dimensions and responsive behavior.
- Baloo 2 is used for display character; Hanken Grotesk/system sans is used for working text.
- Semantic status color remains meaningful: green/leaf = ready/done, honey/amber = pending/in progress, clay/red = blocked/warning.
- Cards and pills are compact, practical information containers; they should not become ornamental chrome.
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

### Page frame

Current pages generally compose:

`Layout → .page → .page-head → shared cards/sections → domain content`

Use existing classes/primitives before inventing a local dialect.

### Core work modes

| Surface | Primary user job | Important UI constraint |
|---|---|---|
| Dashboard | see project status/attention | scan quickly; drill down rather than overload |
| Task detail (`/tasks/:taskId`) | follow instructions and illustrated steps | keep required checks visible; expand images on demand |
| Project facts (`/facts`) | record lengths, unknowns and existing parts | reached from Dashboard/Area; source labels and version history stay explicit; no extra global navigation |
| Solutions (`/solutions`) | compare alternatives and select an exact target version | reached from Dashboard/Area; project-wide target, saved evidence and decision history remain explicit |
| Drawings & references (`/artifacts`) | save reviewed image versions and inspect their recorded basis | reached from Dashboard/Area; task detail attaches/opens/updates/detaches exact versions; changed target/evidence remain visible |
| Areas / Area detail | manage work, materials, crew, references | task/material state must stay legible and actionable |
| People | understand crew skills/needs | skills and safety-relevant dietary info must be easy to scan |
| Events / Event detail | organise a build day | attendance and day plan must be obvious |
| Today | know what to do now | volunteer-facing, minimal, phone-first |
| Shopping | buy what the build needs | checkbox interaction and print cleanliness matter |
| Food | feed the crew safely | allergy/dietary information must never be buried |
| Announcements | share changes with the whole crew | pinned/current updates should dominate old noise |
| Ask bob | ask about the current build | honest working/failure states; must not block unrelated UI accidentally |
| Account | choose/manage projects | project context must remain clear when switching |
| Install Bob (`/#/install`) | put Bob on the phone's home screen | public before project/auth loading; reached from account settings and sign-in; Swedish phone steps |

## Frontend invariants

- **Phone and field use are first-class.** Controls must remain usable one-handed and in outdoor conditions.
- **Today is a fast path, not another dashboard.** Do not bury a volunteer's immediate assignment under project-management detail.
- **Reuse before invention.** Shared buttons/cards/pills/form/modal machinery should be extended intentionally rather than cloned per page.
- **Tokens before repeated raw values.** If a visual value becomes reusable, add/use a token in `src/theme.css` rather than scattering copies.
- **State must be honest.** Loading, empty, error, permission-denied, not-configured and saved states should be visibly distinct where relevant.
- **UI is not authorization.** Disabled/hidden controls are UX; backend/RLS/domain commands own permission truth.
- **AI output must show uncertainty when it matters.** A polished card or drawing must not turn an estimate/assessment into a verified fact.
- **Responsive shell must survive feature work.** In particular, do not introduce fixed elements that collide with mobile nav or the Ask bob affordance.
- **Print surfaces stay print-clean.** Shopping/other printable views should not require background colors or interactive chrome to make sense.

## Stable shared ownership

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

If the change is docs-only or purely stylistic, state which parts of that chain do not apply rather than pretending they were tested.
