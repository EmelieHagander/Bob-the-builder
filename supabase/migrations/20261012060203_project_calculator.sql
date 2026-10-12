-- Common read-only calculation boundary. CLI migration new --help aborted
-- in the installed Bun runtime; filename uses the observed UTC fallback.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- One v1 purchase evaluator, used by the canonical writer AND exact replay.
create function bob_private.material_purchase_math_v1(q numeric,w numeric,inc numeric,stock numeric,reuse numeric)
returns table(required_with_waste numeric,net_quantity numeric,purchase_quantity numeric)
language plpgsql immutable strict security invoker set search_path='' as $$
begin
 if q<=0 or q>1000000000 or w<0 or w>100 or inc<=0 or inc>1000000000 or stock<0 or reuse<0
 then raise exception 'invalid_material_calculation' using errcode='22023'; end if;
 required_with_waste:=ceil(q*(1+w/100)*10000)/10000;
 net_quantity:=greatest(required_with_waste-stock-reuse,0);
 purchase_quantity:=ceil(net_quantity/inc)*inc;
 if purchase_quantity<>trunc(purchase_quantity,4) then purchase_quantity:=ceil(purchase_quantity*10000)/10000; end if;
 return next;
end $$;
revoke all on function bob_private.material_purchase_math_v1(numeric,numeric,numeric,numeric,numeric) from public,anon,service_role;
grant execute on function bob_private.material_purchase_math_v1(numeric,numeric,numeric,numeric,numeric) to authenticated;

-- Preserve the writer's locks/authority/ABI and all other domain operations.
-- An unexpected upstream body stops the migration rather than patching a guess.
do $extract_purchase_math$
declare definition text; original text:=$original_purchase_math$    r.required_with_waste := ceil(r.required_quantity*(1+r.waste_percent/100)*10000)/10000;
    r.stock_quantity := stock_total;
    r.component_quantity := component_total;
    net := greatest(r.required_with_waste-stock_total-component_total,0);
    r.purchase_quantity := ceil(net/r.purchase_increment)*r.purchase_increment;
    if r.purchase_quantity<>trunc(r.purchase_quantity,4) then
      r.purchase_quantity := ceil(r.purchase_quantity*10000)/10000;
    end if;$original_purchase_math$;
 replacement text:=$replacement_purchase_math$    r.stock_quantity := stock_total;
    r.component_quantity := component_total;
    select m.required_with_waste,m.net_quantity,m.purchase_quantity
      into r.required_with_waste,net,r.purchase_quantity
      from bob_private.material_purchase_math_v1(r.required_quantity,r.waste_percent,r.purchase_increment,stock_total,component_total) m;$replacement_purchase_math$;
begin
 select pg_get_functiondef('bob_private.material_requirement_before_construction_fit(text,text,uuid,integer,jsonb)'::regprocedure) into definition;
 if length(definition)-length(replace(definition,original,''))<>length(original) then raise exception 'calculator_purchase_writer_mismatch'; end if;
 execute replace(definition,original,replacement);
end $extract_purchase_math$;

