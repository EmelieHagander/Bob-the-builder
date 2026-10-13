-- New immutable contracts only; preserve historical manifests and other edits.
-- Install the matching Bob handlers before activating these contracts.
begin;
do $cad_server_values$
declare
  patch jsonb;
  current_version record;
  definition jsonb;
  metadata jsonb;
  field text;
  next_version integer;
  version_id uuid;
  activation jsonb := '{}';
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
  for patch in select value from jsonb_array_elements($cad_server_contracts$[
    {"key":"tools.render_cad_candidate","remove_fields":["target_revision"]},
    {"key":"tools.render_saved_cad_candidate","remove_fields":["target_revision"]},
    {"key":"tools.finish_cad_research","server_need_ids":true,"schema_bindings":{"parameters.properties.checks.items.properties.id.enum":"server.check_ids"}}
  ]$cad_server_contracts$::jsonb) loop
    select v.* into current_version from shared.ai_prompts p
      join shared.ai_prompt_versions v on v.id=p.active_version_id
      where p.app='bob' and p.prompt_key=patch->>'key'
        and p.definition_kind='tool_contract';
    if not found then raise exception 'cad_server_contract_missing'; end if;
    definition := current_version.definition;
    metadata := current_version.metadata || jsonb_build_object('server_owned_values',true);
    for field in select jsonb_array_elements_text(coalesce(patch->'remove_fields','[]')) loop
      definition := definition #- array['parameters','properties',field];
      definition := jsonb_set(definition,'{parameters,required}',
        coalesce((select jsonb_agg(value) from jsonb_array_elements(definition#>'{parameters,required}') where value<>to_jsonb(field)),'[]'));
      definition := jsonb_set(definition,'{required_parameters}',
        coalesce((select jsonb_agg(value) from jsonb_array_elements(definition->'required_parameters') where value<>to_jsonb(field)),'[]'));
      definition := jsonb_set(definition,'{optional_parameters}',
        coalesce((select jsonb_agg(value) from jsonb_array_elements(definition->'optional_parameters') where value<>to_jsonb(field)),'[]'));
    end loop;
    if patch->>'server_need_ids'='true' then
      definition := definition #- '{parameters,properties,additional_needs,items,properties,id}';
      definition := jsonb_set(definition,'{parameters,properties,additional_needs,items,required}',
        coalesce((select jsonb_agg(value) from jsonb_array_elements(definition#>'{parameters,properties,additional_needs,items,required}') where value<>'"id"'::jsonb),'[]'));
      metadata := jsonb_set(metadata,'{schema_bindings}',coalesce(metadata->'schema_bindings','{}') || patch->'schema_bindings');
    end if;
    select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=current_version.prompt_id;
    insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,
      metadata,content,definition,flow,available_variables)
    values(current_version.prompt_id,next_version,current_version.definition_kind,current_version.definition_format_version,
      metadata,current_version.content,definition,current_version.flow,current_version.available_variables)
    returning id into version_id;
    activation := activation || jsonb_build_object(patch->>'key',version_id);
  end loop;
  perform shared.activate_ai_catalog('bob',activation);
end $cad_server_values$;
commit;
