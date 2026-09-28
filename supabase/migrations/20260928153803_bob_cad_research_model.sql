-- Read-only source collection has its own governed model. Construction and
-- independent review keep their existing settings and authority.
begin;
do $$ begin
 if not exists(select 1 from shared.ai_models where model_name='gpt-5.4-mini' and is_active and supports_reasoning) then
  raise exception 'bob_research_model_unavailable';
 end if;
end $$;
insert into shared.ai_settings(app,coworker_id,function_name,module_id,model,model_type,max_output_tokens,
 temperature,reasoning_effort,prompt_template,web_search,is_enabled,metadata)
select 'bob','bob','cad-research','cad','gpt-5.4-mini','mini',3000,null,'low',null,false,is_enabled,
 '{"role":"cad_source_collection","authority":"read_only","handoff":"exact_tool_results"}'::jsonb
from shared.ai_settings where app='bob' and coworker_id='bob' and function_name='cad-designer' and module_id='cad'
on conflict(app,coworker_id,function_name,module_id) do update set
 model=excluded.model,model_type=excluded.model_type,max_output_tokens=excluded.max_output_tokens,
 reasoning_effort=excluded.reasoning_effort,temperature=null,updated_at=clock_timestamp();
commit;
