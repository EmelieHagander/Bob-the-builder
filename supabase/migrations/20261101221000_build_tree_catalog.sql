-- The build tree (owner decisions 2026-11-01, "Bob för stora byggen"): Bob reads
-- the project as a tree that follows the house and places builds in it. Every
-- colleague can read it, and starts each job with the outline (build_map).
-- Deploy ask-bob AND bob-worker with the handler first: until then a published
-- tool has no handler and is not offered. Needs 20261101220000_build_tree.sql.
begin;
do $build_tree_catalog$
declare contracts jsonb:=$build_tree_contracts$[
 {
  "name": "read_build_tree",
  "description": "Read the project as a tree that follows the house: buildings, levels, rooms, sub-builds and the constructions and drawings inside them.",
  "parameters": {
   "type": "object",
   "additionalProperties": false,
   "required": [
    "focus",
    "query"
   ],
   "properties": {
    "focus": {
     "type": [
      "string",
      "null"
     ],
     "maxLength": 80,
     "description": "An id from an earlier read to zoom into, or null for the outline from the top."
    },
    "query": {
     "type": [
      "string",
      "null"
     ],
     "maxLength": 200,
     "description": "Words to find by name in the place in focus and everything below it, or null."
    }
   }
  }
 },
 {
  "name": "place_build",
  "description": "Place a sub-build, construction or drawing inside a sub-build or in a room, or move it back to Snickeriet.",
  "parameters": {
   "type": "object",
   "additionalProperties": false,
   "required": [
    "build_id",
    "sub_build_id",
    "room_id"
   ],
   "properties": {
    "build_id": {
     "type": "string",
     "format": "uuid",
     "description": "The sub-build, construction or drawing to place, from read_build_tree."
    },
    "sub_build_id": {
     "type": [
      "string",
      "null"
     ],
     "format": "uuid",
     "description": "The sub-build that holds it, or null."
    },
    "room_id": {
     "type": [
      "string",
      "null"
     ],
     "format": "uuid",
     "description": "The room it belongs to when it is not inside a sub-build, or null."
    }
   }
  }
 }
]$build_tree_contracts$::jsonb;
 policies jsonb:=$build_tree_policies$[
 {
  "name": "read_build_tree",
  "description": "Use when you need to see where things sit in the project or find a build by name. Gives the tree that follows the house, with counted summaries, zoom and the path up to each match.",
  "how_to": "focus null gives the outline from the top: each building, Snickeriet (builds with no room) and what they hold, counted by the server. Zoom with an id from an earlier read: you get the path above it, its summary and what is directly inside. query finds things by name in the place in focus and everything below it, each match with the path up to where it sits, so you can see what a change touches. Read a construction's parts with the construction tools, not here.",
  "schema_version": 1,
  "always_load": false,
  "preload_phases": [],
  "active": true
 },
 {
  "name": "place_build",
  "description": "Use after a build is saved and should sit in a room or a sub-build. Gives the saved place and its path in the tree.",
  "how_to": "Use ids from read_build_tree. Give sub_build_id to put a construction, drawing or sub-build inside a sub-build; it then belongs to that sub-build's room. Give room_id to put it straight in a room. Sub-builds nest two levels: one inside another, never deeper. Both null moves it back to Snickeriet. Moving a build moves it alone; nothing inside it changes.",
  "schema_version": 1,
  "always_load": false,
  "preload_phases": [],
  "active": true
 }
]$build_tree_policies$::jsonb;
 knowledge jsonb:=$build_tree_knowledge${"label": "build_map", "tool": "read_build_tree", "arguments": {"focus": null, "query": null}}$build_tree_knowledge$::jsonb;
 patch jsonb; policy jsonb; prior shared.ai_prompt_versions; template shared.ai_prompt_versions;
 prompt_uuid uuid; version_uuid uuid; next_version integer; definition jsonb; activation jsonb:='{}'; grp text; worker text;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 if to_regprocedure('bob.read_build_tree(text)') is null or to_regprocedure('bob.place_build(text,uuid,uuid,uuid)') is null then raise exception 'build_tree_functions_missing'; end if;
 select v.* into template from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id where p.app='bob' and p.prompt_key='tools.read_construction_changes';
 if not found then raise exception 'build_tree_template_missing'; end if;
 for patch in select value from jsonb_array_elements(contracts) loop
  select value into policy from jsonb_array_elements(policies) where value->>'name'=patch->>'name';
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id where p.app='bob' and p.prompt_key='tools.'||(patch->>'name');
  if not found then
   insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
    values('bob','tools.'||(patch->>'name'),policy->>'description',policy->>'description','','','tool_contract') returning id into prompt_uuid;
   prior:=template;
  else
   if prior.metadata->>'publication'='build-tree-v1' then return; end if;
   prompt_uuid:=prior.prompt_id;
  end if;
  definition:=prior.definition||patch||jsonb_build_object('handler',patch->>'name','required_parameters',patch#>'{parameters,required}','optional_parameters','[]'::jsonb,'additional_description',policy->>'how_to','card_description',policy->>'description');
  definition:=jsonb_set(definition,'{envelope,schema_version}','1'::jsonb);
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prompt_uuid;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prompt_uuid,next_version,'tool_contract',1,jsonb_build_object('publication','build-tree-v1','server_fields','[]'::jsonb),prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object('tools.'||(patch->>'name'),version_uuid);
 end loop;
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id where p.app='bob' and p.prompt_key='bob.tools' for update of p;
 if not found then raise exception 'build_tree_toolbox_missing'; end if;
 definition:=prior.definition;
 for policy in select value from jsonb_array_elements(policies) loop
  insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active)
   values(policy->>'name',policy->>'description',policy->>'how_to',(policy->>'schema_version')::integer,(policy->>'always_load')::boolean,array(select jsonb_array_elements_text(policy->'preload_phases')),(policy->>'active')::boolean)
   on conflict(name) do nothing;
  if not exists(select 1 from jsonb_array_elements(definition->'catalog') r where r->>'name'=policy->>'name') then
   definition:=jsonb_set(definition,'{catalog}',definition->'catalog'||jsonb_build_array(policy));
  end if;
  if not definition->'contract_keys'?('tools.'||(policy->>'name')) then
   definition:=jsonb_set(definition,'{contract_keys}',definition->'contract_keys'||jsonb_build_array('tools.'||(policy->>'name')));
  end if;
  definition:=jsonb_set(definition,'{shelves}',(select jsonb_agg(case when shelf->>'label'='Building and site' and not shelf->'tools'?(policy->>'name') then jsonb_set(shelf,'{tools}',shelf->'tools'||jsonb_build_array(policy->>'name')) else shelf end) from jsonb_array_elements(definition->'shelves') shelf));
 end loop;
 -- Every colleague reads the tree, and gets its outline with the rest of his knowledge.
 foreach grp in array array['workers','build_workers'] loop
  if jsonb_typeof(definition->grp)='object' then
   for worker in select jsonb_object_keys(definition->grp) loop
    if not definition#>array[grp,worker,'reads']?'read_build_tree' then
     definition:=jsonb_set(definition,array[grp,worker,'reads'],definition#>array[grp,worker,'reads']||'["read_build_tree"]'::jsonb);
    end if;
    if jsonb_typeof(definition#>array[grp,worker,'knowledge'])='array' and jsonb_array_length(definition#>array[grp,worker,'knowledge'])<8
     and not exists(select 1 from jsonb_array_elements(definition#>array[grp,worker,'knowledge']) k where k->>'label'='build_map') then
     definition:=jsonb_set(definition,array[grp,worker,'knowledge'],definition#>array[grp,worker,'knowledge']||jsonb_build_array(knowledge));
    end if;
   end loop;
  end if;
 end loop;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,(prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','build-tree-v1'),prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
 activation:=activation||jsonb_build_object('bob.tools',version_uuid);
 perform shared.activate_ai_catalog('bob',activation);
end $build_tree_catalog$;
commit;
