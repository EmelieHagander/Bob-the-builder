-- Shared narrative guidance, not an output quota or a delivery-format rule.
-- Keep the applied baseline seed and all saved manifests unchanged.
begin;
do $communication$
declare
  fragment_key text := 'communication.concise';
  fragment_id uuid;
  revision_id uuid;
  next_version integer;
  role_revision record;
  activation jsonb := '{}';
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
  insert into shared.ai_prompts(app,prompt_key,label,description,definition_kind)
  values('bob',fragment_key,'Kort och koncis kommunikation',
    'Mjuk vägledning för besked till beställaren och kollegorna.',
    'instruction_fragment')
  on conflict(app,prompt_key) do nothing;
  select id into fragment_id from shared.ai_prompts
    where app='bob' and prompt_key=fragment_key
      and definition_kind='instruction_fragment';
  if fragment_id is null then raise exception 'communication_fragment_kind_mismatch'; end if;
  select coalesce(max(version),0)+1 into next_version
    from shared.ai_prompt_versions where prompt_id=fragment_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,
    metadata,content,definition,flow,available_variables)
  values(fragment_id,next_version,'instruction_fragment',
    jsonb_build_object('label','Kort och koncis kommunikation',
      'purpose','Mjuk vägledning för besked till beställaren och kollegorna.'),
    'När du formulerar besked skriver du för någon mitt i arbetet, som kanske bara hinner läsa de sista två meningarna. Dina besked är korta och koncisa, med det viktigaste och nästa steg nära slutet.',
    '{}','', '[]')
  returning id into revision_id;
  activation := jsonb_build_object(fragment_key,revision_id);

  for role_revision in
    select p.prompt_key,v.* from shared.ai_prompts p
    join shared.ai_prompt_versions v on v.id=p.active_version_id
    where p.app='bob' and p.definition_kind='role'
    order by p.prompt_key
  loop
    if role_revision.definition->'prompt_keys' ? fragment_key then continue; end if;
    select coalesce(max(version),0)+1 into next_version
      from shared.ai_prompt_versions where prompt_id=role_revision.prompt_id;
    insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,
      definition_format_version,metadata,content,definition,flow,available_variables)
    values(role_revision.prompt_id,next_version,role_revision.definition_kind,
      role_revision.definition_format_version,role_revision.metadata,
      role_revision.content,
      jsonb_set(role_revision.definition,'{prompt_keys}',
        jsonb_insert(role_revision.definition->'prompt_keys','{1}',to_jsonb(fragment_key))),
      role_revision.flow,role_revision.available_variables)
    returning id into revision_id;
    activation := activation || jsonb_build_object(role_revision.prompt_key,revision_id);
  end loop;
  perform shared.activate_ai_catalog('bob',activation);
end $communication$;
commit;
