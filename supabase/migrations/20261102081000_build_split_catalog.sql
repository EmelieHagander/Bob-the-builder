-- Owner decision 2026-11-02: Bob decides where a build belongs and makes its sub-build in the room;
-- Konrad decides how it is built and saves its constructions inside. A sub-build can start empty.
-- Needs 20261102080000_create_sub_build.sql. Deploy ask-bob and bob-worker first. Pinned manifests keep their behaviour.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function pg_temp.publication_count(node jsonb,target jsonb) returns integer language plpgsql immutable as $count$
declare n integer:=0; v jsonb;
begin
 if node=target then return 1; end if;
 if jsonb_typeof(node)='object' then for v in select value from jsonb_each(node) loop n:=n+pg_temp.publication_count(v,target); end loop;
 elsif jsonb_typeof(node)='array' then for v in select value from jsonb_array_elements(node) loop n:=n+pg_temp.publication_count(v,target); end loop; end if;
 return n;
end $count$;
create or replace function pg_temp.publication_swap(node jsonb,old_value jsonb,new_value jsonb) returns jsonb language plpgsql immutable as $swap$
declare result jsonb; k text; v jsonb;
begin
 if node=old_value then return new_value; end if;
 if jsonb_typeof(node)='object' then
  result:='{}';
  for k,v in select key,value from jsonb_each(node) loop result:=result||jsonb_build_object(k,pg_temp.publication_swap(v,old_value,new_value)); end loop;
  return result;
 elsif jsonb_typeof(node)='array' then
  return coalesce((select jsonb_agg(pg_temp.publication_swap(value,old_value,new_value) order by ord) from jsonb_array_elements(node) with ordinality x(value,ord)),'[]'::jsonb);
 end if;
 return node;
