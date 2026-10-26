-- Fastener and glue needs on the material list (owner decisions 2026-10-26, B3).
--
-- B1 (20261026170000) computes one fastener schedule per saved construction
-- revision. The owner decided that screws, nails and bolts reach the material
-- list and Shopping as quantities grouped by kind and size, and that glue is
-- one package per construction. These are rule-of-thumb proposals, not a
-- strength calculation.
--
-- The ordinary derive path gains two quantity modes:
--  * quantity_mode='fasteners' with fastener_kind (screw|nail|bolt),
--    diameter_mm and length_mm: one need per schedule group, quantity = the
--    group's total count in pcs.
--  * quantity_mode='glue': one need of 1 pcs (one package) when the
--    construction has a glued joint.
-- Joints without a rule or a size are not counted; the need's basis and its
-- provenance row say so (schedule_complete=false). Nothing is invented.
--
-- 1. bob.material_requirement_fastener_sources: typed provenance beneath the
--    existing requirement revisions (sibling of the construction blank table).
-- 2. bob_private.material_requirement_fastener_command derives one need through
--    the existing arithmetic writer; material_requirement_cad_command becomes a
--    dispatcher over the previous body (renamed, no client grant).
-- 3. The manual requirement wrapper (from 20261005173845) keeps fastener
--    provenance across archive/restore and refuses manual revisions.
-- 4. Shopping publish (guarded replace): fastener/glue needs are exempt from
--    the blank-only guard while their construction and sources are current.
--    Stock allocation is accepted through the derive path; pack purchase
--    already guards only blank needs.
-- 5. Construction change work: re-deriving completes the saved item, and the
--    continuation recalculates the same need, or archives it when its group is
--    no longer in the schedule (guarded replace of one statement).
-- Authority stays the caller's project access; Bob reaches the derive path
-- through the existing claimed-turn writer (no new writer version).
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create table bob.material_requirement_fastener_sources (
 project_id text not null,
 requirement_id uuid not null,
 requirement_revision integer not null,
 artifact_id uuid not null,
 artifact_revision integer not null,
 rule_version text not null check(char_length(rule_version) between 1 and 60),
 kind text not null check(kind in ('screw','nail','bolt','glue')),
 diameter_mm numeric check(diameter_mm>0),
 length_mm numeric check(length_mm>0),
 quantity integer not null check(quantity>0),
 joint_ids jsonb not null check(jsonb_typeof(joint_ids)='array'),
 schedule_complete boolean not null,
 primary key(requirement_id,requirement_revision),
 check(case when kind='glue' then diameter_mm is null and length_mm is null else diameter_mm is not null and length_mm is not null end),
 foreign key(requirement_id,requirement_revision) references bob.material_requirement_revisions(requirement_id,revision) on delete cascade,
 foreign key(requirement_id,project_id) references bob.material_requirements(id,project_id) on delete cascade,
 foreign key(artifact_id,artifact_revision) references bob.artifact_construction_revisions(artifact_id,artifact_revision) on delete cascade
);
create index requirement_fastener_project on bob.material_requirement_fastener_sources(project_id,artifact_id);
create index requirement_fastener_artifact on bob.material_requirement_fastener_sources(artifact_id,artifact_revision);
alter table bob.material_requirement_fastener_sources enable row level security;
revoke all on bob.material_requirement_fastener_sources from public,anon,authenticated,service_role;
grant select on bob.material_requirement_fastener_sources to authenticated;
create policy project_read on bob.material_requirement_fastener_sources for select to authenticated using(bob_private.has_project_access(project_id));

-- One active need per construction and fastener group.
create function bob_private.fastener_requirement_taken(p_project text,p_requirement uuid,p_artifact uuid,p_kind text,p_diameter numeric,p_length numeric)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from bob.material_requirement_fastener_sources f
  join bob.material_requirements h on h.id=f.requirement_id and h.project_id=f.project_id and h.current_revision=f.requirement_revision
  join bob.material_requirement_revisions r on r.requirement_id=h.id and r.revision=h.current_revision and not r.archived
  where f.project_id=p_project and f.requirement_id<>p_requirement and f.artifact_id=p_artifact and f.kind=p_kind
   and f.diameter_mm is not distinct from p_diameter and f.length_mm is not distinct from p_length)
$$;
revoke all on function bob_private.fastener_requirement_taken(text,uuid,uuid,text,numeric,numeric) from public,anon,authenticated,service_role;

