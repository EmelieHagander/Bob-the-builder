-- Additive provider capability support. This foundation changes no active
-- definitions, model prices, function switches, or other apps' configuration.

create or replace function shared.ai_catalog_validate(p_snapshot jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare defs jsonb:=p_snapshot->'definitions'; artifact jsonb; d jsonb; item jsonb;
  binding jsonb; model jsonb; caps jsonb; tier text; params jsonb; role_profile jsonb;
begin
  if jsonb_array_length(defs)=0 then raise exception 'ai_catalog_empty' using errcode='22023'; end if;
  for artifact in select value from jsonb_array_elements(defs) loop
    d:=artifact->'definition';
    if artifact->>'definition_format_version'<>'1' then
      raise exception 'ai_catalog_format_unsupported' using errcode='22023';
    end if;
    case artifact->>'definition_kind'
    when 'role' then
      perform shared.ai_catalog_assert_ref(defs,d->>'profile_key',array['execution_profile']);
      select value->'definition' into role_profile from jsonb_array_elements(defs)
        where value->>'prompt_key'=d->>'profile_key';
      if d ? 'routing_key' then
        select profile.value->'definition' into role_profile from jsonb_array_elements(defs) route
          join jsonb_array_elements(defs) profile on profile.value->>'prompt_key'=route.value->'definition'->>'default_profile_key'
          where route.value->>'prompt_key'=d->>'routing_key';
      end if;
      -- Embeddings encode task text, not conversational instructions. Only that
      -- adapter may omit persona prompts; text/image roles keep the old rule.
      if jsonb_typeof(d->'prompt_keys') is distinct from 'array'
        or jsonb_array_length(d->'prompt_keys')=0 and coalesce(role_profile->>'tier','')<>'embedding'
        or jsonb_array_length(d->'prompt_keys')>0 and role_profile->>'tier'='embedding' then
        raise exception 'ai_catalog_prompt_required' using errcode='22023';
      end if;
      if d ? 'routing_key' then perform shared.ai_catalog_assert_ref(defs,d->>'routing_key',array['routing_policy']); end if;
      if d ? 'contract_key' then perform shared.ai_catalog_assert_ref(defs,d->>'contract_key',array['agent_contract']); end if;
      if d ? 'response_schema_key' then perform shared.ai_catalog_assert_ref(defs,d->>'response_schema_key',array['response_schema']); end if;
      for item in select value from jsonb_array_elements(coalesce(d->'prompt_keys','[]')) loop
        perform shared.ai_catalog_assert_ref(defs,item#>>'{}',array['prompt','instruction_fragment','project_method','vocabulary','agent_contract']);
      end loop;
      for item in select value from jsonb_array_elements(coalesce(d->'method_keys','[]')) loop
        perform shared.ai_catalog_assert_ref(defs,item#>>'{}',array['project_method','vocabulary']);
      end loop;
      for item in select value from jsonb_array_elements(coalesce(d->'tool_keys','[]')) loop
        perform shared.ai_catalog_assert_ref(defs,item#>>'{}',array['tool_contract']);
      end loop;
    when 'routing_policy' then
      perform shared.ai_catalog_assert_ref(defs,d->>'default_profile_key',array['execution_profile']);
      if d->>'escalation_profile_key' is not null then
        perform shared.ai_catalog_assert_ref(defs,d->>'escalation_profile_key',array['execution_profile']);
      end if;
    when 'agent_contract' then
      if d->>'instructions_key' is not null then
        perform shared.ai_catalog_assert_ref(defs,d->>'instructions_key',array['prompt','instruction_fragment']);
      end if;
      if d->>'response_schema_key' is not null then
        perform shared.ai_catalog_assert_ref(defs,d->>'response_schema_key',array['response_schema']);
      end if;
    when 'project_method','vocabulary' then
      if d->>'vocabulary_key' is not null then
        perform shared.ai_catalog_assert_ref(defs,d->>'vocabulary_key',array['vocabulary']);
      end if;
    when 'tier_binding' then
      tier:=d->>'tier';
      if tier is null or tier not in ('nano','mini','standard','image','embedding') or
        (select count(*) from jsonb_array_elements(defs) t where t.value->>'definition_kind'='tier_binding'
          and t.value->'definition'->>'tier'=tier)<>1 then
        raise exception 'ai_catalog_tier_ambiguous' using errcode='22023';
      end if;
      select value into model from jsonb_array_elements(p_snapshot->'models') where value->>'model_name'=d->>'model_name';
      if model is null or coalesce((model->>'is_active')::boolean,false)=false
        or model->>'model_type' is distinct from tier then
        raise exception 'ai_catalog_model_unavailable' using errcode='22023';
      end if;
    when 'execution_profile' then
      tier:=d->>'tier';
      select value->'definition' into binding from jsonb_array_elements(defs)
        where value->>'definition_kind'='tier_binding' and value->'definition'->>'tier'=tier;
      if binding is null then raise exception 'ai_catalog_tier_unavailable' using errcode='22023'; end if;
      select value into model from jsonb_array_elements(p_snapshot->'models') where value->>'model_name'=binding->>'model_name';
      caps:=model->'capabilities';
      if caps->>'provider_adapter' not in ('openai-responses-v1','openai-images-v1','openai-embeddings-v1') or caps->>'provider_adapter' is null then
        raise exception 'ai_catalog_provider_unsupported' using errcode='22023';
      end if;
      if model->>'provider' is distinct from 'openai'
        or tier='image' and (caps->>'provider_adapter'<>'openai-images-v1'
          or not coalesce((model->>'supports_image_output')::boolean,false))
        or tier in ('nano','mini','standard') and caps->>'provider_adapter'<>'openai-responses-v1'
        or (tier='embedding') is distinct from (caps->>'provider_adapter'='openai-embeddings-v1') then
        raise exception 'ai_catalog_provider_unsupported' using errcode='22023';
      end if;
      params:=coalesce(d->'provider_parameters','{}');
      if jsonb_typeof(params)<>'object' or
        params-(case when caps->>'provider_adapter'='openai-images-v1'
          then array['size','quality'] when caps->>'provider_adapter'='openai-embeddings-v1'
          then array['dimensions'] else array['temperature','top_p','parallel_tool_calls','verbosity'] end)<>'{}' then
        raise exception 'ai_catalog_provider_parameters_invalid' using errcode='22023';
      end if;
      if caps->>'provider_adapter'='openai-images-v1' and
        (params->>'size' is null or params->>'quality' is null) then
        raise exception 'ai_catalog_provider_parameters_invalid' using errcode='22023';
      end if;
      if params ? 'temperature' and
        (jsonb_typeof(params->'temperature')<>'number' or (params->>'temperature')::numeric not between 0 and 2)
        or params ? 'top_p' and
        (jsonb_typeof(params->'top_p')<>'number' or (params->>'top_p')::numeric not between 0 and 1)
        or params ? 'parallel_tool_calls' and jsonb_typeof(params->'parallel_tool_calls')<>'boolean'
        or params ? 'verbosity' and params->>'verbosity' not in ('low','medium','high')
        or params ? 'quality' and params->>'quality' not in ('low','medium','high')
        or params ? 'size' and params->>'size' not in ('1024x1024','1024x1536','1536x1024') then
        raise exception 'ai_catalog_provider_parameters_invalid' using errcode='22023';
      end if;
      if d ? 'timeout_ms' and (jsonb_typeof(d->'timeout_ms')<>'number' or (d->>'timeout_ms')::numeric<=0)
        or d ? 'enabled' and jsonb_typeof(d->'enabled')<>'boolean' then
        raise exception 'ai_catalog_profile_invalid' using errcode='22023';
      end if;
      if tier='embedding' then
        if jsonb_typeof(params->'dimensions') is distinct from 'number'
          or (params->>'dimensions')::numeric<>trunc((params->>'dimensions')::numeric)
          or (params->>'dimensions')::numeric<1
          or caps->'supports_embedding_dimensions' is distinct from 'true'::jsonb
          or jsonb_typeof(caps->'max_embedding_dimensions') is distinct from 'number'
          or (caps->>'max_embedding_dimensions')::numeric<>trunc((caps->>'max_embedding_dimensions')::numeric)
          or (params->>'dimensions')::numeric>(caps->>'max_embedding_dimensions')::numeric
          or jsonb_typeof(caps->'max_batch_inputs') is distinct from 'number'
          or (caps->>'max_batch_inputs')::numeric<>trunc((caps->>'max_batch_inputs')::numeric)
          or (caps->>'max_batch_inputs')::numeric<1 then
          raise exception 'ai_catalog_embedding_incompatible' using errcode='22023';
        end if;
        if d ? 'max_output_tokens' and d->'max_output_tokens' is distinct from '0'::jsonb
          or d->>'reasoning_effort' is not null then
          raise exception 'ai_catalog_embedding_incompatible' using errcode='22023';
        end if;
      elsif jsonb_typeof(d->'max_output_tokens') is distinct from 'number'
        or (d->>'max_output_tokens')::numeric<>(d->>'max_output_tokens')::integer
        or (d->>'max_output_tokens')::integer<1
        or (d->>'max_output_tokens')::integer>coalesce((model->>'max_output_tokens')::integer,0) then
        raise exception 'ai_catalog_output_incompatible' using errcode='22023';
      end if;
      if coalesce((d->'requirements'->>'images')::boolean,false) and not coalesce((model->>'supports_images')::boolean,false)
        or coalesce((d->'requirements'->>'functions')::boolean,false) and not coalesce((caps->>'supports_functions')::boolean,false)
        or coalesce((d->'requirements'->>'json_schema')::boolean,false) and not coalesce((caps->>'supports_json_schema')::boolean,false)
        or d->>'reasoning_effort' is not null and
          (not coalesce((model->>'supports_reasoning')::boolean,false) or not coalesce(caps->'reasoning_efforts' ? (d->>'reasoning_effort'),false)) then
        raise exception 'ai_catalog_model_incompatible' using errcode='22023';
      end if;
    else null;
    end case;
  end loop;
end $$;
revoke all on function shared.ai_catalog_validate(jsonb) from public,anon,authenticated;
grant execute on function shared.ai_catalog_validate(jsonb) to service_role;
