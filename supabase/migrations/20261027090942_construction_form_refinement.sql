-- FORM checkpoint scope. CLI 2.117.0 aborts during migration new --help;
-- filename uses the observed UTC clock. No hosted migration is applied here.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.artifact_construction_refinements (
 project_id text not null, artifact_id uuid not null, artifact_revision integer not null,
 refinement jsonb not null check(octet_length(refinement::text)<=48000),
 primary key(artifact_id,artifact_revision),
 foreign key(project_id,artifact_id,artifact_revision) references bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision) on delete cascade
);
create index construction_refinement_project_idx on bob.artifact_construction_refinements(project_id,artifact_id,artifact_revision);
alter table bob.artifact_construction_refinements enable row level security;
revoke all on bob.artifact_construction_refinements from public,anon,authenticated,service_role;
grant select on bob.artifact_construction_refinements to authenticated;
create policy project_read on bob.artifact_construction_refinements for select to authenticated using(bob_private.has_project_access(project_id));
create trigger construction_refinement_immutable before update on bob.artifact_construction_refinements for each row execute function bob_private.construction_immutable();

-- Canonical links and their conservative dependency closure, never caller
-- geometry_dependency=false or omitted parts alone, establish pending choices.
create function bob_private.construction_form_scope(intent jsonb, refinement jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare m jsonb; component jsonb; n jsonb; c jsonb; s text; selected text[]:='{}'; affected text[]; instances text[]:='{}'; nodes text[]:='{}'; features text[]:='{}'; before_count integer; boxes jsonb; box jsonb;
 component_ids jsonb; pending_components jsonb; pending_choices jsonb:='[]'; linked jsonb;
begin
 if not bob_private.concept_keys(refinement,array['version','mappings']) or refinement->'version' is distinct from '1'::jsonb
  or jsonb_typeof(refinement->'mappings') is distinct from 'array' or jsonb_array_length(refinement->'mappings') not between 1 and 48
  or intent->'model' is null then raise exception 'invalid_form_refinement' using errcode='22023'; end if;
 for m in select value from jsonb_array_elements(refinement->'mappings') loop
  if not bob_private.concept_keys(m,array['component_id','instance_ids']) or coalesce(m->>'component_id','')!~'^[A-Za-z][A-Za-z0-9_-]{0,31}$'
   or m->>'component_id'=any(selected) or jsonb_typeof(m->'instance_ids') is distinct from 'array' or jsonb_array_length(m->'instance_ids') not between 1 and 128
   then raise exception 'invalid_form_refinement' using errcode='22023'; end if;
  select value into component from jsonb_array_elements(intent#>'{model,components}') where value->>'id'=m->>'component_id' and value->'active'='true'::jsonb;
  if not found then raise exception 'invalid_form_refinement' using errcode='22023'; end if;
  selected:=array_append(selected,m->>'component_id');
  for n in select value from jsonb_array_elements(m->'instance_ids') loop
   s:=n#>>'{}';
   if jsonb_typeof(n) is distinct from 'string' or s!~'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$' or s=any(instances) then raise exception 'invalid_form_refinement' using errcode='22023'; end if;
   instances:=array_append(instances,s);
  end loop;
  nodes:=nodes||array(select jsonb_array_elements_text((component->'position')||(component->'size')));
  features:=features||array(select jsonb_array_elements_text(component->'features'));
 end loop;
 select array_agg(distinct v) into nodes from unnest(nodes) v;
 select coalesce(array_agg(distinct v),'{}') into features from unnest(features) v;
 affected:=selected; boxes:=bob_private.solution_concept_result(intent)->'boxes';
 loop
  before_count:=cardinality(nodes)+cardinality(features)+cardinality(affected);
  for n in select value from jsonb_array_elements(intent#>'{model,nodes}') where value->>'role'='derived' loop
   if n->>'id'=any(nodes) or exists(select 1 from jsonb_array_elements_text(n->'operands') v where v=any(nodes)) then
    nodes:=nodes||array[n->>'id']||array(select jsonb_array_elements_text(n->'operands'));
   end if;
  end loop;
  for c in select value from jsonb_array_elements(intent#>'{model,constraints}') where value->>'relation'<>'view_plane' loop
   if c->>'left'=any(nodes) or c->>'right'=any(nodes) then nodes:=nodes||array[c->>'left',c->>'right']; end if;
  end loop;
  for component in select value from jsonb_array_elements(intent#>'{model,components}') where value->'active'='true' loop
   select value into box from jsonb_array_elements(boxes) where value->>'id'=component->>'id';
   if exists(select 1 from jsonb_array_elements_text(component->'features') f where f=any(features))
    or exists(select 1 from jsonb_array_elements_text((component->'position')||(component->'size')) dep where dep=any(nodes))
    or exists(select 1 from jsonb_array_elements(boxes) neighbor where neighbor->>'id'=any(affected) and box is not null and not exists(
     select 1 from generate_series(0,2) axis where (box->'min'->>axis)::numeric>(neighbor->'min'->>axis)::numeric+(neighbor->'size_mm'->>axis)::numeric
      or (neighbor->'min'->>axis)::numeric>(box->'min'->>axis)::numeric+(box->'size_mm'->>axis)::numeric)) then
    affected:=array_append(affected,component->>'id');
    nodes:=nodes||array(select jsonb_array_elements_text((component->'position')||(component->'size')));
    features:=features||array(select jsonb_array_elements_text(component->'features'));
   end if;
  end loop;
  select array_agg(distinct v) into nodes from unnest(nodes) v;
  select array_agg(distinct v) into affected from unnest(affected) v;
  select coalesce(array_agg(distinct v),'{}') into features from unnest(features) v;
  exit when cardinality(nodes)+cardinality(features)+cardinality(affected)=before_count;
 end loop;
 select coalesce(jsonb_agg(p->>'id' order by ord),'[]') into component_ids from jsonb_array_elements(intent#>'{model,components}') with ordinality x(p,ord) where p->'active'='true' and p->>'id'=any(selected);
 select coalesce(jsonb_agg(p->>'id' order by ord),'[]') into pending_components from jsonb_array_elements(intent#>'{model,components}') with ordinality x(p,ord) where p->'active'='true' and not p->>'id'=any(selected);
 for c in select value from jsonb_array_elements(intent->'choices') where value->>'status'<>'resolved' loop
  select coalesce(jsonb_agg(p),'[]') into linked from jsonb_array_elements(intent#>'{model,components}') p where p->'active'='true' and (p->'choices')?(c->>'id');
  if jsonb_array_length(linked)>0 and not exists(select 1 from jsonb_array_elements(linked) p where p->>'id'=any(affected)) then
   pending_choices:=pending_choices||jsonb_build_array(c->>'id');
  end if;
 end loop;
 return jsonb_build_object('component_ids',component_ids,'pending_component_ids',pending_components,'pending_choice_ids',pending_choices,'verification','unverified');
end $$;
revoke all on function bob_private.construction_form_scope(jsonb,jsonb) from public,anon,service_role;
grant execute on function bob_private.construction_form_scope(jsonb,jsonb) to authenticated;

create function bob.read_construction_readiness(p_project text,p_area text,p_target_revision integer,p_form_refinement jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare design jsonb; scope jsonb; issues jsonb; state text;
begin
 design:=bob.read_design_readiness(p_project,p_area,p_target_revision,'construction');
 if p_form_refinement is null or p_form_refinement='null'::jsonb or design->'design_intent'='null'::jsonb then
  return jsonb_build_object('status',design->'status','issues',design->'issues','form_scope',null,'design_readiness',design);
 end if;
 scope:=bob_private.construction_form_scope(design->'design_intent',p_form_refinement);
 select coalesce(jsonb_agg(i order by ord),'[]') into issues from jsonb_array_elements(design->'issues') with ordinality x(i,ord)
  where not (i->>'code' in ('design_choice_open','design_geometry_choice_open','design_deferral_out_of_scope') and coalesce((scope->'pending_choice_ids')?(i->>'choice_id'),false));
 state:=case when design->>'status' in ('conflict','unavailable') then design->>'status' when jsonb_array_length(issues)>0 then 'needs_data' else 'ready' end;
 return jsonb_build_object('status',state,'issues',issues,'form_scope',scope,'design_readiness',design);
end $$;
revoke all on function bob.read_construction_readiness(text,text,integer,jsonb) from public,anon,service_role;
grant execute on function bob.read_construction_readiness(text,text,integer,jsonb) to authenticated;

create function bob_private.check_construction_form(intent jsonb, recipe jsonb, policy jsonb, refinement jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb; m jsonb; box jsonb; i jsonb; d jsonb; instance_id text; lo numeric[]; hi numeric[]; at_value numeric; size_value numeric; k integer; mapped text[];
begin
 perform bob_private.construction_form_scope(intent,refinement);
 result:=bob_private.solution_concept_result(intent);
 if jsonb_array_length(result->'issues')>0 then raise exception 'concept_reconciliation_required' using errcode='22023'; end if;
 select array_agg(id) into mapped from jsonb_array_elements(refinement->'mappings') map_entry cross join lateral jsonb_array_elements_text(map_entry->'instance_ids') id;
 if cardinality(mapped)<>jsonb_array_length(recipe->'instances') or exists(select 1 from jsonb_array_elements(recipe->'instances') inst where not inst->>'id'=any(mapped)) then raise exception 'form_instance_unmapped' using errcode='22023'; end if;
 for m in select value from jsonb_array_elements(refinement->'mappings') loop
  select value into box from jsonb_array_elements(result->'boxes') where value->>'id'=m->>'component_id';
  lo:=array[null::numeric,null,null]; hi:=lo;
  for instance_id in select jsonb_array_elements_text(m->'instance_ids') loop
   select value into i from jsonb_array_elements(recipe->'instances') where value->>'id'=instance_id;
   if i is null then raise exception 'form_instance_missing' using errcode='22023'; end if;
   select value into d from jsonb_array_elements(recipe->'definitions') where value->>'id'=i->>'definition_id';
   if d->>'primitive' is distinct from 'box' or jsonb_array_length(coalesce(d->'cuts','[]'))>0 or exists(select 1 from unnest(array['rx','ry','rz']) a where (i->'placement'->>a)::numeric<>0) then raise exception 'concept_mapping_unsupported' using errcode='22023'; end if;
   for k in 1..3 loop
    at_value:=(i->'placement'->>(array['x','y','z'])[k])::numeric; size_value:=(d->>(array['x_mm','y_mm','z_mm'])[k])::numeric;
    lo[k]:=least(lo[k],at_value); hi[k]:=greatest(hi[k],at_value+size_value);
   end loop;
   if (box->>'kind'<>'solid') is distinct from exists(select 1 from jsonb_array_elements(policy->'instances') p where p->>'instance_id'=instance_id and p->>'role'='reference') then raise exception 'concept_geometry_changed' using errcode='22023'; end if;
  end loop;
  for k in 1..3 loop
   if lo[k] is distinct from (box->'min'->>(k-1))::numeric or abs(hi[k]-((box->'min'->>(k-1))::numeric+(box->'size_mm'->>(k-1))::numeric))>0.0000001 then raise exception 'concept_geometry_changed' using errcode='22023'; end if;
  end loop;
 end loop;
end $$;
revoke all on function bob_private.check_construction_form(jsonb,jsonb,jsonb,jsonb) from public,anon,service_role;
grant execute on function bob_private.check_construction_form(jsonb,jsonb,jsonb,jsonb) to authenticated;

-- The existing readiness seam owns every construction write, including deltas.
-- Omitted scope inherits the exact preceding revision. Explicit JSON null asks
-- for the old complete handoff and must pass its full readiness/mapping gates.
create or replace function bob_private.bob_project_write_before_parameter_changes(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare readiness jsonb; existing bob_private.bob_write_receipts; op text; refinement jsonb; result jsonb; inner_payload jsonb;
begin
 if p_payload->>'kind' is distinct from 'construction' then return bob_private.bob_project_write_before_design_readiness(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 op:='construction:'||(p_payload->'data'->>'key');
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='PT409'; end if;
  return existing.receipt;
 end if;
 if (p_payload->'data')?'form_refinement' then refinement:=p_payload#>'{data,form_refinement}';
 else select r.refinement into refinement from bob.artifact_construction_refinements r where r.project_id=p_project and r.artifact_id=(p_payload->>'record_id')::uuid and r.artifact_revision=(p_payload->>'expected_revision')::integer; end if;
 readiness:=bob.read_construction_readiness(p_project,p_payload#>>'{data,area_id}',(p_payload#>>'{data,target_revision}')::integer,refinement);
 if readiness->>'status' is distinct from 'ready' then raise exception 'design_readiness_required' using errcode='22023',detail=(readiness->'issues')::text; end if;
 perform 1 from bob.media_assets where project_id=p_project and id in (select (ref->>'image_id')::uuid from jsonb_array_elements(readiness#>'{design_readiness,design_intent,references}') ref) order by id for update;
 readiness:=bob.read_construction_readiness(p_project,p_payload#>>'{data,area_id}',(p_payload#>>'{data,target_revision}')::integer,refinement);
 if readiness->>'status' is distinct from 'ready' then raise exception 'design_readiness_required' using errcode='22023',detail=(readiness->'issues')::text; end if;
 inner_payload:=jsonb_set(p_payload,'{data}',(p_payload->'data')-'form_refinement');
 result:=bob_private.bob_project_write_before_design_readiness(p_project,p_thread,p_turn,p_generation,inner_payload);
 if refinement is not null then
  insert into bob.artifact_construction_refinements values(p_project,(result->>'recordId')::uuid,(result->>'revision')::integer,refinement);
 end if;
 update bob_private.bob_write_receipts set payload=p_payload where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 return result;
end $$;
revoke all on function bob_private.bob_project_write_before_parameter_changes(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;

-- Lifecycle copies retain the exact scope. A tombstone (JSON null) prevents an
-- explicit transition to the complete contract from inheriting its old scope.
create function bob_private.inherit_construction_refinement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from bob.artifact_construction_refinements where artifact_id=new.artifact_id and artifact_revision=new.artifact_revision) then
  insert into bob.artifact_construction_refinements select project_id,artifact_id,new.artifact_revision,refinement from bob.artifact_construction_refinements
   where project_id=new.project_id and artifact_id=new.artifact_id and artifact_revision=new.artifact_revision-1;
 end if;
 return new;
end $$;
revoke all on function bob_private.inherit_construction_refinement() from public,anon,authenticated,service_role;
create constraint trigger a_inherit_construction_refinement after insert on bob.artifact_construction_revisions deferrable initially deferred for each row execute function bob_private.inherit_construction_refinement();

-- Retain the exact legacy mapping when there is no explicit refinement.
do $patch$
declare def text; anchor text:='result:=bob_private.solution_concept_result(intent);';
begin
 def:=pg_get_functiondef('bob_private.validate_construction_concept()'::regprocedure);
 if position(anchor in def)=0 then raise exception 'construction_concept_validator_changed'; end if;
 def:=replace(def,anchor,$scope$
 if exists(select 1 from bob.artifact_construction_refinements r where r.project_id=new.project_id and r.artifact_id=new.artifact_id and r.artifact_revision=new.artifact_revision and r.refinement<>'null'::jsonb) then
  perform bob_private.check_construction_form(intent,new.recipe,
   (select p.policy from bob.artifact_construction_instance_policies p where p.project_id=new.project_id and p.artifact_id=new.artifact_id and p.artifact_revision=new.artifact_revision),
   (select r.refinement from bob.artifact_construction_refinements r where r.project_id=new.project_id and r.artifact_id=new.artifact_id and r.artifact_revision=new.artifact_revision));
  return new;
 end if;
 result:=bob_private.solution_concept_result(intent);$scope$);
 execute def;
 -- A forged concept_ready in a direct CAD payload cannot publish this work.
 def:=pg_get_functiondef('bob_private.validate_cad_construction_source()'::regprocedure);
 anchor:='if not found then raise exception ''construction_source_unavailable'' using errcode=''22023''; end if;';
 if position(anchor in def)=0 then raise exception 'construction_cad_validator_changed'; end if;
 execute replace(def,anchor,anchor||$gate$
 if exists(select 1 from bob.artifact_construction_refinements r where r.project_id=new.project_id and r.artifact_id=source.artifact_id and r.artifact_revision=source.artifact_revision and r.refinement<>'null'::jsonb) then
  raise exception 'form_refinement_unverified' using errcode='22023';
 end if;$gate$);
 -- Manufacturing quantities/cut plans also remain closed. The schedule reader
 -- may still describe a checkpoint, but it cannot become a purchase source.
 def:=pg_get_functiondef('bob_private.construction_build_instances(bob.artifact_construction_revisions)'::regprocedure);
 anchor:='select policy into p from bob.artifact_construction_instance_policies';
 if position(anchor in def)=0 then raise exception 'construction_quantity_validator_changed'; end if;
 execute replace(def,anchor,$gate$
 if exists(select 1 from bob.artifact_construction_refinements r where r.project_id=c.project_id and r.artifact_id=c.artifact_id and r.artifact_revision=c.artifact_revision and r.refinement<>'null'::jsonb) then
  raise exception 'form_refinement_unverified' using errcode='22023';
 end if;
 select policy into p from bob.artifact_construction_instance_policies$gate$);
 def:=pg_get_functiondef('bob_private.material_requirement_cad_command(text,text,uuid,integer,jsonb)'::regprocedure);
 anchor:='if jsonb_typeof(p_data)=''object'' and p_data->>''quantity_mode'' in (''fasteners'',''glue'') then';
 if position(anchor in def)=0 then raise exception 'construction_requirement_validator_changed'; end if;
 execute replace(def,anchor,$gate$
 if exists(select 1 from bob.artifact_construction_refinements r where r.project_id=p_project and r.artifact_id=nullif(p_data->>'artifact_id','')::uuid and r.artifact_revision=nullif(p_data->>'artifact_revision','')::integer and r.refinement<>'null'::jsonb) then
  raise exception 'form_refinement_unverified' using errcode='22023';
 end if;
 $gate$||anchor);
end $patch$;

alter function bob.read_construction_draft(text,uuid,integer,uuid) rename to read_construction_before_form_refinement;
alter function bob.read_construction_before_form_refinement(text,uuid,integer,uuid) set schema bob_private;
revoke all on function bob_private.read_construction_before_form_refinement(text,uuid,integer,uuid) from public,anon,service_role;
grant execute on function bob_private.read_construction_before_form_refinement(text,uuid,integer,uuid) to authenticated;
create function bob.read_construction_draft(p_project text,p_artifact uuid default null,p_revision integer default null,p_after uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; refinement jsonb;
begin
 result:=bob_private.read_construction_before_form_refinement(p_project,p_artifact,p_revision,p_after);
 if result->>'status'='ok' and p_artifact is not null then
  select r.refinement into refinement from bob.artifact_construction_refinements r where r.project_id=p_project and r.artifact_id=p_artifact and r.artifact_revision=(result->>'revision')::integer;
  if refinement is not null and refinement<>'null'::jsonb then
   result:=result||jsonb_build_object('form_refinement',refinement,'form_scope',bob_private.construction_form_scope(result->'design_intent',refinement));
  end if;
 end if;
 return result;
end $$;
revoke all on function bob.read_construction_draft(text,uuid,integer,uuid) from public,anon,service_role;
grant execute on function bob.read_construction_draft(text,uuid,integer,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
