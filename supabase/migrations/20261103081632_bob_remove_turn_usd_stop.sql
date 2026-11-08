-- Owner decision 2026-11-03: remove the temporary USD 4 per-turn spending stop.
-- Usage still goes to the ledger; worker execution, permissions and deadlines
-- remain bounded. Existing jobs retain their immutable pinned contract.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_remove_turn_usd_stop$
declare flags jsonb := $bob_turn_stop_remove$
{"remove_turn_usd_stop":true}
$bob_turn_stop_remove$::jsonb;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid;
begin
 if flags->>'remove_turn_usd_stop' is distinct from 'true' then raise exception 'turn_usd_stop_removal_not_confirmed'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='agent-contract.ask-bob' and p.retired_at is null for update of p;
 if not found then raise exception 'turn_usd_stop_contract_missing'; end if;
 if prior.metadata->'work_allowance_version' is distinct from '1'::jsonb then raise exception 'turn_usd_stop_requires_unlimited_work'; end if;
 if prior.metadata->'turn_usd_stop' is distinct from '4'::jsonb then raise exception 'turn_usd_stop_unexpected_prior'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision'-'turn_usd_stop')||jsonb_build_object('publication','bob-turn-usd-stop-removed-v1'),
   prior.content,prior.definition,prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('agent-contract.ask-bob',version_uuid));
end $bob_remove_turn_usd_stop$;
commit;
