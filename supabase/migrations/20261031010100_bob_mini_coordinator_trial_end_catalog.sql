-- Ends the mini coordinator trial (20261031010000): role.ask-bob returns to
-- profile.ask-bob (standard tier). profile.ask-bob-mini stays published for a
-- later decision. Catalog only; running and pinned jobs keep their manifests.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_mini_trial_end$
declare prior shared.ai_prompt_versions; version_uuid uuid; next_version integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='role.ask-bob' and p.definition_kind='role' for update of p;
 if not found then raise exception 'bob_mini_trial_end_role_missing'; end if;
 if prior.definition->>'profile_key' is distinct from 'profile.ask-bob-mini' then raise exception 'bob_mini_trial_end_not_in_trial'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-mini-trial-end-v1'),
   prior.content,jsonb_set(prior.definition,'{profile_key}','"profile.ask-bob"'::jsonb),prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('role.ask-bob',version_uuid));
end $bob_mini_trial_end$;
commit;
