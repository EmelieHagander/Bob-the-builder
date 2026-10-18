-- Deploy both Bob runtimes with the workflow consumer before activation.
-- Owner request 2026-10-18: make Bob reason like a builder again without
-- spelling out exact rules. Adds catalog workflows (one method per kind of
-- delegated outcome; describing one loads all of its tools) and a judgement
-- paragraph in the base principles. Pinned manifests keep their versions.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_workflows_judgement$
declare prior shared.ai_prompt_versions; next_version integer; version_id uuid; prompt_uuid uuid;
 activation jsonb:='{}';
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 if exists(select 1 from shared.ai_prompts where app='bob' and prompt_key='bob.workflows') then raise exception 'bob_workflows_already_present'; end if;
 insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
  values('bob','bob.workflows','bob.workflows','Bob workflows v1','','','agent_contract') returning id into prompt_uuid;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prompt_uuid,1,'agent_contract',1,jsonb_build_object('publication','bob-workflows-judgement-v1'),
   $bob_workflows_intro$Workflows — start from the one that matches the delegated outcome. describe_tool with its name returns its method and makes its tools callable on the next step; read a single tool's manual when its card is not enough.$bob_workflows_intro$,
   $bob_workflows${
 "workflows": [
  {
   "name": "workflow_construction_drawing",
   "card": "Model, check and draw a construction (furniture, frames, built parts) from intent, mockups and measurements.",
   "tools": [
    "read_construction_draft",
    "save_construction_draft",
    "check_construction_draft",
    "change_construction_parameters",
    "change_construction_roles",
    "read_construction_changes",
    "continue_construction_change",
    "derive_construction_lists",
    "design_project_cad",
    "read_drawing_requests",
    "read_drawing_request_work",
    "link_project_drawing",
    "search_material_catalog",
    "read_material_catalog",
    "list_project_category",
    "open_project_item",
    "describe_project_image",
    "search_building_knowledge",
    "calculate_project"
   ],
   "method": "Gather the intent, the owner's mockups (look at the pixels, not only their metadata) and the measurements. Read the current construction revision before changing it. Model it as the builder who will assemble it: every part has a purpose and a real material dimension, joins and rests on its neighbours, and mirrored or repeated parts (both ends, both sides) match unless the owner says otherwise. Keep unknown dimensions unknown instead of inventing them. Save one coherent revision, then check it and resolve what the check reports in the source. Draw only from the exact checked revision and compare the result with the mockup before answering; name any difference you could not resolve. The work is done when a saved and checked revision and its drawing receipt exist."
  },
  {
   "name": "workflow_living_plan",
   "card": "Create, change, review or approve the project's living plan and its links to tasks and evidence.",
   "tools": [
    "read_project_orientation",
    "read_plan_link_context",
    "read_project_work",
    "compile_project_plan",
    "edit_project_plan",
    "audit_project_plan",
    "save_compiled_project_plan",
    "propose_project_plan",
    "decide_project_plan",
    "set_project_plan_focus",
    "change_plan_focus",
    "change_plan_task_link",
    "link_project_plan_task",
    "link_project_plan_evidence"
   ],
   "method": "Read the current plan and the work it locates before changing it. Describe the intended plan or exact edit with its evidence and let the plan colleagues compile, edit or audit it; resolve every server validation finding in the proposal rather than around it. Save the compiled proposal, then make it current only when the owner has approved it or explicitly instructed so; a request for suggestions is not approval. Link tasks and evidence to the steps they serve, and keep the plan a map of the work, not a copy of the task details."
  },
  {
   "name": "workflow_tasks",
   "card": "Create, change, schedule or complete tasks, their readiness and build days.",
   "tools": [
    "read_work_context",
    "create_work_record",
    "edit_work_record",
    "change_work_state",
    "change_task_readiness",
    "change_work_relation",
    "manage_task_readiness",
    "save_project_task",
    "update_project_task_work",
    "delete_project_task",
    "save_project_build_day",
    "delete_project_build_day",
    "read_project_work"
   ],
   "method": "Read the affected work and its relations first. Write a task as the person doing it needs it on site: what to do, with what, in which order and what counts as finished. When instructions change, integrate the change into the existing text instead of appending dated notes. A task is done only when its result exists and its completion requirements are met with evidence; otherwise state what remains. Readiness reflects real prerequisites such as materials, people, drawings and decisions."
  },
  {
   "name": "workflow_facts_and_site",
   "card": "Record measurements, building and site facts, stairs, room layouts and building plans with their sources.",
   "tools": [
    "save_project_measurement",
    "archive_project_measurement",
    "save_building_context",
    "save_project_building_plan",
    "inspect_building_projection",
    "save_project_stair",
    "inspect_stair_options",
    "create_project_room_layout",
    "edit_project_room_layout",
    "search_project_data",
    "open_project_item",
    "calculate_project"
   ],
   "method": "Search for existing facts before adding one, and keep one current value per fact. State how each value is known: measured on site, provided in a specification, estimated, or still unknown, with its source. When sources conflict, show the conflict and keep the better-supported value instead of averaging or silently overwriting. Derived values come from calculate_project with their inputs named. Ask for a site measurement only when the outcome depends on it."
  },
  {
   "name": "workflow_materials",
   "card": "Find materials, derive quantities and cut lists, and manage stock and the shopping list.",
   "tools": [
    "search_material_catalog",
    "read_material_catalog",
    "save_catalog_definition",
    "manage_project_material",
    "derive_construction_lists",
    "derive_cad_material_requirement",
    "check_construction_cut_fit",
    "save_construction_cut_plan",
    "delete_shopping_item",
    "read_project_work",
    "calculate_project"
   ],
   "method": "Start from the saved construction or drawing, not from memory. Derive quantities and cut lists from its exact revision, check that the cuts fit real stock lengths, and add waste deliberately. Choose catalog materials that match the dimensions in the construction, and name substitutions. Keep stock, needs and purchases distinct, and do not delete shopping items others may rely on without reason."
  },
  {
   "name": "workflow_solutions_and_description",
   "card": "Describe the project and decide between solution alternatives with evidence.",
   "tools": [
    "read_project_edit_context",
    "edit_project_record",
    "save_project_description",
    "read_solution_context",
    "create_solution_alternative",
    "select_solution_alternative",
    "change_solution_evidence",
    "save_project_solution",
    "select_project_target"
   ],
   "method": "Read the current record before editing and preserve unrelated content. Present real alternatives with their consequences, costs and evidence; select one only on the owner's decision or an explicit instruction. Keep the description short and current, and record what was decided and why, not the conversation."
  },
  {
   "name": "workflow_images",
   "card": "Inspect, generate and attach images and mockups.",
   "tools": [
    "list_project_category",
    "open_project_item",
    "describe_project_image",
    "generate_project_image",
    "attach_project_image",
    "detach_project_image",
    "finalize_project_image"
   ],
   "method": "Image metadata and file names are not visual evidence; inspect the pixels before making a claim about what an image shows. A generated image is an illustration, never a measured or verified state. Attach images where they help the people doing the work and describe what they show."
  }
 ]
}$bob_workflows$::jsonb,'','[]') returning id into version_id;
 activation:=activation||jsonb_build_object('bob.workflows',version_id);

 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.context-principles' and p.retired_at is null for update of p;
 if not found then raise exception 'bob_principles_missing'; end if;
 if prior.metadata->>'publication'='bob-workflows-judgement-v1' then raise exception 'bob_principles_already_active'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-workflows-judgement-v1'),
   prior.content||E'\n'||$bob_judgement_principles$Think like the builder who will stand there with the parts. Before saving a construction or plan, picture it finished and in use: each part has a purpose, rests on and joins its neighbours, mirrored and repeated parts match, and dimensions suit the material and load. Compare with the owner's mockups, images and measurements and name the differences. When something looks wrong, fix its cause in the saved source rather than the symptom.$bob_judgement_principles$,
   prior.definition,prior.flow,prior.available_variables) returning id into version_id;
 activation:=activation||jsonb_build_object('bob.context-principles',version_id);
 perform shared.activate_ai_catalog('bob',activation);
end $bob_workflows_judgement$;
commit;