create function bob.read_calculation_source(p_project text,p_kind text,p_id uuid,p_revision integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare record_json jsonb; current_revision integer; archived boolean; state text; r bob.material_requirement_revisions;
 current_need bob.current_material_requirements; math record; cs bob.material_requirement_construction_sources;
 replay jsonb; base_value numeric; base_unit text; n integer; mode text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_kind not in ('plan','stair','material') or p_id is null or p_revision is null or p_revision<1
 then raise exception 'invalid_calculation_source' using errcode='22023'; end if;
 if p_kind='plan' then
  select to_jsonb(d),h.current_revision,a.archived into record_json,current_revision,archived
   from bob.artifact_multifloor_details d join bob.artifacts h on h.id=d.artifact_id and h.project_id=d.project_id
   join bob.artifact_revisions a on a.artifact_id=d.artifact_id and a.revision=d.artifact_revision
   where d.project_id=p_project and d.artifact_id=p_id and d.artifact_revision=p_revision;
 elsif p_kind='stair' then
  select to_jsonb(d),h.current_revision,a.archived into record_json,current_revision,archived
   from bob.artifact_stair_details d join bob.artifacts h on h.id=d.artifact_id and h.project_id=d.project_id
   join bob.artifact_revisions a on a.artifact_id=d.artifact_id and a.revision=d.artifact_revision
   where d.project_id=p_project and d.artifact_id=p_id and d.artifact_revision=p_revision;
 else
  select * into r from bob.material_requirement_revisions where project_id=p_project and requirement_id=p_id and revision=p_revision;
  if found then
   select * into current_need from bob.current_material_requirements where project_id=p_project and id=p_id;
   if not found then raise exception 'calculation_source_unavailable' using errcode='P0002'; end if;
   select * into math from bob_private.material_purchase_math_v1(r.required_quantity,r.waste_percent,r.purchase_increment,r.stock_quantity,r.component_quantity);
   if math.required_with_waste<>r.required_with_waste or math.purchase_quantity<>r.purchase_quantity
   then raise exception 'saved_material_calculation_mismatch' using errcode='22023'; end if;
   replay:=jsonb_build_object('status','stored_only','method',r.method_key,'version',r.method_version,
    'value',r.required_quantity,'unit',r.unit,'source_kind',r.source_kind);
   if r.source_kind='manual' then replay:=replay||jsonb_build_object('status','manual','calculated',false);
   elsif r.method_key like 'construction_blank_%' and r.method_version in ('1','2') then
    select * into cs from bob.material_requirement_construction_sources where project_id=p_project and requirement_id=p_id and requirement_revision=p_revision;
    if not found then raise exception 'calculation_source_unavailable' using errcode='P0002'; end if;
    mode:=cs.quantity_mode;n:=jsonb_array_length(cs.instance_ids);
    if mode='pieces' then base_value:=n;base_unit:='pcs';
    elsif mode like 'length_%' then base_value:=n*(cs.blank_mm->>right(mode,1))::numeric/1000;base_unit:='m';
    else base_value:=n*(cs.blank_mm->>substr(mode,6,1))::numeric*(cs.blank_mm->>substr(mode,7,1))::numeric/1000000;base_unit:='m2';end if;
    base_value:=ceil(base_value*10000)/10000;
    if base_value is null or base_value<>r.required_quantity or base_unit<>r.unit then raise exception 'saved_material_base_mismatch' using errcode='22023';end if;
    replay:=replay||jsonb_build_object('status','replayed','value',base_value,'rounding','ceil_4',
     'source',to_jsonb(cs),'instance_semantics',case when r.method_version='1' then 'all_saved_instances_v1' else 'manufacture_snapshot_v2' end);
   end if;
   state:=case when current_need.revision=p_revision and not current_need.archived and not current_need.target_changed
    and not current_need.artifact_changed and not current_need.stock_changed and not current_need.component_changed then 'current' else 'changed' end;
   return jsonb_build_object('status','ok','project_id',p_project,'id',p_id,'revision',p_revision,'current_revision',current_need.revision,'source_state',state,
    'calculation',jsonb_build_object('base_provenance',replay,'inputs',jsonb_build_array(
     jsonb_build_object('id','required_quantity','value',r.required_quantity,'unit',r.unit,'role',r.source_kind,'method',r.method_key,'method_version',r.method_version),
     jsonb_build_object('id','waste_percent','value',r.waste_percent,'unit','percent','role','decision'),
     jsonb_build_object('id','purchase_increment','value',r.purchase_increment,'unit',r.unit,'role','decision'),
     jsonb_build_object('id','stock_quantity','value',r.stock_quantity,'unit',r.unit,'role','saved_allocation'),
     jsonb_build_object('id','component_quantity','value',r.component_quantity,'unit',r.unit,'role','saved_allocation')),
     'source',jsonb_build_object('kind','material_requirement','id',p_id,'revision',p_revision),
     'dependencies',jsonb_build_array(
      jsonb_build_object('id','required_with_waste','operation','material_allowance_v1','operands',jsonb_build_array('required_quantity','waste_percent'),'rounding','ceil_4'),
      jsonb_build_object('id','net_quantity','operation','subtract_allocations_clamp_zero_v1','operands',jsonb_build_array('required_with_waste','stock_quantity','component_quantity'),'rounding','exact'),
      jsonb_build_object('id','purchase_quantity','operation','purchase_increment_ceiling_v1','operands',jsonb_build_array('net_quantity','purchase_increment'),'rounding','increment_then_ceil_4')),
     'outputs',jsonb_build_array(
      jsonb_build_object('id','required_with_waste','value',math.required_with_waste,'unit',r.unit,'rounding','ceil_4'),
      jsonb_build_object('id','net_quantity','value',math.net_quantity,'unit',r.unit,'rounding','exact'),
      jsonb_build_object('id','purchase_quantity','value',math.purchase_quantity,'unit',r.unit,'rounding','increment_then_ceil_4'))));
  end if;
 end if;
 if record_json is null then return jsonb_build_object('status','not_found','project_id',p_project);end if;
 state:=case when current_revision=p_revision and not archived and not coalesce((record_json->>'sources_changed')::boolean,true)
  and not coalesce((record_json->>'physical_pending')::boolean,(record_json#>>'{plan,physical_pending}')::boolean,false) then 'current' else 'changed' end;
 return jsonb_build_object('status','ok','project_id',p_project,'id',p_id,'revision',p_revision,'current_revision',current_revision,'source_state',state,'record',record_json);
end $$;
revoke all on function bob.read_calculation_source(text,text,uuid,integer) from public,anon,service_role;
grant execute on function bob.read_calculation_source(text,text,uuid,integer) to authenticated;
commit;
