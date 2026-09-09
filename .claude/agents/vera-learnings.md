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

**Lesson:** bob has build/typecheck but no automated browser test suite yet; `.claude/skills/verify/SKILL.md` defines the practical end-to-end verification flow.

**Rule:** for material UI behavior changes, a clean build is necessary but not sufficient. Drive the relevant runtime flow before calling it done.

## 2026-09-09 — Collaboration is product structure, not decoration

**Lesson:** people, skills, build-day attendance, task assignment, food/allergies and announcements are core product surfaces.

**Rule:** new planning/AI experiences must integrate with the collaborative loop rather than turning bob into a single-user planning tool with collaboration bolted on later.
