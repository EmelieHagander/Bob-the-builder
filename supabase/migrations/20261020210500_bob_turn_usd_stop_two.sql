-- Owner change (Emelie, 2026-10-20 23:00): restore the per-turn spending stop
-- from 1 to 2 USD. The 1 USD stop was temporary while the drawing failure was
-- diagnosed; that failure was the PostgREST 40001 retry loop fixed by
-- 20261020203000. The first run after the fix rendered and passed review but
-- stopped at the 1 USD limit before the drawing could be saved.
-- Pinned per job at start; running jobs keep their recorded stop.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_turn_usd_stop_two$
declare flags jsonb:=$turn_usd_stop_change$
{"turn_usd_stop": 2}
$turn_usd_stop_change$::jsonb;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='agent-contract.ask-bob' and p.retired_at is null for update of p;
 if not found then raise exception 'turn_usd_stop_contract_missing'; end if;
 if prior.metadata->'turn_usd_stop' is distinct from '1'::jsonb then raise exception 'turn_usd_stop_change_unexpected_prior'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-turn-usd-stop-v3')||flags,
   prior.content,prior.definition,prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('agent-contract.ask-bob',version_uuid));
end $bob_turn_usd_stop_two$;
commit;
