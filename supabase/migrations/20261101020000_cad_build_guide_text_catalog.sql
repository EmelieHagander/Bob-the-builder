-- Build guide text (owner approved 2026-11-01), publication cad-build-guide-v2.
-- Paid box run 2026-11-01: the drawing worker sent assembly_dependencies null
-- because the field read as optional ("Build guide only ... Null makes no build
-- guide"), so no guide was made. The field now says what the guide is for. Bob
-- sees it only while the cad-build-guide switch is on. Text only: no runtime
-- deploy is needed (the runtime offers the catalog's definition). Re-running is
-- a no-op.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $cad_build_guide_text_v2$
declare spec jsonb:=$cad_build_guide_text${"key": "tools.design_project_cad", "old": "Build guide only. For every saved joint of the construction, the joints that must be done before it: your proposed assembly order. Null makes no build guide.", "description": "The build guide made with this drawing: the builders follow it page by page with the parts in front of them. For every saved joint, the joints that must already be done before it, in the order you would put it together. Null only when the construction has no saved joints."}$cad_build_guide_text$;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid; current text;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key=spec->>'key' and p.retired_at is null for update of p;
 if not found then raise notice 'cad build guide text: % not installed',spec->>'key'; return; end if;
 current:=prior.definition->'parameters'->'properties'->'assembly_dependencies'->>'description';
 if current=spec->>'description' then return; end if;
 if current is distinct from spec->>'old' then raise exception 'cad_build_guide_text_unexpected'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','cad-build-guide-v2'),
   prior.content,jsonb_set(prior.definition,'{parameters,properties,assembly_dependencies,description}',to_jsonb(spec->>'description')),
   prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object(spec->>'key',version_uuid));
end $cad_build_guide_text_v2$;
commit;
