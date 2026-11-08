-- Owner decision 2026-11-08 ("Gå med rek.", after the deep audit): joint
-- rules are stored with the construction (20261108100000). The save and edit
-- tools say so (joint_rule_store_version 1, the pin new claimed jobs adopt
-- with this manifest): a save states the whole rule set; a part edit keeps
-- the stored rules, adds or replaces those it sends by id, and applies them to
-- the parts it adds, changes or moves. Only these sentences change, from the
-- exact published versions. Generated from the code's texts.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_stored_joint_rules$
declare
  prior shared.ai_prompt_versions;
  next_version integer;
  version_uuid uuid;
  activation jsonb:='{}'::jsonb;
  def jsonb;
  tool text;
  sentence_old text;
  sentence_new text;
  rules_old text:=$rules_old$Your joining decision for two definitions, existing parts included: code writes one joint, with these fasteners and reason, for each pair of their parts that touch face to face and have no joint. In a part edit it applies to the parts the edit adds, changes or moves; an edit with only rules applies them to every touching pair. Where it applies, the joints code wrote take its fasteners and reason. A pair of the same definition is ["stud","stud"]. Touching parts that must not be joined this way go in except: code writes no joint for them and removes one it wrote, and they stay unjoined until they get a joint. Empty for none.$rules_old$;
  rules_new text:=$rules_new$Your joining decision for two definitions, existing parts included: code writes one joint, with these fasteners and reason, for each pair of their parts that touch face to face and have no joint. The rules are stored with the construction: a save states the whole set; a part edit keeps the stored rules, adds or replaces those it sends by id, and applies them to the parts it adds, changes or moves; an edit with only rules applies them to every touching pair. Where a rule applies, the joints code wrote take its fasteners and reason. A pair of the same definition is ["stud","stud"]. Touching parts that must not be joined this way go in except: code writes no joint for them and removes one it wrote, and they stay unjoined until they get a joint. Empty for none.$rules_new$;
  publication text;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
  foreach tool in array array['tools.save_construction_draft','tools.edit_construction_parts'] loop
    select v.* into prior from shared.ai_prompts p
      join shared.ai_prompt_versions v on v.id=p.active_version_id
      where p.app='bob' and p.prompt_key=tool and p.definition_kind='tool_contract' and p.retired_at is null for update of p;
    publication:=case when tool='tools.save_construction_draft' then 'bob-lean-construction-v1' else 'bob-lean-edit-text-v1' end;
    sentence_old:=case when tool='tools.save_construction_draft' then $save_old$joint_rules joins touching parts by definition pair; code writes those joints.$save_old$ else $edit_old$In this edit, joint_rules applies to the parts it adds, changes or moves;$edit_old$ end;
    sentence_new:=case when tool='tools.save_construction_draft' then $save_new$joint_rules joins touching parts by definition pair; code writes those joints and stores the rules with the construction.$save_new$ else $edit_new$The construction's stored joint rules apply to the parts this edit adds, changes or moves, and joint_rules adds or replaces rules by id;$edit_new$ end;
    if not found or prior.metadata->>'publication' is distinct from publication or prior.metadata->>'lean_construction_version' is distinct from '1'
      or prior.metadata ? 'joint_rule_store_version'
      or (length(prior.definition->>'description')-length(replace(prior.definition->>'description',sentence_old,'')))/length(sentence_old)<>1
      or prior.definition#>>'{parameters,properties,joint_rules,description}' is distinct from rules_old then
      raise exception 'stored_joint_rules_tool_unexpected: %',tool;
    end if;
    def:=jsonb_set(prior.definition,'{description}',to_jsonb(replace(prior.definition->>'description',sentence_old,sentence_new)));
    def:=jsonb_set(def,'{parameters,properties,joint_rules,description}',to_jsonb(rules_new));
    select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
    insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
      values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
        (prior.metadata-'seed_version'-'source_revision')||'{"publication":"bob-stored-joint-rules-v1","joint_rule_store_version":1}'::jsonb,
        prior.content,def,prior.flow,prior.available_variables)
      returning id into version_uuid;
    activation:=activation||jsonb_build_object(tool,version_uuid);
  end loop;
  perform shared.activate_ai_catalog('bob',activation);
end $bob_stored_joint_rules$;
commit;
