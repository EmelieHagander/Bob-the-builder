-- Owner decision 2026-11-07 (decisions 1–3 after the locked-paths inventory):
-- since piece progress v2–v4 went live on 2026-11-04, 1 of 33 hand-overs to
-- Konrad ended ok. New claimed jobs pin worker_gates_version 1:
--  1. the owner's chat answer is the review: no stop after every saved piece;
--  2. an open piece readback, check or form scope, and a rejected piece write,
--     are facts in the tool result Konrad acts on in the same job; the reason
--     of a stopped hand-over is logged;
--  3. a failed or blocked hand-over refuses only the identical request again
--     in the same turn.
-- Deploy both Bob runtimes with worker_gates_version support before applying.
-- Pinned manifests keep their behaviour.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_worker_gates$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
  flags jsonb:=$worker_gates_contract${"worker_gates_version":1}$worker_gates_contract$::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='agent-contract.ask-bob'
      and p.definition_kind='agent_contract' and p.retired_at is null for update of p;
  if not found or prior.metadata->>'workpad_version' is distinct from '1'
    or prior.metadata->>'worker_focus_version' is distinct from '1'
    or prior.metadata ? 'worker_gates_version' then
    raise exception 'worker_gates_contract_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-worker-gates-v1"}'::jsonb||flags,
    prior.content,prior.definition,prior.flow,prior.available_variables
  ) returning id into version_uuid;
  perform shared.activate_ai_catalog('bob',jsonb_build_object('agent-contract.ask-bob',version_uuid));
end $bob_worker_gates$;
commit;
