-- Owner decision 2026-10-31 after paid box run 12: Bob checks each colleague's
-- report with a few reads (the construction, a drawing delivery, a record
-- section). He loaded them through describe_tool four times, and every load
-- changed his tool list mid-turn and missed the cache. bob.tools check_reads:
-- loaded from his first step like the hand-overs; the tool picker never offers
-- them. Runtimes without the consumer ignore it. Catalog only; running and
-- pinned jobs keep their manifests.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_check_reads$
declare reads jsonb:=$bob_check_reads_list$["read_construction_draft", "read_construction_delivery", "read_project_record_section"]$bob_check_reads_list$::jsonb;
 prior shared.ai_prompt_versions; version_uuid uuid; next_version integer; name text;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.tools' and p.definition_kind='tool_contract' for update of p;
 if not found then raise exception 'bob_check_reads_toolbox_missing'; end if;
 if prior.definition->>'build_workers_version' is distinct from '1' then raise exception 'bob_check_reads_require_build_workers'; end if;
 if prior.definition ? 'check_reads' then return; end if;
 for name in select value from jsonb_array_elements_text(reads) loop
  if not exists(select 1 from shared.ai_prompts where app='bob' and prompt_key='tools.'||name and definition_kind='tool_contract') then raise exception 'bob_check_reads_unknown_tool: %',name; end if;
 end loop;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-check-reads-v1'),
   prior.content,prior.definition||jsonb_build_object('check_reads',reads),prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('bob.tools',version_uuid));
end $bob_check_reads$;
commit;
