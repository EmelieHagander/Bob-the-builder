-- Proposal only. Managed apply supplies the authoritative migration timestamp.
-- Replace Bob's fragile multiplexed plan-assistant call with two simple read-only tools.
begin;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('compile_project_plan',
  'Ground Bob''s own project-manager plan intent against current authorised project truth using the read-only mini compiler and nano reviewer.',
  'Pass only plan_intent: Bob''s concise Step sequence/goals/change intent. Do not supply project id, mode or expected revision; the server reads the current approved living-plan revision itself. The result is advisory and read-only. task_candidates are suggestions only, never saved Step↔Task links. Do not save a compilation with review errors.',
  1,true,array[]::text[],true),
 ('audit_project_plan',
  'Audit the current approved living plan against authorised project evidence with the read-only mini compiler and nano reviewer.',
  'Call with no arguments. The server resolves the current approved living plan and revision. Use the returned review to identify representation/evidence problems. This tool never writes, approves or links Tasks.',
  1,true,array[]::text[],true)
on conflict(name) do update set
  description=excluded.description,how_to=excluded.how_to,schema_version=excluded.schema_version,
  always_load=excluded.always_load,preload_phases=excluded.preload_phases,active=excluded.active;

update bob.tool_catalog
set active=false, always_load=false, preload_phases=array[]::text[]
where name='consult_plan_assistant' and schema_version=1;

update bob.tool_catalog
set how_to='Read the current plan through search_project_data dataset=plan before replanning when you need to understand its exact current contents. Keep completed history: the server carries completed Steps unchanged. Before creating/revising a proposal, call compile_project_plan with only Bob''s plan_intent; the server supplies current revision/project plumbing and returns mini+nano advisory output. Reuse exact Step/Requirement IDs only when they come from the current plan; use null for genuinely new ones. Near-term requirements should be concrete; distant Steps may remain coarse. For every active/near-term Step, notes is the Step Brief. Tasks are actions and Completion Requirements are finish criteria. A plan proposal never creates Step↔Task links even when compile_project_plan returns task_candidates. Link candidates only after the proposal is approved/current, via link_project_plan_task. Explain why the plan changes. This write creates only a proposal and still needs an exact quote from the current request.'
where name='propose_project_plan' and schema_version=1 and active=true;

do $$
begin
  if (select count(*) from bob.tool_catalog
      where name in ('compile_project_plan','audit_project_plan')
        and schema_version=1 and active=true and always_load=true) <> 2 then
    raise exception 'bob_simple_plan_assistant_tools_not_active';
  end if;
  if exists(select 1 from bob.tool_catalog where name='consult_plan_assistant' and active) then
    raise exception 'bob_legacy_plan_assistant_still_active';
  end if;
end $$;

commit;
