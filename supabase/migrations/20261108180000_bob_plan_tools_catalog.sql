-- Owner run 2026-11-08 (Våningssäng 2) and owner decision the same day
-- ("Bob måste ha verktyg för att kunna ändra"): Bob owns the plan, but his
-- plan tools reached him only if the turn's tool picker named them. The picker
-- named reads, so Bob could not add the work steps and told the owner he would
-- wait for her answers. With plan_tools_version 1 the tools below are loaded
-- from Bob's first step, like the check reads (bob-workers.ts catalogPlanTools).
--
-- Only bob.tools changes: a new version with plan_tools_version and plan_tools.
-- Refuses to run if the toolbox already has them or has no build workers.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_plan_tools$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
  addition jsonb:=$plan_tools_definition${"plan_tools_version":1,"plan_tools":["compile_project_plan","edit_project_plan","save_compiled_project_plan","decide_project_plan","create_work_record","edit_work_record"]}$plan_tools_definition$::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' and p.retired_at is null for update of p;
  if not found or prior.definition->'build_workers_version' is distinct from '1'::jsonb
    or prior.definition ? 'plan_tools_version' or prior.definition ? 'plan_tools' then
    raise exception 'plan_tools_toolbox_unexpected';
  end if;
  if exists(select 1 from jsonb_array_elements_text(addition->'plan_tools') t(name)
    where not exists(select 1 from shared.ai_prompts p where p.app='bob' and p.prompt_key='tools.'||t.name and p.definition_kind='tool_contract' and p.retired_at is null)) then
    raise exception 'plan_tools_tool_missing';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
      (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-plan-tools-v1"}'::jsonb,
      prior.content,prior.definition||addition,prior.flow,prior.available_variables)
    returning id into version_uuid;
  perform shared.activate_ai_catalog('bob',jsonb_build_object('bob.tools',version_uuid));
end $bob_plan_tools$;
commit;
