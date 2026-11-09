-- Build guide sections (2026-11-09), publication cad-build-guide-v3.
-- Våningssäng 2 on 2026-11-08 20:35: Bob sent assembly_dependencies as a
-- near-serial chain over 129 joints. The guide made one page per dependency
-- level, so the page count was the chain's depth (51 levels, more pages than
-- the worker draws) and no guide was made. Bob could not see that limit.
-- design_project_cad now takes build_sections instead: Bob divides the guide
-- into titled sections and lists each section's steps in build order, one page
-- per step, every saved joint in exactly one step; up to 40 sections of 12
-- steps (the owner wants long guides in reasonable pieces). The runtime
-- still hides the field while the cad-build-guide switch is off, and still reads
-- assembly_dependencies for jobs pinned to an earlier catalog.
-- Apply AFTER 20261109075000 and the Edge deploy that knows build_sections. Re-running is a no-op.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $cad_build_sections$
declare spec jsonb:=$cad_build_sections_spec${"key":"tools.design_project_cad","replaces":"assembly_dependencies","field":"build_sections","property":{"type":["array","null"],"minItems":1,"maxItems":40,"items":{"type":"object","additionalProperties":false,"required":["title","steps"],"properties":{"title":{"type":"string","minLength":1,"maxLength":80},"steps":{"type":"array","minItems":1,"maxItems":12,"items":{"type":"object","additionalProperties":false,"required":["joint_ids"],"properties":{"joint_ids":{"type":"array","minItems":1,"maxItems":1024,"items":{"type":"string"}}}}}}},"description":"The build guide made with this drawing: the builders work through it section by section, page by page, with the parts in front of them. Divide the build into sections the way an assembly manual does (for example one end frame, then the ladder, then joining them), each with a short title in the owner's language. In each section list its steps in the order you would put it together; a step is one page: the saved joints done together at that point. Every saved joint is in exactly one step. Null only when the construction has no saved joints."}}$cad_build_sections_spec$;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid; definition jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key=spec->>'key' and p.retired_at is null for update of p;
 if not found then raise notice 'cad build steps: % not installed',spec->>'key'; return; end if;
 if prior.definition->'parameters'->'properties' ? (spec->>'field') then return; end if;
 if not (prior.definition->'parameters'->'properties' ? (spec->>'replaces')) then raise exception 'cad_build_sections_unexpected'; end if;
 definition:=jsonb_set(prior.definition,'{parameters,properties}',
  ((prior.definition->'parameters'->'properties')-(spec->>'replaces'))||jsonb_build_object(spec->>'field',spec->'property'));
 definition:=jsonb_set(definition,'{parameters,required}',
  (select jsonb_agg(case when r=spec->>'replaces' then spec->>'field' else r end order by n)
   from jsonb_array_elements_text(prior.definition->'parameters'->'required') with ordinality t(r,n)));
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','cad-build-guide-v3'),
   prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object(spec->>'key',version_uuid));
end $cad_build_sections$;
commit;
