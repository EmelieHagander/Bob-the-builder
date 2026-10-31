-- Owner decision 2026-10-31: Bob coordinates the build team. Konrad (structural
-- designer) owns the construction and Rita draws it, as Mattias does materials.
-- Each has fixed native tools, a persona cast in the project and one shared team
-- text, the same input Bob has (locked project snapshot, conversation summaries
-- and history), then project knowledge read fresh from the database and Bob's
-- plain request last. Bob hands over no values (ask_structure_worker,
-- ask_drawing_worker, ask_materials_worker v2: one request parameter); the
-- workers read and save through the same session gates and report to Bob.
-- No AI reviews the drawing: cad.drawing-check mode code lets the code findings
-- decide (the drawing is generated exactly from the checked construction; Konrad
-- checks the construction against the owner's intent). The legacy box drawing
-- (save_project_drawing) is retired for new jobs. Prompt texts by Saoirse,
-- approved by the owner (OLD -> NEW). bob.tools: build_workers_version 1.
-- Deploy both Bob runtimes with the consumer first and apply with no Bob job
-- running (the ask_materials_worker policy moves to schema 2). Pinned manifests
-- keep their behaviour.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_build_workers$
declare additions jsonb:=$build_workers_additions$[
 {
  "key": "worker.team",
  "kind": "instruction_fragment",
  "content": "DRAFT team text."
 },
 {
  "key": "structure-worker.persona",
  "kind": "prompt",
  "content": "DRAFT Du är Konrad i bygget {{project_name}}.",
  "variables": [
   "project_name"
  ]
 },
 {
  "key": "structure-worker.project",
  "kind": "instruction_fragment",
  "content": "DRAFT projekt:"
 },
 {
  "key": "structure-worker.conversation",
  "kind": "instruction_fragment",
  "content": "DRAFT samtalet."
 },
 {
  "key": "structure-worker.knowledge",
  "kind": "instruction_fragment",
  "content": "DRAFT projektkunskap:"
 },
 {
  "key": "structure-worker.request",
  "kind": "instruction_fragment",
  "content": "DRAFT Bob skriver:"
 },
 {
  "key": "agent-contract.structure-worker",
  "kind": "agent_contract",
  "definition": {
   "mode": "worker_with_tools",
   "instructions_key": "worker.team",
   "source_scope": "current_authorized_work",
   "writes": "through_bob_session"
  }
 },
 {
  "key": "role.structure-worker",
  "kind": "role",
  "definition": {
   "name": "Konrad",
   "title": "Konstruktör",
   "purpose": "DRAFT purpose",
   "function_name": "structure-worker",
   "module": "global",
   "coworker_id": "bob",
   "enabled": true,
   "prompt_keys": [
    "structure-worker.persona",
    "worker.team"
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
   "description": "DRAFT give a job to Konrad.",
   "parameters": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "request": {
      "type": "string",
      "maxLength": 2000
     }
    },
    "required": [
     "request"
    ]
   },
   "handler": "ask_structure_worker",
   "additional_description": "DRAFT how to.",
   "required_parameters": [
    "request"
   ],
   "optional_parameters": [],
   "envelope": {
    "type": "function",
    "schema_version": 1,
    "arguments": "JSON object validated against parameters; project binding and write provenance remain server-owned."
   },
   "expected_return": {
    "format": "json",
    "contract": "DRAFT report."
   },
   "card_description": "Use when DRAFT. Gives Konrad's report."
  }
 },
 {
  "key": "drawing-worker.persona",
  "kind": "prompt",
  "content": "DRAFT Du är Rita i bygget {{project_name}}.",
  "variables": [
   "project_name"
  ]
 },
 {
  "key": "drawing-worker.project",
  "kind": "instruction_fragment",
  "content": "DRAFT projekt:"
 },
 {
  "key": "drawing-worker.conversation",
  "kind": "instruction_fragment",
  "content": "DRAFT samtalet."
 },
 {
  "key": "drawing-worker.knowledge",
  "kind": "instruction_fragment",
  "content": "DRAFT projektkunskap:"
 },
 {
  "key": "drawing-worker.request",
  "kind": "instruction_fragment",
  "content": "DRAFT Bob skriver:"
 },
 {
  "key": "agent-contract.drawing-worker",
  "kind": "agent_contract",
  "definition": {
   "mode": "worker_with_tools",
   "instructions_key": "worker.team",
   "source_scope": "current_authorized_work",
   "writes": "through_bob_session"
  }
 },
 {
  "key": "role.drawing-worker",
  "kind": "role",
  "definition": {
   "name": "Rita",
   "title": "Ritare",
   "purpose": "DRAFT purpose",
   "function_name": "drawing-worker",
   "module": "global",
   "coworker_id": "bob",
   "enabled": true,
   "prompt_keys": [
    "drawing-worker.persona",
    "worker.team"
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
   "description": "DRAFT give a job to Rita.",
   "parameters": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "request": {
      "type": "string",
      "maxLength": 2000
     }
    },
    "required": [
     "request"
    ]
   },
   "handler": "ask_drawing_worker",
   "additional_description": "DRAFT how to.",
   "required_parameters": [
    "request"
   ],
   "optional_parameters": [],
   "envelope": {
    "type": "function",
    "schema_version": 1,
    "arguments": "JSON object validated against parameters; project binding and write provenance remain server-owned."
   },
   "expected_return": {
    "format": "json",
    "contract": "DRAFT report."
   },
   "card_description": "Use when DRAFT. Gives Rita's report."
  }
 },
 {
  "key": "materials-worker.knowledge",
  "kind": "instruction_fragment",
  "content": "DRAFT projektkunskap:"
 },
 {
  "key": "materials-worker.request",
  "kind": "instruction_fragment",
  "content": "DRAFT Bob skriver:"
 },
 {
  "key": "cad.drawing-check",
  "kind": "agent_contract",
  "definition": {
   "mode": "code",
   "version": 1
  }
 }
]$build_workers_additions$::jsonb;
 edits jsonb:=$build_workers_edits$[
 {
  "key": "materials-worker.persona",
  "kind": "prompt",
  "old_content": "Du är Mattias, Bobs materialansvarige i byggprojektet. Du kan material, dimensioner, lager, kapning och inköp. Bob leder arbetet och pratar med beställaren; du gör materialarbetet han ger dig, noggrant och med rätt verktyg.",
  "content": "DRAFT Du är Mattias i bygget {{project_name}}.",
  "variables": [
   "project_name"
  ]
 },
 {
  "key": "role.materials-worker",
  "kind": "role",
  "definition": {
   "prompt_keys": [
    "materials-worker.persona",
    "worker.team"
   ]
  }
 },
 {
  "key": "agent-contract.materials-worker",
  "kind": "agent_contract",
  "definition": {
   "instructions_key": "worker.team"
  }
 },
 {
  "key": "tools.ask_materials_worker",
  "kind": "tool_contract",
  "definition": {
   "name": "ask_materials_worker",
   "description": "DRAFT give a job to Mattias.",
   "parameters": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
     "request": {
      "type": "string",
      "maxLength": 2000
     }
    },
    "required": [
     "request"
    ]
   },
   "handler": "ask_materials_worker",
   "additional_description": "DRAFT how to.",
   "required_parameters": [
    "request"
   ],
   "optional_parameters": [],
   "envelope": {
    "type": "function",
    "schema_version": 2,
    "arguments": "JSON object validated against parameters; project binding and write provenance remain server-owned."
   },
   "expected_return": {
    "format": "json",
    "contract": "DRAFT report."
   },
   "card_description": "Use when DRAFT. Gives Mattias's report."
  }
 },
 {
  "key": "materials-worker.project",
  "kind": "instruction_fragment",
  "old_content": "Projektet på huvudnivå, samma låsta bild som Bob har:",
  "content": "DRAFT projekt:"
 },
 {
  "key": "materials-worker.conversation",
  "kind": "instruction_fragment",
  "old_content": "Här följer samtalet mellan Bob och beställaren hittills. Det är bakgrund, inte ditt uppdrag.",
  "content": "DRAFT samtalet."
 },
 {
  "key": "bob.context-principles",
  "kind": "instruction_fragment",
  "replace": {
   "field": "content",
   "old": "Before saving a construction or plan,",
   "new": "DRAFT Before you save a plan,"
  }
 },
 {
  "key": "tools.link_cad_shell_steps",
  "kind": "tool_contract",
  "replace": {
   "field": "additional_description",
   "old": "in build order (for example walls before the bed that stands against them).",
   "new": "in build order, supporting pieces before what stands on or against them."
  }
 }
]$build_workers_edits$::jsonb;
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
  "knowledge": [
   {
    "label": "constructions",
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
   },
   {
    "label": "drawing_requests",
    "tool": "read_drawing_requests",
    "arguments": {
     "request_id": null,
     "after_id": null
    }
   },
   {
    "label": "plan",
    "tool": "search_project_data",
    "arguments": {
     "dataset": "plan",
     "query": null,
     "status": null,
     "area_id": null,
     "record_id": null,
     "after_id": null
    }
   },
   {
    "label": "selected_solutions",
    "tool": "read_solution_context",
    "arguments": {
     "resource": "selected_solutions",
     "query": null,
     "next_ref": null
    }
   }
  ]
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
  "knowledge": [
   {
    "label": "selected_solutions",
    "tool": "read_solution_context",
    "arguments": {
     "resource": "selected_solutions",
     "query": null,
     "next_ref": null
    }
   },
   {
    "label": "measurements",
    "tool": "read_solution_context",
    "arguments": {
     "resource": "measurements",
     "query": null,
     "next_ref": null
    }
   },
   {
    "label": "images",
    "tool": "read_solution_context",
    "arguments": {
     "resource": "images",
     "query": null,
     "next_ref": null
    }
   },
   {
    "label": "constructions",
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
  ]
 }
}$build_workers_definition$::jsonb;
 materials jsonb:=$build_workers_materials${
 "knowledge": [
  {
   "label": "materials",
   "tool": "search_project_data",
   "arguments": {
    "dataset": "materials",
    "query": null,
    "status": null,
    "area_id": null,
    "record_id": null,
    "after_id": null
   }
  },
  {
   "label": "constructions",
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
 ],
 "policy": {
  "name": "ask_materials_worker",
  "description": "DRAFT give a job to Mattias.",
  "how_to": "DRAFT how to.",
  "schema_version": 2,
  "always_load": false,
  "preload_phases": [],
  "active": true
 }
}$build_workers_materials$::jsonb;
 retired jsonb:=$build_workers_retired$[
 "save_project_drawing"
]$build_workers_retired$::jsonb;
 fn text; patch jsonb; policies jsonb:='[]'; prompt_uuid uuid; version_uuid uuid; activation jsonb:='{}'; prior shared.ai_prompt_versions; next_version integer; definition jsonb;
 new_content text; field text; old_text text; source text;
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
   values(prompt_uuid,1,patch->>'kind',1,jsonb_build_object('publication','bob-build-workers-v1'),coalesce(patch->>'content',''),coalesce(patch->'definition','{}'::jsonb),'',coalesce(patch->'variables','[]'::jsonb)) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 -- New versions of existing rows: Mattias, Bob's principle and one manual.
 for patch in select value from jsonb_array_elements(edits) loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=patch->>'key' and p.definition_kind=patch->>'kind' and p.retired_at is null for update of p;
  if not found then raise exception 'build_workers_edit_missing: %',patch->>'key'; end if;
  if patch ? 'old_content' and prior.content is distinct from patch->>'old_content' then raise exception 'build_workers_edit_unexpected: %',patch->>'key'; end if;
  new_content:=coalesce(patch->>'content',prior.content);definition:=prior.definition||coalesce(patch->'definition','{}'::jsonb);
  if patch ? 'replace' then
   field:=patch#>>'{replace,field}';old_text:=patch#>>'{replace,old}';
   source:=case when field='content' then prior.content else prior.definition->>field end;
   if source is null or (length(source)-length(replace(source,old_text,'')))/length(old_text)<>1 then raise exception 'build_workers_replace_unexpected: %',patch->>'key'; end if;
   if field='content' then new_content:=replace(source,old_text,patch#>>'{replace,new}');
   else definition:=jsonb_set(definition,array[field],to_jsonb(replace(source,old_text,patch#>>'{replace,new}'))); end if;
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-build-workers-v1','build_workers_version',1),
    new_content,definition,prior.flow,coalesce(patch->'variables',prior.available_variables)) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 -- Tool policy rows: Bob may hand work to any worker in every phase.
 for patch in select value from jsonb_each(workers) loop
  select value->'definition' into definition from jsonb_array_elements(additions) where value->>'key'='tools.'||(patch->>'tool');
  policies:=policies||jsonb_build_array(jsonb_build_object('name',patch->>'tool','description',definition->>'description','how_to',definition->>'additional_description',
   'schema_version',1,'always_load',false,'preload_phases','[]'::jsonb,'active',true));
  insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active)
   values(patch->>'tool',definition->>'description',definition->>'additional_description',1,false,array[]::text[],true)
   on conflict(name) do nothing;
 end loop;
 update bob.tool_catalog set description=materials#>>'{policy,description}',how_to=materials#>>'{policy,how_to}',schema_version=2
  where name='ask_materials_worker';
 if not found then raise exception 'build_workers_materials_policy_missing'; end if;
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' for update of p;
 if not found then raise exception 'build_workers_toolbox_missing'; end if;
 if prior.definition->>'materials_worker_version' is distinct from '1' then raise exception 'build_workers_require_materials_worker'; end if;
 definition:=prior.definition||jsonb_build_object('build_workers_version',1,'build_workers',workers,'retired_tools',retired,
  'workers',jsonb_set(prior.definition->'workers','{materials,knowledge}',materials->'knowledge'),
  'contract_keys',(prior.definition->'contract_keys')||(select jsonb_agg('tools.'||(p->>'name')) from jsonb_array_elements(policies) p),
  'catalog',(select jsonb_agg(case when c->>'name'='ask_materials_worker' then materials->'policy' else c end order by ord)
   from jsonb_array_elements(prior.definition->'catalog') with ordinality x(c,ord))||policies);
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
