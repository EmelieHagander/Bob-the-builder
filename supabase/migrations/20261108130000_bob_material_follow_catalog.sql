-- Owner runs 2026-11-08 (Våningssäng 2) and the review of GPT's audit:
--
-- 1. continue_construction_change was bound in worker jobs under
--    artifact_id/revision, but the tool takes record_id/expected_revision.
--    Every recalculation Konrad sent in a worker job was refused
--    ("$.artifact_id: remove unsupported field"), so the server's own
--    recalculation of a material row was never used and Mattias redid the
--    rows by hand. The binding now names the tool's own fields.
-- 2. material_follow_version 1 (the pin new claimed jobs adopt): after
--    Konrad's job, code recalculates the material rows of each construction
--    revision the job saved, through the same tool and writer
--    (construction-follow-up.ts). Rows that need a decision stay pending.
--
-- Nothing else changes. Refuses to run if either published value differs.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_material_follow$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
  activation jsonb:='{}'::jsonb;
  old_binding jsonb:=$material_follow_old_binding${"source":{"id":"artifact_id","revision":"revision","ref":"source_ref","readOnly":false},"schema":[{"path":[],"hide":["artifact_id","revision"],"refs":[{"field":"source_ref","kind":"construction","nullable":true,"when":"drawingOrUnbound"}]}]}$material_follow_old_binding$::jsonb;
  new_binding jsonb:=$material_follow_binding${"source":{"id":"record_id","revision":"expected_revision","ref":"source_ref","readOnly":false},"schema":[{"path":[],"hide":["record_id","expected_revision"],"refs":[{"field":"source_ref","kind":"construction","nullable":true,"when":"drawingOrUnbound"}]}]}$material_follow_binding$::jsonb;
  flags jsonb:=$material_follow_contract${"material_follow_version":1}$material_follow_contract$::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));

  -- bob.tools: the recalculation is bound under its own fields.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' and p.retired_at is null for update of p;
  if not found or prior.metadata->>'publication' is distinct from 'bob-lean-writes-v1'
    or prior.definition#>'{worker_operation_bindings,continue_construction_change}' is distinct from old_binding then
    raise exception 'material_follow_toolbox_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
      (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-material-follow-v1"}'::jsonb,
      prior.content,jsonb_set(prior.definition,'{worker_operation_bindings,continue_construction_change}',new_binding),prior.flow,prior.available_variables)
    returning id into version_uuid;
  activation:=activation||jsonb_build_object('bob.tools',version_uuid);

  -- agent-contract.ask-bob: the pin new claimed jobs adopt.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='agent-contract.ask-bob' and p.definition_kind='agent_contract' and p.retired_at is null for update of p;
  if not found or prior.metadata->>'refusal_guard_version' is distinct from '1' or prior.metadata ? 'material_follow_version' then
    raise exception 'material_follow_contract_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
      (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-material-follow-v1"}'::jsonb||flags,
      prior.content,prior.definition,prior.flow,prior.available_variables)
    returning id into version_uuid;
  activation:=activation||jsonb_build_object('agent-contract.ask-bob',version_uuid);

  perform shared.activate_ai_catalog('bob',activation);
end $bob_material_follow$;
commit;
