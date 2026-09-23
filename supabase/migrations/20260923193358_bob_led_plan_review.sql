-- Bob owns semantic assessment and repair. Keep the existing one-field save API.
-- Metadata only: no changes to auth, RLS, write RPCs or proposal approval.
begin;

update bob.tool_catalog
set description='Compile Bob''s plan intent into exact Steps/Requirements and return nano''s advisory review to Bob. Read-only; Bob decides corrections and saving.',
    how_to='Pass only plan_intent. The server supplies the current revision and authorised snapshot. Each call runs mini and nano once, then returns control to Bob. Read server_validation separately from the advisory review. Correct server errors; assess nano objections against evidence. To repair, call again with Bob''s corrected intent; prior compilation and feedback are supplied automatically. proposal_ready=true means server-valid, not nano-approved. If Bob accepts the proposal and the current request authorizes it, call save_compiled_project_plan with the current request_quote. Respect remaining_attempts; do not ask again for already granted proposal scope. Task candidates remain advisory until separate links are saved.'
where name='compile_project_plan' and schema_version=1 and active=true;

update bob.tool_catalog
set description='Save the exact server-valid compilation after Bob assesses the advisory review. Bob decides; nano does not veto. Creates a proposal only, never approval.',
    how_to='Available when the current compilation passes server validation. Bob must assess the compiled plan and nano advice before choosing this tool. A mistaken review objection or an unavailable reviewer is not a veto. Correct real semantic defects via compile_project_plan; missing measurements may remain open requirements. Pass only request_quote from the CURRENT request. A scoped continuation can authorize saving an already requested proposal. The server saves the exact compiled payload through the usual caller-authorized write and receipt path. Never reconstruct nested plan JSON. This does not approve a plan or create Step-Task links.'
where name='save_compiled_project_plan' and schema_version=1 and active=true;

do $$
begin
  if (select count(*) from bob.tool_catalog where name in ('compile_project_plan','save_compiled_project_plan')
      and schema_version=1 and active and always_load) <> 2 then
    raise exception 'bob_plan_tools_not_active';
  end if;
end $$;
commit;
