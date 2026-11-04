-- Publish v4 only AFTER ask-bob and bob-worker both support the database-backed
-- facade gate. Old claimed turns retain their previously pinned v1/v2/v3.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bounded_piece_publication$
declare prior shared.ai_prompt_versions; next_version integer; version_uuid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p
  join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='agent-contract.ask-bob'
   and p.definition_kind='agent_contract' and p.retired_at is null for update of p;
 if not found or prior.metadata->>'worker_piece_progress_version' is distinct from '3'
  or prior.metadata->>'worker_checkpoint_version' is distinct from '1'
  or prior.metadata->>'workpad_version' is distinct from '1'
  then raise exception 'construction_piece_review_contract_unexpected';end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
 values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
  (prior.metadata-'seed_version'-'source_revision') ||
   '{"publication":"construction-piece-review-v4","worker_piece_progress_version":4}'::jsonb,
  prior.content,prior.definition,prior.flow,prior.available_variables)
 returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('agent-contract.ask-bob',version_uuid));
end $bounded_piece_publication$;
commit;
