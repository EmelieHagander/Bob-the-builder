-- Owner decision 2026-10-30 after paid box run 7: back to native tools in tool
-- order. With the fixed list and the repair helper (tool_repair_version 1) the
-- run passed but Bob needed 40 calls instead of 20 (run 6), 9 rejected tool
-- calls instead of 1, and cost USD 1.22 instead of 0.93; the helper fixed 1 of
-- 10 rejections, because most were about meaning, not shape. The cache share
-- rose to 78% but did not make up for the extra steps.
-- bob.tools: tool_order_version 1 replaces tool_sheets_version 1 and
-- tool_repair_version 1. Both Bob runtimes already carry the tool-order path;
-- no deploy. The repair role stays published but unused by new jobs; pinned
-- manifests keep their behaviour.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_tool_order_restore$
declare prior shared.ai_prompt_versions; version_uuid uuid; next_version integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' for update of p;
 if not found then raise exception 'tool_order_restore_toolbox_missing'; end if;
 if prior.metadata->>'tool_repair_version' is distinct from '1' then raise exception 'tool_order_restore_requires_tool_repair'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision'-'tool_sheets_version'-'tool_repair_version')||jsonb_build_object('publication','tool-order-restore-v1','tool_order_version',1),
   prior.content,(prior.definition-'tool_sheets_version'-'tool_repair_version')||jsonb_build_object('tool_order_version',1),
   prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('bob.tools',version_uuid));
end $bob_tool_order_restore$;
commit;
