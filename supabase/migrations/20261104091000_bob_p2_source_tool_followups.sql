-- P2: Avoid repeated tool-manual/response rounds when Bob has already
-- opened a current solution or its exact editable source.
-- No new tool, model, vendor adapter, or entitlement: existing policies,
-- schema/permission checks and the next-step offer fence still apply.
-- Existing in-flight turns keep their pinned catalog manifest.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $p2_source_tool_followups$
declare
 prior shared.ai_prompt_versions;
 next_version integer;
 version_uuid uuid;
 followups jsonb;
 additions constant jsonb := '[
   {"after_tool":"read_solution_context","statuses":["ok"],
    "tools":["read_project_edit_context","change_solution_evidence"]},
   {"after_tool":"read_project_edit_context","statuses":["ok"],
    "tools":["edit_project_record"]}
 ]'::jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior
 from shared.ai_prompts p
 join shared.ai_prompt_versions v on v.id=p.active_version_id
 where p.app='bob' and p.prompt_key='bob.tools'
  and p.definition_kind='tool_contract' and p.retired_at is null
 for update of p;
 if not found then raise exception 'p2_source_followup_catalog_missing'; end if;
 if prior.metadata->>'p2_source_followups_version'='1' then return; end if;
 if prior.version<>43 or prior.metadata->>'construction_work_version' is distinct from '1'
  or jsonb_typeof(prior.definition->'operation_followups') is distinct from 'array'
 then raise exception 'p2_source_followup_catalog_changed'; end if;
 followups:=prior.definition->'operation_followups';
 if jsonb_array_length(followups)+jsonb_array_length(additions)>32 then
  raise exception 'p2_source_followup_budget_exceeded';
 end if;
 if exists(
   select 1 from jsonb_array_elements(followups) f
    where f->>'after_tool' in ('read_solution_context','read_project_edit_context')
 ) then raise exception 'p2_source_followup_existing_chain'; end if;
 -- Reuse existing read/write tool contracts and their current live gates.
 -- A successful read merely makes the next tools available on the NEXT step.
 select coalesce(max(version),0)+1 into next_version
  from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(
   prompt_id,version,definition_kind,definition_format_version,
   metadata,content,definition,flow,available_variables
 ) values(
   prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision') ||
   '{"publication":"p2-source-tool-followups-v1","p2_source_followups_version":1}'::jsonb,
   prior.content,jsonb_set(prior.definition,'{operation_followups}',followups||additions),
   prior.flow,prior.available_variables
 ) returning id into version_uuid;
 perform shared.activate_ai_catalog(
   'bob',jsonb_build_object('bob.tools',version_uuid));
end $p2_source_tool_followups$;
commit;
