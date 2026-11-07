-- Owner decision 2026-11-07 (sketchbook, design B; "Ja kör på rek!"): Konrad
-- builds a construction in a sketch and saves it once per assignment, or at a
-- step the owner should see. edit_construction_parts takes mode sketch|save;
-- commit_construction_sketch saves, reads, rebases or discards the sketch. For
-- constructions this replaces the 2026-11-03 direction to save each piece
-- before the next. New claimed jobs pin construction_sketch_version 1.
-- Needs 20261107090000_construction_sketches.sql and both Bob runtimes with
-- sketch support. Pinned manifests keep their behaviour.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_construction_sketch$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
  prompt_uuid uuid;
  activation jsonb:='{}'::jsonb;
  def jsonb;
  note text:=$construction_sketch_note$ mode sketch keeps this change in your sketch of the construction instead of saving it: it is merged with the changes already sketched (a later change to the same id replaces the earlier one), checked as a whole like a saved revision, and saves nothing. expected_revision stays the saved revision the sketch started from. mode save saves at once. Build a construction in the sketch and save it once with commit_construction_sketch when the assignment is done, or at a step the owner should see.$construction_sketch_note$;
  commit_tool jsonb:=$construction_sketch_tool${
 "name": "commit_construction_sketch",
 "description": "Save, read or discard your sketch of one construction. commit saves all sketched changes as one new revision through the same checks as edit_construction_parts, with the whole-model check of that revision. read shows what the sketch adds, changes and removes. discard drops it without saving. rebase moves the sketch onto the current saved revision when the construction changed after the sketch began, and checks it there. A sketch lasts for this request only.",
 "parameters": {
  "type": "object",
  "additionalProperties": false,
  "required": [
   "record_id",
   "action",
   "key",
   "change_note",
   "request_quote"
  ],
  "properties": {
   "record_id": {
    "type": "string",
    "format": "uuid",
    "description": "The construction the sketch belongs to."
   },
   "action": {
    "type": "string",
    "enum": [
     "commit",
     "read",
     "discard",
     "rebase"
    ]
   },
   "key": {
    "anyOf": [
     {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,80}$"
     },
     {
      "type": "null"
     }
    ],
    "description": "commit and rebase: names this change; a corrected retry needs a new key. null for read and discard."
   },
   "change_note": {
    "anyOf": [
     {
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
     },
     {
      "type": "null"
     }
    ],
    "description": "commit and rebase: what the saved change does, in plain words. null for read and discard."
   },
   "request_quote": {
    "type": "string",
    "minLength": 1,
    "maxLength": 500
   }
  }
 },
 "handler": "commit_construction_sketch",
 "additional_description": "Commit once when the assignment is done, or at a step the owner should see: the construction then gets one new revision, its whole-model check and its follow-up work once. Read the sketch first when unsure what it holds. When a commit says the construction changed, rebase, correct what the rebase names with edit_construction_parts mode sketch, then commit.",
 "required_parameters": [
  "record_id",
  "action",
  "key",
  "change_note",
  "request_quote"
 ],
 "optional_parameters": [],
 "envelope": {
  "type": "function",
  "schema_version": 1,
  "arguments": "JSON object validated against parameters; project binding and write provenance remain server-owned."
 },
 "expected_return": {
  "format": "json",
  "contract": "The registered handler returns its structured domain result and status; a successful write additionally returns its saved receipt. A provider tool call alone is not a saved result."
 },
 "card_description": "Use to save, read or discard the sketch of construction changes made with edit_construction_parts mode sketch. A commit saves them as one revision with its whole-model check."
}$construction_sketch_tool$::jsonb;
  entry jsonb:=$construction_sketch_entry${
 "name": "commit_construction_sketch",
 "description": "Save, read or discard a sketch of construction changes.",
 "how_to": "Commit once when the assignment is done, or at a step the owner should see: the construction then gets one new revision, its whole-model check and its follow-up work once. Read the sketch first when unsure what it holds. When a commit says the construction changed, rebase, correct what the rebase names with edit_construction_parts mode sketch, then commit.",
 "schema_version": 1,
 "always_load": false,
 "preload_phases": [],
 "active": true
}$construction_sketch_entry$::jsonb;
  flags jsonb:=$construction_sketch_contract${"construction_sketch_version":1}$construction_sketch_contract$::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));

  -- edit_construction_parts: mode sketch|save.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='tools.edit_construction_parts'
      and p.definition_kind='tool_contract' and p.retired_at is null for update of p;
  if not found or prior.definition->'parameters'->'properties' ? 'mode'
    or jsonb_typeof(prior.definition->'parameters'->'required') is distinct from 'array'
    or jsonb_typeof(prior.definition->'required_parameters') is distinct from 'array' then
    raise exception 'construction_sketch_edit_tool_unexpected';
  end if;
  def:=jsonb_set(prior.definition,'{parameters,properties,mode}','{"type":"string","enum":["sketch","save"]}'::jsonb,true);
  def:=jsonb_set(def,'{parameters,required}',(def->'parameters'->'required')||'["mode"]'::jsonb,false);
  def:=jsonb_set(def,'{required_parameters}',(def->'required_parameters')||'["mode"]'::jsonb,false);
  def:=jsonb_set(def,'{description}',to_jsonb((def->>'description')||note),false);
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-construction-sketch-v1","construction_sketch_version":1}'::jsonb,
    prior.content,def,prior.flow,prior.available_variables
  ) returning id into version_uuid;
  activation:=activation||jsonb_build_object('tools.edit_construction_parts',version_uuid);

  -- commit_construction_sketch: the new tool contract.
  if exists(select 1 from shared.ai_prompts where app='bob' and prompt_key='tools.commit_construction_sketch') then
    raise exception 'construction_sketch_tool_already_published';
  end if;
  insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
    values('bob','tools.commit_construction_sketch','tools.commit_construction_sketch','bob-construction-sketch-v1','','','tool_contract')
    returning id into prompt_uuid;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prompt_uuid,1,'tool_contract',1,'{"server_fields":["request_quote"],"publication":"bob-construction-sketch-v1","construction_sketch_version":1}'::jsonb,
      '',commit_tool,'','[]'::jsonb)
    returning id into version_uuid;
  activation:=activation||jsonb_build_object('tools.commit_construction_sketch',version_uuid);

  -- bob.tools: listed, on the drawings shelf, and in Konrad's core focus.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='bob.tools'
      and p.definition_kind='tool_contract' and p.retired_at is null for update of p;
  if not found or prior.definition->>'worker_focus_version' is distinct from '1'
    or prior.definition ? 'construction_sketch_version'
    or exists(select 1 from jsonb_array_elements(prior.definition->'catalog') c where c->>'name'='commit_construction_sketch')
    or not (prior.definition->'contract_keys' ? 'tools.edit_construction_parts')
    or not (prior.definition->'shelves'->5->'tools' ? 'edit_construction_parts')
    or not (prior.definition->'build_workers'->'structure'->'tools' ? 'edit_construction_parts')
    or not (prior.definition->'build_workers'->'structure'->'focus'->'core' ? 'edit_construction_parts') then
    raise exception 'construction_sketch_toolbox_unexpected';
  end if;
  def:=prior.definition||flags;
  def:=jsonb_set(def,'{catalog}',(def->'catalog')||jsonb_build_array(entry),false);
  def:=jsonb_set(def,'{contract_keys}',(def->'contract_keys')||'["tools.commit_construction_sketch"]'::jsonb,false);
  def:=jsonb_set(def,'{shelves,5,tools}',(def->'shelves'->5->'tools')||'["commit_construction_sketch"]'::jsonb,false);
  def:=jsonb_set(def,'{build_workers,structure,tools}',(def->'build_workers'->'structure'->'tools')||'["commit_construction_sketch"]'::jsonb,false);
  def:=jsonb_set(def,'{build_workers,structure,focus,core}',(def->'build_workers'->'structure'->'focus'->'core')||'["commit_construction_sketch"]'::jsonb,false);
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-construction-sketch-v1"}'::jsonb||flags,
    prior.content,def,prior.flow,prior.available_variables
  ) returning id into version_uuid;
  activation:=activation||jsonb_build_object('bob.tools',version_uuid);

  -- agent-contract.ask-bob: the pin new claimed jobs adopt.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='agent-contract.ask-bob'
      and p.definition_kind='agent_contract' and p.retired_at is null for update of p;
  if not found or prior.metadata->>'write_check_version' is distinct from '1'
    or prior.metadata ? 'construction_sketch_version' then
    raise exception 'construction_sketch_contract_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-construction-sketch-v1"}'::jsonb||flags,
    prior.content,prior.definition,prior.flow,prior.available_variables
  ) returning id into version_uuid;
  activation:=activation||jsonb_build_object('agent-contract.ask-bob',version_uuid);

  -- The live tool policy row (schema version 1, matching the handler).
  insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active)
    values(entry->>'name',entry->>'description',entry->>'how_to',1,false,'{}'::text[],true);

  perform shared.activate_ai_catalog('bob',activation);
end $bob_construction_sketch$;
commit;
