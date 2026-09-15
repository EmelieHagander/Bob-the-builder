-- Keep the field-first Today surface aware of the workstream it comes from.
-- Adds identifiers/context only; task status remains independent from lifecycle phase.
--
-- Legacy migration replay and the deployed database reached different historical
-- column orders for this view. CREATE OR REPLACE cannot reorder existing view
-- columns, so recreate the derived view here and converge every installation on
-- one canonical shape before appending Area context.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop view if exists bob.today_tasks;

create view bob.today_tasks with (security_invoker=true) as
select
  t.id,
  a.project_id,
  a.name as area_name,
  t.name,
  t.skill,
  t.status,
  coalesce(
    (select array_agg(ta.person_id) from bob.task_assignees ta where ta.task_id = t.id),
    '{}'::text[]
  ) as assignee_ids,
  t.area_id,
  a.phase as area_phase
from bob.tasks t
join bob.areas a on a.id = t.area_id
where t.status in ('todo', 'doing');

revoke all on bob.today_tasks from public, anon;
grant select on bob.today_tasks to authenticated;

notify pgrst, 'reload schema';
commit;
