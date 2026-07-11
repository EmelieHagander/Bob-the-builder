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
| `/` | Dashboard — status at a glance, areas, next build day, what needs attention |
| `/areas`, `/areas/:slug` | Areas list and area detail (tasks / materials / reference images) |
| `/people` | People, their skills and dietary needs |
| `/events`, `/events/:slug` | Build events and event detail with sign-up + day plan |
| `/food` | Meal plan and the allergy / dietary matrix |
| `/food/shopping` | Food shopping list (checkable, printable) |
| `/shopping` | Materials shopping list, grouped by category (checkable, printable) |
| `/announcements` | Announcement board |
| `/today` | Day-of "what needs doing today" view |
| — | **Ask bob** assistant drawer (floating button on every screen) |

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
```

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
2. On Supabase, expose the schema: **API settings → Exposed schemas → add
   `bob`.**
3. Copy `.env.example` to `.env.local` and fill in the URL + anon key.

That's it — restart `npm run dev` and every screen reads from the database.

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
│   ├── AskBob.tsx        assistant drawer
│   └── ui.tsx            shared primitives (pills, rings, avatars, etc.)
└── pages/                one file per screen
```

## Design

The look follows the original mockup: a warm, practical "site office" feel with
the **birch** theme by default (`forest` and `dusk` are also defined in
`theme.css`). Status colours are semantic — green = done/ready, amber = in
progress, red = blocked/missing — and shopping lists are print-clean on A4.
