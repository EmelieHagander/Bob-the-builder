-- A saved drawing request can be redrawn from other sides.
--
-- A request's views were fixed when it was created; resuming meant
-- handoff:null, which keeps the saved views. On 2026-10-21 the bunk-bed
-- request kept front,right,top,isometric after every side became drawable,
-- so its left-gable requirements still could not be seen and every review
-- failed. design_project_cad gets a nullable `views` argument: null keeps the
-- saved views, a list replaces them. Requirements stay as saved.
-- (publication cad-resume-views-v1). The runtime accepts the argument as
-- optional, so jobs pinned to an earlier catalog are unaffected.
-- Re-running is a no-op.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $cad_resume_views$
declare spec jsonb:=$cad_resume_views_spec${"key": "tools.design_project_cad", "property": {"type": ["array", "null"], "items": {"type": "string", "enum": ["front", "back", "left", "right", "top", "bottom", "isometric", "isometric_front_left", "isometric_back_left", "isometric_back_right"]}, "minItems": 1, "maxItems": 6, "uniqueItems": true, "description": "Null keeps the views saved on the request. To show other sides of a saved request, pass the complete new view list (1-6); its requirements stay as saved. Pick views that show every requirement where it is."}}$cad_resume_views_spec$;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid; definition jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key=spec->>'key' and p.retired_at is null for update of p;
 if not found then raise notice 'cad resume views: % not installed',spec->>'key'; return; end if;
 if prior.definition->'parameters'->'properties' ? 'views' then return; end if;
 definition:=jsonb_set(prior.definition,'{parameters,properties,views}',spec->'property');
 definition:=jsonb_set(definition,'{parameters,required}',(definition->'parameters'->'required')||'["views"]'::jsonb);
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','cad-resume-views-v1'),
   prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object(spec->>'key',version_uuid));
end $cad_resume_views$;
commit;
