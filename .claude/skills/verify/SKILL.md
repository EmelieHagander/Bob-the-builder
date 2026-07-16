---
name: verify
description: Build, launch and drive bob to verify changes end-to-end in the browser.
---

# Verifying bob

React + Vite SPA, no test suite — verification is driving the running app.

## Build & launch

```bash
npm install
npm run build        # tsc -b && vite build — must stay clean
npm run dev          # http://localhost:5173, mock mode (no env = demo data)
```

Mock mode serves the in-memory Skogsstuga sample (src/data/mockData.ts) —
writes mutate it in-memory, so created areas/tasks persist across navigation
but reset on reload. Live mode needs VITE_SUPABASE_URL/ANON_KEY and real
sign-in; mock mode has no auth gate and is what you want for UI verification.

## Driving it

Playwright with the pre-installed browser (do NOT `playwright install`):

```js
chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
```

Routes are hash-based: `/#/areas`, `/#/areas/:slug`, `/#/events`, `/#/shopping`…

Flows worth driving after a change: Add area (Areas), Add task / Add material /
Assign / status-cycle (AreaDetail), "I'm coming!" (Events + EventDetail),
Post update (Announcements), tick + Add material (Shopping), Invite (People).

## Gotchas

- The floating **Ask bob** button (bottom right) and its drawer intercept
  clicks — close the drawer (X in its header) before clicking elsewhere.
- Checkboxes are hidden inputs inside `<label>`s — click the label.
- After a modal submit, wait for `.modal` to detach AND for the list to
  refetch (~120ms mock latency) before counting cards.
- Avatar `title` attributes are people's initials (Astrid Berg = "AS").
