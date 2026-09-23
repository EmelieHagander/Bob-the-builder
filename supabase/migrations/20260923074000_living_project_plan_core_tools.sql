-- Living-plan tools are project-level capabilities and must remain available
-- when legacy projects have no lifecycle phase yet.
begin;

update bob.tool_catalog
set always_load = true
where name in ('propose_project_plan','decide_project_plan','link_project_plan_evidence')
  and schema_version = 1
  and active = true;

do $$
declare changed integer;
begin
  select count(*) into changed
  from bob.tool_catalog
  where name in ('propose_project_plan','decide_project_plan','link_project_plan_evidence')
    and schema_version = 1
    and active = true
    and always_load = true;
  if changed <> 3 then
    raise exception 'living_plan_core_tool_update_incomplete';
  end if;
end $$;

update bob.tool_catalog
set description = 'Create a task or change its name and instructions. Does not assign participants, complete tasks, change status or approve readiness. A Task is not a living Project Plan; never use this tool to store or emulate one — use propose_project_plan.'
where name = 'save_project_task'
  and schema_version = 1
  and active = true;

do $$
begin
  if not exists (
    select 1 from bob.tool_catalog
    where name = 'save_project_task'
      and schema_version = 1
      and active = true
      and description like '%not a living Project Plan%'
  ) then
    raise exception 'task_plan_boundary_update_incomplete';
  end if;
end $$;

commit;
