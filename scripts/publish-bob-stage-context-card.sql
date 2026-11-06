-- Add the missing lazy-loading card without rewriting any published version.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $stage_context_card_publication$
declare
 patch jsonb := $stage_context_card_spec${"key":"tools.advance_work_stage","definition":{"card_description":"When a question is settled, carry source-bound findings and unresolved matters to the next stage, releasing older tool payloads and unneeded image pixels. Keep comparison images still needed. Original instructions and exact history remain. Call alone; this grants no approval."}}$stage_context_card_spec$::jsonb;
 prior shared.ai_prompt_versions;
 new_id uuid;
 next_version integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior
 from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
 where p.app='bob' and p.prompt_key=patch->>'key' and p.retired_at is null
 for update of p;
 if not found then raise exception 'stage_context_tool_missing'; end if;
 if prior.metadata->>'stage_context_version' is distinct from '1'
   or prior.definition->>'name' is distinct from 'advance_work_stage'
   or prior.definition->>'handler' is distinct from 'advance_work_stage' then
  raise exception 'stage_context_tool_incompatible';
 end if;
 if prior.definition @> (patch->'definition') then return; end if;
 if prior.definition ? 'card_description' then raise exception 'stage_context_card_changed'; end if;
 select coalesce(max(version),0)+1 into next_version
 from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
 values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
  (prior.metadata-'seed_version'-'source_revision')||'{"publication":"stage-context-card-v1"}'::jsonb,
  prior.content,prior.definition||(patch->'definition'),prior.flow,prior.available_variables)
 returning id into new_id;
 perform shared.activate_ai_catalog('bob',jsonb_build_object(patch->>'key',new_id));
end $stage_context_card_publication$;
commit;
