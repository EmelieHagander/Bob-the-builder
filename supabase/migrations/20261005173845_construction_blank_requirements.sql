-- K4 first boundary: exact blank needs use the existing material planner.
-- CLI migration new was attempted; the installed CLI aborts before execution.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Provenance under existing requirement revisions; this is not a second BOM store.
create table bob.material_requirement_construction_sources (
 project_id text not null,
 requirement_id uuid not null,
 requirement_revision integer not null,
 artifact_id uuid not null,
 artifact_revision integer not null,
 definition_id text not null,
 quantity_mode text not null check(quantity_mode in ('pieces','length_x','length_y','length_z','area_xy','area_xz','area_yz')),
 instance_ids jsonb not null check(jsonb_typeof(instance_ids)='array'),
 blank_mm jsonb not null check(jsonb_typeof(blank_mm)='object'),
 material_binding jsonb not null check(jsonb_typeof(material_binding)='object'),
 primary key(requirement_id,requirement_revision),
 foreign key(requirement_id,requirement_revision) references bob.material_requirement_revisions(requirement_id,revision) on delete cascade,
 foreign key(requirement_id,project_id) references bob.material_requirements(id,project_id) on delete cascade,
 foreign key(artifact_id,artifact_revision) references bob.artifact_construction_revisions(artifact_id,artifact_revision) on delete cascade
);
create index requirement_construction_project on bob.material_requirement_construction_sources(project_id);
create index requirement_construction_artifact on bob.material_requirement_construction_sources(artifact_id,artifact_revision);
alter table bob.material_requirement_construction_sources enable row level security;
revoke all on bob.material_requirement_construction_sources from public,anon,authenticated,service_role;
grant select on bob.material_requirement_construction_sources to authenticated;
create policy project_read on bob.material_requirement_construction_sources for select to authenticated using(bob_private.has_project_access(project_id));

