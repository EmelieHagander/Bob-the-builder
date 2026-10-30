-- Build guides (2026-10-30): design_project_cad gets a nullable
-- `assembly_dependencies` argument, Bob's proposed assembly order for every saved
-- joint (publication cad-build-guide-v1). The runtime hides it from Bob unless
-- the owner's switch (shared.ai_settings cad-build-guide) is on, and accepts it
-- as optional, so jobs pinned to an earlier catalog are unaffected. With the
-- switch off nothing changes. Re-running is a no-op.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $cad_build_guide$
declare spec jsonb:=$cad_build_guide_spec${"key":"tools.design_project_cad","property":{"type":["array","null"],"maxItems":1024,"items":{"type":"object","additionalProperties":false,"required":["joint_id","depends_on"],"properties":{"joint_id":{"type":"string"},"depends_on":{"type":"array","maxItems":1024,"items":{"type":"string"}}}},"description":"Build guide only. For every saved joint of the construction, the joints that must be done before it: your proposed assembly order. Null makes no build guide."}}$cad_build_guide_spec$;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid; definition jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key=spec->>'key' and p.retired_at is null for update of p;
 if not found then raise notice 'cad build guide: % not installed',spec->>'key'; return; end if;
 if prior.definition->'parameters'->'properties' ? 'assembly_dependencies' then return; end if;
 definition:=jsonb_set(prior.definition,'{parameters,properties,assembly_dependencies}',spec->'property');
 definition:=jsonb_set(definition,'{parameters,required}',(definition->'parameters'->'required')||'["assembly_dependencies"]'::jsonb);
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','cad-build-guide-v1'),
   prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object(spec->>'key',version_uuid));
end $cad_build_guide$;
commit;
