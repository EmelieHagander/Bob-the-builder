-- Owner decision 2026-11-02 (thread "Fix Bob rambling in Ladan chat"): the
-- project description holds no measurements and is rewritten in each project
-- phase. Ladan's description still said 4 x 7 m after the owner chose 3 x 6 m,
-- because measurements lived in two places. Measurements belong to
-- measurements and the selected solution. Catalog only.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_description_role$
declare
 spec constant jsonb:=$bob_description_role_spec${
 "key": "tools.edit_project_record",
 "old": "Text fields: /description, /title, /assumptions, /tradeoffs.",
 "new": "Text fields: /description, /title, /assumptions, /tradeoffs. The project description tells what is being built, for whom and why, its character and where the project stands in its current phase; it holds no measurements, which live in measurements and the selected solution. Rewrite it when the project moves to a new phase."
}$bob_description_role_spec$::jsonb;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid; d text;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key=spec->>'key' and p.retired_at is null for update of p;
 if not found then raise exception 'bob_description_role_missing'; end if;
 if prior.metadata->>'description_role_version'='1' then return; end if;
 d:=prior.definition->>'description';
 if (length(d)-length(replace(d,spec->>'old','')))/length(spec->>'old')<>1 then raise exception 'bob_description_role_unexpected_description'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-description-role-v1','description_role_version',1),
   prior.content,jsonb_set(prior.definition,'{description}',to_jsonb(replace(d,spec->>'old',spec->>'new'))),prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object(spec->>'key',version_uuid));
end $bob_description_role$;
commit;
