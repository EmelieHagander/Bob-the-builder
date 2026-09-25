begin;
set local lock_timeout='5s';

-- Derive quantities only from the current saved assembly, never from model arithmetic.
-- The exact recipe remains pinned by artifact_id/artifact_revision in every revision.
create function bob_private.material_requirement_cad_command(p_project text,p_action text,p_requirement uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare drawing bob.artifact_cad_revisions; definition jsonb; n integer; mode text:=p_data->>'quantity_mode';
 quantity numeric; unit text; saved jsonb; v_basis text; payload jsonb; aid uuid; version integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action not in ('create','revise') or p_requirement is null or jsonb_typeof(p_data) is distinct from 'object'
  or octet_length(p_data::text)>30000 or p_data-array['name','category','area_id','task_id','waste_percent','purchase_increment','assumptions','artifact_id','artifact_revision','target_revision','stock_allocations','component_allocations','change_note','definition_id','quantity_mode']<>'{}'
  or coalesce(mode,'') not in ('pieces','length_x','length_y','length_z','area_xy','area_xz','area_yz') then raise exception 'invalid_cad_requirement'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 aid:=(p_data->>'artifact_id')::uuid; version:=(p_data->>'artifact_revision')::integer;
 select c.* into drawing from bob.artifact_cad_revisions c
 join bob.artifacts a on a.project_id=c.project_id and a.id=c.artifact_id and a.current_revision=c.artifact_revision
 join bob.artifact_revisions r on r.project_id=c.project_id and r.artifact_id=c.artifact_id and r.revision=c.artifact_revision
 where c.project_id=p_project and c.artifact_id=aid and c.artifact_revision=version and not r.archived;
 if not found then raise exception 'A current saved CAD drawing is required'; end if;
 if drawing.recipe->>'units'<>'mm' or drawing.recipe->>'contract_version'<>'1' then raise exception 'Unsupported CAD quantity contract'; end if;
 select d into definition from jsonb_array_elements(drawing.recipe->'definitions') d where d->>'id'=p_data->>'definition_id';
 select count(*) into n from jsonb_array_elements(drawing.recipe->'instances') i where i->>'definition_id'=p_data->>'definition_id';
 if definition is null or n not between 1 and 512 then raise exception 'Choose a used CAD part definition'; end if;
 if mode='pieces' then quantity:=n; unit:='pcs';
 elsif definition->>'primitive'='box' then
  if mode like 'length_%' then quantity:=n*(definition->>(right(mode,1)||'_mm'))::numeric/1000; unit:='m';
  else quantity:=n*(definition->>(substr(mode,6,1)||'_mm'))::numeric*(definition->>(substr(mode,7,1)||'_mm'))::numeric/1000000; unit:='m2'; end if;
 elsif definition->>'primitive' in ('tube','cylinder') and mode='length_z' then
  quantity:=n*(definition->>'length_mm')::numeric/1000; unit:='m';
 else raise exception 'Quantity mode is not supported for this CAD part'; end if;
 if quantity is null or quantity<=0 or quantity>1000000000 then raise exception 'Invalid CAD quantity'; end if;
 quantity:=ceil(quantity*10000)/10000;
 v_basis:=format('CAD blank quantity v1: artifact %s revision %s; definition %s; %s instances; %s = %s %s. Uses original stock dimensions before holes/notches. Material label: %s. Allowance is applied once by the material planner. Stock/reuse allocation requires confirmed specification and fit. This quantity is not cutting-stock optimization or a structural check.',aid,version,p_data->>'definition_id',n,mode,quantity,unit,coalesce(definition->>'material_ref','unspecified'));
 payload:=(p_data-array['definition_id','quantity_mode'])||jsonb_build_object('required_quantity',quantity::text,'unit',unit,'basis',v_basis);
 saved:=bob_private.material_requirement_command(p_project,p_action,p_requirement,p_expected,payload);
 update bob.material_requirement_revisions set source_kind='deterministic',method_key='cad_blank_'||mode,method_version='1',basis=v_basis
 where project_id=p_project and requirement_id=p_requirement and revision=(saved->>'revision')::integer;
 if not found then raise exception 'CAD quantity was not persisted'; end if;
 return saved;
end $$;
create function bob.material_requirement_cad_command(p_project text,p_action text,p_requirement uuid,p_expected integer,p_data jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select bob_private.material_requirement_cad_command(p_project,p_action,p_requirement,p_expected,p_data) $$;
revoke all on function bob_private.material_requirement_cad_command(text,text,uuid,integer,jsonb),bob.material_requirement_cad_command(text,text,uuid,integer,jsonb) from public,anon;
grant execute on function bob_private.material_requirement_cad_command(text,text,uuid,integer,jsonb),bob.material_requirement_cad_command(text,text,uuid,integer,jsonb) to authenticated;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('derive_cad_material_requirement','Derive a versioned material requirement from a saved CAD part and its actual instance count.','Read the saved drawing, target and existing requirements. Choose explicit part definition and blank quantity mode. The server calculates quantity; confirm stock specification/fit before allocating and publish to Shopping separately.',1,false,array['planning','build'],true);
commit;
