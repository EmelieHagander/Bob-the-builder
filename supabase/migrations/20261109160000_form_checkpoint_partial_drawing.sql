-- Owner decision 2026-11-09 ("Ja, märkt som delritning"): a FORM checkpoint
-- (for example walls only) may be published as a labelled partial drawing.
-- The drawing carries manifest.bob_form_checkpoint, and its pinned check may
-- hold only form_refinement_unverified plus, at most, one form_components_pending
-- issue whose ids equal the label. Quantities, cut plans and purchases keep
-- their form_refinement_unverified gates unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.cad_form_checkpoint_valid(p_check jsonb, p_label jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(
  jsonb_typeof(p_label)='object'
  and (select count(*) from jsonb_object_keys(p_label))=2
  and p_label->'version'='1'::jsonb
  and jsonb_typeof(p_label->'pending_component_ids')='array'
  and not exists(select 1 from jsonb_array_elements(p_label->'pending_component_ids') e where jsonb_typeof(e)<>'string')
  and p_check->'concept_ready'='false'::jsonb
  and jsonb_typeof(p_check->'issues')='array'
  and p_check->'issue_count'=to_jsonb(jsonb_array_length(p_check->'issues'))
  and not exists(select 1 from jsonb_array_elements(p_check->'issues') i where i->>'code' is null or i->>'code' not in ('form_components_pending','form_refinement_unverified'))
  and (select count(*) from jsonb_array_elements(p_check->'issues') i where i->>'code'='form_refinement_unverified')=1
  and (select count(*) from jsonb_array_elements(p_check->'issues') i where i->>'code'='form_components_pending')<=1
  and coalesce((select i->'ids' from jsonb_array_elements(p_check->'issues') i where i->>'code'='form_components_pending'),'[]'::jsonb)=p_label->'pending_component_ids'
 ,false)
$$;
revoke all on function bob_private.cad_form_checkpoint_valid(jsonb,jsonb) from public,anon,authenticated;

do $patch$
declare def text:=pg_get_functiondef('bob_private.validate_cad_construction_source()'::regprocedure);
 old_check text:=$o$  or pin->'check'->'concept_ready' is distinct from 'true'::jsonb or pin->'check'->'fabrication_ready' is distinct from 'false'::jsonb
  or pin->'check'->'issue_count' is distinct from '0'::jsonb or pin->'check'->'issues' is distinct from '[]'::jsonb$o$;
 new_check text:=$o$  or pin->'check'->'fabrication_ready' is distinct from 'false'::jsonb
  or (case when new.manifest ? 'bob_form_checkpoint' then pin->'check'->'concept_ready' is distinct from 'false'::jsonb
   else pin->'check'->'concept_ready' is distinct from 'true'::jsonb or pin->'check'->'issue_count' is distinct from '0'::jsonb or pin->'check'->'issues' is distinct from '[]'::jsonb end)$o$;
 old_gate text:=$o$ if exists(select 1 from bob.artifact_construction_refinements r where r.project_id=new.project_id and r.artifact_id=source.artifact_id and r.artifact_revision=source.artifact_revision and r.refinement<>'null'::jsonb) then
  raise exception 'form_refinement_unverified' using errcode='22023';
 end if;$o$;
 new_gate text:=$o$ if exists(select 1 from bob.artifact_construction_refinements r where r.project_id=new.project_id and r.artifact_id=source.artifact_id and r.artifact_revision=source.artifact_revision and r.refinement<>'null'::jsonb) then
  if not bob_private.cad_form_checkpoint_valid(pin->'check',new.manifest->'bob_form_checkpoint') then
   raise exception 'form_refinement_unverified' using errcode='22023';
  end if;
 elsif new.manifest ? 'bob_form_checkpoint' then
  raise exception 'invalid_construction_check' using errcode='22023';
 end if;$o$;
begin
 if position(old_check in def)=0 or position(old_gate in def)=0 then raise exception 'construction_cad_validator_changed'; end if;
 execute replace(replace(def,old_check,new_check),old_gate,new_gate);
end $patch$;
commit;
