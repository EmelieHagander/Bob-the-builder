-- Owner decisions 2026-11-01 after paid box run 14 (Saoirse's texts, approved
-- by the owner OLD -> NEW):
-- A. bob.tools construction_auto_check_version 1: after Konrad's job, code runs the server
--    construction check on every saved revision he left unchecked (no model).
-- B. Bob's hand-over to Konrad: the owner's latest decisions are in the selected solution
--    before the job goes to him (run 14 wasted a Konrad job on the old width). The return
--    contract names the code check. The policy copies of the manual change with it.
-- Deploy the consumer first. Pinned manifests keep their behaviour.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_catalog_publication_do$
declare spec jsonb:=$bob_catalog_publication${
 "publication": "bob-solution-first-v1",
 "header": [
  "Owner decisions 2026-11-01 after paid box run 14 (Saoirse's texts, approved",
  "by the owner OLD -> NEW):",
  "A. bob.tools construction_auto_check_version 1: after Konrad's job, code runs the server",
  "   construction check on every saved revision he left unchecked (no model).",
  "B. Bob's hand-over to Konrad: the owner's latest decisions are in the selected solution",
  "   before the job goes to him (run 14 wasted a Konrad job on the old width). The return",
  "   contract names the code check. The policy copies of the manual change with it.",
  "Deploy the consumer first. Pinned manifests keep their behaviour."
 ],
 "flags": {
  "construction_auto_check_version": 1
 },
 "requires": {
  "report_readback_version": 1
 },
 "edits": [
  {
   "key": "tools.ask_structure_worker",
   "kind": "tool_contract",
   "replace": [
    {
     "field": "additional_description",
     "old": "Have the solution selected first; Konrad constructs what is selected.",
     "new": "Konrad constructs the selected solution as it is saved, not as it was discussed: before the job goes to him, the owner's latest decisions are in the selected solution, and one that already holds them needs no new save."
    },
    {
     "path": [
      "expected_return",
      "contract"
     ],
     "old": "not written by him.",
     "new": "not written by him. Where he left a saved revision unchecked, code runs the construction check on the whole of it after the job; its receipt and the readback show the result."
    }
   ]
  }
 ],
 "how_to": {
  "ask_structure_worker": "Konrad constructs the selected solution as it is saved, not as it was discussed: before the job goes to him, the owner's latest decisions are in the selected solution, and one that already holds them needs no new save. Write to him as you would to a colleague on site: what to construct, and what is left out for now. He reads the solution, the measurements, the images and the existing constructions himself, so leave ids, measurements and other values out. A large build may come back as several constructions in one coordinate system; where to split is his call. The construction he saved or checked comes with his report, read back by code after the job; go by that and its check before you send Rita to draw it or tell the owner."
 }
}$bob_catalog_publication$::jsonb;
 patch jsonb; change jsonb; prior shared.ai_prompt_versions; version_uuid uuid; next_version integer; activation jsonb:='{}';
 new_content text; definition jsonb; field text; old_text text; source text; requirement record;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 for patch in select value from jsonb_array_elements(spec->'edits') loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=patch->>'key' and p.definition_kind=patch->>'kind' and p.retired_at is null for update of p;
  if not found then raise exception 'publication_edit_missing: %',patch->>'key'; end if;
  new_content:=prior.content;definition:=prior.definition;
  for change in select value from jsonb_array_elements(patch->'replace') loop
   field:=coalesce(change->>'field','');old_text:=change->>'old';
   source:=case when field='content' then new_content when change ? 'path' then definition#>>(select array_agg(x) from jsonb_array_elements_text(change->'path') x) else definition->>field end;
   if source is null or (length(source)-length(replace(source,old_text,'')))/length(old_text)<>1 then raise exception 'publication_replace_unexpected: % %',patch->>'key',coalesce(change->>'path',field); end if;
   if field='content' then new_content:=replace(source,old_text,change->>'new');
   else definition:=jsonb_set(definition,case when change ? 'path' then (select array_agg(x) from jsonb_array_elements_text(change->'path') x) else array[field] end,to_jsonb(replace(source,old_text,change->>'new'))); end if;
  end loop;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication',spec->>'publication'),
    new_content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' for update of p;
 if not found then raise exception 'publication_toolbox_missing'; end if;
 for requirement in select key,value from jsonb_each(spec->'requires') loop
  if prior.definition->requirement.key is distinct from requirement.value then raise exception 'publication_requires: %',requirement.key; end if;
 end loop;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication',spec->>'publication'),
   prior.content,prior.definition||(spec->'flags')||jsonb_build_object(
    'catalog',(select jsonb_agg(case when spec->'how_to' ? (c->>'name') then jsonb_set(c,'{how_to}',spec->'how_to'->(c->>'name')) else c end order by ord)
     from jsonb_array_elements(prior.definition->'catalog') with ordinality x(c,ord))),prior.flow,prior.available_variables) returning id into version_uuid;
 activation:=activation||jsonb_build_object('bob.tools',version_uuid);
 update bob.tool_catalog t set how_to=h.value from jsonb_each_text(spec->'how_to') h where t.name=h.key;
 perform shared.activate_ai_catalog('bob',activation);
end $bob_catalog_publication_do$;
commit;