-- A re-derived fastener need completes its saved construction change item,
-- as material_requirement_construction_sources does for blank needs.
create function bob_private.complete_fastener_change_output() returns trigger
language plpgsql security definer set search_path='' as $$
declare receipt jsonb;
begin
 select w.receipt into receipt from bob_private.bob_write_receipts w where w.project_id=new.project_id
  and w.receipt->>'dataset'='requirements' and w.receipt->>'recordId'=new.requirement_id::text and w.receipt->>'revision'=new.requirement_revision::text
  order by w.created_at desc limit 1;
 update bob.construction_change_items i set state='updated',completed_revision=new.requirement_revision,completion_receipt=receipt,completed_at=clock_timestamp()
  from bob.construction_change_sets c where i.change_id=c.id and i.project_id=c.project_id and c.project_id=new.project_id
   and c.artifact_id=new.artifact_id and c.to_revision=new.artifact_revision and i.kind='requirement' and i.requirement_id=new.requirement_id and i.state='pending';
 return new;
end $$;
revoke all on function bob_private.complete_fastener_change_output() from public,anon,authenticated,service_role;
create constraint trigger complete_fastener_requirement after insert on bob.material_requirement_fastener_sources deferrable initially deferred
 for each row execute function bob_private.complete_fastener_change_output();

