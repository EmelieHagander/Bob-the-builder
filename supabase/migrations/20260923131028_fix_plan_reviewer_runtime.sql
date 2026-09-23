-- Fix Bob's plan-reviewer model setting and make advisory Task candidates explicit.
begin;

do $$
begin
  if not exists(
    select 1 from shared.ai_models
    where model_name='gpt-5.4-nano' and is_active and supports_reasoning
  ) then
    raise exception 'bob_plan_reviewer_model_unavailable';
  end if;
end $$;

update shared.ai_settings
set reasoning_effort='low',
    updated_at=clock_timestamp()
where app='bob'
  and coworker_id='bob'
  and function_name='plan-reviewer'
  and module_id='living-plan'
  and model='gpt-5.4-nano'
  and is_enabled=true;

do $$
begin
  if not exists(
    select 1 from shared.ai_settings
    where app='bob'
      and coworker_id='bob'
      and function_name='plan-reviewer'
      and module_id='living-plan'
      and model='gpt-5.4-nano'
      and reasoning_effort='low'
      and is_enabled=true
  ) then
    raise exception 'bob_plan_reviewer_setting_not_updated';
  end if;
end $$;

update bob.tool_catalog
set how_to='Bob owns the project strategy. For a new/revised plan, pass mode=compile_plan, the exact current approved revision (0 when none) and Bob''s concise plan_intent. The mini compiler may atomize Completion Requirements, match exact existing Task/evidence candidates and produce the normal proposal shape; the nano reviewer checks semantic fit. For an existing plan use audit_plan with plan_intent=null. Treat output as advisory. Do not save a known review error. task_candidates are suggestions only, never persisted Step↔Task links. A proposal does not create those links; after approval use link_project_plan_task and only report a Task as linked after a successful write receipt. The assistants never authorize a write; Bob must use the normal propose/decision/evidence/task tools.'
where name='consult_plan_assistant' and schema_version=1 and active=true;

update bob.tool_catalog
set how_to='Read the current plan through search_project_data dataset=plan before replanning. Keep completed history: the server carries completed Steps unchanged. Reuse exact Step/Requirement IDs only when they come from the current plan; use null for genuinely new ones. Near-term requirements should be concrete; distant Steps may remain coarse. For every active/near-term Step, notes is the Step Brief: a short self-prompt covering purpose, focus, important constraints and what matters while working there. Tasks are actions and Completion Requirements are finish criteria; do not turn every Task into a requirement. A plan proposal never creates Step↔Task links, even when consult_plan_assistant returns task_candidates. Link candidates only after the proposal is approved/current, via link_project_plan_task. A measurement requirement should prefer an exact existing Measurement ID when one exists, otherwise an exact subject/Area selector. Responsibility is Bob, a project person, or unassigned; assignment never grants authority. Explain why the plan changes. This write creates only a proposal and still needs an exact quote from the current request.'
where name='propose_project_plan' and schema_version=1 and active=true;

do $$
begin
  if (select count(*) from bob.tool_catalog
      where name in ('consult_plan_assistant','propose_project_plan')
        and schema_version=1 and active=true) <> 2 then
    raise exception 'bob_plan_task_link_guides_not_updated';
  end if;
end $$;

commit;
