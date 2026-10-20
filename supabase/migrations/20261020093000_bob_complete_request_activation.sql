-- Activates stage 2+3 of the Launchpad-pattern migration for NEW durable main
-- turns (owner decision 2026-10-20, option A): every model call is one complete
-- request rebuilt from checkpoint state, and older tool results become exact
-- references instead of an AI summary. Running jobs keep their pinned identity.
-- Runtime code is already hosted; deploy #292's runtimes first.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_complete_request_activation$
declare flags jsonb:=$complete_request_activation_flags$
{"complete_request_version": 1, "result_reference_version": 1}
$complete_request_activation_flags$::jsonb;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='agent-contract.ask-bob' and p.retired_at is null for update of p;
 if not found then raise exception 'complete_request_contract_missing'; end if;
 if prior.metadata->'context_strategy_version' is distinct from '1'::jsonb then raise exception 'complete_request_context_strategy_required'; end if;
 if prior.metadata ? 'complete_request_version' or prior.metadata ? 'result_reference_version' then raise exception 'complete_request_already_published'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-complete-request-activation-v1')||flags,
   prior.content,prior.definition,prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('agent-contract.ask-bob',version_uuid));
end $bob_complete_request_activation$;
commit;
