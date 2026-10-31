-- Owner decision 2026-10-31 after paid box run 13: what Konrad and Rita saved comes
-- back with their report, read by code (the construction overview or the drawing
-- record at its saved revision), so Bob checks the saved record instead of
-- reading it again. bob.tools report_readback_version 1 switches the runtime on;
-- the texts that tell Bob where the record is (drafted by Saoirse, approved by
-- the owner, OLD -> NEW) change with it. Deploy the consumer first. Pinned
-- manifests keep their behaviour.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_report_readback$
declare edits jsonb:=$bob_report_readback_edits$[
 {
  "key": "bob.context-principles",
  "kind": "instruction_fragment",
  "replace": [
   {
    "field": "content",
    "old": "Their report says what they did; the saved record is what they did, so read the record before you pass anything on.",
    "new": "Their report says what they did; the saved record is what they did, so you go by the record."
   }
  ]
 },
 {
  "key": "tools.ask_structure_worker",
  "kind": "tool_contract",
  "replace": [
   {
    "field": "additional_description",
    "old": "Read the saved construction and its check before you send Rita to draw it or tell the owner.",
    "new": "The construction he saved or checked comes with his report, read back by code after the job; go by that and its check before you send Rita to draw it or tell the owner."
   },
   {
    "path": [
     "expected_return",
     "contract"
    ],
    "old": "Konrad's report: status, his answer to Bob (what he constructed and checked, what he saved, what is open and for whom), the tool calls he made with their status, and the receipts of what he saved.",
    "new": "Konrad's report: status, his answer to Bob (what he constructed and checked, what he saved, what is open and for whom), the tool calls he made with their status, the receipts of what he saved, and the readback: the overview of each construction he saved or checked at that exact revision, read by code after the job, not written by him."
   }
  ]
 },
 {
  "key": "tools.ask_drawing_worker",
  "kind": "tool_contract",
  "replace": [
   {
    "field": "additional_description",
    "old": "Read what she saved before you tell the owner.",
    "new": "The drawing she saved comes with her report, read back by code after the job; go by that before you tell the owner."
   },
   {
    "path": [
     "expected_return",
     "contract"
    ],
    "old": "Rita's report: status, her answer to Bob (what she drew, saved and linked, what is open and for whom), the tool calls she made with their status, and the receipts of what she saved.",
    "new": "Rita's report: status, her answer to Bob (what she drew, saved and linked, what is open and for whom), the tool calls she made with their status, the receipts of what she saved, and the readback: the record of each drawing she saved at that exact revision, with its source state and linked Steps, read by code after the job, not written by her."
   }
  ]
 }
]$bob_report_readback_edits$::jsonb;
 policy_how_to jsonb:=$bob_report_readback_how_to${
 "ask_structure_worker": "Have the solution selected first; Konrad constructs what is selected. Write to him as you would to a colleague on site: what to construct, and what is left out for now. He reads the solution, the measurements, the images and the existing constructions himself, so leave ids, measurements and other values out. A large build may come back as several constructions in one coordinate system; where to split is his call. The construction he saved or checked comes with his report, read back by code after the job; go by that and its check before you send Rita to draw it or tell the owner.",
 "ask_drawing_worker": "Rita draws what Konrad has saved and checked; a change to the construction goes to Konrad, not into the drawing. Floor plans, room layouts and stair studies stay with you. Write to her as you would to a colleague on site: what to draw and what it is for. She reads the constructions, the plan and the drawing requests herself, so leave ids, measurements and other values out. The drawing she saved comes with her report, read back by code after the job; go by that before you tell the owner."
}$bob_report_readback_how_to$::jsonb;
 patch jsonb; change jsonb; prior shared.ai_prompt_versions; version_uuid uuid; next_version integer; activation jsonb:='{}';
 new_content text; definition jsonb; field text; old_text text; source text;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 for patch in select value from jsonb_array_elements(edits) loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=patch->>'key' and p.definition_kind=patch->>'kind' and p.retired_at is null for update of p;
  if not found then raise exception 'report_readback_edit_missing: %',patch->>'key'; end if;
  new_content:=prior.content;definition:=prior.definition;
  for change in select value from jsonb_array_elements(patch->'replace') loop
   field:=coalesce(change->>'field','');old_text:=change->>'old';
   source:=case when field='content' then new_content when change ? 'path' then definition#>>(select array_agg(x) from jsonb_array_elements_text(change->'path') x) else definition->>field end;
   if source is null or (length(source)-length(replace(source,old_text,'')))/length(old_text)<>1 then raise exception 'report_readback_replace_unexpected: % %',patch->>'key',coalesce(change->>'path',field); end if;
   if field='content' then new_content:=replace(source,old_text,change->>'new');
   else definition:=jsonb_set(definition,case when change ? 'path' then (select array_agg(x) from jsonb_array_elements_text(change->'path') x) else array[field] end,to_jsonb(replace(source,old_text,change->>'new'))); end if;
  end loop;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-report-readback-v1'),
    new_content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object(patch->>'key',version_uuid);
 end loop;
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' for update of p;
 if not found then raise exception 'report_readback_toolbox_missing'; end if;
 if prior.definition->>'build_workers_version' is distinct from '1' then raise exception 'report_readback_requires_build_workers'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-report-readback-v1'),
   prior.content,prior.definition||jsonb_build_object('report_readback_version',1,
    'catalog',(select jsonb_agg(case when policy_how_to ? (c->>'name') then jsonb_set(c,'{how_to}',policy_how_to->(c->>'name')) else c end order by ord)
     from jsonb_array_elements(prior.definition->'catalog') with ordinality x(c,ord))),prior.flow,prior.available_variables) returning id into version_uuid;
 activation:=activation||jsonb_build_object('bob.tools',version_uuid);
 -- The policy copies of the two hand-over manuals change with them.
 update bob.tool_catalog t set how_to=h.value from jsonb_each_text(policy_how_to) h where t.name=h.key;
 perform shared.activate_ai_catalog('bob',activation);
end $bob_report_readback$;
commit;
