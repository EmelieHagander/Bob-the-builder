-- Owner decision 2026-11-07 (sketchbook, design A): edit_project_record takes
-- mode check|save. A check runs the same write through bob_project_write_check
-- (20261107080000) and rolls it back, so every rule, including the 30,000-byte
-- readback behind compact_design_intent_required, answers before a save. New
-- claimed jobs pin write_check_version 1. Deploy both Bob runtimes and the
-- check function first. Pinned manifests keep their behaviour.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_write_check$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
  activation jsonb:='{}'::jsonb;
  def jsonb;
  note text:=$write_check_note$ mode check runs this exact change through every save rule, including the 30,000-byte readback of the whole solution, and saves nothing; mode save keeps it. Check a large or uncertain change first.$write_check_note$;
  flags jsonb:=$write_check_contract${"write_check_version":1}$write_check_contract$::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));

  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='tools.edit_project_record'
      and p.definition_kind='tool_contract' and p.retired_at is null for update of p;
  if not found or prior.definition->'parameters'->'properties' ? 'mode'
    or jsonb_typeof(prior.definition->'parameters'->'required') is distinct from 'array' then
    raise exception 'write_check_tool_unexpected';
  end if;
  def:=jsonb_set(prior.definition,'{parameters,properties,mode}','{"type":"string","enum":["check","save"]}'::jsonb,true);
  def:=jsonb_set(def,'{parameters,required}',(def->'parameters'->'required')||'["mode"]'::jsonb,false);
  if jsonb_typeof(def->'required_parameters')='array' then
    def:=jsonb_set(def,'{required_parameters}',(def->'required_parameters')||'["mode"]'::jsonb,false);
  end if;
  def:=jsonb_set(def,'{description}',to_jsonb((def->>'description')||note),false);
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-write-check-v1"}'::jsonb,
    prior.content,def,prior.flow,prior.available_variables
  ) returning id into version_uuid;
  activation:=activation||jsonb_build_object('tools.edit_project_record',version_uuid);

  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='agent-contract.ask-bob'
      and p.definition_kind='agent_contract' and p.retired_at is null for update of p;
  if not found or prior.metadata->>'worker_gates_version' is distinct from '1'
    or prior.metadata ? 'write_check_version' then
    raise exception 'write_check_contract_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-write-check-v1"}'::jsonb||flags,
    prior.content,prior.definition,prior.flow,prior.available_variables
  ) returning id into version_uuid;
  activation:=activation||jsonb_build_object('agent-contract.ask-bob',version_uuid);

  perform shared.activate_ai_catalog('bob',activation);
end $bob_write_check$;
commit;
