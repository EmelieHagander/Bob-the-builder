# Vera — durable learnings

> Reusable frontend/UX lessons discovered while working on bob. Keep this file concise. Promote only recurring rules; one-off bugs belong in findings/issues.

## 2026-09-09 — Current UI ownership is already real

**Lesson:** bob already has a coherent visual/runtime spine; stewardship should strengthen it rather than starting a new design system.

**Evidence:** `src/theme.css` owns themes/tokens/global responsive behavior; `src/components/Layout.tsx` owns shell/navigation/Ask bob; shared UI/form/modal machinery already exists.

**Rule:** extend current owners deliberately. Do not introduce a parallel token file, shell or control family unless a later explicit design-system decision supersedes the current architecture.

## 2026-09-09 — Mobile navigation is a behavioral contract

**Lesson:** fixed UI can break the app even when it looks fine. The mobile nav deliberately lets CSS own its desktop/mobile display state so an invisible fixed bar does not swallow clicks.

**Rule:** when adding fixed/sticky UI, verify hit areas and overlap on phone widths, especially around the mobile nav and floating Ask bob control.

## 2026-09-09 — Browser verification is currently part of frontend proof

**Lesson:** bob now has automated production-frontend checks for install/PWA, project isolation and the manual foundations at 320, 390 and 1280px. These use HTTP fixtures; separate live API checks prove deployed Auth/PostgREST/Storage. `.claude/skills/verify/SKILL.md` owns the verification procedure and its evidence boundaries.

**Rule:** for material UI behavior changes, a clean build is necessary but not sufficient. Drive the relevant runtime flow before calling it done.

## 2026-09-09 — Shared fields and modals need real interaction proof

**Lesson:** a wrapping label can include select-option text in the accessible name. A transformed page can trap a fixed modal below navigation and Ask bob, even with a high local z-index.

**Rule:** shared `Field` explicitly labels native controls with its visible label. Shared `Modal` portals to the document body and contains scroll. Exercise long forms on narrow screens; wait for entrance animations to finish before measuring touch targets.

## 2026-09-09 — Collaboration is product structure, not decoration

**Lesson:** people, skills, build-day attendance, task assignment, food/allergies and announcements are core product surfaces.

**Rule:** new planning/AI experiences must integrate with the collaborative loop rather than turning bob into a single-user planning tool with collaboration bolted on later.
