-- Owner decision 2026-10-30 (after paid box run 5): the job's tools stay
-- native. With every tool except the permanent six behind use_tool, Bob read
-- each tool as text and wrote wrong arguments about 20 times in one turn
-- (create_solution_alternative 11 times) until the run's time limit;
-- the same tools succeeded first time as native functions in run 4.
-- tool_sheets_version 2: the tools offered at the turn's first step (the
-- permanent tools and the tool picker's choice) are native for the whole turn,
-- in a fixed order with use_tool last. Only a tool loaded later in the turn is
-- described at the end and called through use_tool, so the tool list still never
-- changes within a turn. Deploy both Bob runtimes with the version 2 consumer
-- before activation. Pinned manifests keep version 1 or native lists.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_tool_sheets_hybrid$
declare additions jsonb:=$tool_sheets_hybrid_additions$[
 {
  "key": "bob.toolbox.sheets-late",
  "kind": "instruction_fragment",
  "content": "Som byggprojektledare har du alltid dina standardverktyg och jobbets verktyg till hands. Verktyg du hämtar senare under jobbet beskrivs i detalj sist i samtalet. Call such a tool, or one whose manual describe_tool returned, through use_tool with its exact name and arguments that follow its parameters exactly."
 },
 {
  "key": "bob.toolbox.sheets-late-intro",
  "kind": "instruction_fragment",
  "content": "Verktyg du har hämtat under jobbet, i detalj. Call them through use_tool with the exact name and every required argument (null where the parameters allow it):"
 }
]$tool_sheets_hybrid_additions$::jsonb;
 patch jsonb; prompt_uuid uuid; version_uuid uuid; activation jsonb:='{}'; prior shared.ai_prompt_versions; next_version integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 for patch in select value from jsonb_array_elements(additions) loop
  if exists(select 1 from shared.ai_prompts where app='bob' and prompt_key=patch->>'key') then raise exception 'tool_sheets_hybrid_already_published: %',patch->>'key'; end if;
  insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
   values('bob',patch->>'key',patch->>'key','Tool sheets hybrid v1',coalesce(patch->>'content',''),'',patch->>'kind') returning id into prompt_uuid;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prompt_uuid,1,patch->>'kind',1,jsonb_build_object('publication','tool-sheets-hybrid-v1'),coalesce(patch->>'content',''),coalesce(patch->'definition','{}'::jsonb),'','[]'::jsonb) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' for update of p;
 if not found then raise exception 'tool_sheets_hybrid_toolbox_missing'; end if;
 if prior.metadata->>'tool_sheets_version' is distinct from '1' then raise exception 'tool_sheets_hybrid_requires_sheets'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','tool-sheets-hybrid-v1','tool_sheets_version',2),
   prior.content,prior.definition||jsonb_build_object('tool_sheets_version',2),
   prior.flow,prior.available_variables) returning id into version_uuid;
 activation:=activation||jsonb_build_object('bob.tools',version_uuid);
 perform shared.activate_ai_catalog('bob',activation);
end $bob_tool_sheets_hybrid$;
commit;
