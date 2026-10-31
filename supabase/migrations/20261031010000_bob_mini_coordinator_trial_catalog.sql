-- Owner decision 2026-10-31: an early, short trial of Bob on the mini tier while
-- his workers stay standard. Adds profile.ask-bob-mini (profile.ask-bob on the
-- mini tier, same reasoning effort, limits and requirements) and points
-- role.ask-bob at it. Mattias keeps profile.ask-bob. Measured with one paid box
-- run, then 20261031010100 restores role.ask-bob unless the owner keeps it.
-- Catalog only; running and pinned jobs keep their manifests.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_mini_trial$
declare prior shared.ai_prompt_versions; base shared.ai_prompt_versions; prompt_uuid uuid; version_uuid uuid; activation jsonb:='{}'; next_version integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into base from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='profile.ask-bob' and p.definition_kind='execution_profile';
 if not found then raise exception 'bob_mini_trial_profile_missing'; end if;
 if exists(select 1 from shared.ai_prompts where app='bob' and prompt_key='profile.ask-bob-mini') then raise exception 'bob_mini_trial_already_published'; end if;
 insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
  values('bob','profile.ask-bob-mini','profile.ask-bob-mini','Bob mini coordinator trial','','','execution_profile') returning id into prompt_uuid;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prompt_uuid,1,'execution_profile',base.definition_format_version,jsonb_build_object('publication','bob-mini-trial-v1'),'',
   base.definition||jsonb_build_object('tier','mini'),'','[]'::jsonb) returning id into version_uuid;
 activation:=activation||jsonb_build_object('profile.ask-bob-mini',version_uuid);
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='role.ask-bob' and p.definition_kind='role' for update of p;
 if not found then raise exception 'bob_mini_trial_role_missing'; end if;
 if prior.definition->>'profile_key' is distinct from 'profile.ask-bob' then raise exception 'bob_mini_trial_unexpected_profile'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-mini-trial-v1'),
   prior.content,jsonb_set(prior.definition,'{profile_key}','"profile.ask-bob-mini"'::jsonb),prior.flow,prior.available_variables) returning id into version_uuid;
 activation:=activation||jsonb_build_object('role.ask-bob',version_uuid);
 perform shared.activate_ai_catalog('bob',activation);
end $bob_mini_trial$;
commit;
