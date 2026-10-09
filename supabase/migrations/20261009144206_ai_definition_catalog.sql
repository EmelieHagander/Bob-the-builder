-- Versioned AI definition catalog. This extends the existing cross-app register;
-- it does not change other apps' legacy prompts or model settings.
begin;

alter table shared.ai_prompts add column definition_kind text not null default 'prompt';
alter table shared.ai_prompts add column active_version_id uuid;
alter table shared.ai_prompts add column catalog_managed boolean not null default false;
alter table shared.ai_prompts add constraint ai_prompts_definition_kind_check check (
  definition_kind in ('role','prompt','instruction_fragment','tool_contract','agent_contract',
    'project_method','vocabulary','execution_profile','tier_binding','routing_policy','response_schema')
);
alter table shared.ai_models add column capabilities jsonb not null default '{}';
alter table shared.ai_models add constraint ai_models_capabilities_object check (jsonb_typeof(capabilities)='object');

create table shared.ai_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references shared.ai_prompts(id) on delete restrict,
  version integer not null check (version>0),
  definition_kind text not null,
  definition_format_version integer not null default 1 check (definition_format_version=1),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata)='object'),
  content text not null default '',
  definition jsonb not null default '{}' check (jsonb_typeof(definition)='object'),
  flow text not null default '',
  available_variables jsonb not null default '[]' check (jsonb_typeof(available_variables)='array'),
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  unique(prompt_id,version),
  unique(id,prompt_id),
  check (not (definition ? 'flow') and not (definition ? 'available_variables'))
);
alter table shared.ai_prompts add constraint ai_prompts_active_version_owner
  foreign key(active_version_id,id) references shared.ai_prompt_versions(id,prompt_id) deferrable initially deferred;

create table shared.ai_catalog_manifests (
  id uuid primary key default gen_random_uuid(),
  app text not null check (length(btrim(app))>0),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(app,payload_hash),
  check (payload->>'app' is not null and payload->>'manifest_id' is not null
    and payload->>'app'=app and payload->>'manifest_id'=id::text)
);
create index ai_catalog_manifests_app_created_idx on shared.ai_catalog_manifests(app,created_at desc);
alter table shared.ai_prompt_versions enable row level security;
alter table shared.ai_catalog_manifests enable row level security;
revoke all on shared.ai_prompt_versions,shared.ai_catalog_manifests from public,anon,authenticated;
grant select,insert on shared.ai_prompt_versions,shared.ai_catalog_manifests to service_role;
grant select,insert,update on shared.ai_prompts to service_role;
grant select on shared.ai_models,shared.ai_settings to service_role;
grant usage on schema shared to service_role;
create policy ai_prompt_versions_service on shared.ai_prompt_versions to service_role using(true) with check(true);
create policy ai_catalog_manifests_service on shared.ai_catalog_manifests to service_role using(true) with check(true);

create function shared.ai_catalog_hash(p_payload jsonb) returns text
language sql immutable security invoker set search_path='' as $$
  select encode(sha256(convert_to(p_payload::text,'UTF8')),'hex')
$$;
revoke all on function shared.ai_catalog_hash(jsonb) from public,anon,authenticated;
grant execute on function shared.ai_catalog_hash(jsonb) to service_role;

create function shared.ai_prompt_version_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare head shared.ai_prompts;
begin
  if tg_op<>'INSERT' then raise exception 'ai_catalog_version_immutable' using errcode='55000'; end if;
  select * into head from shared.ai_prompts where id=new.prompt_id;
  if not found or head.definition_kind<>new.definition_kind then
    raise exception 'ai_catalog_kind_mismatch' using errcode='22023';
  end if;
  if not head.catalog_managed then
    update shared.ai_prompts set catalog_managed=true where id=head.id;
  end if;
  new.payload_hash:=shared.ai_catalog_hash(jsonb_build_object(
    'definition_kind',new.definition_kind,'definition_format_version',new.definition_format_version,
    'metadata',new.metadata,'content',new.content,'definition',new.definition,
    'flow',new.flow,'available_variables',new.available_variables));
  return new;