create function bob_private.material_requirement_fastener_command(p_project text,p_action text,p_requirement uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source bob.artifact_construction_revisions; head bob.artifacts; state text; schedule jsonb; mode text:=p_data->>'quantity_mode';
 v_kind text; d numeric; l numeric; n integer; joints jsonb; open_joints integer; v_title text; v_basis text; word text; payload jsonb; saved jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action is null or p_action not in ('create','revise') or p_requirement is null or p_expected is null
  or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>30000
  or coalesce(mode,'') not in ('fasteners','glue')
  or p_data-array['name','category','area_id','task_id','waste_percent','purchase_increment','assumptions','artifact_id','artifact_revision','target_revision','stock_allocations','component_allocations','change_note','quantity_mode','fastener_kind','diameter_mm','length_mm']<>'{}'
  or (mode='glue' and p_data ?| array['fastener_kind','diameter_mm','length_mm'])
  or (mode='fasteners' and (coalesce(p_data->>'fastener_kind','') not in ('screw','nail','bolt')
   or jsonb_typeof(p_data->'diameter_mm') is distinct from 'number' or jsonb_typeof(p_data->'length_mm') is distinct from 'number'))
  then raise exception 'invalid_cad_requirement' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select * into source from bob.artifact_construction_revisions where project_id=p_project
  and artifact_id=nullif(p_data->>'artifact_id','')::uuid and artifact_revision=nullif(p_data->>'artifact_revision','')::integer;
 if not found then raise exception 'fastener_construction_required' using errcode='22023'; end if;
 select * into head from bob.artifacts where id=source.artifact_id and project_id=p_project for share;
 if not found or head.current_revision<>source.artifact_revision
  or not exists(select 1 from bob.artifact_revisions where artifact_id=head.id and revision=head.current_revision and not archived)
  then raise exception 'construction_source_changed' using errcode='PT409'; end if;
 perform 1 from bob.catalog_items where id in (
  select (m->>'material_id')::uuid from jsonb_array_elements(source.materials) m union
  select (m->>'part_id')::uuid from jsonb_array_elements(source.materials) m where m->>'part_id' is not null) order by id for share;
 select s.source_state into state from bob_private.artifact_source_assessment(p_project,source.artifact_id,source.artifact_revision) s;
 if state is distinct from 'current' then raise exception 'construction_source_changed' using errcode='PT409'; end if;

 schedule:=bob_private.construction_fastener_schedule_for(source);
 if mode='glue' then
  v_kind:='glue';
  -- Owner decision 2026-10-26: one glue package per construction.
  if coalesce((schedule->>'glue_packages')::integer,0)<1 then raise exception 'fastener_group_not_in_schedule' using errcode='22023'; end if;
  n:=1;
  select coalesce(jsonb_agg(x->>'joint_id' order by x->>'joint_id'),'[]') into joints from jsonb_array_elements(schedule->'joints') x where x->>'kind'='glue';
 else
  v_kind:=p_data->>'fastener_kind';
  select (t->>'diameter_mm')::numeric,(t->>'length_mm')::numeric,(t->>'count')::integer,t->'joint_ids' into d,l,n,joints
   from jsonb_array_elements(schedule->'totals') t
   where t->>'kind'=v_kind and (t->>'diameter_mm')::numeric=(p_data->>'diameter_mm')::numeric and (t->>'length_mm')::numeric=(p_data->>'length_mm')::numeric;
  if n is null or n<1 then raise exception 'fastener_group_not_in_schedule' using errcode='22023'; end if;
 end if;
 -- A need keeps its construction and group; blank needs keep theirs.
 if p_action='revise' and (exists(select 1 from bob.material_requirement_construction_sources where project_id=p_project and requirement_id=p_requirement and requirement_revision=p_expected)
  or exists(select 1 from bob.material_requirement_fastener_sources f where f.project_id=p_project and f.requirement_id=p_requirement and f.requirement_revision=p_expected
   and (f.artifact_id<>source.artifact_id or f.kind<>v_kind or f.diameter_mm is distinct from d or f.length_mm is distinct from l)))
  then raise exception 'construction_requirement_identity_changed' using errcode='22023'; end if;
 if bob_private.fastener_requirement_taken(p_project,p_requirement,source.artifact_id,v_kind,d,l) then raise exception 'fastener_requirement_exists' using errcode='PT409'; end if;

 -- Joints the schedule cannot size stay unknown and uncounted.
 select count(*) into open_joints from jsonb_array_elements(schedule->'joints') x
  where x->>'source'='no_rule' or (x->>'kind' in ('screw','nail','bolt') and (jsonb_typeof(x->'count') is distinct from 'number'
   or jsonb_typeof(x->'diameter_mm') is distinct from 'number' or jsonb_typeof(x->'length_mm') is distinct from 'number'));
 select r.title into v_title from bob.artifact_revisions r where r.artifact_id=source.artifact_id and r.revision=source.artifact_revision;
 if mode='glue' then
  v_basis:=format('One glue package for the saved construction "%s", which has %s glued %s. One package per construction is a rule of thumb, not a measured amount; check that the glue suits the material and the use.',
   coalesce(v_title,'construction'),jsonb_array_length(joints),case when jsonb_array_length(joints)=1 then 'joint' else 'joints' end);
 else
  word:=v_kind||case when n=1 then '' else 's' end;
  v_basis:=format('Counted from the saved construction "%s": %s %s of %s x %s mm over %s %s, from the joint fastener schedule. A rule-of-thumb proposal, not a strength calculation; the product, pilot holes and edge distances are still open.',
   coalesce(v_title,'construction'),n,word,trim_scale(d),trim_scale(l),jsonb_array_length(joints),case when jsonb_array_length(joints)=1 then 'joint' else 'joints' end);
 end if;
 if open_joints>0 then
  v_basis:=v_basis||format(' %s other %s no fastener size or rule yet and %s not counted.',open_joints,case when open_joints=1 then 'joint has' else 'joints have' end,case when open_joints=1 then 'is' else 'are' end);
 end if;
 if length(v_basis)>6000 then raise exception 'construction_basis_too_large' using errcode='22023'; end if;

 payload:=(p_data-array['quantity_mode','fastener_kind','diameter_mm','length_mm'])||jsonb_build_object('required_quantity',n::text,'unit','pcs','basis',v_basis);
 -- The arithmetic writer itself: the blank-only allocation guard in the
 -- manual wrapper does not apply to buyable fastener quantities.
 saved:=bob_private.material_requirement_before_construction_fit(p_project,p_action,p_requirement,p_expected,payload);
 update bob.material_requirement_revisions set source_kind='deterministic',method_key=case when mode='glue' then 'construction_glue' else 'construction_fasteners' end,method_version='1',basis=v_basis
 where project_id=p_project and requirement_id=p_requirement and revision=(saved->>'revision')::integer;
 if not found then raise exception 'construction_quantity_not_persisted' using errcode='22023'; end if;
 insert into bob.material_requirement_fastener_sources(project_id,requirement_id,requirement_revision,artifact_id,artifact_revision,rule_version,kind,diameter_mm,length_mm,quantity,joint_ids,schedule_complete)
 values(p_project,p_requirement,(saved->>'revision')::integer,source.artifact_id,source.artifact_revision,schedule->>'rule_version',v_kind,d,l,n,joints,(schedule->>'complete')::boolean);
 return saved;
end $$;
revoke all on function bob_private.material_requirement_fastener_command(text,text,uuid,integer,jsonb) from public,anon,authenticated,service_role;

-- Dispatcher: the installed body (20261026120000) keeps blank derivation.
alter function bob_private.material_requirement_cad_command(text,text,uuid,integer,jsonb) rename to material_requirement_cad_before_fasteners;
revoke all on function bob_private.material_requirement_cad_before_fasteners(text,text,uuid,integer,jsonb) from public,anon,authenticated,service_role;
create function bob_private.material_requirement_cad_command(p_project text,p_action text,p_requirement uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if jsonb_typeof(p_data)='object' and p_data->>'quantity_mode' in ('fasteners','glue') then
  return bob_private.material_requirement_fastener_command(p_project,p_action,p_requirement,p_expected,p_data);
 end if;
 if p_action='revise' and exists(select 1 from bob.material_requirement_fastener_sources where project_id=p_project and requirement_id=p_requirement and requirement_revision=p_expected)
  then raise exception 'construction_requirement_identity_changed' using errcode='22023'; end if;
 return bob_private.material_requirement_cad_before_fasteners(p_project,p_action,p_requirement,p_expected,p_data);
end $$;
revoke all on function bob_private.material_requirement_cad_command(text,text,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function bob_private.material_requirement_cad_command(text,text,uuid,integer,jsonb) to authenticated;

-- Manual wrapper from 20261005173845, unchanged apart from fastener provenance:
-- refuse a manual revise, fence restore like blank needs, carry the row.
create or replace function bob_private.material_requirement_command(p_project text,p_action text,p_requirement uuid,p_expected integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior bob.material_requirement_construction_sources; fastener bob.material_requirement_fastener_sources; saved jsonb; state text;
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
 select * into fastener from bob.material_requirement_fastener_sources where project_id=p_project and requirement_id=p_requirement and requirement_revision=p_expected;
 if found and p_action='revise' then raise exception 'construction_derive_required' using errcode='22023'; end if;
 if fastener.requirement_id is not null and p_action='restore' then
  select s.source_state into state from bob_private.artifact_source_assessment(p_project,fastener.artifact_id,fastener.artifact_revision) s;
  if state is distinct from 'current' then raise exception 'construction_source_changed' using errcode='PT409'; end if;
  if bob_private.fastener_requirement_taken(p_project,p_requirement,fastener.artifact_id,fastener.kind,fastener.diameter_mm,fastener.length_mm)
   then raise exception 'fastener_requirement_exists' using errcode='PT409'; end if;
 end if;
 saved:=bob_private.material_requirement_before_construction_fit(p_project,p_action,p_requirement,p_expected,p_data);
 if prior.requirement_id is not null and p_action in ('archive','restore') then
  insert into bob.material_requirement_construction_sources values(prior.project_id,prior.requirement_id,(saved->>'revision')::integer,
   prior.artifact_id,prior.artifact_revision,prior.definition_id,prior.quantity_mode,prior.instance_ids,prior.blank_mm,prior.material_binding);
 end if;
 if fastener.requirement_id is not null and p_action in ('archive','restore') then
  insert into bob.material_requirement_fastener_sources(project_id,requirement_id,requirement_revision,artifact_id,artifact_revision,rule_version,kind,diameter_mm,length_mm,quantity,joint_ids,schedule_complete)
  values(fastener.project_id,fastener.requirement_id,(saved->>'revision')::integer,fastener.artifact_id,fastener.artifact_revision,fastener.rule_version,
   fastener.kind,fastener.diameter_mm,fastener.length_mm,fastener.quantity,fastener.joint_ids,fastener.schedule_complete);
 end if;
 return saved;
end $$;

-- Shopping publish: guarded replace of the blank guard (20261005173845).
do $$
declare fn regprocedure:='bob_private.material_requirement_publish(text,uuid,integer)'::regprocedure; def text;
 old_guard constant text:=$q$ if exists(select 1 from bob.current_material_requirements r where r.project_id=p_project and r.id=p_requirement and exists(select 1 from bob.artifact_construction_revisions c where c.project_id=r.project_id and c.artifact_id=r.artifact_id and c.artifact_revision=r.artifact_revision))
  then raise exception 'construction_cut_fit_required' using errcode='22023'; end if;$q$;
 new_guard constant text:=$q$ if exists(select 1 from bob.current_material_requirements r join bob.material_requirement_fastener_sources f
   on f.project_id=r.project_id and f.requirement_id=r.id and f.requirement_revision=r.revision
  where r.project_id=p_project and r.id=p_requirement and r.artifact_changed)
  then raise exception 'construction_source_changed' using errcode='PT409'; end if;
 if exists(select 1 from bob.current_material_requirements r where r.project_id=p_project and r.id=p_requirement and exists(select 1 from bob.artifact_construction_revisions c where c.project_id=r.project_id and c.artifact_id=r.artifact_id and c.artifact_revision=r.artifact_revision)
   and not exists(select 1 from bob.material_requirement_fastener_sources f where f.project_id=r.project_id and f.requirement_id=r.id and f.requirement_revision=r.revision))
  then raise exception 'construction_cut_fit_required' using errcode='22023'; end if;$q$;
begin
 def:=pg_get_functiondef(fn);
 if position(old_guard in def)=0 or (length(def)-length(replace(def,old_guard,'')))/length(old_guard)<>1 then raise exception 'fastener_requirements_publish_changed'; end if;
 execute replace(def,old_guard,new_guard);
end $$;

-- Construction change work: recalculate the same fastener need at the new
-- construction revision, or archive it when its group left the schedule. New
-- groups are new needs through the ordinary derive path.
create function bob_private.fastener_consequence(p_project text,p_requirement uuid,p_revision integer,p_artifact uuid,p_to integer,p_target jsonb,p_note text)
returns jsonb language plpgsql stable set search_path='' as $$
declare f bob.material_requirement_fastener_sources; q bob.material_requirement_revisions; src bob.artifact_construction_revisions; schedule jsonb; n integer; fields jsonb;
begin
 select * into f from bob.material_requirement_fastener_sources where project_id=p_project and requirement_id=p_requirement and requirement_revision=p_revision;
 if not found then raise exception 'consequence_output_changed' using errcode='PT409'; end if;
 if f.artifact_id is distinct from p_artifact then raise exception 'consequence_source_changed' using errcode='PT409'; end if;
 select * into q from bob.material_requirement_revisions where project_id=p_project and requirement_id=p_requirement and revision=p_revision;
 select * into src from bob.artifact_construction_revisions where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_to;
 if not found then raise exception 'construction_changed' using errcode='PT409'; end if;
 schedule:=bob_private.construction_fastener_schedule_for(src);
 if f.kind='glue' then n:=case when coalesce((schedule->>'glue_packages')::integer,0)>0 then 1 else 0 end;
 else
  select (t->>'count')::integer into n from jsonb_array_elements(schedule->'totals') t
   where t->>'kind'=f.kind and (t->>'diameter_mm')::numeric=f.diameter_mm and (t->>'length_mm')::numeric=f.length_mm;
 end if;
 if coalesce(n,0)=0 then
  return jsonb_build_object('status','ready','kind','requirement_retire','domain',jsonb_build_object('kind','operational','record_id',p_requirement,'expected_revision',p_revision,
   'data',jsonb_build_object('resource','requirement','action','archive','fields','{}'::jsonb)));
 end if;
 fields:=jsonb_build_object('name',q.name,'category',q.category,'area_id',q.area_id,'task_id',q.task_id,'waste_percent',q.waste_percent::text,'purchase_increment',q.purchase_increment::text,'assumptions',q.assumptions,
  'artifact_id',p_artifact,'artifact_revision',p_to,'target_revision',p_target,'quantity_mode',case when f.kind='glue' then 'glue' else 'fasteners' end,
  'stock_allocations','[]'::jsonb,'component_allocations','[]'::jsonb,'change_note',p_note)
  ||case when f.kind='glue' then '{}'::jsonb else jsonb_build_object('fastener_kind',f.kind,'diameter_mm',f.diameter_mm,'length_mm',f.length_mm) end;
 return jsonb_build_object('status','ready','kind','requirement','domain',jsonb_build_object('kind','operational','record_id',p_requirement,'expected_revision',p_revision,
  'data',jsonb_build_object('resource','cad_requirement','action','revise','fields',fields)));
end $$;
revoke all on function bob_private.fastener_consequence(text,uuid,integer,uuid,integer,jsonb,text) from public,anon,authenticated,service_role;

do $$
declare fn regprocedure:='bob.prepare_construction_consequence(text,uuid,uuid,bigint,jsonb)'::regprocedure; def text;
 old_step constant text:=$q$  select * into proof from bob.material_requirement_construction_sources where project_id=p_project and requirement_id=i.requirement_id and requirement_revision=q.revision;
  if not found then return jsonb_build_object('status','needs_requirement_model',$q$;
 new_step constant text:=$q$  select * into proof from bob.material_requirement_construction_sources where project_id=p_project and requirement_id=i.requirement_id and requirement_revision=q.revision;
  if not found and exists(select 1 from bob.material_requirement_fastener_sources fs where fs.project_id=p_project and fs.requirement_id=i.requirement_id and fs.requirement_revision=q.revision)
   then return bob_private.fastener_consequence(p_project,i.requirement_id,q.revision,c.artifact_id,c.to_revision,draft->'target_revision',d->>'change_note'); end if;
  if not found then return jsonb_build_object('status','needs_requirement_model',$q$;
begin
 def:=pg_get_functiondef(fn);
 if position(old_step in def)=0 or (length(def)-length(replace(def,old_step,'')))/length(old_step)<>1 then raise exception 'fastener_requirements_consequence_changed'; end if;
 execute replace(def,old_step,new_step);
end $$;

commit;
