-- Owner decision 2026-11-02 (thread "Fix Bob rambling in Ladan chat"): a
-- go-ahead hands Bob the whole active outcome. bob-project-lead-v1 told Bob to
-- end each reply with the next step and let the owner's next message carry it,
-- so each turn did one small step and stopped (about twelve bare go-aheads in
-- Ladan). Bob now hands over only after real progress or when only the owner
-- can answer, and works on what does not depend on an open taste question.
-- Catalog only; running and pinned jobs keep their manifests.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_drive_outcome$
declare
 spec constant jsonb:=$bob_drive_outcome_spec$
[
 {"key":"bob.persona","old":"Smakfrågor och det som inte går att ångra lägger du fram ett i taget, med din rekommendation.","new":"Smakfrågor och det som inte går att ångra lägger du fram med din rekommendation, och gör under tiden resten."},
 {"key":"bob.persona","old":"Börja med vad som är gjort eller bestämt, upprepa inte det som redan står i projektet, och sluta med vad du tar dig an härnäst eller det enda val som behövs.","new":"Börja med vad som är gjort eller bestämt och upprepa inte det som redan står i projektet. Du lämnar över när bygget har tagit ett riktigt kliv eller bara beställaren kan svara."},
 {"key":"bob.contract","old":"Keep it compact: what you did, what it means for the build, and the next step or the one question you need answered.","new":"Keep it compact: what you did, what it means for the build, and the one question you need answered, if any."},
 {"key":"bob.contract","old":" Name the next step you will take; the owner's next message carries it forward unless it changes direction.","new":""},
 {"key":"bob.contract","old":" The next step you named in your last reply is part of that work.","new":" A go-ahead hands over the whole active outcome, not only the step mentioned last."}
]
$bob_drive_outcome_spec$::jsonb;
 prior shared.ai_prompt_versions; next_version integer; version_uuid uuid; k text; e jsonb; new_content text; activation jsonb:='{}'::jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 if exists(select 1 from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.persona' and p.retired_at is null and v.metadata->>'drive_outcome_version'='1') then return; end if;
 for k in select distinct value->>'key' from jsonb_array_elements(spec) loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=k and p.retired_at is null for update of p;
  if not found then raise exception 'bob_drive_outcome_missing_%',k; end if;
  new_content:=prior.content;
  for e in select value from jsonb_array_elements(spec) where value->>'key'=k loop
   if (length(new_content)-length(replace(new_content,e->>'old','')))/length(e->>'old')<>1 then raise exception 'bob_drive_outcome_unexpected_%',k; end if;
   new_content:=replace(new_content,e->>'old',e->>'new');
  end loop;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-drive-outcome-v1','drive_outcome_version',1),
    new_content,prior.definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object(k,version_uuid);
 end loop;
 perform shared.activate_ai_catalog('bob',activation);
end $bob_drive_outcome$;
commit;