end $$;
revoke all on function shared.ai_prompt_version_guard() from public,anon,authenticated;
grant execute on function shared.ai_prompt_version_guard() to service_role;
create trigger ai_prompt_versions_immutable before insert or update or delete on shared.ai_prompt_versions
  for each row execute function shared.ai_prompt_version_guard();

create function shared.ai_catalog_manifest_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'ai_catalog_manifest_immutable' using errcode='55000';
end $$;
revoke all on function shared.ai_catalog_manifest_guard() from public,anon,authenticated;
grant execute on function shared.ai_catalog_manifest_guard() to service_role;
create trigger ai_catalog_manifests_immutable before update or delete on shared.ai_catalog_manifests
  for each row execute function shared.ai_catalog_manifest_guard();

-- The old editable columns become a projection once this row is versioned.
-- Rows used by other apps without an active revision keep their legacy contract.
create function shared.ai_prompt_register_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare chosen shared.ai_prompt_versions;
begin
  if new.catalog_managed and current_user not in ('service_role','postgres','supabase_admin')
    and (tg_op='INSERT' or old.catalog_managed is distinct from new.catalog_managed) then
    raise exception 'ai_catalog_service_required' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if old.catalog_managed and not new.catalog_managed then
      raise exception 'ai_catalog_identity_immutable' using errcode='55000';
    end if;
    if (old.catalog_managed or new.catalog_managed or old.active_version_id is not null or new.active_version_id is not null)
      and (new.id<>old.id or new.app<>old.app or new.prompt_key<>old.prompt_key
       or new.definition_kind<>old.definition_kind) then
      raise exception 'ai_catalog_identity_immutable' using errcode='55000';
    end if;
    if old.active_version_id is not null and new.active_version_id is null then
      raise exception 'ai_catalog_active_required' using errcode='22023';
    end if;
    if old.active_version_id is not null and new.active_version_id=old.active_version_id and
      (new.content is distinct from old.content or new.flow is distinct from old.flow
       or new.available_variables is distinct from old.available_variables
       or new.label is distinct from old.label or new.description is distinct from old.description) then
      raise exception 'ai_catalog_projection_read_only' using errcode='55000';
    end if;
  end if;
  if new.active_version_id is not null then
    if current_user not in ('service_role','postgres','supabase_admin') then
      raise exception 'ai_catalog_service_required' using errcode='42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('ai_catalog:'||new.app,0));
    if tg_op='INSERT' or old.active_version_id is distinct from new.active_version_id then
      perform set_config('ai_catalog.validated_'||md5(new.app),'',true);
    end if;
    select * into chosen from shared.ai_prompt_versions where id=new.active_version_id and prompt_id=new.id;
    if not found or chosen.definition_kind<>new.definition_kind then
      raise exception 'ai_catalog_active_version_scope' using errcode='22023';
    end if;
    new.content:=chosen.content;
    new.flow:=chosen.flow;
    -- The legacy variable column is a native array. Preserve its real type by
    -- passing the JSON through the existing table's record conversion.
    new.available_variables:=(jsonb_populate_record(new,jsonb_build_object('available_variables',chosen.available_variables))).available_variables;
    new.label:=coalesce(chosen.metadata->>'label',chosen.metadata->>'name',new.prompt_key);
    new.description:=coalesce(chosen.metadata->>'purpose',chosen.metadata->>'description');
  end if;
  return new;
end $$;
revoke all on function shared.ai_prompt_register_guard() from public,anon,authenticated;
grant execute on function shared.ai_prompt_register_guard() to service_role;
create trigger ai_prompts_version_projection before insert or update on shared.ai_prompts
  for each row execute function shared.ai_prompt_register_guard();

