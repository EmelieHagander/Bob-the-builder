-- Konrad's read loop (job da79a46e, 2026-11-01 18:28): workers refreshed their
-- context at Bob's 64k continuation limit, so a 70-part construction was
-- summarized almost every step; Konrad lost the pages he had read, read them
-- about 20 times and never saved. Workers and other specialists now refresh at
-- 150k (below their 200k ceiling). Bob keeps 64k. Pinned per job at start.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_specialist_continuation$
declare flags jsonb:=$contract_flags_change$
{"specialist_continuation_tokens": 150000}
$contract_flags_change$::jsonb;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='agent-contract.ask-bob' and p.retired_at is null for update of p;
 if not found then raise exception 'specialist_continuation_contract_missing'; end if;
 if prior.metadata ? 'specialist_continuation_tokens' then raise exception 'specialist_continuation_already_set'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-specialist-continuation-v1')||flags,
   prior.content,prior.definition,prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('agent-contract.ask-bob',version_uuid));
end $bob_specialist_continuation$;
commit;
