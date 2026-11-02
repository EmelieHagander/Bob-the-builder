-- Owner decision 2026-11-02 (thread "Fix Bob rambling in Ladan chat", option B):
-- Konrad starts a first construction only when the selected solution passes the
-- construction check. In Ladan he wrote a whole construction (40k output tokens)
-- that the save then refused. bob.tools gains handover_readiness_version 1; the
-- hand-over code reads it (new manifests only, so pinned jobs replay unchanged).
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_handover_readiness$
declare
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.tools' and p.retired_at is null for update of p;
 if not found then raise exception 'bob_handover_readiness_missing'; end if;
 if prior.definition->>'handover_readiness_version'='1' then return; end if;
 if prior.definition->>'build_workers_version' is distinct from '1' then raise exception 'bob_handover_readiness_unexpected_tools'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-handover-readiness-v1'),
   prior.content,prior.definition||'{"handover_readiness_version":1}'::jsonb,prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('bob.tools',version_uuid));
end $bob_handover_readiness$;
commit;
