-- Proposal only. Managed apply supplies the authoritative migration timestamp.
-- Save Bob's exact reviewed current-turn compilation without reserializing nested plan JSON.
begin;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('save_compiled_project_plan',
  'Save the exact current-turn living-plan compilation that already passed server validation and nano review. Creates a reviewable proposal only; never approval.',
  'Available only after compile_project_plan returned proposal_ready=true in this same turn. Pass only request_quote: an exact quote from the CURRENT user request authorising a plan proposal. The server reuses the exact reviewed compilation and current expected revision. Do not reconstruct Steps/Requirements or call propose_project_plan with copied assistant JSON. This tool never creates Step↔Task links and never approves the proposal.',
  1,true,array[]::text[],true)
on conflict(name) do update set
  description=excluded.description,how_to=excluded.how_to,schema_version=excluded.schema_version,
  always_load=excluded.always_load,preload_phases=excluded.preload_phases,active=excluded.active;

update bob.tool_catalog
set how_to='Pass only plan_intent. The server resolves the current approved revision, grounds Bob''s strategy through mini and reviews it with nano. If the result says proposal_ready=true and the current user request authorizes saving, use save_compiled_project_plan with only an exact request_quote. Do not copy the compiled nested JSON into propose_project_plan. task_candidates remain advisory until explicit Step↔Task writes after approval.'
where name='compile_project_plan' and schema_version=1 and active=true;

update bob.tool_catalog
set always_load=false,
    preload_phases=array[]::text[],
    how_to='Low-level manual proposal write. Normally do NOT use this after compile_project_plan: save_compiled_project_plan owns that path and preserves the exact reviewed compilation. Load this only when an authorised manual proposal genuinely cannot originate from the compiler. It still requires the exact current revision, full strict Step/Requirement schema and exact request_quote.'
where name='propose_project_plan' and schema_version=1 and active=true;

do $$
begin
  if not exists(select 1 from bob.tool_catalog
    where name='save_compiled_project_plan' and schema_version=1 and active=true and always_load=true) then
    raise exception 'bob_compiled_plan_save_tool_not_active';
  end if;
  if exists(select 1 from bob.tool_catalog
    where name='propose_project_plan' and always_load=true) then
    raise exception 'bob_manual_plan_proposal_still_core';
  end if;
end $$;

commit;