-- One SQL statement captures definitions, tier models and legacy kill switches
-- under the same MVCC snapshot. The definition graph is then checked against
-- that captured data, not by separate potentially newer table reads.
create function shared.ai_catalog_snapshot(p_app text) returns jsonb
language sql stable security invoker set search_path='' as $$
  with defs as (
    select jsonb_build_object('id',v.id,'prompt_id',p.id,'prompt_key',p.prompt_key,
      'version',v.version,'definition_kind',v.definition_kind,
      'definition_format_version',v.definition_format_version,'metadata',v.metadata,
      'content',v.content,'definition',v.definition,'flow',v.flow,
      'available_variables',v.available_variables,'payload_hash',v.payload_hash) value
    from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id and v.prompt_id=p.id
    where p.app=p_app
  ), bindings as (
    select value->'definition'->>'model_name' model_name from defs where value->>'definition_kind'='tier_binding'
  )
  select jsonb_build_object('format_version',1,'app',p_app,
    'definitions',coalesce((select jsonb_agg(value order by value->>'prompt_key') from defs),'[]'),
    'models',coalesce((select jsonb_agg(to_jsonb(m) order by m.model_name) from shared.ai_models m
      where m.model_name in (select model_name from bindings)),'[]'),
    'settings',coalesce((select jsonb_agg(to_jsonb(s) order by s.coworker_id,s.function_name,s.module_id)
      from shared.ai_settings s where s.app=p_app),'[]'))
$$;
revoke all on function shared.ai_catalog_snapshot(text) from public,anon,authenticated;
grant execute on function shared.ai_catalog_snapshot(text) to service_role;

create function shared.ai_catalog_assert_ref(p_definitions jsonb,p_key text,p_kinds text[]) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare target jsonb;
begin
  select value into target from jsonb_array_elements(p_definitions) where value->>'prompt_key'=p_key;
  if p_key is null or length(p_key)=0 or target is null or not (target->>'definition_kind'=any(p_kinds)) then
    raise exception 'ai_catalog_reference_unavailable: %',p_key using errcode='22023';
  end if;
end $$;
revoke all on function shared.ai_catalog_assert_ref(jsonb,text,text[]) from public,anon,authenticated;
grant execute on function shared.ai_catalog_assert_ref(jsonb,text,text[]) to service_role;

