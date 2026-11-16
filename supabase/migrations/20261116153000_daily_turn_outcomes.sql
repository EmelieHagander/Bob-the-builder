-- Audit 2026-11-16, point 4: one daily number for "did what the owner asked for get saved?".
-- Read-only, content-free, built from bob.execution_events. Service-only like its source.
-- change_turns: turns where Bob or a worker called a tool that changes something
--   (anything except read/search/get/list/find/open/describe/check and the workpad).
-- saved_pct: share of change_turns that ended saved (delivery status saved or
--   candidate_ready, with at least one saved record). partial/failed show the rest.
create or replace view bob_private.daily_turn_outcomes as
with turns as (
  -- A resumed turn can write more than one delivery row; the latest one is its outcome.
  select distinct on (d.turn_id) d.turn_id, (d.created_at at time zone 'Europe/Stockholm')::date as day, d.status,
    coalesce((d.counts->>'saved_records')::int, 0) as saved_records
  from bob.execution_events d where d.kind = 'delivery' and d.turn_id is not null
  order by d.turn_id, d.created_at desc
), tools as (
  select e.turn_id,
    count(*) filter (where e.counts->>'tool' !~ '^(read|search|get|list|find|open|describe|check|update_workpad)') as change_calls,
    count(*) filter (where e.status in ('invalid', 'conflict', 'needs_data', 'unavailable', 'step_budget')) as refused_calls,
    count(*) filter (where e.counts->>'tool' = 'read_construction_draft') as drawing_reads
  from bob.execution_events e where e.kind = 'tool' and e.turn_id is not null group by e.turn_id
), money as (
  select turn_id, sum(cost_usd) as cost_usd from bob.execution_events where kind = 'model' and turn_id is not null group by turn_id
)
select t.day,
  count(*) as turns,
  count(*) filter (where coalesce(x.change_calls, 0) > 0) as change_turns,
  count(*) filter (where coalesce(x.change_calls, 0) > 0 and t.saved_records > 0 and t.status in ('saved', 'candidate_ready')) as change_turns_saved,
  round(100.0 * count(*) filter (where coalesce(x.change_calls, 0) > 0 and t.saved_records > 0 and t.status in ('saved', 'candidate_ready'))
    / nullif(count(*) filter (where coalesce(x.change_calls, 0) > 0), 0)) as saved_pct,
  count(*) filter (where t.status = 'partial') as partial,
  count(*) filter (where t.status = 'failed') as failed,
  coalesce(sum(x.refused_calls), 0) as refused_calls,
  coalesce(sum(x.drawing_reads), 0) as drawing_reads,
  round(coalesce(sum(m.cost_usd), 0), 2) as cost_usd
from turns t left join tools x using (turn_id) left join money m using (turn_id)
group by t.day
;

revoke all on bob_private.daily_turn_outcomes from public, anon, authenticated;
comment on view bob_private.daily_turn_outcomes is
  'Daily owner-turn outcomes (audit 2026-11-16): saved_pct = change turns that ended saved. Days in Europe/Stockholm.';
