-- Preserve exact visual feedback for older constructions with real box geometry
-- but no FORM concept model. Never manufacture component mappings or approval.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $legacy_construction_presentation$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('bob.record_construction_presentation(text,uuid,integer,text)'::regprocedure);
 old:=$old$ if (refinement is null or refinement='null'::jsonb) and exists(select 1 from jsonb_array_elements(c.recipe->'instances') i
  where not exists(select 1 from jsonb_array_elements(intent#>'{model,components}') part where part->'active'='true'::jsonb and part->>'id'=i->>'id'))
  then raise exception 'presentation_scope_unavailable' using errcode='22023';end if;
 -- For the older one-to-one contract, only components with an exact saved
 -- instance identity are shown. Unmapped historical solids cannot grant consent.
 select coalesce(jsonb_agg(jsonb_build_object('id',part->>'id','label',part->>'label') order by part->>'id'),'[]') into components
 from jsonb_array_elements(intent#>'{model,components}') part where part->'active'='true'::jsonb and
 case when refinement is not null and refinement<>'null'::jsonb
  then exists(select 1 from jsonb_array_elements(refinement->'mappings') m where m->>'component_id'=part->>'id')
  else exists(select 1 from jsonb_array_elements(c.recipe->'instances') i where i->>'id'=part->>'id') end;
 if jsonb_array_length(components)=0 then raise exception 'presentation_scope_unavailable' using errcode='22023';end if;$old$;
 replacement:=$new$ if (refinement is null or refinement='null'::jsonb) and not (intent ? 'model') then
  -- Virtual review scope, not a FORM component. Exact revision and view only.
  components:=jsonb_build_array(jsonb_build_object('id','unmapped_geometry',
   'label','Saved geometry (FORM component mapping not yet established)'));
 else
  if (refinement is null or refinement='null'::jsonb) and exists(select 1 from jsonb_array_elements(c.recipe->'instances') i
   where not exists(select 1 from jsonb_array_elements(intent#>'{model,components}') part where part->'active'='true'::jsonb and part->>'id'=i->>'id'))
   then raise exception 'presentation_scope_unavailable' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',part->>'id','label',part->>'label') order by part->>'id'),'[]') into components
  from jsonb_array_elements(intent#>'{model,components}') part where part->'active'='true'::jsonb and
  case when refinement is not null and refinement<>'null'::jsonb
   then exists(select 1 from jsonb_array_elements(refinement->'mappings') m where m->>'component_id'=part->>'id')
   else exists(select 1 from jsonb_array_elements(c.recipe->'instances') i where i->>'id'=part->>'id') end;
  if jsonb_array_length(components)=0 then raise exception 'presentation_scope_unavailable' using errcode='22023';end if;
 end if;$new$;
 if position(old in definition)=0 then raise exception 'legacy_construction_presentation_anchor_changed';end if;
 execute replace(definition,old,replacement);
end $legacy_construction_presentation$;
notify pgrst,'reload schema';
commit;
