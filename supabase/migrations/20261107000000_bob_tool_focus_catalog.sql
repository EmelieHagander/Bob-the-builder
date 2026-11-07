-- Owner decision 2026-11-06 ("Applicera alla"): B after A.
-- Measured since 2026-11-02 (28 Bob turns with Konrad): Konrad was offered 25
-- tools on every call; two of them (read_construction_draft 386 calls,
-- edit_construction_parts 57) were 75 % of his calls, thirteen were used seven
-- times or fewer and five never. Bob called describe_tool 97 times, and each
-- loaded tool changed his tool list within the turn, which under Claude paid
-- the whole input again.
--
-- B1 Konrad plans first: a construction write before a plan note in his
--    workpad is refused with plan_required (same tool list, no cache miss).
-- B2 Konrad's focus: seven core tools always (plus the workpad), up to four
--    of eleven optional tools picked at job start from Bob's request by the
--    tool picker, the five never-used tools no longer offered.
-- B3 Bob's picker names up to eight tools at turn start instead of four.
--
-- Deploy both Bob runtimes with worker_focus_version / worker_plan_version /
-- tool_pick_limit support before applying. Pinned manifests keep their
-- behaviour; only new claimed jobs adopt the flags.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_tool_focus$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
  activation jsonb:='{}'::jsonb;
  focus jsonb:=$tool_focus_definition${
    "version": 1,
    "core": ["read_construction_draft", "edit_construction_parts", "save_construction_draft", "check_construction_draft",
             "find_catalog_materials", "add_catalog_fastener", "search_project_data"],
    "optional": ["change_construction_parameters", "continue_construction_change", "read_build_tree", "read_solution_context",
                 "read_construction_changes", "search_building_knowledge", "open_project_item", "list_project_category",
                 "calculate_project", "change_construction_roles", "read_construction_delivery"],
    "optional_limit": 4
  }$tool_focus_definition$::jsonb;
  contract_flags jsonb:=$tool_focus_contract${"worker_focus_version":1,"worker_plan_version":1,"tool_pick_limit":8}$tool_focus_contract$::jsonb;
  persona_addition text:=$tool_focus_persona$Innan du ändrar något skriver du din plan i anteckningsblocket: målet, stegen i ordning och nästa steg. En ändring utan plan avvisas. Planen är ditt arbetsläge, inte ett sparat resultat; uppdatera nästa steg efter varje sparad del.$tool_focus_persona$;
  picker_old text:=$tool_focus_picker_old$Name at most four, only from candidates; name fewer when fewer are needed.$tool_focus_picker_old$;
  picker_new text:=$tool_focus_picker_new$Name at most eight, only from candidates; name fewer when fewer are needed.$tool_focus_picker_new$;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));

  -- bob.tools: the structure worker's focus, flagged on the box.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='bob.tools'
      and p.definition_kind='tool_contract' and p.retired_at is null for update of p;
  if not found or prior.definition->>'build_workers_version' is distinct from '1'
    or prior.definition->>'workpad_version' is distinct from '1'
    or prior.definition ? 'worker_focus_version'
    or prior.definition->'build_workers'->'structure' is null
    or prior.definition->'build_workers'->'structure' ? 'focus' then
    raise exception 'tool_focus_toolbox_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-tool-focus-v1","worker_focus_version":1}'::jsonb,
    prior.content,
    jsonb_set(prior.definition||'{"worker_focus_version":1}'::jsonb,'{build_workers,structure,focus}',focus,true),
    prior.flow,prior.available_variables
  ) returning id into version_uuid;
  activation:=activation||jsonb_build_object('bob.tools',version_uuid);

  -- agent-contract.ask-bob: the three pins new claimed jobs adopt.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='agent-contract.ask-bob'
      and p.definition_kind='agent_contract' and p.retired_at is null for update of p;
  if not found or prior.metadata->>'workpad_version' is distinct from '1'
    or prior.metadata->>'worker_checkpoint_version' is distinct from '1'
    or prior.metadata ? 'worker_focus_version' or prior.metadata ? 'worker_plan_version' or prior.metadata ? 'tool_pick_limit' then
    raise exception 'tool_focus_contract_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-tool-focus-v1"}'::jsonb||contract_flags,
    prior.content,prior.definition,prior.flow,prior.available_variables
  ) returning id into version_uuid;
  activation:=activation||jsonb_build_object('agent-contract.ask-bob',version_uuid);

  -- schema.bob_tool_pick: room for eight names.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='schema.bob_tool_pick'
      and p.definition_kind='response_schema' and p.retired_at is null for update of p;
  if not found or prior.definition->'properties'->'tools'->>'maxItems' is distinct from '4' then
    raise exception 'tool_focus_pick_schema_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-tool-focus-v1"}'::jsonb,
    prior.content,
    jsonb_set(prior.definition,'{properties,tools,maxItems}','8'::jsonb,false),
    prior.flow,prior.available_variables
  ) returning id into version_uuid;
  activation:=activation||jsonb_build_object('schema.bob_tool_pick',version_uuid);

  -- tool-picker.contract: the same sentence, eight instead of four.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='tool-picker.contract'
      and p.definition_kind='instruction_fragment' and p.retired_at is null for update of p;
  if not found or position(picker_old in prior.content)=0 then
    raise exception 'tool_focus_picker_contract_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-tool-focus-v1"}'::jsonb,
    replace(prior.content,picker_old,picker_new),prior.definition,prior.flow,prior.available_variables
  ) returning id into version_uuid;
  activation:=activation||jsonb_build_object('tool-picker.contract',version_uuid);

  -- structure-worker.persona: the plan comes first.
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='structure-worker.persona'
      and p.definition_kind='prompt' and p.retired_at is null for update of p;
  if not found or position('en öppning eller berörd vägg i taget' in prior.content)=0
    or position('Innan du ändrar något' in prior.content)>0 then
    raise exception 'tool_focus_persona_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-tool-focus-v1"}'::jsonb,
    prior.content||E'\n\n'||persona_addition,
    prior.definition,prior.flow,prior.available_variables
  ) returning id into version_uuid;
  activation:=activation||jsonb_build_object('structure-worker.persona',version_uuid);

  perform shared.activate_ai_catalog('bob',activation);
end $bob_tool_focus$;
commit;
