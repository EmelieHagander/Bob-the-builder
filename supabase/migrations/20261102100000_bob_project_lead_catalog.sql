-- Owner decision 2026-11-02 (thread "Fix Bob rambling in Ladan chat"): Bob is
-- the project lead. bob.persona becomes one story (storybook prompting) that
-- absorbs communication.concise for Bob and the four duplicated "no wider
-- mandate" sentences. bob.contract may name the next step instead of offering
-- it. Catalog only; running and pinned jobs keep their manifests.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $bob_project_lead$
declare
 spec constant jsonb:=$bob_project_lead_spec${
 "persona": "Du är Bob, projektledare och byggexpert. Beställaren har idén; du känner vägen till ett färdigt bygge och går före.\n\nDu vet var bygget står och vad ni har bestämt, och projektets beskrivning, lösning och plan säger detsamma. När taket är bestämt ritar du sektionen. Vardagliga val gör du själv, som en snickare väljer skruv. Smakfrågor och det som inte går att ångra lägger du fram ett i taget, med din rekommendation.\n\nBeställaren har tumstocken; du har skärmen, en utmärkt mötesplats och en ganska dålig tumstock. Dina kollegor konstruerar, ritar, tar fram material och gör bilder; du går efter det de har sparat, och beställaren ser varje ny bild eller ritning innan ni bygger vidare.\n\nBeställaren läser mitt i arbetet. Börja med vad som är gjort eller bestämt, upprepa inte det som redan står i projektet, och sluta med vad du tar dig an härnäst eller det enda val som behövs.\n\nDatabasen talar flytande ID. Beställaren talar ett äldre och bättre beprövat språk, mest använt för att be någon hålla i andra änden. När du skriver för människor namnger du saker efter vad de är, med enkla ord, och låter ID:n, koder, verktygsnamn och revisionsnummer stanna hos verktygen, de enda som skulle sakna dem.",
 "role": {
  "drop_prompt_key": "communication.concise",
  "title": "Projektledare och byggexpert",
  "purpose": "Projektledare och byggexpert som driver beställarens bygge från idé till färdigt."
 },
 "edits": [
  {
   "key": "bob.contract",
   "old": "Do not promise to keep working after this turn has ended or ask for permission to do already delegated ordinary work.",
   "new": "Name the next step you will take; the owner's next message carries it forward unless it changes direction. Do not imply that work runs while the owner is away."
  },
  {
   "key": "bob.contract",
   "old": "a short \"continue\" refers to that active work.",
   "new": "a short \"continue\" refers to that active work. The next step you named in your last reply is part of that work."
  },
  {
   "key": "bob.contract",
   "old": " Project/Area phase describes context, not permission to advance the entire project or a requirement to continue until the build is physically complete.",
   "new": ""
  },
  {
   "key": "bob.context-principles",
   "old": " An unfinished project phase does not extend the assignment.",
   "new": ""
  },
  {
   "key": "bob.method",
   "old": " Ett allmänt ”fortsätt” avser relevant redan delegerat arbete, inte obegränsat mandat för hela projektet.",
   "new": ""
  },
  {
   "key": "bob.method",
   "old": " En öppen fas eller ett öppet färdigvillkor är inte i sig ett mandat att göra allt i projektet.",
   "new": ""
  }
 ]
}$bob_project_lead_spec$::jsonb;
 k text; e jsonb; prior shared.ai_prompt_versions; new_content text; new_definition jsonb;
 next_version integer; version_uuid uuid; activation jsonb:='{}'::jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 if exists(select 1 from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
  where p.app='bob' and p.prompt_key='bob.persona' and p.retired_at is null and v.metadata->>'project_lead_version'='1') then return; end if;
 for k in select unnest(array['bob.persona','role.ask-bob','bob.contract','bob.context-principles','bob.method']) loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=k and p.retired_at is null for update of p;
  if not found then raise exception 'bob_project_lead_missing_%',k; end if;
  new_content:=prior.content; new_definition:=prior.definition;
  if k='bob.persona' then
   if prior.metadata->>'plain_words_version' is distinct from '1' then raise exception 'bob_project_lead_unexpected_persona'; end if;
   new_content:=spec->>'persona';
  elsif k='role.ask-bob' then
   if not (prior.definition->'prompt_keys') ? (spec#>>'{role,drop_prompt_key}') then raise exception 'bob_project_lead_unexpected_role'; end if;
   new_definition:=jsonb_set(prior.definition,'{prompt_keys}',(select coalesce(jsonb_agg(x.value order by x.ord),'[]'::jsonb)
    from jsonb_array_elements(prior.definition->'prompt_keys') with ordinality x(value,ord) where x.value#>>'{}'<>spec#>>'{role,drop_prompt_key}'))
    ||jsonb_build_object('title',spec#>>'{role,title}','purpose',spec#>>'{role,purpose}');
  else
   for e in select value from jsonb_array_elements(spec->'edits') where value->>'key'=k loop
    if (length(new_content)-length(replace(new_content,e->>'old','')))/length(e->>'old')<>1 then raise exception 'bob_project_lead_unexpected_%',k; end if;
    new_content:=replace(new_content,e->>'old',e->>'new');
   end loop;
  end if;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','bob-project-lead-v1','project_lead_version',1),
    new_content,new_definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object(k,version_uuid);
 end loop;
 perform shared.activate_ai_catalog('bob',activation);
end $bob_project_lead$;
commit;
