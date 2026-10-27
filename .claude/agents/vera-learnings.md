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

## 2026-10-04 — Reserve phone space for the actual work

**Rule:** long descriptions and supporting controls must not displace the shared
Plan or chat transcript. Keep retry actions compact, explanations scrollable,
and textarea growth bounded by the available viewport. Observe content and
viewport resizing for chat follow behavior, but only follow while the reader
is already at the end. Test both an older answer and the latest answer while
the composer and text density change.

## 2026-10-04 — Density must propagate through the shared system

**Rule:** spacing tokens need real consumers. Replace inline panel padding and
section gaps in existing screens, and use shared list rows for repeated entities.
Changing only the theme cannot override inline geometry. Keep touch targets
independent from visual padding, and verify representative routes rather than
assuming one compact screen proves app-wide density. Native checklist controls
must remain keyboard-operable when visual chrome is removed.

A startup spinner needs a bounded connection failure and a retry path. Test a
near-expiry persisted session and a stalled read; a fresh one-hour fixture token
does not exercise the same path. Account, phase and chat data must share one
Auth owner, while volunteer credentials retain their independent session.

## 2026-10-17 — Preview text is not fresh server state

An in-memory transcript preview can satisfy a text selector before revalidation
finishes. Browser tests that assert current server delivery must also wait for
the initial sync to enable actions. Test the preview separately with a delayed
server read and disabled actions. After a deliberate reload, load older pages
explicitly before making assertions about the entire transcript.

Work status needed during long background jobs must remain visible while the
transcript scrolls. Use actual progress timestamps rather than poll times, and
show connection loss without implying new activity. Bound the whole initial
read, including member lookup; per-query timeouts alone cannot cover a stalled
dependency. Fence late results after the deadline and preserve the unsent draft.

## 2026-10-25 — Server-confirmed toggles still answer the tap

**Rule:** a checkbox whose truth is a guarded server row shows the intended
state beside **Saving…** while the write and read-back run, serialises further
toggles, and falls back to the read-back state on failure. Re-read only the
changed scope, not the whole page, so the list does not flash empty. Browser
fixtures that serve Home must honour PostgREST `in.(…)` filters, or grouping
checks pass vacuously.

## 2026-10-25 — Failures and codes reach people only as written copy

**Rule:** screens render `userErrorMessage(error, fallback)` and labels from
`src/lib/labels.ts`; never `error.message`, `String(error)`, a code, UUID or
recipe path. Depend on `hasErrorCode`, not message text. Browser checks share
port 4173: an orphaned preview from another run silently serves the wrong
build, so check `ss -ltnp` or isolate the run before trusting a pass.

## 2026-10-26 — Room size reads typed values, never labels

**Rule:** a size or dimension summary reads only typed backend fields
(`project_room_dimensions`); it names unknown parts and lists every conflicting
value instead of picking one. Put a secondary line in its own element so exact
`getByText` on the primary label still matches.

## 2026-10-27 — Lazy-load checks follow module identity

**Rule:** identify a lazy renderer through Vite's build manifest, then assert
that its exact entry is absent before opening the view and loaded afterward.
Shared styles and geometry helpers can receive the same filename prefix as the
renderer; a prefix match is not evidence that the renderer loaded eagerly.
Keep actual rendering and no-extra-source-read assertions alongside this check.
