-- Owner decision 2026-10-30: Bob's base prompt is always the same, and
-- everything new for a turn is added after it. The native tool list holds only
-- the six permanent tools and one fixed entry, use_tool; the tools chosen for
-- the job (the tool picker's four, and any loaded later) are described in detail
-- at the end of the conversation and called through use_tool. A tool loaded
-- mid-turn then never changes the start of the prompt, so the provider cache
-- holds for the whole turn and across turns. The fixed part says, as a
-- construction project manager would, that the tools for the job come in
-- detail at the end. Deploy both Bob runtimes with the use_tool consumer
-- before activation. Pinned manifests keep their native tool lists.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_tool_sheets$
declare additions jsonb:=$tool_sheets_additions$[
 {
  "key": "bob.toolbox.sheets-at-end",
  "kind": "instruction_fragment",
  "content": "Som byggprojektledare har du alltid dina standardverktyg till hands. Verktygen du har framför dig för just det här jobbet beskrivs i detalj sist i samtalet. Call such a tool, or one whose manual describe_tool returned, through use_tool with its exact name and arguments; a tool described at the end needs no describe_tool."
 },
 {
  "key": "bob.toolbox.sheets-intro",
  "kind": "instruction_fragment",
  "content": "Verktygen du har framför dig för det här jobbet, i detalj. Call them through use_tool with the exact name and arguments:"
 },
 {
  "key": "tools.use_tool",
  "kind": "tool_contract",
  "definition": {
   "name": "use_tool",
   "description": "Call a tool for this job by its exact name, with arguments that follow its parameters as described at the end of the conversation or in a describe_tool result.",
   "parameters": {"type": "object", "additionalProperties": false, "properties": {"name": {"type": "string"}, "arguments": {"type": "object"}}, "required": ["name", "arguments"]},
   "handler": "use_tool",
   "additional_description": "The server runs the named tool exactly as if it were called directly: the same authority, prerequisites, validation and receipts.",
   "required_parameters": ["name", "arguments"],
   "optional_parameters": [],
   "envelope": {"type": "function", "schema_version": 1, "arguments": "JSON object validated against parameters; project binding and write provenance remain server-owned."},
   "expected_return": {"format": "json", "contract": "The named tool's own structured result and status."},
   "card_description": "Use when a tool for this job is described at the end or by describe_tool. Gives that tool's own result."
  }
 }
]$tool_sheets_additions$::jsonb;
 patch jsonb; prompt_uuid uuid; version_uuid uuid; activation jsonb:='{}'; prior shared.ai_prompt_versions; next_version integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 for patch in select value from jsonb_array_elements(additions) loop
  if exists(select 1 from shared.ai_prompts where app='bob' and prompt_key=patch->>'key') then raise exception 'tool_sheets_already_published: %',patch->>'key'; end if;
  insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
   values('bob',patch->>'key',patch->>'key','Tool sheets v1',coalesce(patch->>'content',''),'',patch->>'kind') returning id into prompt_uuid;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prompt_uuid,1,patch->>'kind',1,jsonb_build_object('publication','tool-sheets-v1'),coalesce(patch->>'content',''),coalesce(patch->'definition','{}'::jsonb),'','[]'::jsonb) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 -- The toolbox names the fixed entry and opts in.
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' for update of p;
 if not found then raise exception 'tool_sheets_toolbox_missing'; end if;
 if prior.metadata->>'phase_tools_version' is distinct from '1' then raise exception 'tool_sheets_requires_phase_tools'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','tool-sheets-v1','tool_sheets_version',1),
   prior.content,
   jsonb_set(prior.definition||jsonb_build_object('tool_sheets_version',1),'{contract_keys}',(prior.definition->'contract_keys')||'["tools.use_tool"]'::jsonb),
   prior.flow,prior.available_variables) returning id into version_uuid;
 activation:=activation||jsonb_build_object('bob.tools',version_uuid);
 perform shared.activate_ai_catalog('bob',activation);
end $bob_tool_sheets$;
commit;
