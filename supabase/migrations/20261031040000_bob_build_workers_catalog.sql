-- Owner decision 2026-10-31: Bob coordinates; the structural designer owns the
-- construction and Rita makes the drawing, like Mattias does materials. Each has
-- its own fixed native tools and instructions, the same input Bob has (locked
-- project snapshot, conversation summaries and history) and Bob's brief last,
-- with the present records of its area (construction drafts; drawing requests).
-- They read and save through the same session gates, receipts and turn budgets
-- and report to Bob; they never answer the owner. Bob no longer offers their
-- tools; he hands jobs over through ask_structure_worker and ask_drawing_worker.
-- The independent drawing review gets its own identity, since Rita now draws.
-- The legacy box drawing (save_project_drawing), which skipped both the
-- construction and the review, is retired for new jobs (retired_tools).
-- Prompt texts drafted by Saoirse and approved by the owner (OLD -> NEW).
-- bob.tools: build_workers_version 1 and build_workers. Runtimes that read only
-- workers (materials) ignore them and keep these tools with Bob. Deploy both Bob
-- runtimes with the build_workers consumer before activation. Pinned manifests
-- keep their behaviour.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_build_workers$
declare additions jsonb:=$build_workers_additions$[
 {
  "key": "structure-worker.persona",
  "kind": "prompt",
  "content": "DRAFT persona"
 },
 {
  "key": "structure-worker.contract",
  "kind": "instruction_fragment",
  "content": "DRAFT contract"
 },
 {
  "key": "structure-worker.project",
  "kind": "instruction_fragment",
  "content": "DRAFT project:"
 },
 {
  "key": "structure-worker.conversation",
  "kind": "instruction_fragment",
  "content": "DRAFT conversation"
 },
 {
  "key": "structure-worker.brief",
  "kind": "instruction_fragment",
  "content": "DRAFT brief:"
 },
 {
  "key": "agent-contract.structure-worker",
  "kind": "agent_contract",
  "definition": {
   "mode": "worker_with_tools",
   "instructions_key": "structure-worker.contract",
   "source_scope": "current_authorized_work",
   "writes": "through_bob_session"
  }
 },
 {
  "key": "role.structure-worker",
  "kind": "role",
  "definition": {
   "name": "DRAFT",
   "title": "DRAFT",
   "purpose": "DRAFT purpose",
   "function_name": "structure-worker",
   "module": "global",
   "coworker_id": "bob",
   "enabled": true,
   "prompt_keys": [
    "structure-worker.persona",
    "structure-worker.contract"
   ],
   "profile_key": "profile.ask-bob",
   "contract_key": "agent-contract.structure-worker",
   "method_keys": [],
   "tool_keys": [
    "tools.save_construction_draft",
    "tools.check_construction_draft",
    "tools.change_construction_parameters",
    "tools.edit_construction_parts",
    "tools.change_construction_roles",
    "tools.continue_construction_change",
    "tools.derive_construction_lists",
    "tools.transition_legacy_drawing"
   ]
  }
 },
 {
  "key": "tools.ask_structure_worker",
  "kind": "tool_contract",
  "definition": {
   "name": "ask_structure_worker",
   "description": "DRAFT",
   "parameters": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "job": {
      "type": "string",
      "maxLength": 2000
     },
     "findings": {
      "type": [
       "string",
       "null"
      ],
      "maxLength": 6000
     }
    },
    "required": [
     "job",
     "findings"
    ]
   },
   "handler": "ask_structure_worker",
   "additional_description": "DRAFT",
   "required_parameters": [
    "job",
    "findings"
   ],
   "optional_parameters": [],
   "envelope": {
    "type": "function",
    "schema_version": 1,
    "arguments": "JSON object validated against parameters; project binding and write provenance remain server-owned."
   },
   "expected_return": {
    "format": "json",
    "contract": "DRAFT"
   },
   "card_description": "DRAFT"
  }
 },
 {
  "key": "drawing-worker.persona",
  "kind": "prompt",
  "content": "DRAFT persona"
 },
 {
  "key": "drawing-worker.contract",
  "kind": "instruction_fragment",
  "content": "DRAFT contract"
 },
 {
  "key": "drawing-worker.project",
  "kind": "instruction_fragment",
  "content": "DRAFT project:"
 },
 {
  "key": "drawing-worker.conversation",
  "kind": "instruction_fragment",
  "content": "DRAFT conversation"
 },
 {
  "key": "drawing-worker.brief",
  "kind": "instruction_fragment",
  "content": "DRAFT brief:"
 },
 {
  "key": "agent-contract.drawing-worker",
  "kind": "agent_contract",
  "definition": {
   "mode": "worker_with_tools",
   "instructions_key": "drawing-worker.contract",
   "source_scope": "current_authorized_work",
   "writes": "through_bob_session"
  }
 },
 {
  "key": "role.drawing-worker",
  "kind": "role",
  "definition": {
   "name": "Rita",
   "title": "DRAFT",
   "purpose": "DRAFT purpose",
   "function_name": "drawing-worker",
   "module": "global",
   "coworker_id": "bob",
   "enabled": true,
   "prompt_keys": [
    "drawing-worker.persona",
    "drawing-worker.contract"
   ],
   "profile_key": "profile.ask-bob",
   "contract_key": "agent-contract.drawing-worker",
   "method_keys": [],
   "tool_keys": [
    "tools.design_project_cad",
    "tools.save_cad_design",
    "tools.plan_cad_pieces",
    "tools.compose_cad_shell",
    "tools.link_cad_shell_steps",
    "tools.link_project_drawing",
    "tools.link_drawing_gap",
    "tools.ensure_drawing_gap_task"
   ]
  }
 },
 {
  "key": "tools.ask_drawing_worker",
  "kind": "tool_contract",
  "definition": {
   "name": "ask_drawing_worker",
   "description": "DRAFT",
   "parameters": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "job": {
      "type": "string",
      "maxLength": 2000
     },
     "findings": {
      "type": [
       "string",
       "null"
      ],
      "maxLength": 6000
     }
    },
    "required": [
     "job",
     "findings"
    ]
   },
   "handler": "ask_drawing_worker",
   "additional_description": "DRAFT",
   "required_parameters": [
    "job",
    "findings"
   ],
   "optional_parameters": [],
   "envelope": {
    "type": "function",
    "schema_version": 1,
    "arguments": "JSON object validated against parameters; project binding and write provenance remain server-owned."
   },
   "expected_return": {
    "format": "json",
    "contract": "DRAFT"
   },
   "card_description": "DRAFT"
  }
 }
]$build_workers_additions$::jsonb;
 edits jsonb:=$build_workers_edits$[]$build_workers_edits$::jsonb;
 workers jsonb:=$build_workers_definition${
 "drawing": {
  "role": "role.drawing-worker",
  "tool": "ask_drawing_worker",
  "tools": [
   "design_project_cad",
   "save_cad_design",
   "plan_cad_pieces",
   "compose_cad_shell",
   "link_cad_shell_steps",
   "link_project_drawing",
   "link_drawing_gap",
   "ensure_drawing_gap_task"
  ],
  "reads": [
   "read_construction_draft",
   "read_construction_delivery",
   "read_drawing_requests",
   "read_drawing_request_work",
   "read_cad_shell",
   "read_solution_context",
   "search_project_data",
   "open_project_item",
   "read_work_context",
   "calculate_project",
   "list_project_category",
   "read_plan_link_context",
   "read_project_record_section"
  ],
  "max_steps": 10,
  "current": {
   "tool": "read_drawing_requests",
   "arguments": {
    "request_id": null,
    "after_id": null
   }
  }
 },
 "structure": {
  "role": "role.structure-worker",
  "tool": "ask_structure_worker",
  "tools": [
   "save_construction_draft",
   "check_construction_draft",
   "change_construction_parameters",
   "edit_construction_parts",
   "change_construction_roles",
   "continue_construction_change",
   "derive_construction_lists",
   "transition_legacy_drawing"
  ],
  "reads": [
   "read_construction_draft",
   "read_construction_changes",
   "read_construction_delivery",
   "read_solution_context",
   "search_project_data",
   "open_project_item",
   "search_material_catalog",
   "read_material_catalog",
   "calculate_project",
   "search_building_knowledge",
   "list_project_category"
  ],
  "max_steps": 16,
  "current": {
   "tool": "read_construction_draft",
   "arguments": {
    "artifact_id": null,
    "revision": null,
    "after": null,
    "view": "overview",
    "ids": [],
    "result_id": null,
    "section": null,
    "step_id": null,
    "work_kind": null
   }
  }
 }
}$build_workers_definition$::jsonb;
 retired jsonb:=$build_workers_retired$[
 "save_project_drawing"
]$build_workers_retired$::jsonb;
 fn text; patch jsonb; policies jsonb:='[]'; prompt_uuid uuid; version_uuid uuid; activation jsonb:='{}'; prior shared.ai_prompt_versions; next_version integer; definition jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 foreach fn in array array['structure-worker','drawing-worker'] loop
  insert into shared.ai_settings(app,coworker_id,function_name,module_id,model,model_type,max_output_tokens,temperature,reasoning_effort,prompt_template,web_search,is_enabled,metadata)
   select 'bob','bob',fn,'global',model,model_type,max_output_tokens,temperature,reasoning_effort,null,false,is_enabled,
    jsonb_build_object('role',replace(fn,'-','_'),'authority','bob_session')
   from shared.ai_settings where app='bob' and coworker_id='bob' and function_name='ask-bob' and module_id='global'
   on conflict(app,coworker_id,function_name,module_id) do nothing;
  if not exists(select 1 from shared.ai_settings where app='bob' and coworker_id='bob' and function_name=fn and module_id='global') then raise exception 'build_workers_settings_missing: %',fn; end if;
 end loop;
 for patch in select value from jsonb_array_elements(additions) loop
  if exists(select 1 from shared.ai_prompts where app='bob' and prompt_key=patch->>'key') then raise exception 'build_workers_already_published: %',patch->>'key'; end if;
  insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
   values('bob',patch->>'key',patch->>'key','Build workers v1',coalesce(patch->>'content',''),'',patch->>'kind') returning id into prompt_uuid;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prompt_uuid,1,patch->>'kind',1,jsonb_build_object('publication','bob-build-workers-v1'),coalesce(patch->>'content',''),coalesce(patch->'definition','{}'::jsonb),'','[]'::jsonb) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 -- New versions of existing rows: the review's own identity and the colleague directory.
 for patch in select value from jsonb_array_elements(edits) loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=patch->>'key' and p.definition_kind=patch->>'kind' and p.retired_at is null for update of p;
  if not found then raise exception 'build_workers_edit_missing: %',patch->>'key'; end if;
  if patch ? 'old_content' and prior.content is distinct from patch->>'old_content' then raise exception 'build_workers_edit_unexpected: %',patch->>'key'; end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-build-workers-v1','build_workers_version',1),
    coalesce(patch->>'content',prior.content),prior.definition||coalesce(patch->'definition','{}'::jsonb),prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 -- Tool policy rows: Bob may hand work to either worker in every phase.
 for patch in select value from jsonb_each(workers) loop
  select value->'definition' into definition from jsonb_array_elements(additions) where value->>'key'='tools.'||(patch->>'tool');
  policies:=policies||jsonb_build_array(jsonb_build_object('name',patch->>'tool','description',definition->>'description','how_to',definition->>'additional_description',
   'schema_version',1,'always_load',false,'preload_phases','[]'::jsonb,'active',true));
  insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active)
   values(patch->>'tool',definition->>'description',definition->>'additional_description',1,false,array[]::text[],true)
   on conflict(name) do nothing;
 end loop;
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' for update of p;
 if not found then raise exception 'build_workers_toolbox_missing'; end if;
 if prior.definition->>'materials_worker_version' is distinct from '1' then raise exception 'build_workers_require_materials_worker'; end if;
 definition:=prior.definition||jsonb_build_object('build_workers_version',1,'build_workers',workers,'retired_tools',retired,
  'contract_keys',(prior.definition->'contract_keys')||(select jsonb_agg('tools.'||(p->>'name')) from jsonb_array_elements(policies) p),
  'catalog',(prior.definition->'catalog')||policies);
 definition:=jsonb_set(definition,'{shelves}',(select jsonb_agg(case when shelf->>'label'='Drawings and CAD'
   then jsonb_set(shelf,'{tools}',(select jsonb_agg(p->'name') from jsonb_array_elements(policies) p)||(shelf->'tools')) else shelf end order by ord)
  from jsonb_array_elements(prior.definition->'shelves') with ordinality s(shelf,ord)));
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-build-workers-v1','build_workers_version',1),
   prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
 activation:=activation||jsonb_build_object('bob.tools',version_uuid);
 perform shared.activate_ai_catalog('bob',activation);
end $bob_build_workers$;
commit;
