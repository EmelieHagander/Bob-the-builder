# bob — database

bob lives in a **shared Postgres database**, so it keeps strictly to its own
schema: everything is created inside schema **`bob`** — tables, enums, views,
functions and triggers. Nothing touches `public`, every statement is
schema-qualified, and nothing relies on `search_path`.

## Layout

```
db/
├── migrations/
│   └── 0001_create_bob_schema.sql   schema `bob` + all tables, enums, view, RLS, grants
├── seed.sql                         the "Skogsstuga" sample project (mirrors src/data/mockData.ts)
└── README.md                        this file
```

## Applying it

```bash
psql "$DATABASE_URL" -f db/migrations/0001_create_bob_schema.sql
psql "$DATABASE_URL" -f db/seed.sql        # optional sample data
```

Migrations are numbered and run once, in order. The seed is idempotent —
re-running it is a no-op.

### On Supabase

1. Run the migration (SQL editor, or `supabase db push` with the file in your
   migrations dir).
2. Expose the schema to the API: **Project settings → API → Exposed schemas →
   add `bob`.**
3. Point the client at the schema when creating it (see below).

## How it maps to the app

The tables mirror `src/data/types.ts` one-to-one. Array fields on the TS types
become join tables:

| TS type / field | Database |
| --- | --- |
| `Project` | `bob.projects` |
| `Person`, `Person.skills` | `bob.people`, `bob.person_skills` |
| `Area`, `.crewIds`, `.referenceImages` | `bob.areas`, `bob.area_crew`, `bob.area_reference_images` |
| `Task`, `.assigneeIds` | `bob.tasks`, `bob.task_assignees` |
| `Material` | `bob.materials` (`area` → `area_label`) |
| `BuildEvent`, `.attendeeIds` | `bob.events`, `bob.event_attendees` |
| `Meal` | `bob.meals` (linked to its build day via `event_id`) |
| `DietMatrixRow` + `getDietColumns()` | `bob.diet_flags` + `bob.diet_columns` (a flag row = `true`) |
| `FoodGroup` / `FoodItem` | `bob.food_groups`, `bob.food_items` |
| `Announcement` | `bob.announcements` |
| `TodayTask` | `bob.today_tasks` (a view over tasks + areas, not a table) |
| `ChatMessage` (Ask bob) | *not in the DB* — scripted assistant content stays client-side |

Display strings the UI consumes verbatim (`hours: '6h'`, `spots: '12 / 20'`,
`cost: '1 920 kr'`, `day: 'Lör 5 juli'`) are stored as authored text for now,
exactly like the mock data. Normalising them into numeric/date columns is
future work and only touches this schema + `src/data/database.ts`.

## Wiring the app to it

All data access already goes through the single module
[`src/data/database.ts`](../src/data/database.ts). To read from the database
instead of the mock, create the client **scoped to the `bob` schema** and flip
`USE_MOCK`:

```ts
import { createClient } from '@supabase/supabase-js'

const db = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'bob' } },          // ◄ shared database — always scope to bob
)
const USE_MOCK = false
```

Then each function body becomes the equivalent query, e.g.
`db.from('areas').select('*')` — the client already targets schema `bob`, so
table names stay bare.

## Security posture

- **RLS is enabled on every table** from day one (shared database).
- v1 of the app is read-only, so each table carries a single public
  `for select` policy and nothing else — all writes are blocked until proper
  auth-based policies are added alongside the write features.
- The grants block in the migration is Supabase-aware (`anon` /
  `authenticated` / `service_role`) and a no-op on a plain Postgres — there,
  grant your app's role instead:

  ```sql
  grant usage on schema bob to bob_app;
  grant select on all tables in schema bob to bob_app;
  alter default privileges in schema bob grant select on tables to bob_app;
  ```
