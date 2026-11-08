-- Deep audit 2026-11-08, the first Entrén turn after #502: Konrad sent no
-- joint rules and typed 104 joints by hand (28,607 characters, 54 % of what
-- he wrote). Under lean writing the edit tool's additional_description still
-- told him to "Resolve dependent bindings, nodes, joints, materials and roles
-- explicitly", which contradicts the lean note (code writes the joints a rule
-- covers and removes what only served a removed part). Only that sentence of
-- tools.edit_construction_parts changes, from the exact published version.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_lean_edit_text$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
  def jsonb;
  old_text text:='Resolve dependent bindings, nodes, joints, materials and roles explicitly.';
  new_text text:='Join parts of two definitions with a joint rule in joint_rules rather than each joint; code writes those joints and removes what only served a removed part. Resolve other dependent bindings, nodes and joints explicitly.';
  extra text;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
  select v.* into prior from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.prompt_key='tools.edit_construction_parts' and p.definition_kind='tool_contract' and p.retired_at is null for update of p;
  extra:=prior.definition->>'additional_description';
  if not found or prior.metadata->>'publication' is distinct from 'bob-lean-construction-v1'
    or prior.metadata->>'lean_construction_version' is distinct from '1'
    or extra is null or (length(extra)-length(replace(extra,old_text,'')))/length(old_text)<>1 then
    raise exception 'lean_edit_text_unexpected';
  end if;
  def:=jsonb_set(prior.definition,'{additional_description}',to_jsonb(replace(extra,old_text,new_text)));
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
      (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-lean-edit-text-v1"}'::jsonb,
      prior.content,def,prior.flow,prior.available_variables)
    returning id into version_uuid;
  perform shared.activate_ai_catalog('bob',jsonb_build_object('tools.edit_construction_parts',version_uuid));
end $bob_lean_edit_text$;
commit;
