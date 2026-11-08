-- Publish only after the private workpad migration and both Bob runtimes have
-- the renewal code. Existing pinned turns keep their earlier worker protocol.
-- No provider chain is restarted without a saved revision, exact readback and
-- a newer private note naming the next step.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_worker_verified_renewal$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='agent-contract.ask-bob'
      and p.definition_kind='agent_contract' and p.retired_at is null for update of p;
  if not found or prior.metadata->>'workpad_version' is distinct from '1'
    or prior.metadata->>'worker_checkpoint_version' is distinct from '1'
    or prior.metadata->>'worker_verified_renewal_version' is not null then
    raise exception 'worker_renewal_contract_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version
    from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||
      '{"publication":"bob-worker-verified-renewal-v1","worker_verified_renewal_version":1}'::jsonb,
    prior.content,prior.definition,prior.flow,prior.available_variables
  ) returning id into version_uuid;
  perform shared.activate_ai_catalog('bob',jsonb_build_object('agent-contract.ask-bob',version_uuid));
end $bob_worker_verified_renewal$;
commit;
