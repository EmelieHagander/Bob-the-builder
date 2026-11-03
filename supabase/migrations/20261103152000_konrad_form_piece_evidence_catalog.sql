-- Activate A/B only after ask-bob and bob-worker both ship the v2 readers.
-- Existing claimed jobs retain their pinned worker_piece_progress_version=1.
-- No schema, extra model, or worker-tool-contract change.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $konrad_form_piece$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
  tools_definition jsonb;
  evidence_metadata jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob', 0));

  select v.definition into tools_definition from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='bob.tools'
      and p.definition_kind='tool_contract' and p.retired_at is null;
  select v.metadata into evidence_metadata from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='tools.check_construction_draft'
      and p.definition_kind='tool_contract' and p.retired_at is null;
  if tools_definition is null or tools_definition->>'build_workers_version' is distinct from '1'
    or tools_definition->>'report_readback_version' is distinct from '1'
    or tools_definition->>'construction_auto_check_version' is distinct from '1'
    or evidence_metadata->>'construction_evidence_version' is distinct from '1' then
    raise exception 'konrad_form_piece_tools_unexpected';
  end if;

  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='agent-contract.ask-bob'
      and p.definition_kind='agent_contract' and p.retired_at is null for update of p;
  if not found or prior.metadata->>'worker_piece_progress_version' is distinct from '1'
    or prior.metadata->>'worker_checkpoint_version' is distinct from '1'
    or prior.metadata->>'workpad_version' is distinct from '1' then
    raise exception 'konrad_form_piece_contract_unexpected';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id, version, definition_kind, definition_format_version, metadata,
    content, definition, flow, available_variables
  ) values (
    prior.prompt_id, next_version, prior.definition_kind, prior.definition_format_version,
    (prior.metadata - 'seed_version' - 'source_revision') ||
      '{"publication":"konrad-form-piece-evidence-v2","worker_piece_progress_version":2}'::jsonb,
    prior.content, prior.definition, prior.flow, prior.available_variables
  ) returning id into version_uuid;

  perform shared.activate_ai_catalog('bob', jsonb_build_object('agent-contract.ask-bob', version_uuid));
end $konrad_form_piece$;
commit;
