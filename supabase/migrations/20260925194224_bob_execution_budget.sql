-- Bound a delegated turn at 32 committed operations across all routed writer
-- versions. Preserve exact bodies, grants, claim/CAS checks and receipt replay.
-- Server validation failures do not create receipts or spend this commit budget.
do $budget$
declare version integer; fn regprocedure; body text; replacement text;
begin
  for version in 1..12 loop
    fn := to_regprocedure(format('bob_private.bob_project_write%s(text,uuid,uuid,bigint,jsonb)',case when version=1 then '' else '_v'||version end));
    if fn is null then raise exception 'Missing Bob writer version %',version; end if;
    body := pg_get_functiondef(fn);
    replacement := replace(body, 'turn_id=p_turn)>=8 then', 'turn_id=p_turn)>=32 then');
    if replacement=body then raise exception 'Unexpected Bob budget contract in %',fn; end if;
    execute replacement;
  end loop;
end
$budget$;

-- Routing interprets language and tool contracts; it is read-only and cannot
-- authorize writes. Keep its reasoning/output budget separate from the designer.
insert into shared.ai_settings(app,coworker_id,function_name,module_id,model,model_type,max_output_tokens,
  temperature,reasoning_effort,prompt_template,web_search,is_enabled,metadata)
select 'bob','bob','work-router','global',model,model_type,4000,null,'low',null,false,is_enabled,
  '{"role":"work_and_capability_routing","authority":"read_only"}'::jsonb
from shared.ai_settings where app='bob' and coworker_id='bob' and function_name='ask-bob' and module_id='global'
on conflict(app,coworker_id,function_name,module_id) do update set
  max_output_tokens=excluded.max_output_tokens,reasoning_effort=excluded.reasoning_effort,
  updated_at=clock_timestamp();
