-- Activate after the matching Ask Bob runtime. Existing jobs retain their pinned manifest.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $publication$
declare
  edits constant jsonb := $plan_progress_edits$[
    {"key":"bob.context-principles","append":"As delegated work advances, link verified results to the step they satisfy and move the saved focus to the work you take up next. Leave unresolved criteria visible, including checks that need a person on site."},
    {"key":"completion-gate.contract","append":"For delegated plan work, compare plan_at_turn_start with saved_work and attempted_actions. If a verified result satisfies a criterion or Bob has taken up another step and the corresponding plan update is still missing, name that gap. A later drawing or a prepared task alone proves neither completion nor a physical check."},
    {"key":"agent-contract.ask-bob"}
  ]$plan_progress_edits$::jsonb;
  edit jsonb;
  prior shared.ai_prompt_versions;
  next_version integer;
  version_id uuid;
  activation jsonb := '{}';
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
  for edit in select value from jsonb_array_elements(edits) loop
    select v.* into strict prior from shared.ai_prompts p
      join shared.ai_prompt_versions v on v.id=p.active_version_id
      where p.app='bob' and p.prompt_key=edit->>'key' and p.retired_at is null for update of p;
    if prior.metadata->>'plan_progress_version'='1' then continue; end if;
    select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
    insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
      values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
        (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-plan-progress-v1","plan_progress_version":1}'::jsonb,
        prior.content || coalesce(' ' || (edit->>'append'),''),prior.definition,prior.flow,prior.available_variables)
      returning id into version_id;
    activation:=activation||jsonb_build_object(edit->>'key',version_id);
  end loop;
  if activation<>'{}'::jsonb then perform shared.activate_ai_catalog('bob',activation); end if;
end $publication$;
commit;