end $swap$;
do $bob_catalog_publication_do$
declare spec jsonb:=$bob_catalog_publication${
 "publication": "build-split-v1",
 "header": [
  "Owner decision 2026-11-02: Bob decides where a build belongs and makes its sub-build in the room;",
  "Konrad decides how it is built and saves its constructions inside. A sub-build can start empty.",
  "Needs 20261102080000_create_sub_build.sql. Deploy ask-bob and bob-worker first. Pinned manifests keep their behaviour."
 ],
 "settings": [],
 "additions": [
  {
   "key": "tools.create_sub_build",
   "kind": "tool_contract",
   "content": "",
   "metadata": {
    "server_fields": []
   },
   "definition": {
    "name": "create_sub_build",
    "description": "Make an empty sub-build, the place a build is collected in: inside a sub-build or in a room, or in Snickeriet.",
    "parameters": {
     "type": "object",
     "additionalProperties": false,
     "required": [
      "title",
      "description",
      "sub_build_id",
      "room_id"
     ],
     "properties": {
      "title": {
       "type": "string",
       "minLength": 1,
       "maxLength": 200,
       "description": "What the sub-build is, in the owner's words, for example the bunk bed."
      },
      "description": {
       "type": "string",
       "minLength": 1,
       "maxLength": 2000,
       "description": "What it holds and what it is for."
      },
      "sub_build_id": {
       "type": [
        "string",
        "null"
       ],
       "format": "uuid",
       "description": "The sub-build it sits inside, or null."
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
    },
    "handler": "create_sub_build",
    "additional_description": "Use ids from read_build_tree. Give room_id for the sub-build a build gets in its room, or sub_build_id for a sub-build inside another (two levels at most). Its constructions and drawings are saved and placed in it afterwards. The same title in the same place returns the existing sub-build instead of a twin.",
    "required_parameters": [
     "title",
     "description",
     "sub_build_id",
     "room_id"
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
    "card_description": "Use when a build needs its place before its parts are saved. Gives the sub-build's id and its path in the tree."
   }
  }
 ],
 "edits": [
  {
   "key": "structure-worker.persona",
   "kind": "prompt",
   "replace": [
    {
     "field": "content",
     "old": "Ett stort bygge delar du i flera konstruktioner i samma koordinatsystem, med gränserna där en snickare naturligt byter arbetsmoment.",
     "new": "Ett stort bygge delar du i flera konstruktioner i samma koordinatsystem, med gränserna där en snickare naturligt byter arbetsmoment. Var bygget hör hemma bestämmer Bob, som ger dig dess delbygge; hur det delas inuti bestämmer du. Varje del sparar du för sig och lägger i delbygget, så att trädet visar var allt finns och ett nekat sparande bara kostar en del."
    }
   ]
  },
  {
   "key": "tools.ask_structure_worker",
   "kind": "tool_contract",
   "replace": [
    {
     "field": "additional_description",
     "old": "A large build may come back as several constructions in one coordinate system; where to split is his call.",
     "new": "Before a new build goes to him, give it its place: the sub-build in the room it belongs to, made with create_sub_build when it is not there yet, and name that sub-build in your request. How many constructions it becomes and where to split is his call; he saves them into it, and the tree counts them for you."
    }
   ]
  }
 ],
 "requires": {},
 "flags": {},
 "how_to": {
  "ask_structure_worker": "Konrad constructs the selected solution as it is saved, not as it was discussed: before the job goes to him, the owner's latest decisions are in the selected solution, and one that already holds them needs no new save. Write to him as you would to a colleague on site: what to construct, and what is left out for now. He reads the solution, the measurements, the images and the existing constructions himself, so leave ids, measurements and other values out. Before a new build goes to him, give it its place: the sub-build in the room it belongs to, made with create_sub_build when it is not there yet, and name that sub-build in your request. How many constructions it becomes and where to split is his call; he saves them into it, and the tree counts them for you. The construction he saved or checked comes with his report, read back by code after the job; go by that and its check before you send Rita to draw it or tell the owner."
 },
 "toolbox_set": [],
 "toolbox_append": [
  {
   "path": [
    "catalog"
   ],
   "values": [
    {
     "name": "create_sub_build",
     "description": "Use when a build needs its place before its parts are saved. Gives the sub-build's id and its path in the tree.",
     "how_to": "Use ids from read_build_tree. Give room_id for the sub-build a build gets in its room, or sub_build_id for a sub-build inside another (two levels at most). Its constructions and drawings are saved and placed in it afterwards. The same title in the same place returns the existing sub-build instead of a twin.",
     "schema_version": 1,
     "always_load": false,
     "preload_phases": [],
     "active": true
    }
   ]
  },
  {
   "path": [
    "contract_keys"
   ],
   "values": [
    "tools.create_sub_build"
   ]
  },
  {
   "path": [
    "shelves",
    "8",
    "tools"
   ],
   "values": [
    "create_sub_build"
   ]
  },
  {
   "path": [
    "build_workers",
    "structure",
    "reads"
   ],
   "values": [
    "create_sub_build",
    "place_build"
   ]
  }
 ],
 "tool_catalog": [
  {
   "name": "create_sub_build",
   "description": "Use when a build needs its place before its parts are saved. Gives the sub-build's id and its path in the tree.",
   "how_to": "Use ids from read_build_tree. Give room_id for the sub-build a build gets in its room, or sub_build_id for a sub-build inside another (two levels at most). Its constructions and drawings are saved and placed in it afterwards. The same title in the same place returns the existing sub-build instead of a twin.",
   "schema_version": 1,
   "always_load": false,
   "preload_phases": [],
   "active": true
  }
 ]
}$bob_catalog_publication$::jsonb;
 patch jsonb; change jsonb; prior shared.ai_prompt_versions; prompt_uuid uuid; version_uuid uuid; next_version integer; activation jsonb:='{}';
 new_content text; definition jsonb; field text; old_text text; source text; requirement record; setting jsonb; item jsonb; path text[];
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 for setting in select value from jsonb_array_elements(spec->'settings') loop
  insert into shared.ai_settings(app,coworker_id,function_name,module_id,model,model_type,max_output_tokens,temperature,reasoning_effort,prompt_template,web_search,is_enabled,metadata)
   select 'bob','bob',setting->>'function_name','global',setting->>'model',(setting->>'model_type')::shared.ai_model_type,(setting->>'max_output_tokens')::integer,null,
    (setting->>'reasoning_effort')::shared.ai_reasoning_effort,null,false,is_enabled,setting->'metadata'
   from shared.ai_settings where app='bob' and coworker_id='bob' and function_name=setting->>'copy_from' and module_id='global'
   on conflict(app,coworker_id,function_name,module_id) do nothing;
  if not exists(select 1 from shared.ai_settings where app='bob' and coworker_id='bob' and function_name=setting->>'function_name' and module_id='global') then raise exception 'publication_settings_missing: %',setting->>'function_name'; end if;
 end loop;
 for patch in select value from jsonb_array_elements(spec->'additions') loop
  if exists(select 1 from shared.ai_prompts where app='bob' and prompt_key=patch->>'key') then raise exception 'publication_already_published: %',patch->>'key'; end if;
  insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
   values('bob',patch->>'key',patch->>'key',spec->>'publication',coalesce(patch->>'content',''),'',patch->>'kind') returning id into prompt_uuid;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prompt_uuid,1,patch->>'kind',1,coalesce(patch->'metadata','{}'::jsonb)||jsonb_build_object('publication',spec->>'publication'),coalesce(patch->>'content',''),
    coalesce(patch->'definition','{}'::jsonb),'','[]'::jsonb) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 for patch in select value from jsonb_array_elements(spec->'edits') loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=patch->>'key' and p.definition_kind=patch->>'kind' and p.retired_at is null for update of p;
  if not found then raise exception 'publication_edit_missing: %',patch->>'key'; end if;
  new_content:=prior.content;definition:=prior.definition;
  for change in select value from jsonb_array_elements(coalesce(patch->'swap','[]'::jsonb)) loop
   if pg_temp.publication_count(definition->'parameters',change->'old')<>(change->>'count')::integer then raise exception 'publication_swap_unexpected: %',patch->>'key'; end if;
   definition:=jsonb_set(definition,'{parameters}',pg_temp.publication_swap(definition->'parameters',change->'old',change->'new'));
  end loop;
  for change in select value from jsonb_array_elements(coalesce(patch->'set','[]'::jsonb)) loop
   path:=array(select jsonb_array_elements_text(change->'path'));
   if definition#>path is null then raise exception 'publication_set_missing: % %',patch->>'key',change->>'path'; end if;
   definition:=jsonb_set(definition,path,change->'value');
  end loop;
  for change in select value from jsonb_array_elements(coalesce(patch->'replace','[]'::jsonb)) loop
   field:=coalesce(change->>'field','');old_text:=change->>'old';
   source:=case when field='content' then new_content when change ? 'path' then definition#>>(select array_agg(x) from jsonb_array_elements_text(change->'path') x) else definition->>field end;
   if source is null or (length(source)-length(replace(source,old_text,'')))/length(old_text)<>1 then raise exception 'publication_replace_unexpected: % %',patch->>'key',coalesce(change->>'path',field); end if;
   if field='content' then new_content:=replace(source,old_text,change->>'new');
   else definition:=jsonb_set(definition,case when change ? 'path' then (select array_agg(x) from jsonb_array_elements_text(change->'path') x) else array[field] end,to_jsonb(replace(source,old_text,change->>'new'))); end if;
  end loop;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||coalesce(patch->'metadata','{}'::jsonb)||jsonb_build_object('publication',spec->>'publication'),
    new_content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' for update of p;
 if not found then raise exception 'publication_toolbox_missing'; end if;
 for requirement in select key,value from jsonb_each(spec->'requires') loop
  if prior.definition->requirement.key is distinct from requirement.value then raise exception 'publication_requires: %',requirement.key; end if;
 end loop;
 definition:=prior.definition||(spec->'flags');
 if (select count(*) from jsonb_array_elements(definition->'catalog') c where spec->'how_to' ? (c->>'name'))<>(select count(*) from jsonb_object_keys(spec->'how_to')) then raise exception 'publication_how_to_missing'; end if;
 definition:=jsonb_set(definition,'{catalog}',(select jsonb_agg(case when spec->'how_to' ? (c->>'name') then jsonb_set(c,'{how_to}',spec->'how_to'->(c->>'name')) else c end order by ord)
  from jsonb_array_elements(definition->'catalog') with ordinality x(c,ord)));
 for change in select value from jsonb_array_elements(spec->'toolbox_set') loop
  path:=array(select jsonb_array_elements_text(change->'path'));
  if definition#>path is null then raise exception 'publication_toolbox_set_missing: %',change->>'path'; end if;
  -- Only the exact value this publication was written against is replaced.
  if definition#>path is distinct from change->'old' then raise exception 'publication_toolbox_set_changed: %',change->>'path'; end if;
  definition:=jsonb_set(definition,path,change->'value');
 end loop;
 for change in select value from jsonb_array_elements(spec->'toolbox_append') loop
  path:=array(select jsonb_array_elements_text(change->'path'));
  if jsonb_typeof(definition#>path) is distinct from 'array' then raise exception 'publication_toolbox_append_missing: %',change->>'path'; end if;
  definition:=jsonb_set(definition,path,(definition#>path)||(change->'values'));
 end loop;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication',spec->>'publication'),
   prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
 activation:=activation||jsonb_build_object('bob.tools',version_uuid);
 for item in select value from jsonb_array_elements(spec->'tool_catalog') loop
  insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active)
   values(item->>'name',item->>'description',item->>'how_to',(item->>'schema_version')::integer,(item->>'always_load')::boolean,
    array(select jsonb_array_elements_text(item->'preload_phases')),(item->>'active')::boolean)
   on conflict(name) do nothing;
 end loop;
 update bob.tool_catalog t set how_to=h.value from jsonb_each_text(spec->'how_to') h where t.name=h.key;
 perform shared.activate_ai_catalog('bob',activation);
end $bob_catalog_publication_do$;
commit;
