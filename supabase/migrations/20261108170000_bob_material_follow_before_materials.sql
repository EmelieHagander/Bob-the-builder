-- Owner run 2026-11-08 16:06 (Våningssäng 2): material rows left pending by an
-- earlier turn were redone by Mattias with the model, row by row (25 rows,
-- 104 model calls, USD 6.91). The code recalculation of #508 ran only after a
-- Konrad job, and Konrad was not in that turn.
--
-- material_follow_version 2 (the pin new claimed jobs adopt): before Mattias's
-- job, code also recalculates the rows still pending on the construction
-- Konrad's scope binds, through the same tool and writer
-- (construction-follow-up.ts, project-answer.ts followBeforeMaterials).
-- Mattias reads the result as material_follow_up in his knowledge. Rows that
-- need a decision stay pending.
--
-- Only the contract pin changes. Refuses to run unless version 1 is published.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_material_follow_2$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
  flags jsonb:=$material_follow_2_contract${"material_follow_version":2}$material_follow_2_contract$::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='agent-contract.ask-bob' and p.definition_kind='agent_contract' and p.retired_at is null for update of p;
  if not found or prior.metadata->>'material_follow_version' is distinct from '1' then
    raise exception 'material_follow_2_contract_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
      (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-material-follow-v2"}'::jsonb||flags,
      prior.content,prior.definition,prior.flow,prior.available_variables)
    returning id into version_uuid;
  perform shared.activate_ai_catalog('bob',jsonb_build_object('agent-contract.ask-bob',version_uuid));
end $bob_material_follow_2$;
commit;
