-- P2.4: Offer the existing Plan-focus tools automatically only after the
-- authoritative construction workpiece gate identifies an unfocused Step.
-- This loads manuals for the NEXT model step; it neither changes the Plan
-- nor grants new access, and preserves all pinned in-flight manifests.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $p24_focus_tools$
declare prior shared.ai_prompt_versions; nid uuid; nv integer; existing jsonb; extra jsonb:=
  '[{"after_tool":"ask_structure_worker","statuses":["needs_verification"],
     "when":{"field":"reason","equals":"construction_piece_step_not_focused"},
     "tools":["read_plan_link_context","change_plan_focus"]}]'::jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p
 join shared.ai_prompt_versions v on v.id=p.active_version_id
 where p.app='bob' and p.prompt_key='bob.tools' and p.retired_at is null for update of p;
 if not found then raise exception 'p24_tool_catalog_unavailable'; end if;
 if prior.metadata->>'p24_focus_tools_version'='1' then return; end if;
 existing:=prior.definition->'operation_followups';
 if prior.metadata->>'construction_work_version' is distinct from '1'
   or prior.metadata->>'p2_source_followups_version' is distinct from '1'
   or jsonb_typeof(existing) is distinct from 'array'
   or jsonb_array_length(existing)<>20 then raise exception 'p24_tool_catalog_baseline_changed'; end if;
 if exists(select 1 from jsonb_array_elements(existing) row
   where row->>'after_tool'='ask_structure_worker'
     and row->'when'->>'equals'='construction_piece_step_not_focused')
 then raise exception 'p24_focus_followup_already_exists'; end if;
 select coalesce(max(version),0)+1 into nv from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
 values(prior.prompt_id,nv,prior.definition_kind,prior.definition_format_version,
  (prior.metadata-'seed_version'-'source_revision') ||
    '{"publication":"p24-focused-konrad-handoff","p24_focus_tools_version":1}'::jsonb,
  prior.content,jsonb_set(prior.definition,'{operation_followups}',existing||extra),
  prior.flow,prior.available_variables) returning id into nid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('bob.tools',nid));
end $p24_focus_tools$;
commit;
