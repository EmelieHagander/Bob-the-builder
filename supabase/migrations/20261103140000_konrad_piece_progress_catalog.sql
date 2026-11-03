-- New claimed Konrad jobs only: one bounded construction mutation per model
-- batch and exact persisted-revision readback before the next piece. The model
-- chooses the natural wall/opening scope; backend verifies the save boundary.
-- Apply after both Bob runtimes contain worker_piece_progress_version support.
-- Existing pinned turns, construction tools and physical safety checks stay.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $konrad_piece_progress$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
  activation jsonb:='{}'::jsonb;
  tools_definition jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));

  select v.definition into tools_definition from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='bob.tools'
      and p.definition_kind='tool_contract' and p.retired_at is null;
  if tools_definition is null or tools_definition->>'build_workers_version' is distinct from '1'
    or tools_definition->>'workpad_version' is distinct from '1'
    or tools_definition->>'report_readback_version' is distinct from '1'
    or tools_definition->>'construction_auto_check_version' is distinct from '1' then
    raise exception 'konrad_piece_toolbox_unexpected';
  end if;

  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='structure-worker.persona'
      and p.definition_kind='prompt' and p.retired_at is null for update of p;
  if not found or position('en öppning eller berörd vägg i taget' in prior.content)>0 then
    raise exception 'konrad_piece_persona_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||'{"publication":"konrad-piece-progress-v1"}'::jsonb,
    prior.content||E'\n\nNär flera likartade ändringar behövs i samma bygge arbetar du i naturliga delar – en öppning eller berörd vägg i taget. Ändra bara den berörda delen av den sparade konstruktionen, spara, läs det verifierade kvittot och kontrollen innan nästa; skilj fel i delen från vad som medvetet återstår och håll nästa steg i ditt privata anteckningsblock. Tekniska delkontroller gör du själv; Bob visar den samlade ritningen när beställaren behöver bedöma formen.',
    prior.definition,prior.flow,prior.available_variables
  ) returning id into version_uuid;
  activation:=activation||jsonb_build_object('structure-worker.persona',version_uuid);

  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='agent-contract.ask-bob'
      and p.definition_kind='agent_contract' and p.retired_at is null for update of p;
  if not found or prior.metadata->>'workpad_version' is distinct from '1'
    or prior.metadata->>'worker_checkpoint_version' is distinct from '1'
    or prior.metadata->>'worker_verified_renewal_version' is distinct from '1'
    or prior.metadata->>'worker_piece_progress_version' is not null then
    raise exception 'konrad_piece_contract_unexpected';
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(
    prompt_id,version,definition_kind,definition_format_version,metadata,
    content,definition,flow,available_variables
  ) values (
    prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||
      '{"publication":"konrad-piece-progress-v1","worker_piece_progress_version":1}'::jsonb,
    prior.content,prior.definition,prior.flow,prior.available_variables
  ) returning id into version_uuid;
  activation:=activation||jsonb_build_object('agent-contract.ask-bob',version_uuid);

  perform shared.activate_ai_catalog('bob',activation);
end $konrad_piece_progress$;
commit;
