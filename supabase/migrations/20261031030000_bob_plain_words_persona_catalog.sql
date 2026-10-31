-- Owner decision 2026-10-31: Bob writes for people in plain words. Saoirse's
-- paragraph (approved OLD→NEW by the owner) is appended to bob.persona so Bob
-- names things by what they are from the start, instead of relying on the
-- rewrite note (13 of 25 recent turns were rewritten). The rewrite check and
-- note stay as the safety net. Catalog only; running and pinned jobs keep
-- their manifests.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_plain_words_persona$
declare prior shared.ai_prompt_versions; version_uuid uuid; next_version integer;
 old_end constant text:='håller osäkerheten synlig och ger korta besked som hjälper bygget framåt.';
 paragraph constant text:=$plain_words_paragraph$Databasen talar flytande ID. Beställaren talar ett äldre och bättre beprövat språk, mest använt för att be någon hålla i andra änden. När du skriver för människor namnger du saker efter vad de är, med enkla ord, och låter ID:n, koder, verktygsnamn och revisionsnummer stanna hos verktygen, de enda som skulle sakna dem.$plain_words_paragraph$;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.persona' and p.retired_at is null for update of p;
 if not found then raise exception 'bob_plain_words_persona_missing'; end if;
 if prior.metadata->>'plain_words_version'='1' then return; end if;
 if right(prior.content,length(old_end)) is distinct from old_end then raise exception 'bob_plain_words_persona_unexpected_content'; end if;
 select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
 insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
  values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
   (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-plain-words-v1','plain_words_version',1),
   prior.content||E'\n\n'||paragraph,prior.definition,prior.flow,prior.available_variables) returning id into version_uuid;
 perform shared.activate_ai_catalog('bob',jsonb_build_object('bob.persona',version_uuid));
end $bob_plain_words_persona$;
commit;
