-- Owner decision 2026-10-30 (after paid box run 5): every tool Bob uses is a
-- native function again. With every tool but the six permanent ones behind
-- use_tool, Bob read each tool as text and wrote wrong arguments 20 times in one
-- turn (create_solution_alternative 11 times) until the run's time limit; the
-- same tools succeeded first time as native functions in run 4.
-- tool_order_version 1 replaces tool_sheets_version 1: the tools offered at the
-- turn's first step (the permanent tools and the tool picker's choice) keep
-- their order for the whole turn, and a tool loaded later is added at the end.
-- The list only grows, so each load costs one cache miss and every step in
-- between keeps the cache. Deploy both Bob runtimes with the tool-order
-- consumer before activation. Pinned manifests keep tool sheets or their
-- earlier native lists.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_tool_order$
declare prior shared.ai_prompt_versions; version_uuid uuid; next_version integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' for update of p;
 if not found then raise exception 'tool_order_toolbox_missing'; end if;
 if prior.metadata->>'tool_sheets_version' is distinct from '1' then raise exception 'tool_order_requires_tool_sheets'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision'-'tool_sheets_version')||jsonb_build_object('publication','tool-order-v1','tool_order_version',1),
   prior.content,(prior.definition-'tool_sheets_version')||jsonb_build_object('tool_order_version',1),
   prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('bob.tools',version_uuid));
end $bob_tool_order$;
commit;
