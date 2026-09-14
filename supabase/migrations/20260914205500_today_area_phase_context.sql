-- Keep the field-first Today surface aware of the workstream it comes from.
-- Adds identifiers/context only; task status remains independent from lifecycle phase.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace view bob.today_tasks with (security_invoker=true) as
select
  t.id,
  a.name as area_name,
  t.name,
  t.skill,
  t.status,
  coalesce(
    (select array_agg(ta.person_id) from bob.task_assignees ta where ta.task_id = t.id),
    '{}'
  ) as assignee_ids,
  a.project_id,
  t.area_id,
  a.phase as area_phase
from bob.tasks t
join bob.areas a on a.id = t.area_id
where t.status in ('todo', 'doing');

revoke all on bob.today_tasks from public, anon;
grant select on bob.today_tasks to authenticated;

notify pgrst, 'reload schema';
commit;
