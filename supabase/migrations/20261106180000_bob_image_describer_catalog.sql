-- Owner decision 2026-11-06: Bob first sees a short description of each
-- project image, opens only the images he needs, and keeps the description
-- after the pixels leave. Of 48 ready images only 6 had a cached description,
-- written only when Bob chose to after viewing. A read-only role on the
-- smallest vision tier now describes a listed image once per image version.
-- Dimensions appear only when written in the image itself (owner choice C).
-- Deploy both Bob runtimes with the image-describer consumer before
-- activation. Pinned manifests keep their behaviour.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_image_describer$
declare additions jsonb:=$image_describer_additions$[
 {
  "key": "image-describer.persona",
  "kind": "prompt",
  "content": "Du beskriver en projektbild kort, så att Bob kan välja rätt bild innan han öppnar den."
 },
 {
  "key": "image-describer.contract",
  "kind": "instruction_fragment",
  "content": "Describe the image in one short Swedish phrase of at most 120 characters, for choosing between project images: the subject, which side or place, the viewpoint and the build state, for example \"Entré framifrån innan påbyggnad\" or \"Mockup: entré med två smala frontfönster\". Name a dimension only when it is written in the image itself, exactly as written. Never estimate sizes or distances, never name materials or details you cannot see, and never identify people. The supplied title, purpose and source kind are context, not facts about the pixels."
 },
 {
  "key": "schema.bob_image_description",
  "kind": "response_schema",
  "definition": {
   "type": "object",
   "additionalProperties": false,
   "properties": {
    "description": { "type": "string", "maxLength": 160 }
   },
   "required": ["description"]
  }
 },
 {
  "key": "agent-contract.image-describer",
  "kind": "agent_contract",
  "definition": {
   "mode": "structured_read_only",
   "instructions_key": "image-describer.contract",
   "response_schema_key": "schema.bob_image_description",
   "source_scope": "current_authorized_work",
   "writes": "none"
  }
 },
 {
  "key": "profile.image-describer",
  "kind": "execution_profile",
  "definition": {
   "tier": "nano",
   "reasoning_effort": "low",
   "max_output_tokens": 300,
   "timeout_ms": 30000,
   "requirements": { "images": true, "functions": false, "json_schema": true }
  }
 },
 {
  "key": "role.image-describer",
  "kind": "role",
  "definition": {
   "name": "Bildbeskrivaren",
   "title": "Kort beskrivning av projektbilder",
   "purpose": "Beskriver varje projektbild en gång kort, så att Bob kan välja bild innan han öppnar den.",
   "function_name": "image-describer",
   "module": "global",
   "coworker_id": "bob",
   "enabled": true,
   "prompt_keys": ["image-describer.persona", "image-describer.contract"],
   "profile_key": "profile.image-describer",
   "contract_key": "agent-contract.image-describer",
   "method_keys": [],
   "tool_keys": [],
   "response_schema_key": "schema.bob_image_description"
  }
 }
]$image_describer_additions$::jsonb;
 patch jsonb; prompt_uuid uuid; version_uuid uuid; activation jsonb:='{}';
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 insert into shared.ai_settings(app,coworker_id,function_name,module_id,model,model_type,max_output_tokens,temperature,reasoning_effort,prompt_template,web_search,is_enabled,metadata)
  select 'bob','bob','image-describer','global','gpt-5.4-nano','nano',300,null,'low',null,false,is_enabled,
   jsonb_build_object('role','image_describer','authority','read_only')
  from shared.ai_settings where app='bob' and coworker_id='bob' and function_name='ask-bob' and module_id='global'
  on conflict(app,coworker_id,function_name,module_id) do nothing;
 if not exists(select 1 from shared.ai_settings where app='bob' and coworker_id='bob' and function_name='image-describer' and module_id='global') then raise exception 'image_describer_settings_missing'; end if;
 for patch in select value from jsonb_array_elements(additions) loop
  if exists(select 1 from shared.ai_prompts where app='bob' and prompt_key=patch->>'key') then raise exception 'image_describer_already_published: %',patch->>'key'; end if;
  insert into shared.ai_prompts(app,prompt_key,label,description,content,flow,definition_kind)
   values('bob',patch->>'key',patch->>'key','Image describer v1',coalesce(patch->>'content',''),'',patch->>'kind') returning id into prompt_uuid;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prompt_uuid,1,patch->>'kind',1,jsonb_build_object('publication','bob-image-describer-v1'),coalesce(patch->>'content',''),coalesce(patch->'definition','{}'::jsonb),'','[]'::jsonb) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 perform shared.activate_ai_catalog('bob',activation);
end $bob_image_describer$;
commit;
