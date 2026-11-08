-- Publish only after bob_agent_workpads exists and both Bob runtimes understand
-- the new tool. This adds one optional workpad tool to the four role sessions;
-- the six permanent Bob tools, existing worker ownership and pinned jobs stay.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_agent_workpads_catalog$
declare
  spec jsonb:=$workpad_contract${
    "name":"update_workpad",
    "description":"Replace your short private working note with the current goal, next small step, blockers and references. It is not a saved construction or proof of finished project work.",
    "handler":"update_workpad",
    "parameters":{
      "type":"object","additionalProperties":false,
      "properties":{
        "expected_revision":{"type":"integer","minimum":0,"maximum":2147483645},
        "note":{"type":"object","additionalProperties":false,
          "properties":{
            "status":{"type":"string","enum":["working","waiting","done"]},
            "goal":{"type":"string","maxLength":500},
            "next_step":{"type":"string","maxLength":250},
            "steps":{"type":"array","maxItems":6,"items":{"type":"string","maxLength":180}},
            "blockers":{"type":"array","maxItems":6,"items":{"type":"string","maxLength":180}},
            "references":{"type":"array","maxItems":12,"items":{"type":"string","maxLength":180}}
          },"required":["status","goal","next_step","steps","blockers","references"]}
      },"required":["expected_revision","note"]
    },
    "required_parameters":["expected_revision","note"],
    "optional_parameters":[],
    "additional_description":"Use this as a replaceable scratch note when your current step or blockers change. Revision zero means no earlier note. Keep references short and reopen exact current project records for facts. A workpad note never counts as a save, check, permission or project decision.",
    "card_description":"Keep a short private working note for this colleague; project saves still need actual tool receipts.",
    "envelope":{"type":"function","schema_version":1,"arguments":"JSON object; the runtime binds the project, claimed turn and agent identity."},
    "expected_return":{"format":"json","contract":"noted (new revision), conflict (current revision) or unavailable; never saved or checked."}
  }$workpad_contract$::jsonb;
  policy jsonb:=jsonb_build_object('name','update_workpad',
    'description',spec->>'description','how_to',spec->>'additional_description',
    'schema_version',1,'always_load',false,'preload_phases','[]'::jsonb,'active',true);
  prior shared.ai_prompt_versions;
  prompt_uuid uuid; version_uuid uuid; next_version integer;
  activation jsonb:='{}'; definition jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
  if to_regprocedure('bob.bob_agent_workpad(text,uuid,uuid,uuid,bigint,text,integer,jsonb)') is null then
    raise exception 'workpad_database_missing';
  end if;
  if exists (select 1 from shared.ai_prompts where app='bob' and prompt_key='tools.update_workpad') then
    raise exception 'workpad_tool_already_published';
  end if;
  insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
    values('bob','tools.update_workpad','Private workpad',spec->>'description','','','tool_contract')
    returning id into prompt_uuid;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prompt_uuid,1,'tool_contract',1,'{"publication":"bob-agent-workpads-v1"}'::jsonb,'',spec,'','[]'::jsonb)
    returning id into version_uuid;
  activation:=activation||jsonb_build_object('tools.update_workpad',version_uuid);

  insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active)
    values('update_workpad',policy->>'description',policy->>'how_to',1,false,array[]::text[],true);

  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' and p.retired_at is null for update of p;
  if not found or prior.definition->>'build_workers_version' is distinct from '1'
    or prior.definition->>'workpad_version' is not null then raise exception 'workpad_toolbox_unexpected'; end if;
  definition:=prior.definition||jsonb_build_object('workpad_version',1,
    'contract_keys',prior.definition->'contract_keys'||jsonb_build_array('tools.update_workpad'),
    'catalog',prior.definition->'catalog'||jsonb_build_array(policy));
  definition:=jsonb_set(definition,'{shelves}',(select jsonb_agg(
    case when s->>'label'='Project records and memory'
      then jsonb_set(s,'{tools}',s->'tools'||jsonb_build_array('update_workpad')) else s end order by ord)
    from jsonb_array_elements(prior.definition->'shelves') with ordinality as shelves(s,ord)));
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
      (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-agent-workpads-v1"}'::jsonb,
      prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object('bob.tools',version_uuid);

  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='agent-contract.ask-bob' and p.definition_kind='agent_contract' and p.retired_at is null for update of p;
  if not found or prior.metadata->>'worker_checkpoint_version' is distinct from '1'
    or prior.metadata->>'workpad_version' is not null then raise exception 'workpad_contract_unexpected'; end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
      (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-agent-workpads-v1","workpad_version":1}'::jsonb,
      prior.content,prior.definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object('agent-contract.ask-bob',version_uuid);

  perform shared.activate_ai_catalog('bob',activation);
end $bob_agent_workpads_catalog$;
commit;
