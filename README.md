# bob 🌲

**build together, in the forest**

bob is a mobile-friendly web app for coordinating community build and renovation
projects — from a 50-volunteer house extension down to a 5-friend chicken coop.
It keeps areas, tasks, people, materials, shopping lists, food and volunteer
coordination in one place.

This is the v1 implementation of the **BuildCoord** PRD (see
[`Docs/`](./Docs)). The sample project throughout is *Skogsstuga*, a cabin build
in Dalarna.

## What's in here

A React + TypeScript single-page app built with Vite. Screens:

| Route | Screen |
| --- | --- |
| `/install` | Public Swedish home-screen installation guide, available before sign-in |
| `/account/settings` | Account details and a prominent **Installera appen** entry |
| `/` | Dashboard — status at a glance, areas, next build day, what needs attention |
| `/areas`, `/areas/:slug` | Areas list and area detail (tasks / materials / reference images) |
| `/people` | People, their skills and dietary needs |
| `/events`, `/events/:slug` | Build events and event detail with sign-up + day plan |
| `/food` | Meal plan and the allergy / dietary matrix |
| `/food/shopping` | Food shopping list (checkable, printable) |
| `/shopping` | Materials shopping list, grouped by category (checkable, printable) |
| `/announcements` | Announcement board |
| `/today` | Day-of "what needs doing today" view |
| — | **Ask bob** assistant drawer. Slice 0 binds OpenAI and read-only lookups to the active authorised project, with source disclosure. OpenAI is Bob's permanent AI integration. [Setup](supabase/README.md) · [verification and rollout gates](Docs/slice-0-verification.md) |

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
```

## Install Bob on a phone

Open **Account → Settings → Installera appen**, or use the same button above
the sign-in form. The [public installation guide](https://emeliehagander.github.io/Bob-the-builder/#/install)
walks users through Safari on iPhone/iPad and Chrome on Android in Swedish.
Supporting browsers offer a native installation prompt after a user clicks.
Other browsers keep the manual instructions available. No app-store account
or paid store licence is required.

The installed app uses the same code, login and database as the website.
Projects, media and Ask bob need an internet connection. The service worker
caches **only `public/offline.html`**, a public connection/retry page. It never
caches API responses, project data, user images or authentication responses,
and never queues writes. Normal HTTP/browser and media-server cache rules
continue to apply to images; installation adds no separate asset database.

New website deployments also update the installed app. Save your work, close
Bob (including other open Bob windows/tabs), and reopen it to load the new
version. The worker never forces a reload or interrupts an open form.

### Installation assets and verification

`public/favicon.svg` is the existing gran/tree identity used as the source
for the favicon, Apple touch icon, 192/512 px app icons and full-bleed maskable
icon. This also aligns the older PNG favicon with the tree identity in Bob's
app shell. `public/icons/bundle.json` records the source and export checksums.
To regenerate, install **Pillow 12.3.0** in your Python environment and run
`python3 scripts/render-icons.py`; commit the exports and bundle together.
No image-generation service or runtime image dependency is needed.

`public/manifest.webmanifest` uses relative identity, start and scope URLs.
Vite expands `%BASE_URL%` in HTML and `import.meta.env.BASE_URL` in code, so
the app stays inside `/Bob-the-builder/` on GitHub Pages. Hash routes remain
unchanged. Installation must be served over HTTPS (localhost is also valid).

After `npm ci`, run `npm run build` and `npm run verify:pwa` to check the
production manifest, icon bundle, installation states and worker boundaries.
Run `CHROME_PATH=/path/to/chrome npm run verify:install` for the relevant
browser flow at 320/390 px and desktop widths, including a real offline
fallback. CI runs this against both demo data and a dummy, intercepted live
configuration; it never uses a real account or writes to the database.
The device's final installation dialog still belongs to iOS/Android and
should be checked on a real phone when changing the installation instructions.

Guide references: [Apple's Swedish iPhone instructions](https://support.apple.com/sv-se/guide/iphone/iph42ab2f3a7/ios)
and [Google's Android installation instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en-GB).

## Architecture — the database layer

> _"Let's create a special script for anywhere we'd have a database connection,
> so the app reads from that one script and gets its mock data from there."_

That request shaped the whole data flow. **All data access goes through a single
module: [`src/data/database.ts`](./src/data/database.ts).** No screen imports the
mock data directly — they only ever call `database` functions like
`getAreas()`, `getPeople()`, `getEvent(slug)`, `getDashboardStats()`.

```
   screens / components
            │   (only ever call database.*)
            ▼
   src/data/database.ts   ◄── the ONE place a real DB connection lives
            │
            ▼
   src/data/mockData.ts   (sample "Skogsstuga" content; swappable)
```

`database.ts` runs in one of two modes, decided once at startup:

- **Live** — when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set,
  every function queries the real Postgres database (Supabase). The database is
  **shared** with other apps, so everything bob owns lives in its own schema,
  `bob`, and the client is pinned to it.
- **Mock** — with no env config, the app serves the in-memory Skogsstuga sample
  data in `mockData.ts`, exactly as before. Zero setup, great for dev and demos.

The function signatures are identical in both modes, so no UI code knows or
cares which one is active.

### Running against the real database

1. Apply the migrations in [`db/migrations/`](./db/migrations) and optionally
   the sample data in `db/seed.sql` — see [`db/README.md`](./db/README.md).
   API exposure is part of the migrations (`0003` appends `bob` to the
   exposed schemas in SQL and reloads PostgREST — no dashboard step).
2. Copy `.env.example` to `.env.local` and fill in the URL + anon key.

That's it — restart `npm run dev` and every screen reads from the database.

### Signing in

Live mode has real login (magic link or email + password, `/#/signin`).
Reading is open to everyone; signing in identifies you: an email the
organiser has invited (see [`db/README.md`](./db/README.md#login--membership))
claims that person on the crew list, any other email joins as a fresh
volunteer. Demo mode skips auth entirely — the first organiser plays "you".

## Project layout

```
src/
├── main.tsx              app entry, mounts router + icon fonts
├── App.tsx               routes + theme application
├── theme.css             design tokens (forest / dusk / birch themes) + layout
├── data/
│   ├── types.ts          domain model
│   ├── mockData.ts       sample content (the only hard-coded data)
│   └── database.ts       ◄ the single data-access layer
├── components/
│   ├── Layout.tsx        sidebar, mobile nav, Ask bob button
│   ├── AskBob.tsx        project-bound assistant drawer and consulted sources
│   └── ui.tsx            shared primitives (pills, rings, avatars, etc.)
└── pages/                one file per screen
```

## Design

The look follows the original mockup: a warm, practical "site office" feel with
the **birch** theme by default (`forest` and `dusk` are also defined in
`theme.css`). Status colours are semantic — green = done/ready, amber = in
progress, red = blocked/missing — and shopping lists are print-clean on A4.
