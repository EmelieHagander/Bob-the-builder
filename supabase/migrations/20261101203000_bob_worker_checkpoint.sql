-- Konrad's stalled job (da79a46e, 2026-11-01): bob-worker hit "CPU Time
-- exceeded" on every resume. A worker job runs inside one of Bob's tool calls,
-- so each resume replayed the whole worker job from its first step. Jobs now
-- save the worker's place after each finished worker step and continue from
-- there. Pinned per job at start; running jobs keep their behaviour.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_worker_checkpoint$
declare flags jsonb:=$contract_flags_change$
{"worker_checkpoint_version": 1}
$contract_flags_change$::jsonb;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='agent-contract.ask-bob' and p.retired_at is null for update of p;
 if not found then raise exception 'worker_checkpoint_contract_missing'; end if;
 if prior.metadata ? 'worker_checkpoint_version' then raise exception 'worker_checkpoint_already_set'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-worker-checkpoint-v1')||flags,
   prior.content,prior.definition,prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('agent-contract.ask-bob',version_uuid));
end $bob_worker_checkpoint$;
commit;
