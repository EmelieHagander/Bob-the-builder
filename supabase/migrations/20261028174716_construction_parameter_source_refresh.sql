-- Extend the existing bounded command; preserve old payloads and receipt keys.
-- A caller explicitly names the target revision. No implicit source rebasing.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $source_refresh$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('bob.prepare_construction_parameter_change(text,uuid,uuid,bigint,jsonb)'::regprocedure);
 old:=$old$node jsonb; ids text[]$old$;
 if position(old in definition)=0 then raise exception 'parameter_preparation_anchor_missing'; end if;
 definition:=replace(definition,old,'node jsonb; readiness jsonb; ids text[]');
 old:=$old$d-array['key','change_note','changes','computed']<>'{}' or (select count(*) from jsonb_object_keys(d))<>4$old$;
 replacement:=$new$d-array['key','change_note','changes','computed','target_revision']<>'{}'
  or (select count(*) from jsonb_object_keys(d))<>4+(case when d?'target_revision' then 1 else 0 end)
  or (d?'target_revision' and d->'target_revision'<>'null'::jsonb and
   (jsonb_typeof(d->'target_revision') is distinct from 'number' or coalesce(d->>'target_revision','')!~'^[1-9][0-9]{0,8}$'))$new$;
 if position(old in definition)=0 then raise exception 'parameter_shape_anchor_missing'; end if;
 definition:=replace(definition,old,replacement);
 old:='jsonb_array_length(d->''changes'') not between 1 and 128';
 replacement:=$new$jsonb_array_length(d->'changes') not between (case when coalesce(d->>'target_revision','')<>'' then 0 else 1 end) and 128$new$;
 if position(old in definition)=0 then raise exception 'parameter_changes_anchor_missing'; end if;
 definition:=replace(definition,old,replacement);
 old:=' for change in select value from jsonb_array_elements(d->''changes'') loop';
 replacement:=$new$ if d->>'target_revision' is not null then
  readiness:=bob.read_construction_readiness(p_project,draft->>'area_id',(d->>'target_revision')::integer,draft->'form_refinement');
  if readiness->>'status' is distinct from 'ready' then
   return jsonb_build_object('status',coalesce(readiness->>'status','unavailable'),'reason','construction_source_refresh_blocked',
    'artifact_id',draft->'artifact_id','revision',draft->'revision','target_revision',d->'target_revision','issues',readiness->'issues');
  end if;
 end if;
 for change in select value from jsonb_array_elements(d->'changes') loop$new$;
 if position(old in definition)=0 then raise exception 'parameter_readiness_anchor_missing'; end if;
 definition:=replace(definition,old,replacement);
 execute definition;

 -- This is the original parameter writer, renamed by the legacy-transition layer.
 -- Keep the full current wrapper chain and its concept/refinement constraints.
 definition:=pg_get_functiondef('bob_private.bob_project_write_before_legacy_transition(text,uuid,uuid,bigint,jsonb)'::regprocedure);
 old:=$old$draft:=prepared->'draft';old:=draft->'parameters';$old$;
 replacement:=$new$if prepared->>'status' is distinct from 'ready' then
  raise exception 'construction_source_refresh_blocked' using errcode='22023',detail=(prepared->'issues')::text;
 end if;
 draft:=prepared->'draft';old:=draft->'parameters';$new$;
 if position(old in definition)=0 then raise exception 'parameter_writer_ready_anchor_missing'; end if;
 definition:=replace(definition,old,replacement);
 old:=$old$'target_revision',draft->'target_revision'$old$;
 replacement:=$new$'target_revision',coalesce(nullif(d->'target_revision','null'::jsonb),draft->'target_revision')$new$;
 if position(old in definition)=0 then raise exception 'parameter_writer_target_anchor_missing'; end if;
 definition:=replace(definition,old,replacement);
 execute definition;
end $source_refresh$;
notify pgrst,'reload schema';
commit;