alter function bob_private.material_requirement_cad_command(text,text,uuid,integer,jsonb) rename to material_requirement_cad_before_construction;
create function bob_private.material_requirement_cad_command(p_project text,p_action text,p_requirement uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source bob.artifact_construction_revisions; head bob.artifacts; def jsonb; binding jsonb;
 n integer; quantity numeric; unit text; mode text:=p_data->>'quantity_mode'; state text; saved jsonb; payload jsonb; v_basis text; instances jsonb;
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
 if not found then return bob_private.material_requirement_cad_before_construction(p_project,p_action,p_requirement,p_expected,p_data); end if;
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
 select count(*),jsonb_agg(i->>'id' order by i->>'id') into n,instances from jsonb_array_elements(source.recipe->'instances') i where i->>'definition_id'=p_data->>'definition_id';
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
 v_basis:=format('Construction blank v1: artifact %s revision %s; definition %s; instances %s; local blank %s x %s x %s mm; material %s@%s; part %s@%s; %s = %s %s. Counts every actual instance once. Dimensions are canonical computed inputs. Concept only: raw-stock format, kerf, grain, fit, hardware and assembly access are unresolved. This is not a purchase, cutting-stock layout or fabrication approval.',source.artifact_id,source.artifact_revision,def->>'id',instances,def->>'x_mm',def->>'y_mm',def->>'z_mm',binding->>'material_id',binding->>'material_revision',binding->>'part_id',binding->>'part_revision',mode,quantity,unit);
 if length(v_basis)>6000 then raise exception 'construction_basis_too_large' using errcode='22023'; end if;
 payload:=(p_data-array['definition_id','quantity_mode'])||jsonb_build_object('required_quantity',quantity::text,'unit',unit,'basis',v_basis);
 saved:=bob_private.material_requirement_command(p_project,p_action,p_requirement,p_expected,payload);
 update bob.material_requirement_revisions set source_kind='deterministic',method_key='construction_blank_'||mode,method_version='1',basis=v_basis
 where project_id=p_project and requirement_id=p_requirement and revision=(saved->>'revision')::integer;
 if not found then raise exception 'construction_quantity_not_persisted' using errcode='22023'; end if;
 insert into bob.material_requirement_construction_sources values(p_project,p_requirement,(saved->>'revision')::integer,
  source.artifact_id,source.artifact_revision,def->>'id',mode,instances,
  jsonb_build_object('x',def->'x_mm','y',def->'y_mm','z',def->'z_mm'),binding);
 return saved;
end $$;
revoke all on function bob_private.material_requirement_cad_command(text,text,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function bob_private.material_requirement_cad_command(text,text,uuid,integer,jsonb) to authenticated;

-- Unchanged construction heads may still have changed catalog/physical sources.
create or replace view bob.current_material_requirements with(security_invoker=true) as
select h.id,
  r.requirement_id,r.project_id,r.revision,r.name,r.category,r.area_id,r.area_title,
  r.task_id,r.task_title,r.unit,r.required_quantity,r.waste_percent,r.purchase_increment,
  r.required_with_waste,r.stock_quantity,r.component_quantity,r.purchase_quantity,
  r.source_kind,r.method_key,r.method_version,r.basis,r.assumptions,
  r.artifact_id,r.artifact_revision,r.artifact_title,r.target_revision,
  r.solution_id,r.solution_revision,r.solution_title,r.archived,r.change_note,
  r.recorded_by,r.actor_label,r.recorded_at,
  (pt.current_revision is distinct from r.target_revision) as target_changed,
  (r.artifact_id is not null and (
    ah.current_revision is distinct from r.artifact_revision or ar.archived is distinct from false
    or (exists(select 1 from bob.artifact_construction_revisions c where c.project_id=r.project_id and c.artifact_id=r.artifact_id and c.artifact_revision=r.artifact_revision) and not exists(
      select 1 from bob_private.artifact_source_assessment(r.project_id,r.artifact_id,r.artifact_revision) s where s.source_state='current'
    ))
  )) as artifact_changed,
  exists(
    select 1 from bob.material_requirement_stock rs
    join bob.stock_items sh on sh.id=rs.stock_id and sh.project_id=rs.project_id
    join bob.stock_revisions sr on sr.stock_id=sh.id and sr.revision=sh.current_revision
    where rs.requirement_id=h.id and rs.requirement_revision=h.current_revision
      and (sh.current_revision<>rs.stock_revision or sr.archived or sr.status<>'available')
  ) as stock_changed,
  exists(
    select 1 from bob.material_requirement_components rc
    join bob.existing_components ch on ch.id=rc.component_id and ch.project_id=rc.project_id
    join bob.component_revisions cr on cr.component_id=ch.id and cr.revision=ch.current_revision
    where rc.requirement_id=h.id and rc.requirement_revision=h.current_revision
      and (ch.current_revision<>rc.component_revision or cr.archived or cr.intent<>'reuse' or cr.quantity is null)
  ) as component_changed,
  r.sheet_layer
from bob.material_requirements h
join bob.material_requirement_revisions r
  on r.requirement_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id
left join lateral (
  select p.current_revision from bob.project_targets p
  where p.project_id=h.project_id
    and (p.area_id is not distinct from r.area_id or (r.area_id is not null and p.area_id is null))
  order by case when p.area_id is not distinct from r.area_id then 0 else 1 end
  limit 1
) pt on true
left join bob.artifacts ah on ah.id=r.artifact_id and ah.project_id=h.project_id
left join bob.artifact_revisions ar on ar.artifact_id=ah.id and ar.revision=ah.current_revision;

-- Keep the same fit boundary even if a caller uses the manual needs surface.
alter function bob_private.material_requirement_command(text,text,uuid,integer,jsonb) rename to material_requirement_before_construction_fit;
create function bob_private.material_requirement_command(p_project text,p_action text,p_requirement uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior bob.material_requirement_construction_sources; saved jsonb; state text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 if p_action in ('create','revise') and exists(select 1 from bob.artifact_construction_revisions c
  where c.project_id=p_project and c.artifact_id=nullif(p_data->>'artifact_id','')::uuid and c.artifact_revision=nullif(p_data->>'artifact_revision','')::integer)
  and (p_data->'stock_allocations' is distinct from '[]'::jsonb or p_data->'component_allocations' is distinct from '[]'::jsonb)
  then raise exception 'construction_cut_fit_required' using errcode='22023'; end if;
 select * into prior from bob.material_requirement_construction_sources where project_id=p_project and requirement_id=p_requirement and requirement_revision=p_expected;
 if found and p_action='restore' then
  select s.source_state into state from bob_private.artifact_source_assessment(p_project,prior.artifact_id,prior.artifact_revision) s;
  if state is distinct from 'current' then raise exception 'construction_source_changed' using errcode='PT409'; end if;
  if exists(select 1 from bob.material_requirement_construction_sources cs join bob.current_material_requirements r
   on r.id=cs.requirement_id and r.revision=cs.requirement_revision and r.project_id=cs.project_id
   where cs.project_id=p_project and cs.requirement_id<>p_requirement and cs.artifact_id=prior.artifact_id
    and cs.definition_id=prior.definition_id and cs.quantity_mode=prior.quantity_mode and not r.archived)
   then raise exception 'construction_requirement_exists' using errcode='PT409'; end if;
 end if;
 saved:=bob_private.material_requirement_before_construction_fit(p_project,p_action,p_requirement,p_expected,p_data);
 if prior.requirement_id is not null and p_action in ('archive','restore') then
  insert into bob.material_requirement_construction_sources values(prior.project_id,prior.requirement_id,(saved->>'revision')::integer,
   prior.artifact_id,prior.artifact_revision,prior.definition_id,prior.quantity_mode,prior.instance_ids,prior.blank_mm,prior.material_binding);
 end if;
 return saved;
end $$;
revoke all on function bob_private.material_requirement_command(text,text,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function bob_private.material_requirement_command(text,text,uuid,integer,jsonb) to authenticated;

-- Public manual revisions must not strip deterministic construction provenance.
-- The CAD/construction derive path calls the private arithmetic helper instead.
create or replace function bob.material_requirement_command(p_project text,p_action text,p_requirement uuid,p_expected integer,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action='revise' and exists(select 1 from bob.material_requirement_construction_sources where project_id=p_project and requirement_id=p_requirement and requirement_revision=p_expected)
  then raise exception 'construction_derive_required' using errcode='22023'; end if;
 if p_action='publish' then
  if p_data is null or jsonb_typeof(p_data)<>'object' or p_data<>'{}'::jsonb then raise exception 'Shopping publish does not accept client-authored fields.'; end if;
  return bob_private.material_requirement_publish(p_project,p_requirement,p_expected);
 end if;
 return bob_private.material_requirement_command(p_project,p_action,p_requirement,p_expected,p_data);
end $$;
revoke all on function bob.material_requirement_command(text,text,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function bob.material_requirement_command(text,text,uuid,integer,jsonb) to authenticated;

-- Incomplete blank needs cannot be mistaken for raw stock or buy-ready packages.
alter function bob_private.material_requirement_publish(text,uuid,integer) rename to material_requirement_publish_before_construction;
create function bob_private.material_requirement_publish(p_project text,p_requirement uuid,p_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 if exists(select 1 from bob.current_material_requirements r where r.project_id=p_project and r.id=p_requirement and exists(select 1 from bob.artifact_construction_revisions c where c.project_id=r.project_id and c.artifact_id=r.artifact_id and c.artifact_revision=r.artifact_revision))
  then raise exception 'construction_cut_fit_required' using errcode='22023'; end if;
 return bob_private.material_requirement_publish_before_construction(p_project,p_requirement,p_expected);
end $$;
revoke all on function bob_private.material_requirement_publish(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.material_requirement_publish(text,uuid,integer) to authenticated;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('derive_construction_lists','Derive concept part quantities, blank cut dimensions and a proposed assembly order from the exact checked construction.','Read/check the exact current construction. assembly_dependencies=[] reports the missing order; otherwise specify every joint once with prerequisite joint IDs. The code counts actual instances and validates a separate acyclic assembly graph. Blank cuts are not a raw-stock layout, product approval or saved delivery. Preserve explicit raw-format, kerf, grain, hardware and assembly-access gaps. Save blank needs through derive_cad_material_requirement using this construction revision, then read_project_work(requirement) to verify. Shopping and stock/reuse allocation are blocked until cut fit is supported.',1,false,array['planning','build'],true);
update bob.tool_catalog set description='Derive a versioned blank material requirement from a saved CAD drawing or construction checkpoint.',
 how_to='Read the exact current drawing/construction, target and existing requirements. Choose an actual used definition and blank quantity mode; the server counts instances and copies computed dimensions. Preserve existing requirement IDs. Construction needs pin the construction/material revisions and are concept quantities: raw-stock fit, kerf, grain, hardware and access remain open, so stock/reuse allocations and Shopping are blocked. Ordinary CAD requirements retain their existing allocation/publish path. Read the saved requirement to verify its exact source and quantity.' where name='derive_cad_material_requirement';
commit;