create function shared.ai_catalog_validate(p_snapshot jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare defs jsonb:=p_snapshot->'definitions'; artifact jsonb; d jsonb; item jsonb;
  binding jsonb; model jsonb; caps jsonb; tier text; params jsonb;
begin
  if jsonb_array_length(defs)=0 then raise exception 'ai_catalog_empty' using errcode='22023'; end if;
  for artifact in select value from jsonb_array_elements(defs) loop
    d:=artifact->'definition';
    if artifact->>'definition_format_version'<>'1' then
      raise exception 'ai_catalog_format_unsupported' using errcode='22023';
    end if;
    case artifact->>'definition_kind'
    when 'role' then
      if jsonb_typeof(d->'prompt_keys') is distinct from 'array' or jsonb_array_length(d->'prompt_keys')=0 then
        raise exception 'ai_catalog_prompt_required' using errcode='22023';
      end if;
      perform shared.ai_catalog_assert_ref(defs,d->>'profile_key',array['execution_profile']);
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
      if caps->>'provider_adapter' not in ('openai-responses-v1','openai-images-v1') or caps->>'provider_adapter' is null then
        raise exception 'ai_catalog_provider_unsupported' using errcode='22023';
      end if;
      if model->>'provider' is distinct from 'openai'
        or tier='image' and (caps->>'provider_adapter'<>'openai-images-v1'
          or not coalesce((model->>'supports_image_output')::boolean,false))
        or tier in ('nano','mini','standard') and caps->>'provider_adapter'<>'openai-responses-v1' then
        raise exception 'ai_catalog_provider_unsupported' using errcode='22023';
      end if;
      params:=coalesce(d->'provider_parameters','{}');
      if jsonb_typeof(params)<>'object' or
        params-(case when caps->>'provider_adapter'='openai-images-v1'
          then array['size','quality'] else array['temperature','top_p','parallel_tool_calls','verbosity'] end)<>'{}' then
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
      if jsonb_typeof(d->'max_output_tokens') is distinct from 'number'
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

-- Direct writes to active pointers receive the same graph check as the RPC.
-- Deferred checking permits related revisions to be switched in one transaction
-- without admitting a half-activated graph when that transaction commits.
create function shared.ai_catalog_active_graph_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare snapshot jsonb; cache_key text;
begin
  if new.active_version_id is not null and
    (tg_op='INSERT' or old.active_version_id is distinct from new.active_version_id) then
    cache_key:='ai_catalog.validated_'||md5(new.app);
    if current_setting(cache_key,true) is distinct from 'valid' then
      snapshot:=shared.ai_catalog_snapshot(new.app);
      perform shared.ai_catalog_validate(snapshot);
      perform set_config(cache_key,'valid',true);
    end if;
  end if;
  return null;
end $$;
revoke all on function shared.ai_catalog_active_graph_guard() from public,anon,authenticated;
grant execute on function shared.ai_catalog_active_graph_guard() to service_role;
create constraint trigger ai_prompts_active_graph after insert or update on shared.ai_prompts
  deferrable initially deferred for each row execute function shared.ai_catalog_active_graph_guard();

-- Atomic activation/rollback. The same procedure activates earlier immutable
-- revisions; its map cannot reference another app's or another prompt's row.
create function shared.activate_ai_catalog(p_app text,p_versions jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare entry record; head shared.ai_prompts; chosen shared.ai_prompt_versions;
begin
  if jsonb_typeof(p_versions)<>'object' or p_versions='{}' then
    raise exception 'ai_catalog_activation_invalid' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:'||p_app,0));
  for entry in select key,value from jsonb_each_text(p_versions) order by key loop
    select * into head from shared.ai_prompts where app=p_app and prompt_key=entry.key for update;
    select * into chosen from shared.ai_prompt_versions where id=entry.value::uuid;
    if head.id is null or chosen.id is null or chosen.prompt_id<>head.id
      or chosen.definition_kind<>head.definition_kind then
      raise exception 'ai_catalog_active_version_scope: %',entry.key using errcode='22023';
    end if;
    update shared.ai_prompts set active_version_id=chosen.id where id=head.id;
  end loop;
  perform shared.ai_catalog_validate(shared.ai_catalog_snapshot(p_app));
end $$;
revoke all on function shared.activate_ai_catalog(text,jsonb) from public,anon,authenticated;
grant execute on function shared.activate_ai_catalog(text,jsonb) to service_role;

create function shared.resolve_ai_catalog(p_app text,p_manifest_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare payload jsonb; existing jsonb; checksum text; manifest uuid:=gen_random_uuid();
begin
  if p_app is null or length(btrim(p_app))=0 then raise exception 'ai_catalog_app_required' using errcode='22023'; end if;
  if p_manifest_id is not null then
    select m.payload into payload from shared.ai_catalog_manifests m where m.id=p_manifest_id and m.app=p_app;
    if not found then raise exception 'ai_catalog_manifest_unavailable' using errcode='22023'; end if;
    return payload;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:'||p_app,0));
  payload:=shared.ai_catalog_snapshot(p_app);
  perform shared.ai_catalog_validate(payload);
  checksum:=shared.ai_catalog_hash(payload);
  select m.payload into existing from shared.ai_catalog_manifests m where m.app=p_app and m.payload_hash=checksum;
  if found then return existing; end if;
  payload:=payload||jsonb_build_object('manifest_id',manifest,'payload_hash',checksum,'created_at',clock_timestamp());
  insert into shared.ai_catalog_manifests(id,app,payload,payload_hash) values(manifest,p_app,payload,checksum);
  return payload;
end $$;
revoke all on function shared.resolve_ai_catalog(text,uuid) from public,anon,authenticated;
grant execute on function shared.resolve_ai_catalog(text,uuid) to service_role;

notify pgrst,'reload schema';
commit;
