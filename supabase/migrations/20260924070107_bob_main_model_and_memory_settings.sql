-- Bob's project manager uses the standard model. Memory folding has its own
-- governed settings so it does not inherit the manager's reasoning budget.
begin;
do $$ begin
  if not exists(select 1 from shared.ai_models where model_name='gpt-5.4' and is_active and supports_reasoning)
    or not exists(select 1 from shared.ai_models where model_name='gpt-5.4-mini' and is_active and supports_reasoning) then
    raise exception 'bob_required_models_unavailable';
  end if;
end $$;

insert into shared.ai_settings(app,coworker_id,function_name,module_id,model,model_type,max_output_tokens,
  temperature,reasoning_effort,prompt_template,web_search,is_enabled,metadata)
values ('bob','bob','ask-bob','global','gpt-5.4','standard',16000,null,'high',null,false,true,
  '{"role":"project_manager"}'::jsonb)
on conflict(app,coworker_id,function_name,module_id) do update set
  model=excluded.model,model_type=excluded.model_type,reasoning_effort=excluded.reasoning_effort,
  temperature=null,updated_at=clock_timestamp();

insert into shared.ai_settings(app,coworker_id,function_name,module_id,model,model_type,max_output_tokens,
  temperature,reasoning_effort,prompt_template,web_search,is_enabled,metadata)
select 'bob','bob','context-summary','global','gpt-5.4-mini','mini',3000,null,'low',null,false,is_enabled,
  '{"role":"conversation_summary","authority":"read_only"}'::jsonb
from shared.ai_settings where app='bob' and coworker_id='bob' and function_name='ask-bob' and module_id='global'
on conflict(app,coworker_id,function_name,module_id) do update set
  model=excluded.model,model_type=excluded.model_type,max_output_tokens=excluded.max_output_tokens,
  reasoning_effort=excluded.reasoning_effort,temperature=null,updated_at=clock_timestamp();
commit;
