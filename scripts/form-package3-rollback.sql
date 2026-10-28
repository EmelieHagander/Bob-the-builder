-- Operator-only FORM package 3 ROLLBACK for ALL users of this Bob project.
-- Turns OFF the targeted CAD review, read_task_sources and the small source reader.
-- Run only after ask-bob and bob-worker from main are deployed and migrations
-- 20261028080000, 20261028120000 and 20261028140000 are applied. Never part of
-- supabase/migrations: the baseline comparison must run before enablement.
-- New catalog versions keep history; pinned in-flight jobs keep their manifest.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $form_package3$
declare role_key text; prior shared.ai_prompt_versions; next_version integer; version_uuid uuid; definition jsonb; activation jsonb:='{}';
 tools constant text[]:=array['read_task_sources','read_source_findings'];
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 foreach role_key in array array['role.cad-targeted-reviewer','role.source-reader'] loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=role_key for update of p;
  if not found then raise exception 'form_package3_publication_missing: %',role_key; end if;
  if prior.definition->'enabled' is distinct from to_jsonb(false) then
   select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
   insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
    values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,prior.metadata||jsonb_build_object('enablement','form-package3-rollback'),
     prior.content,jsonb_set(prior.definition,'{enabled}',to_jsonb(false)),prior.flow,prior.available_variables) returning id into version_uuid;
   activation:=activation||jsonb_build_object(role_key,version_uuid);
  end if;
 end loop;
 if (select count(*) from bob.tool_catalog where name=any(tools))<>2 then raise exception 'form_package3_policy_missing'; end if;
 update bob.tool_catalog set active=false where name=any(tools) and active is distinct from false;
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.tools' for update of p;
 if not found then raise exception 'form_package3_toolbox_missing'; end if;
 definition:=jsonb_set(prior.definition,'{catalog}',(select jsonb_agg(case when r->>'name'=any(tools) then jsonb_set(r,'{active}',to_jsonb(false)) else r end order by ord)
  from jsonb_array_elements(prior.definition->'catalog') with ordinality t(r,ord)));
 if definition is distinct from prior.definition then
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,prior.metadata||jsonb_build_object('enablement','form-package3-rollback'),
    prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object('bob.tools',version_uuid);
 end if;
 if activation<>'{}' then perform shared.activate_ai_catalog('bob',activation); end if;
end $form_package3$;
commit;
