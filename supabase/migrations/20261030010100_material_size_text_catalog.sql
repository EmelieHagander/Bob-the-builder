-- Owner decision 2026-10-30: the material search text names the size columns as
-- they now are (diameter_mm for fasteners and tubes, depth_mm for thickness and
-- a tube's wall) and the length per piece of household stock.
-- Apply after 20261030010000_material_sizes_diameter_and_details.sql. No Edge
-- runtime change. Existing manifests remain pinned.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $material_size_text_publication$
declare specs jsonb:=$material_size_text_spec$[{"key":"tools.search_material_catalog","replacements":[["size in mm (fasteners: width_mm is the shank diameter)","size in mm (depth_mm is the thickness or a tube's wall; diameter_mm a fastener's shank or a tube's outside diameter)"],["the caller's household stock at home","the caller's household stock at home (piece_length_mm when counted in pieces of one length)"]]}]$material_size_text_spec$::jsonb;
 item jsonb; prior shared.ai_prompt_versions; definition jsonb; replacement jsonb; field text; matched boolean;
 next_version integer; version_uuid uuid; activation jsonb:='{}';
begin
 perform pg_advisory_xact_lock(hashtextextended('ai_catalog:bob',0));
 for item in select value from jsonb_array_elements(specs) loop
  select v.* into prior from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id
   where p.app='bob' and p.prompt_key=item->>'key' and p.retired_at is null for update of p;
  if not found then raise exception 'material_size_text_contract_missing: %',item->>'key'; end if;
  if prior.metadata->>'material_size_text_version'='1' then continue; end if;
  definition:=prior.definition;
  -- Every replaced sentence must exist; a drifted text stops the publication.
  for replacement in select value from jsonb_array_elements(item->'replacements') loop
   matched:=false;
   foreach field in array array['description','additional_description','card_description'] loop
    if definition ? field and position(replacement->>0 in definition->>field)>0 then
     definition:=jsonb_set(definition,array[field],to_jsonb(replace(definition->>field,replacement->>0,replacement->>1)));matched:=true;
    end if;
   end loop;
   if not matched then raise exception 'material_size_text_missing: %',item->>'key'; end if;
  end loop;
  select coalesce(max(version),0)+1 into next_version from shared.ai_prompt_versions where prompt_id=prior.prompt_id;
  insert into shared.ai_prompt_versions(prompt_id,version,definition_kind,definition_format_version,metadata,content,definition,flow,available_variables)
   values(prior.prompt_id,next_version,prior.definition_kind,prior.definition_format_version,
    (prior.metadata-'seed_version'-'source_revision')||jsonb_build_object('publication','material-size-text-v1','material_size_text_version',1),
    prior.content,definition,prior.flow,prior.available_variables) returning id into version_uuid;
  activation:=activation||jsonb_build_object(item->>'key',version_uuid);
 end loop;
 if activation<>'{}'::jsonb then perform shared.activate_ai_catalog('bob',activation); end if;
end $material_size_text_publication$;
commit;
