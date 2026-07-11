-- ─────────────────────────────────────────────────────────────────────────────
-- bob — migration 0002: explicit display order for areas and people
--
-- The dashboard, areas list, people page and diet matrix all render these in
-- list order, so the order is content, not an accident of insertion. Materials,
-- events, meals and food already carry sort_order — this brings areas and
-- people in line.
--
-- Apply with:  psql "$DATABASE_URL" -f db/migrations/0002_add_display_order.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table bob.areas  add column sort_order integer not null default 0;
alter table bob.people add column sort_order integer not null default 0;

-- Backfill for databases already carrying the Skogsstuga seed (no-op elsewhere).
update bob.areas set sort_order = v.ord
from (values
  ('a_koket', 1), ('a_taket', 2), ('a_bastun', 3),
  ('a_tradgarden', 4), ('a_loftet', 5), ('a_verandan', 6)
) as v(id, ord)
where bob.areas.id = v.id;

update bob.people set sort_order = v.ord
from (values
  ('em', 1), ('he', 2), ('as', 3), ('ma', 4),
  ('la', 5), ('si', 6), ('os', 7), ('tv', 8)
) as v(id, ord)
where bob.people.id = v.id;

commit;
