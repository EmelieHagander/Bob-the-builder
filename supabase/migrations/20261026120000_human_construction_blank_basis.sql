-- Human basis text for construction blank requirements (owner decision
-- 2026-10-26: human text holds only human prose; references are typed
-- relations). The previous body (20261011090115_construction_instance_roles.sql)
-- wrote artifact/definition/material IDs and revisions into the basis, which
-- material_requirement_construction_sources already records as typed links.
-- Only the basis sentence changes: authority, source, instance-role, quantity
-- and lineage checks, method identity and the typed source row are unchanged.
-- New writes only; existing requirement revisions keep their saved basis.

create or replace function bob_private.material_requirement_cad_command(p_project text,p_action text,p_requirement uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source bob.artifact_construction_revisions; head bob.artifacts; def jsonb; binding jsonb;
 n integer; quantity numeric; unit text; mode text:=p_data->>'quantity_mode'; state text; saved jsonb; payload jsonb; v_basis text; instances jsonb; v_title text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action is null or p_action not in ('create','revise') or p_requirement is null or p_expected is null
  or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>30000
  or p_data-array['name','category','area_id','task_id','waste_percent','purchase_increment','assumptions','artifact_id','artifact_revision','target_revision','stock_allocations','component_allocations','change_note','definition_id','quantity_mode']<>'{}'
  or coalesce(mode,'') not in ('pieces','length_x','length_y','length_z','area_xy','area_xz','area_yz')
  then raise exception 'invalid_cad_requirement' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select * into source from bob.artifact_construction_revisions where project_id=p_project
  and artifact_id=nullif(p_data->>'artifact_id','')::uuid and artifact_revision=nullif(p_data->>'artifact_revision','')::integer;
 if not found then raise exception 'construction_instance_roles_required' using errcode='22023'; end if;
 select * into head from bob.artifacts where id=source.artifact_id and project_id=p_project for share;
 if not found or head.current_revision<>source.artifact_revision
  or not exists(select 1 from bob.artifact_revisions where artifact_id=head.id and revision=head.current_revision and not archived)
  then raise exception 'construction_source_changed' using errcode='PT409'; end if;
 perform 1 from bob.catalog_items where id in (
  select (m->>'material_id')::uuid from jsonb_array_elements(source.materials) m union
  select (m->>'part_id')::uuid from jsonb_array_elements(source.materials) m where m->>'part_id' is not null) order by id for share;
 select s.source_state into state from bob_private.artifact_source_assessment(p_project,source.artifact_id,source.artifact_revision) s;
 if state is distinct from 'current' then raise exception 'construction_source_changed' using errcode='PT409'; end if;
 if p_data->'stock_allocations' is distinct from '[]'::jsonb or p_data->'component_allocations' is distinct from '[]'::jsonb
  then raise exception 'construction_cut_fit_required' using errcode='22023'; end if;
 select d into def from jsonb_array_elements(source.recipe->'definitions') d where d->>'id'=p_data->>'definition_id';
 select m into binding from jsonb_array_elements(source.materials) m where m->>'definition_id'=p_data->>'definition_id';
 select count(*),jsonb_agg(i->>'id' order by i->>'id') into n,instances from jsonb_array_elements(bob_private.construction_build_instances(source)) i where i->>'definition_id'=p_data->>'definition_id';
 if exists(
  select 1 from bob.material_requirement_construction_sources cs join bob.current_material_requirements r
   on r.id=cs.requirement_id and r.revision=cs.requirement_revision and r.project_id=cs.project_id
  where cs.project_id=p_project and cs.requirement_id<>p_requirement and cs.artifact_id=source.artifact_id and cs.definition_id=p_data->>'definition_id'
   and cs.quantity_mode=mode and not r.archived)
  then raise exception 'construction_requirement_exists' using errcode='PT409'; end if;
 if p_action='revise' and exists(
  select 1 from bob.material_requirement_construction_sources cs where cs.project_id=p_project and cs.requirement_id=p_requirement
   and cs.requirement_revision=p_expected and (cs.artifact_id<>source.artifact_id or cs.definition_id is distinct from p_data->>'definition_id' or cs.quantity_mode<>mode))
  then raise exception 'construction_requirement_identity_changed' using errcode='22023'; end if;
 if def is null or binding is null or n not between 1 and 512 or def->>'primitive'<>'box' or coalesce(jsonb_array_length(def->'cuts'),0)>0
  then raise exception 'unsupported_construction_blank' using errcode='22023'; end if;
 if mode='pieces' then quantity:=n;unit:='pcs';
 elsif mode like 'length_%' then quantity:=n*(def->>(right(mode,1)||'_mm'))::numeric/1000;unit:='m';
 else quantity:=n*(def->>(substr(mode,6,1)||'_mm'))::numeric*(def->>(substr(mode,7,1)||'_mm'))::numeric/1000000;unit:='m2'; end if;
 if quantity is null or quantity<=0 or quantity>1000000000 then raise exception 'invalid_construction_quantity' using errcode='22023'; end if;
 quantity:=ceil(quantity*10000)/10000;
 select r.title into v_title from bob.artifact_revisions r where r.artifact_id=source.artifact_id and r.revision=source.artifact_revision;
 v_basis:=format('Counted from the saved construction "%s": %s %s of %s x %s x %s mm%s. Each piece that is made counts once; kept, complete and reference items are left out. A concept need only: raw-stock format, saw cuts, grain, fit, hardware and assembly access are still open. This is not a purchase, a cutting layout or a fabrication approval.',
  coalesce(v_title,'construction'),n,case when n=1 then 'blank' else 'blanks' end,def->>'x_mm',def->>'y_mm',def->>'z_mm',
  case when mode='pieces' then '' else ', '||trim_scale(quantity)::text||' '||unit||' in total' end);
 if length(v_basis)>6000 then raise exception 'construction_basis_too_large' using errcode='22023'; end if;
 payload:=(p_data-array['definition_id','quantity_mode'])||jsonb_build_object('required_quantity',quantity::text,'unit',unit,'basis',v_basis);
 saved:=bob_private.material_requirement_command(p_project,p_action,p_requirement,p_expected,payload);
 update bob.material_requirement_revisions set source_kind='deterministic',method_key='construction_blank_'||mode,method_version='2',basis=v_basis
 where project_id=p_project and requirement_id=p_requirement and revision=(saved->>'revision')::integer;
 if not found then raise exception 'construction_quantity_not_persisted' using errcode='22023'; end if;
 insert into bob.material_requirement_construction_sources values(p_project,p_requirement,(saved->>'revision')::integer,
  source.artifact_id,source.artifact_revision,def->>'id',mode,instances,
  jsonb_build_object('x',def->'x_mm','y',def->'y_mm','z',def->'z_mm'),binding);
 return saved;
end $$;
