-- Owner decision 2026-11-07, after the bed and entry turns ("1. Ja 2. Ja
-- 3. Ja 4. Nej, kör opus"): versions come from the database, tool schemas stay
-- the same all job long, and a new construction can be sketched in parts.
--   server_target_version 1: no target_revision in Konrad's construction
--     writes; the server keeps a construction on the current selected target
--     (bed: Konrad sent 20 where the target was 15, four refusals).
--   stable_tools_version 1: operation refs are checked by the server instead
--     of listed as an enum in the schemas; core tools first with a cache point.
--   server_revisions_version 1: no model types any revision number; the
--     server fills each one (catalog items, measurements, constructions, the
--     plan, the selected target, or what the model read in this request).
--   refusal_guard_version 1: a refused call does not run again unchanged;
--     a third refusal for the same reason asks for another approach.
--   construction_sketch_version 2: save_construction_draft takes mode
--     sketch|save; commit_construction_sketch takes new_key and is bound to
--     the job's construction like the part edits (entry: a new wall did not
--     fit the 120 s answer window, seven times).
-- Needs 20261107100000_construction_new_sketches.sql and both Bob runtimes
-- with this code. Pinned manifests keep their behaviour.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_lean_writes$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
  activation jsonb:='{}'::jsonb;
  def jsonb;
  tool text;
  edit_old text:=$lean_writes_edit_old$; target_revision must be null because the server binds the new selection.$lean_writes_edit_old$;
  edit_new text:=$lean_writes_edit_new$; the server binds the new selection.$lean_writes_edit_new$;
  param_old text:=$lean_writes_param_old$target_revision:null preserves the saved target pin. After reading a changed selected Solution, supply its current target_revision to reconcile this SAME construction with it; changes:[] refreshes only that pin.$lean_writes_param_old$;
  param_new text:=$lean_writes_param_new$The server keeps this construction on the current selected Solution; changes:[] refreshes only that pin.$lean_writes_param_new$;
  save_note text:=$lean_writes_save_note$ mode sketch builds a new construction in your sketch instead of saving it: send it in parts, every call with the same key, the current title, description, area and refinement, and the next parts; a definition, part, node, binding, material, joint or role with the same id replaces the earlier one. Each call is checked as a whole like a save and saves nothing. Save it once with commit_construction_sketch, new_key being that key. mode save saves at once.$lean_writes_save_note$;
  commit_v2 jsonb:=$lean_writes_commit${
 "description": "Save, read or discard your sketch of one construction. For a new construction new_key is the key its save_construction_draft sketch used; otherwise new_key is null. commit saves all sketched changes as one revision, a new construction as revision 1, through the same checks as a direct save, with the whole-model check of that revision. read shows what the sketch holds. discard drops it without saving. rebase moves a sketch of an existing construction onto its current saved revision when the construction changed after the sketch began, and checks it there. A sketch lasts for this request only.",
 "parameters": {
  "type": "object",
  "additionalProperties": false,
  "required": [
   "record_id",
   "new_key",
   "action",
   "key",
   "change_note",
   "request_quote"
  ],
  "properties": {
   "record_id": {
    "anyOf": [
     {
      "type": "string",
      "format": "uuid"
     },
     {
      "type": "null"
     }
    ],
    "description": "The construction the sketch belongs to; null for a new construction."
   },
   "new_key": {
    "anyOf": [
     {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{1,80}$"
     },
     {
      "type": "null"
     }
    ],
    "description": "For a new construction, the key of its sketch; otherwise null."
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
 "required_parameters": [
  "record_id",
  "new_key",
  "action",
  "key",
  "change_note",
  "request_quote"
 ],
 "card_description": "Use to save, read or discard the sketch of construction changes made with edit_construction_parts mode sketch, or of a new construction sketched with save_construction_draft mode sketch. A commit saves them as one revision with its whole-model check."
}$lean_writes_commit$::jsonb;
  commit_binding jsonb:=$lean_writes_binding${"schema":[{"path":[],"hide":["record_id"],"refs":[{"field":"source_ref","kind":"construction","nullable":true,"when":"unbound"}],"role":"structure"}]}$lean_writes_binding$::jsonb;
  flags jsonb:=$lean_writes_contract${"stable_tools_version":1,"server_target_version":1,"server_revisions_version":1,"refusal_guard_version":1,"construction_sketch_version":2}$lean_writes_contract$::jsonb;
  occurrences integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));

  -- The three construction writes lose target_revision.
  foreach tool in array array['tools.edit_construction_parts','tools.change_construction_parameters','tools.save_construction_draft'] loop
    select v.* into prior from shared.ai_prompts p
      join shared.ai_prompt_versions v on v.id=p.active_version_id
      where p.app='bob' and p.prompt_key=tool and p.definition_kind='tool_contract' and p.retired_at is null for update of p;
    if not found or not (prior.definition->'parameters'->'properties' ? 'target_revision')
      or prior.metadata ? 'server_target_version' then
      raise exception 'lean_writes_tool_unexpected: %',tool;
    end if;
    def:=prior.definition #- '{parameters,properties,target_revision}';
    def:=jsonb_set(def,'{parameters,required}',coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(def->'parameters'->'required') with ordinality r(x,n) where x<>'"target_revision"'),'[]'::jsonb),false);
    def:=jsonb_set(def,'{required_parameters}',coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(def->'required_parameters') with ordinality r(x,n) where x<>'"target_revision"'),'[]'::jsonb),false);
    if tool<>'tools.save_construction_draft' then
      occurrences:=(length(def->>'description')-length(replace(def->>'description',edit_old,'')))/length(edit_old);
      if occurrences<>1 then raise exception 'lean_writes_text_unexpected: % edit',tool; end if;
      def:=jsonb_set(def,'{description}',to_jsonb(replace(def->>'description',edit_old,edit_new)),false);
    end if;
    if tool='tools.change_construction_parameters' then
      occurrences:=(length(def->>'description')-length(replace(def->>'description',param_old,'')))/length(param_old);
      if occurrences<>1 then raise exception 'lean_writes_text_unexpected: % refresh',tool; end if;
      def:=jsonb_set(def,'{description}',to_jsonb(replace(def->>'description',param_old,param_new)),false);
    end if;
    if tool='tools.save_construction_draft' then
      if def->'parameters'->'properties' ? 'mode' then raise exception 'lean_writes_save_mode_unexpected'; end if;
      def:=jsonb_set(def,'{parameters,properties,mode}','{"type":"string","enum":["sketch","save"]}'::jsonb,true);
      def:=jsonb_set(def,'{parameters,required}',(def->'parameters'->'required')||'["mode"]'::jsonb,false);
      def:=jsonb_set(def,'{required_parameters}',(def->'required_parameters')||'["mode"]'::jsonb,false);
      def:=jsonb_set(def,'{description}',to_jsonb((def->>'description')||save_note),false);
    end if;
    select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
    insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
      values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
        (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-lean-writes-v1","server_target_version":1}'::jsonb
          ||case when tool='tools.save_construction_draft' then '{"construction_sketch_version":2}'::jsonb else '{}'::jsonb end,
        prior.content,def,prior.flow,prior.available_variables)
      returning id into version_uuid;
    activation:=activation||jsonb_build_object(tool,version_uuid);
  end loop;

  -- commit_construction_sketch: new_key for a new construction.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='tools.commit_construction_sketch' and p.definition_kind='tool_contract' and p.retired_at is null for update of p;
  if not found or prior.definition->'parameters'->'properties' ? 'new_key' then raise exception 'lean_writes_commit_unexpected'; end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
      (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-lean-writes-v1","construction_sketch_version":2}'::jsonb,
      prior.content,prior.definition||commit_v2,prior.flow,prior.available_variables)
    returning id into version_uuid;
  activation:=activation||jsonb_build_object('tools.commit_construction_sketch',version_uuid);

  -- bob.tools: the commit is bound to the job's construction.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' and p.retired_at is null for update of p;
  if not found or prior.definition->>'construction_sketch_version' is distinct from '1'
    or jsonb_typeof(prior.definition->'worker_operation_bindings') is distinct from 'object'
    or prior.definition->'worker_operation_bindings' ? 'commit_construction_sketch' then
    raise exception 'lean_writes_toolbox_unexpected';
  end if;
  def:=jsonb_set(prior.definition||flags,'{worker_operation_bindings,commit_construction_sketch}',commit_binding,true);
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
      (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-lean-writes-v1"}'::jsonb||flags,
      prior.content,def,prior.flow,prior.available_variables)
    returning id into version_uuid;
  activation:=activation||jsonb_build_object('bob.tools',version_uuid);

  -- agent-contract.ask-bob: the pins new claimed jobs adopt.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='agent-contract.ask-bob' and p.definition_kind='agent_contract' and p.retired_at is null for update of p;
  if not found or prior.metadata->>'construction_sketch_version' is distinct from '1'
    or prior.metadata ? 'stable_tools_version' or prior.metadata ? 'server_target_version' or prior.metadata ? 'server_revisions_version' or prior.metadata ? 'refusal_guard_version' then
    raise exception 'lean_writes_contract_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
      (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-lean-writes-v1"}'::jsonb||flags,
      prior.content,prior.definition,prior.flow,prior.available_variables)
    returning id into version_uuid;
  activation:=activation||jsonb_build_object('agent-contract.ask-bob',version_uuid);

  perform shared.activate_ai_catalog('bob',activation);
end $bob_lean_writes$;
commit;
