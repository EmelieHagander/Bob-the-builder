-- Owner decision 2026-10-31: the mini coordinator trial, done properly. Bob's
-- model is chosen by routing.ask-bob (its default_profile_key overrides the
-- role's own profile_key), so this points the routing at profile.ask-bob-mini
-- for one paid box run; 20261031020100 points it back. Mattias keeps
-- profile.ask-bob. Catalog only; running and pinned jobs keep their manifests.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_mini_routing_trial$
declare prior shared.ai_prompt_versions; version_uuid uuid; next_version integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='routing.ask-bob' and p.definition_kind='routing_policy' for update of p;
 if not found then raise exception 'bob_mini_routing_trial_routing_missing'; end if;
 if prior.definition->>'default_profile_key' is distinct from 'profile.ask-bob' then raise exception 'bob_mini_routing_trial_unexpected_profile'; end if;
 if not exists(select 1 from shared.ai_prompts where app='bob' and prompt_key='profile.ask-bob-mini') then raise exception 'bob_mini_routing_trial_profile_missing'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-mini-routing-trial-v1'),
   prior.content,jsonb_set(prior.definition,'{default_profile_key}','"profile.ask-bob-mini"'::jsonb),prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('routing.ask-bob',version_uuid));
end $bob_mini_routing_trial$;
commit;
