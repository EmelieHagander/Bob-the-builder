-- Proposal only. Managed apply supplies the authoritative migration timestamp.
-- Bob remains project manager. Plan Compiler/Reviewer are read-only subagents.
begin;

do $$
begin
  if not exists(select 1 from shared.ai_models where model_name='gpt-5.4-mini' and is_active)
     or not exists(select 1 from shared.ai_models where model_name='gpt-5.4-nano' and is_active) then
    raise exception 'bob_plan_assistant_models_unavailable';
  end if;
end $$;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('consult_plan_assistant',
  'Ground/compile Bob''s project-manager plan or audit the current living plan with read-only mini/nano assistants. They never decide strategy or write project data.',
  'Bob owns the project strategy. For a new/revised plan, pass mode=compile_plan, the exact current approved revision (0 when none) and Bob''s concise plan_intent. The mini compiler may atomize Completion Requirements, match exact existing Task/evidence candidates and produce the normal proposal shape; the nano reviewer checks semantic fit. For an existing plan use audit_plan with plan_intent=null. Treat output as advisory. Do not save a known review error. The assistants never authorize a write; Bob must use the normal propose/decision/evidence/task tools. After approval, candidate Tasks can be linked to the stable Step IDs.',
  1,true,array[]::text[],true)
on conflict(name) do update set
  description=excluded.description,how_to=excluded.how_to,schema_version=excluded.schema_version,
  always_load=excluded.always_load,preload_phases=excluded.preload_phases,active=excluded.active;

insert into shared.ai_settings(
  app,coworker_id,function_name,module_id,model,model_type,max_output_tokens,temperature,
  reasoning_effort,prompt_template,web_search,is_enabled,metadata
) values
 ('bob','bob','plan-compiler','living-plan','gpt-5.4-mini','mini',8000,null,'low',null,false,true,
  '{"role":"bob_plan_compiler","authority":"read_only_advisory"}'::jsonb),
 ('bob','bob','plan-reviewer','living-plan','gpt-5.4-nano','nano',4000,null,'minimal',null,false,true,
  '{"role":"bob_plan_reviewer","authority":"read_only_advisory"}'::jsonb)
on conflict(app,coworker_id,function_name,module_id) do update set
  model=excluded.model,model_type=excluded.model_type,max_output_tokens=excluded.max_output_tokens,
  temperature=excluded.temperature,reasoning_effort=excluded.reasoning_effort,prompt_template=excluded.prompt_template,
  web_search=excluded.web_search,is_enabled=excluded.is_enabled,metadata=excluded.metadata,updated_at=clock_timestamp();

commit;
