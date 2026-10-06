-- K4 saved cut plans; UTC filename fallback after the installed CLI crashed.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- A sheet format belongs to the existing immutable stock revision, not a new
-- stock register. Omission on revise preserves it; explicit null clears it.
alter table bob.stock_revisions add column sheet_format jsonb;
create function bob_private.cut_plan_mm(v jsonb, positive boolean default false) returns numeric
language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if jsonb_typeof(v) is distinct from 'number' then raise exception 'cut_plan_invalid_dimension' using errcode='22023'; end if;
 n:=(v#>>'{}')::numeric;
 if n<0 or n>1000000 or (positive and n=0) or n<>trunc(n,6) then raise exception 'cut_plan_invalid_dimension' using errcode='22023'; end if;
 return n;
end $$;
revoke all on function bob_private.cut_plan_mm(jsonb,boolean) from public,anon,authenticated,service_role;

create function bob_private.check_stock_sheet_format(p_project text, f jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare m bob.catalog_item_revisions; h bob.catalog_items; k text;
begin
 if f is null or f='null'::jsonb then return; end if;
 if jsonb_typeof(f) is distinct from 'object' or f-array['material_id','material_revision','length_mm','width_mm','thickness_mm','grain','basis','note']<>'{}'
  or (select count(*) from jsonb_object_keys(f))<>8 or coalesce(f->>'grain','') not in ('length','width','none')
  or coalesce(f->>'basis','') not in ('measured','provided_spec','estimated') or jsonb_typeof(f->'note') is distinct from 'string'
  or char_length(btrim(f->>'note')) not between 1 and 1000 then raise exception 'cut_plan_invalid_stock_format' using errcode='22023'; end if;
 for k in select unnest(array['length_mm','width_mm','thickness_mm']) loop perform bob_private.cut_plan_mm(f->k,true); end loop;
 select * into h from bob.catalog_items where id=(f->>'material_id')::uuid and (project_id is null or project_id=p_project) and kind='material' for share;
 if not found or h.current_revision is distinct from (f->>'material_revision')::integer then raise exception 'cut_plan_material_changed' using errcode='PT409'; end if;
 select * into m from bob.catalog_item_revisions where item_id=h.id and revision=h.current_revision;
 if m.profile_code<>'sheet_stock' or m.properties->'thickness'->>'unit' is distinct from 'mm'
  or m.properties->'thickness'->>'value' is null or (m.properties->'thickness'->>'value')::numeric<>(f->>'thickness_mm')::numeric
  then raise exception 'cut_plan_invalid_stock_format' using errcode='22023'; end if;
end $$;
revoke all on function bob_private.check_stock_sheet_format(text,jsonb) from public,anon,authenticated,service_role;

alter function bob_private.stock_command(text,text,uuid,integer,jsonb) rename to stock_command_before_sheet_format;
create function bob_private.stock_command(p_project text,p_action text,p_stock uuid,p_expected integer,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved jsonb; f jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid stock command' using errcode='22023'; end if;
 if p_action in ('create','revise') then
  if p_data?'sheet_format' then f:=nullif(p_data->'sheet_format','null'::jsonb);
  elsif p_action='revise' then select sheet_format into f from bob.stock_revisions where project_id=p_project and stock_id=p_stock and revision=p_expected; end if;
  if f is not null and p_data->>'unit' is distinct from 'pcs' then raise exception 'cut_plan_sheet_stock_requires_pieces' using errcode='22023'; end if;
  perform bob_private.check_stock_sheet_format(p_project,f);
 elsif p_data?'sheet_format' then raise exception 'Unsupported stock lifecycle fields' using errcode='22023'; end if;
 saved:=bob_private.stock_command_before_sheet_format(p_project,p_action,p_stock,p_expected,p_data-'sheet_format');
 -- The existing command inserts the new row with a null field. Set it once in
 -- this transaction before its revision is visible to any other transaction.
 if p_action in ('create','revise') then update bob.stock_revisions set sheet_format=f where stock_id=p_stock and revision=(saved->>'revision')::integer; end if;
 return saved;
end $$;
revoke all on function bob_private.stock_command_before_sheet_format(text,text,uuid,integer,jsonb),bob_private.stock_command(text,text,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function bob_private.stock_command(text,text,uuid,integer,jsonb) to authenticated;
-- Recreate the invoker view to expose the appended column; existing order stays.
create or replace view bob.current_stock_items with(security_invoker=true) as
 select h.id,r.* from bob.stock_items h join bob.stock_revisions r on r.stock_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id;

create table bob.material_cut_plans (
 id uuid primary key, project_id text not null references bob.projects(id) on delete cascade,
 artifact_id uuid not null, current_revision integer not null check(current_revision>0),
 unique(id,project_id), unique(project_id,artifact_id),
 foreign key(artifact_id,project_id) references bob.artifacts(id,project_id) on delete cascade
);
create table bob.material_cut_plan_revisions (
 plan_id uuid not null, project_id text not null, revision integer not null check(revision>0),
 artifact_id uuid not null, artifact_revision integer not null,
 calculation_version text not null check(calculation_version='construction-sheet-guillotine-v1'),
 candidates jsonb not null, blank_grain jsonb not null, candidate_sources jsonb not null, layout jsonb not null,
 change_note text not null check(char_length(btrim(change_note)) between 1 and 1000),
 recorded_by uuid not null, actor_label text not null, recorded_at timestamptz not null default clock_timestamp(),
 primary key(plan_id,revision), unique(plan_id,revision,project_id),
 foreign key(plan_id,project_id) references bob.material_cut_plans(id,project_id) on delete cascade,
 foreign key(artifact_id,artifact_revision) references bob.artifact_construction_revisions(artifact_id,artifact_revision) on delete cascade
);
alter table bob.material_cut_plans add constraint cut_plan_current_revision_fk foreign key(id,current_revision)
 references bob.material_cut_plan_revisions(plan_id,revision) deferrable initially deferred;
create table bob.material_cut_plan_requirements (
 project_id text not null, plan_id uuid not null, plan_revision integer not null,
 requirement_id uuid not null, requirement_revision integer not null,
 primary key(plan_id,plan_revision,requirement_id),
 foreign key(plan_id,plan_revision,project_id) references bob.material_cut_plan_revisions(plan_id,revision,project_id) on delete cascade,
 foreign key(requirement_id,project_id) references bob.material_requirements(id,project_id) on delete cascade,
 foreign key(requirement_id,requirement_revision) references bob.material_requirement_revisions(requirement_id,revision) on delete cascade
);
create index cut_plan_revisions_project on bob.material_cut_plan_revisions(project_id,plan_id);
create index cut_plan_revisions_source on bob.material_cut_plan_revisions(artifact_id,artifact_revision);
create index cut_plan_requirement_source on bob.material_cut_plan_requirements(requirement_id,requirement_revision);
create index cut_plan_requirements_project on bob.material_cut_plan_requirements(project_id,plan_id);
create index cut_plan_heads_current on bob.material_cut_plans(id,current_revision);
create index cut_plan_revisions_parent on bob.material_cut_plan_revisions(plan_id,project_id);
create index cut_plan_requirement_parent on bob.material_cut_plan_requirements(plan_id,plan_revision,project_id);
create index cut_plan_requirement_project_source on bob.material_cut_plan_requirements(requirement_id,project_id);
create index cut_plan_heads_source on bob.material_cut_plans(artifact_id,project_id);
do $$ declare n text; begin
 for n in select unnest(array['material_cut_plans','material_cut_plan_revisions','material_cut_plan_requirements']) loop
  execute format('alter table bob.%I enable row level security',n);
  execute format('revoke all on bob.%I from public,anon,authenticated,service_role',n);
  execute format('grant select on bob.%I to authenticated',n);
  execute format('create policy project_read on bob.%I for select to authenticated using(bob_private.has_project_access(project_id))',n);
 end loop;
end $$;

-- Independent replay verifier: no client or model assertion of feasibility is
-- sufficient. SQL replays full-span cuts and matches each final leaf to the
-- exact canonical construction instance or an explicit offcut.
create function bob_private.check_cut_plan_layout(c bob.artifact_construction_revisions, candidates jsonb, grains jsonb, layout jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare f jsonb; g jsonb; d jsonb; b jsonb; m bob.catalog_item_revisions; p jsonb; cut jsonb; r jsonb; s jsonb;
 pieces jsonb:='[]'; seen jsonb:='[]'; sheet_names jsonb:='[]'; used jsonb:='[]'; dims jsonb; axes text[]; plane text[];
 thickness numeric; x numeric; y numeric; w numeric; h numeric; pos numeric; kerf numeric; idx integer; i integer; k text; found_rect boolean;
begin
 if jsonb_typeof(candidates) is distinct from 'array' or jsonb_array_length(candidates) not between 1 and 8
  or jsonb_typeof(grains) is distinct from 'array' or jsonb_array_length(grains) not between 1 and 24
  or jsonb_typeof(layout) is distinct from 'object' or layout-array['placements','cuts','offcuts','used_sheets']<>'{}'
  or (select count(*) from jsonb_object_keys(layout))<>4 then raise exception 'cut_plan_invalid_layout' using errcode='22023'; end if;
 foreach k in array array['placements','cuts','offcuts','used_sheets'] loop
  if jsonb_typeof(layout->k) is distinct from 'array' then raise exception 'cut_plan_invalid_layout' using errcode='22023'; end if;
 end loop;
 if jsonb_array_length(layout->'placements')<>jsonb_array_length(c.recipe->'instances') or jsonb_array_length(layout->'placements') not between 1 and 24
  or jsonb_array_length(layout->'cuts')>48 or jsonb_array_length(layout->'offcuts')>64 then raise exception 'cut_plan_invalid_layout' using errcode='22023'; end if;
 for g in select value from jsonb_array_elements(grains) loop
  if jsonb_typeof(g) is distinct from 'object' or g-array['definition_id','axis']<>'{}' or (select count(*) from jsonb_object_keys(g))<>2
   or coalesce(g->>'axis','') not in ('x','y','z','none') or not exists(select 1 from jsonb_array_elements(c.recipe->'instances') t where t->>'definition_id'=g->>'definition_id')
   then raise exception 'cut_plan_invalid_grain' using errcode='22023'; end if;
 end loop;
 if (select count(distinct value->>'definition_id') from jsonb_array_elements(grains))<>jsonb_array_length(grains)
  or (select count(distinct value->>'definition_id') from jsonb_array_elements(c.recipe->'instances'))<>jsonb_array_length(grains)
  then raise exception 'cut_plan_invalid_grain' using errcode='22023'; end if;
 for f in select value from jsonb_array_elements(candidates) loop
  if jsonb_typeof(f) is distinct from 'object' or f-array['id','material_id','material_revision','length_mm','width_mm','thickness_mm','count','kerf_mm','trim_mm','grain','basis','note']<>'{}'
   or (select count(*) from jsonb_object_keys(f))<>12 or coalesce(f->>'id','')!~'^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'
   or sheet_names ? (f->>'id') or jsonb_typeof(f->'count') is distinct from 'number' or coalesce(f->>'count','')!~'^[1-9][0-9]?$' or (f->>'count')::integer>16
   or coalesce(f->>'grain','') not in ('length','width','none') or coalesce(f->>'basis','') not in ('design_choice','provided_spec')
   or jsonb_typeof(f->'note') is distinct from 'string' or char_length(btrim(f->>'note')) not between 1 and 1000
   then raise exception 'cut_plan_invalid_candidate' using errcode='22023'; end if;
  sheet_names:=sheet_names||jsonb_build_array(f->>'id');
  foreach k in array array['length_mm','width_mm','thickness_mm'] loop perform bob_private.cut_plan_mm(f->k,true); end loop;
  perform bob_private.cut_plan_mm(f->'kerf_mm'); perform bob_private.cut_plan_mm(f->'trim_mm');
  if not exists(select 1 from jsonb_array_elements(c.materials) t where t->>'material_id'=f->>'material_id' and t->'material_revision'=f->'material_revision')
   then raise exception 'cut_plan_material_mismatch' using errcode='22023'; end if;
  select * into m from bob.catalog_item_revisions where item_id=(f->>'material_id')::uuid and revision=(f->>'material_revision')::integer;
  if not found or m.profile_code<>'sheet_stock' or m.properties->'thickness'->>'value' is null
   or (m.properties->'thickness'->>'value')::numeric<>(f->>'thickness_mm')::numeric then raise exception 'cut_plan_material_mismatch' using errcode='22023'; end if;
  x:=(f->>'trim_mm')::numeric; w:=(f->>'length_mm')::numeric-2*x; h:=(f->>'width_mm')::numeric-2*x;
  if w<=0 or h<=0 then raise exception 'cut_plan_invalid_candidate' using errcode='22023'; end if;
  for i in 1..(f->>'count')::integer loop pieces:=pieces||jsonb_build_array(jsonb_build_object('sheet_id',(f->>'id')||':'||i,'x_mm',x,'y_mm',x,'length_mm',w,'width_mm',h)); end loop;
 end loop;
 if jsonb_array_length(pieces)>16 then raise exception 'cut_plan_invalid_candidate' using errcode='22023'; end if;
 -- Validate the exact placed blanks before replay so cuts cannot reference a
 -- fabricated instance, different material, rotated grain or changed dimensions.
 for p in select value from jsonb_array_elements(layout->'placements') loop
  if jsonb_typeof(p) is distinct from 'object' or p-array['instance_id','definition_id','label','sheet_id','x_mm','y_mm','length_mm','width_mm','thickness_mm','length_axis','width_axis','grain_axis']<>'{}'
   or (select count(*) from jsonb_object_keys(p))<>12 or seen ? (p->>'instance_id') then raise exception 'cut_plan_invalid_blank' using errcode='22023'; end if;
  select value into b from jsonb_array_elements(c.recipe->'instances') where value->>'id'=p->>'instance_id';
  if b is null or b->>'definition_id' is distinct from p->>'definition_id' then raise exception 'cut_plan_invalid_blank' using errcode='22023'; end if;
  select value into d from jsonb_array_elements(c.recipe->'definitions') where value->>'id'=b->>'definition_id';
  if d->>'primitive' is distinct from 'box' or coalesce(jsonb_array_length(d->'cuts'),0)>0 then raise exception 'cut_plan_unsupported_blank' using errcode='22023'; end if;
  select value into g from jsonb_array_elements(grains) where value->>'definition_id'=b->>'definition_id';
  select value into f from jsonb_array_elements(candidates) where exists(select 1 from generate_series(1,(value->>'count')::integer) serial where p->>'sheet_id'=(value->>'id')||':'||serial);
  if f is null then raise exception 'cut_plan_invalid_blank' using errcode='22023'; end if;
  select value into s from jsonb_array_elements(c.materials) where value->>'definition_id'=b->>'definition_id';
  if s->'material_id' is distinct from f->'material_id' or s->'material_revision' is distinct from f->'material_revision'
   then raise exception 'cut_plan_material_mismatch' using errcode='22023'; end if;
  thickness:=bob_private.cut_plan_mm(f->'thickness_mm',true); axes:=array[]::text[]; plane:=array[]::text[];
  foreach k in array array['x','y','z'] loop
   if bob_private.cut_plan_mm(d->(k||'_mm'),true)=thickness then axes:=array_append(axes,k); else plane:=array_append(plane,k); end if;
  end loop;
  if cardinality(axes)<>1 or cardinality(plane)<>2 or g->>'axis'=axes[1]
   or p->>'length_axis'=p->>'width_axis' or not (p->>'length_axis'=any(plane)) or not (p->>'width_axis'=any(plane))
   or p->>'grain_axis' is distinct from g->>'axis' or p->'thickness_mm' is distinct from f->'thickness_mm'
   or bob_private.cut_plan_mm(p->'length_mm',true)<>bob_private.cut_plan_mm(d->((p->>'length_axis')||'_mm'),true)
   or bob_private.cut_plan_mm(p->'width_mm',true)<>bob_private.cut_plan_mm(d->((p->>'width_axis')||'_mm'),true)
   or (g->>'axis'<>'none' and not ((f->>'grain'='length' and p->>'length_axis'=g->>'axis') or (f->>'grain'='width' and p->>'width_axis'=g->>'axis')))
   then raise exception 'cut_plan_invalid_blank' using errcode='22023'; end if;
  perform bob_private.cut_plan_mm(p->'x_mm'); perform bob_private.cut_plan_mm(p->'y_mm');
  if p->>'label' is distinct from (select 'P'||ordinality from jsonb_array_elements(c.recipe->'instances') with ordinality where value->>'id'=p->>'instance_id') then raise exception 'cut_plan_invalid_blank' using errcode='22023'; end if;
  seen:=seen||jsonb_build_array(p->>'instance_id');
  if not used ? (p->>'sheet_id') then used:=used||jsonb_build_array(p->>'sheet_id'); end if;
 end loop;
 if (select jsonb_agg(value order by value) from jsonb_array_elements(used)) is distinct from (select jsonb_agg(value order by value) from jsonb_array_elements(layout->'used_sheets'))
  then raise exception 'cut_plan_invalid_layout' using errcode='22023'; end if;
 for cut in select value from jsonb_array_elements(layout->'cuts') loop
  if jsonb_typeof(cut) is distinct from 'object' or cut-array['sheet_id','before_instance_id','axis','position_mm','span_start_mm','span_end_mm','kerf_mm']<>'{}'
   or (select count(*) from jsonb_object_keys(cut))<>7 or coalesce(cut->>'axis','') not in ('length','width') then raise exception 'cut_plan_invalid_cut' using errcode='22023'; end if;
  select value into f from jsonb_array_elements(candidates) where exists(select 1 from generate_series(1,(value->>'count')::integer) serial where cut->>'sheet_id'=(value->>'id')||':'||serial);
  select value into p from jsonb_array_elements(layout->'placements') where value->>'instance_id'=cut->>'before_instance_id';
  if f is null or p is null or p->'sheet_id' is distinct from cut->'sheet_id' then raise exception 'cut_plan_invalid_cut' using errcode='22023'; end if;
  pos:=bob_private.cut_plan_mm(cut->'position_mm'); kerf:=bob_private.cut_plan_mm(cut->'kerf_mm');
  perform bob_private.cut_plan_mm(cut->'span_start_mm'); perform bob_private.cut_plan_mm(cut->'span_end_mm');
  if kerf<>(f->>'kerf_mm')::numeric or pos<>(case when cut->>'axis'='length' then (p->>'x_mm')::numeric+(p->>'length_mm')::numeric else (p->>'y_mm')::numeric+(p->>'width_mm')::numeric end)
   then raise exception 'cut_plan_invalid_cut' using errcode='22023'; end if;
  found_rect:=false;
  for r,idx in select value,ordinality::integer-1 from jsonb_array_elements(pieces) with ordinality loop
   x:=(r->>'x_mm')::numeric; y:=(r->>'y_mm')::numeric; w:=(r->>'length_mm')::numeric; h:=(r->>'width_mm')::numeric;
   if r->>'sheet_id'<>cut->>'sheet_id' or x<>(p->>'x_mm')::numeric or y<>(p->>'y_mm')::numeric then continue; end if;
   if cut->>'axis'='length' then
    if y<>(cut->>'span_start_mm')::numeric or y+h<>(cut->>'span_end_mm')::numeric or pos<=x or pos+kerf>x+w then continue; end if;
    pieces:=(pieces-idx)||jsonb_build_array(r||jsonb_build_object('length_mm',pos-x));
    if x+w>pos+kerf then pieces:=pieces||jsonb_build_array(r||jsonb_build_object('x_mm',pos+kerf,'length_mm',x+w-pos-kerf)); end if;
   else
    if x<>(cut->>'span_start_mm')::numeric or x+w<>(cut->>'span_end_mm')::numeric or pos<=y or pos+kerf>y+h then continue; end if;
    pieces:=(pieces-idx)||jsonb_build_array(r||jsonb_build_object('width_mm',pos-y));
    if y+h>pos+kerf then pieces:=pieces||jsonb_build_array(r||jsonb_build_object('y_mm',pos+kerf,'width_mm',y+h-pos-kerf)); end if;
   end if;
   found_rect:=true; exit;
  end loop;
  if not found_rect then raise exception 'cut_plan_invalid_cut' using errcode='22023'; end if;
 end loop;
 for p in select value from jsonb_array_elements(layout->'placements') loop
  r:=p-array['instance_id','definition_id','label','thickness_mm','length_axis','width_axis','grain_axis'];
  select ordinality::integer-1 into idx from jsonb_array_elements(pieces) with ordinality where value=r limit 1;
  if idx is null then raise exception 'cut_plan_unreleased_blank' using errcode='22023'; end if;
  pieces:=pieces-idx;
 end loop;
 if (select jsonb_agg(value order by value::text) from jsonb_array_elements(pieces)) is distinct from (select jsonb_agg(value order by value::text) from jsonb_array_elements(layout->'offcuts'))
  then raise exception 'cut_plan_invalid_offcuts' using errcode='22023'; end if;
end $$;
revoke all on function bob_private.check_cut_plan_layout(bob.artifact_construction_revisions,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Bind only to exact current same-project stock or readable catalog parts.
-- This reports capacity and never reserves any sheets.
create function bob_private.cut_plan_sources(p_project text,candidates jsonb,sources jsonb,p_lock boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb; f jsonb; fmt jsonb; stock bob.current_stock_items; item bob.catalog_items; part bob.catalog_item_revisions;
 reserved numeric; requested numeric; capacity jsonb:='[]'; k text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if jsonb_typeof(sources) is distinct from 'array' or jsonb_array_length(sources)<>jsonb_array_length(candidates)
  or (select count(distinct value->>'candidate_id') from jsonb_array_elements(sources))<>jsonb_array_length(sources)
  then raise exception 'cut_plan_invalid_sources' using errcode='22023'; end if;
 if p_lock then
  perform 1 from bob.stock_items where project_id=p_project and id in (select (value->>'record_id')::uuid from jsonb_array_elements(sources) where value->>'kind'='stock') order by id for update;
  perform 1 from bob.catalog_items where id in (select (value->>'record_id')::uuid from jsonb_array_elements(sources) where value->>'kind'='catalog_part') and (project_id is null or project_id=p_project) order by id for share;
 end if;
 for s in select value from jsonb_array_elements(sources) loop
  if jsonb_typeof(s) is distinct from 'object' or s-array['candidate_id','kind','record_id','revision']<>'{}' or (select count(*) from jsonb_object_keys(s))<>4
   or coalesce(s->>'kind','') not in ('hypothetical','stock','catalog_part') then raise exception 'cut_plan_invalid_sources' using errcode='22023'; end if;
  select value into f from jsonb_array_elements(candidates) where value->'id'=s->'candidate_id';
  if f is null then raise exception 'cut_plan_invalid_sources' using errcode='22023'; end if;
  if s->>'kind'='hypothetical' then
   if s->'record_id' is distinct from 'null'::jsonb or s->'revision' is distinct from 'null'::jsonb then raise exception 'cut_plan_invalid_sources' using errcode='22023'; end if;
   capacity:=capacity||jsonb_build_array(jsonb_build_object('candidate_id',f->>'id','kind','hypothetical','available_sheets',null,'reserved',false)); continue;
  end if;
  if coalesce(s->>'revision','')!~'^[1-9][0-9]{0,8}$' then raise exception 'cut_plan_invalid_sources' using errcode='22023'; end if;
  if s->>'kind'='stock' then
   select * into stock from bob.current_stock_items where project_id=p_project and id=(s->>'record_id')::uuid;
   if not found or stock.revision<>(s->>'revision')::integer or stock.archived or stock.status<>'available' or stock.unit<>'pcs' or stock.sheet_format is null
    then raise exception 'cut_plan_stock_changed' using errcode='PT409'; end if;
   fmt:=stock.sheet_format;
   select coalesce(sum(a.quantity),0) into reserved from bob.material_requirement_stock a
    join bob.current_material_requirements r on r.project_id=a.project_id and r.id=a.requirement_id and r.revision=a.requirement_revision
    where a.project_id=p_project and a.stock_id=stock.id and not r.archived;
   select sum((c->>'count')::numeric) into requested from jsonb_array_elements(sources) sr join jsonb_array_elements(candidates) c on c->'id'=sr->'candidate_id'
    where sr->>'kind'='stock' and sr->'record_id'=s->'record_id';
   if requested>greatest(0,stock.quantity-reserved) then raise exception 'cut_plan_stock_capacity_changed' using errcode='PT409'; end if;
   if fmt->'material_id' is distinct from f->'material_id' or fmt->'material_revision' is distinct from f->'material_revision' or fmt->'grain' is distinct from f->'grain'
    then raise exception 'cut_plan_format_mismatch' using errcode='22023'; end if;
   capacity:=capacity||jsonb_build_array(jsonb_build_object('candidate_id',f->>'id','kind','stock','stock_id',stock.id,'stock_revision',stock.revision,
    'requested_sheets',(f->>'count')::integer,'available_sheets',greatest(0,stock.quantity-reserved),'basis',fmt->'basis','note',fmt->'note','reserved',false));
  else
   select * into item from bob.catalog_items where id=(s->>'record_id')::uuid and kind='part' and (project_id is null or project_id=p_project);
   if not found or item.current_revision<>(s->>'revision')::integer then raise exception 'cut_plan_catalog_changed' using errcode='PT409'; end if;
   select * into part from bob.catalog_item_revisions where item_id=item.id and revision=item.current_revision;
   if part.profile_code<>'panel' or part.has_unknown or cardinality(part.parameter_keys)>0 or part.material_id::text is distinct from f->>'material_id' or part.material_revision is distinct from (f->>'material_revision')::integer
    then raise exception 'cut_plan_format_mismatch' using errcode='22023'; end if;
   fmt:=jsonb_build_object('length_mm',(part.properties->'length'->>'value')::numeric,'width_mm',(part.properties->'width'->>'value')::numeric,'thickness_mm',(part.properties->'thickness'->>'value')::numeric);
   capacity:=capacity||jsonb_build_array(jsonb_build_object('candidate_id',f->>'id','kind','catalog_part','part_id',item.id,'part_revision',item.current_revision,'available_sheets',null,'reserved',false));
  end if;
  foreach k in array array['length_mm','width_mm','thickness_mm'] loop
   if fmt->k is distinct from f->k then raise exception 'cut_plan_format_mismatch' using errcode='22023'; end if;
  end loop;
 end loop;
 return capacity;
end $$;
revoke all on function bob_private.cut_plan_sources(text,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;

create function bob_private.read_cut_plan(p_project text,p_plan uuid,p_revision integer default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h bob.material_cut_plans; r bob.material_cut_plan_revisions; state text; pins jsonb; capacity jsonb; reason text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select * into h from bob.material_cut_plans where project_id=p_project and id=p_plan;
 if not found then return null; end if;
 select * into r from bob.material_cut_plan_revisions where project_id=p_project and plan_id=p_plan and revision=coalesce(p_revision,h.current_revision);
 if not found then return null; end if;
 select source_state into state from bob_private.artifact_source_assessment(p_project,r.artifact_id,r.artifact_revision);
 state:=case when state='current' and r.revision=h.current_revision and exists(select 1 from bob.current_artifacts where project_id=p_project and id=r.artifact_id and revision=r.artifact_revision and not archived) then 'current' else 'changed' end;
 select coalesce(jsonb_agg(jsonb_build_object('id',requirement_id,'revision',requirement_revision) order by requirement_id),'[]') into pins
  from bob.material_cut_plan_requirements where project_id=p_project and plan_id=p_plan and plan_revision=r.revision;
 if exists(select 1 from bob.material_cut_plan_requirements p left join bob.current_material_requirements q on q.project_id=p.project_id and q.id=p.requirement_id
  where p.plan_id=p_plan and p.plan_revision=r.revision and (q.id is null or q.revision<>p.requirement_revision or q.archived or q.artifact_changed or q.target_changed))
  then state:='changed'; end if;
 if exists(select 1 from jsonb_array_elements(r.candidates) f left join bob.catalog_items m on m.id=(f->>'material_id')::uuid
  where m.id is null or (m.project_id is not null and m.project_id<>p_project) or m.current_revision is distinct from (f->>'material_revision')::integer)
  then state:='changed'; end if;
 begin capacity:=bob_private.cut_plan_sources(p_project,r.candidates,r.candidate_sources,false);
 exception when sqlstate 'PT409' or sqlstate '22023' then state:='changed'; reason:='format_or_capacity_changed'; capacity:='[]'; end;
 return to_jsonb(r)||jsonb_build_object('id',h.id,'name','Construction cut plan','current_revision',h.current_revision,'requirements',pins,'source_state',state,
  'capacity',capacity,'gap',reason,'saved',true,'stock_reserved',false,'shopping_ready',false,'fabrication_ready',false,'input_evidence_verified',false);
end $$;
revoke all on function bob_private.read_cut_plan(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.read_cut_plan(text,uuid,integer) to authenticated;
create function bob.read_material_cut_plan(p_project text,p_plan uuid,p_revision integer default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select bob_private.read_cut_plan(p_project,p_plan,p_revision) $$;
revoke all on function bob.read_material_cut_plan(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.read_material_cut_plan(text,uuid,integer) to authenticated;

alter function bob.read_project_work(text,jsonb) rename to read_project_work_before_cut_plans;
create function bob.read_project_work(p_project text,p_input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb; page jsonb; more boolean; result jsonb;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_input->>'resource' is distinct from 'cut_plan' then
  result:=bob.read_project_work_before_cut_plans(p_project,p_input);
  if p_input->>'resource'='stock' then
   select coalesce(jsonb_agg(value||jsonb_build_object('reserved_quantity',coalesce((select sum(a.quantity) from bob.material_requirement_stock a join bob.current_material_requirements r
    on r.project_id=a.project_id and r.id=a.requirement_id and r.revision=a.requirement_revision where a.project_id=p_project and a.stock_id=(value->>'id')::uuid and not r.archived),0),
    'unreserved_sheets',case when value->>'unit'='pcs' and value->'sheet_format' is not null and value->'sheet_format'<>'null'::jsonb then
     case when value->>'status'='available' and value->'archived'='false'::jsonb then greatest(0,(value->>'quantity')::numeric-coalesce((select sum(a.quantity) from bob.material_requirement_stock a join bob.current_material_requirements r
      on r.project_id=a.project_id and r.id=a.requirement_id and r.revision=a.requirement_revision where a.project_id=p_project and a.stock_id=(value->>'id')::uuid and not r.archived),0)) else 0 end else null end)),'[]')
    into rows from jsonb_array_elements(result->'records');
   result:=jsonb_set(result,'{records}',rows);
  end if;
  if p_input->>'resource'='requirement' then
   select coalesce(jsonb_agg(value||jsonb_build_object('cut_plans',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'revision',h.current_revision,'requirement_revision',p.requirement_revision) order by h.id)
    from bob.material_cut_plan_requirements p join bob.material_cut_plans h on h.id=p.plan_id and h.current_revision=p.plan_revision and h.project_id=p.project_id
    where p.project_id=p_project and p.requirement_id=(value->>'id')::uuid),'[]'))),'[]') into rows from jsonb_array_elements(result->'records');
   result:=jsonb_set(result,'{records}',rows);
  end if;
  return result;
 end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_input-array['resource','record_id','after_id']<>'{}' or (select count(*) from jsonb_object_keys(p_input))<>3
  or coalesce(length(p_input->>'record_id'),0)>200 or coalesce(length(p_input->>'after_id'),0)>200 then raise exception 'invalid_read' using errcode='22023'; end if;
 select coalesce(jsonb_agg(bob_private.read_cut_plan(p_project,id,null) order by id),'[]') into rows
  from (select id from bob.material_cut_plans where project_id=p_project and (p_input->>'record_id' is null or id::text=p_input->>'record_id')
    and (p_input->>'after_id' is null or id::text>p_input->>'after_id') order by id limit 9) h;
 more:=jsonb_array_length(rows)>8;
 select coalesce(jsonb_agg(value order by ordinality),'[]') into page from jsonb_array_elements(rows) with ordinality where ordinality<=8;
 if octet_length(page::text)>500000 then raise exception 'record_too_large' using errcode='22023'; end if;
 return jsonb_build_object('projectId',p_project,'resource','cut_plan','records',page,'truncated',more,'next_cursor',case when more then page->7->>'id' else null end);
end $$;
revoke all on function bob.read_project_work(text,jsonb) from public,anon,service_role;
grant execute on function bob.read_project_work(text,jsonb) to authenticated;

create function bob_private.bob_project_write_v15(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; c bob.artifact_construction_revisions; existing bob_private.bob_write_receipts; h bob.material_cut_plans;
 msg text; op text; aid uuid; expected integer; n integer; pins jsonb; requested jsonb; rec jsonb; before_row jsonb; result jsonb; actor text; state text; packet bob.artifact_cad_revisions;
begin
 if p_payload->>'kind' is distinct from 'cut_plan' then return bob_private.bob_project_write_v14(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>120000 or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or p_payload->'expected_updated_at' is distinct from 'null'::jsonb or coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$'
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(p_payload->>'request_quote') not between 1 and 500
  or jsonb_typeof(d) is distinct from 'object' or d-array['key','artifact_id','artifact_revision','requirements','candidates','blank_grain','candidate_sources','layout','change_note']<>'{}'
  or (select count(*) from jsonb_object_keys(d))<>9 or coalesce(d->>'key','')!~'^[A-Za-z0-9_-]{1,80}$'
  or jsonb_typeof(d->'change_note') is distinct from 'string' or char_length(btrim(d->>'change_note')) not between 1 and 1000
  or jsonb_typeof(d->'requirements') is distinct from 'array' or jsonb_array_length(d->'requirements') not between 1 and 24
  then raise exception 'cut_plan_invalid_write' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 op:='cut_plan:'||(d->>'key');
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='PT409'; end if;
  return existing.receipt;
 end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=32 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 select * into c from bob.artifact_construction_revisions where project_id=p_project and artifact_id=(d->>'artifact_id')::uuid and artifact_revision=(d->>'artifact_revision')::integer;
 if not found then raise exception 'project_denied' using errcode='42501'; end if;
 perform 1 from bob.artifacts where project_id=p_project and id=c.artifact_id and current_revision=c.artifact_revision for share;
 if not found or exists(select 1 from bob.current_artifacts where project_id=p_project and id=c.artifact_id and archived) then raise exception 'cut_plan_construction_changed' using errcode='PT409'; end if;
 packet.project_id:=p_project;packet.artifact_id:=c.artifact_id;packet.artifact_revision:=c.artifact_revision;packet.recipe:=c.recipe;packet.manifest:=jsonb_build_object('bob_parameters',c.parameters);
 perform bob_private.check_cad_parameter_graph(packet,false);
 select source_state into state from bob_private.artifact_source_assessment(p_project,c.artifact_id,c.artifact_revision);
 if state is distinct from 'current' then raise exception 'cut_plan_construction_changed' using errcode='PT409'; end if;
 -- Lock the exact catalog heads alongside the project/source revisions.
 perform 1 from bob.catalog_items where id in (select (value->>'material_id')::uuid from jsonb_array_elements(c.materials)
  union select (value->>'part_id')::uuid from jsonb_array_elements(c.materials) where value->>'part_id' is not null) order by id for share;
 if exists(select 1 from jsonb_array_elements(c.materials) b left join bob.catalog_items m on m.id=(b->>'material_id')::uuid
  where m.id is null or (m.project_id is not null and m.project_id<>p_project) or m.current_revision is distinct from (b->>'material_revision')::integer)
  then raise exception 'cut_plan_material_changed' using errcode='PT409'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision) order by r.id),'[]') into pins
  from bob.current_material_requirements r join bob.material_requirement_construction_sources s on s.project_id=r.project_id and s.requirement_id=r.id and s.requirement_revision=r.revision
  where r.project_id=p_project and not r.archived and s.artifact_id=c.artifact_id and s.artifact_revision=c.artifact_revision and s.quantity_mode='pieces'
   and not r.target_changed and not r.artifact_changed and r.waste_percent=0 and r.purchase_increment=1;
 select jsonb_agg(value order by value->>'id') into requested from jsonb_array_elements(d->'requirements');
 if pins is distinct from requested or jsonb_array_length(pins)<>(select count(distinct value->>'definition_id') from jsonb_array_elements(c.recipe->'instances'))
  or exists(select 1 from jsonb_array_elements(c.recipe->'instances') i where not exists(select 1 from bob.material_requirement_construction_sources s join jsonb_array_elements(pins) p
   on p->>'id'=s.requirement_id::text and (p->>'revision')::integer=s.requirement_revision
   where s.project_id=p_project and s.artifact_id=c.artifact_id and s.artifact_revision=c.artifact_revision and s.definition_id=i->>'definition_id' and s.instance_ids ? (i->>'id')))
  then raise exception 'cut_plan_requirements_changed' using errcode='PT409'; end if;
 perform bob_private.check_cut_plan_layout(c,d->'candidates',d->'blank_grain',d->'layout');
 perform bob_private.cut_plan_sources(p_project,d->'candidates',d->'candidate_sources',true);
 expected:=(p_payload->>'expected_revision')::integer; aid:=coalesce((p_payload->>'record_id')::uuid,gen_random_uuid());
 if p_payload->>'record_id' is null then
  if expected<>0 or exists(select 1 from bob.material_cut_plans where project_id=p_project and artifact_id=c.artifact_id) then raise exception 'cut_plan_exists' using errcode='PT409'; end if;
  n:=1; insert into bob.material_cut_plans values(aid,p_project,c.artifact_id,n);
 else
  select * into h from bob.material_cut_plans where project_id=p_project and id=aid for update;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  if h.current_revision<>expected or h.artifact_id<>c.artifact_id then raise exception 'cut_plan_changed' using errcode='PT409'; end if;
  before_row:=bob_private.read_cut_plan(p_project,aid,null); n:=expected+1;
 end if;
 select name into actor from bob.people where project_id=p_project and auth_user_id=auth.uid();
 if actor is null then raise exception 'project_denied' using errcode='42501'; end if;
 insert into bob.material_cut_plan_revisions(plan_id,project_id,revision,artifact_id,artifact_revision,calculation_version,candidates,blank_grain,candidate_sources,layout,change_note,recorded_by,actor_label)
  values(aid,p_project,n,c.artifact_id,c.artifact_revision,'construction-sheet-guillotine-v1',d->'candidates',d->'blank_grain',d->'candidate_sources',d->'layout',d->>'change_note',auth.uid(),actor);
 insert into bob.material_cut_plan_requirements select p_project,aid,n,(value->>'id')::uuid,(value->>'revision')::integer from jsonb_array_elements(pins);
 update bob.material_cut_plans set current_revision=n where id=aid;
 rec:=bob_private.read_cut_plan(p_project,aid,n);
 result:=jsonb_build_object('projectId',p_project,'dataset','cut_plans','recordId',aid,'revision',n,'areaId',null,'label','Construction cut plan',
  'operation',case when expected=0 then 'created' else 'updated' end,'savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
end $$;
create function bob.bob_project_write_v15(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.bob_project_write_v15(p_project,p_thread,p_turn,p_generation,p_payload) $$;
revoke all on function bob_private.bob_project_write_v15(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v15(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v15(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v15(text,uuid,uuid,bigint,jsonb) to authenticated;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('save_construction_cut_plan','Save a checked sheet-cutting layout under the existing exact blank needs.','Read current construction and all saved piece requirements first. Supply candidate formats, exact material/need pins, kerf/trim, grain and candidate_sources. The handler computes placements/cuts; SQL independently replays them. Reuse an existing cut-plan identity on revision. Hypothetical formats remain hypothetical; stock sources require matching current structured sheet_format and unreserved whole-piece capacity. Catalog panel parts pin format, not supplier/product approval. Read_project_work(cut_plan) reopens the saved result and source_state. This save does not reserve stock, publish Shopping or approve fabrication.',1,false,array['planning','build'],true);
update bob.tool_catalog set how_to=how_to||' Saved cut plans are read through resource=cut_plan (list or exact record_id); inspect source_state, exact need/source pins and current capacity. Stock reads include structured sheet_format and unreserved_sheets; a capacity preview never reserves stock.' where name='read_project_work';
update bob.tool_catalog set how_to=how_to||' Stock create/revise may include sheet_format:{material_id,material_revision,length_mm,width_mm,thickness_mm,grain,basis,note} for exact sheet_stock materials and whole pcs. basis is measured, provided_spec or estimated; never invent inspection or stock. Omission on revise preserves the format; explicit null removes it. Existing construction blank reservation and Shopping guards remain in force even after saving a cut plan.' where name='manage_project_material';
notify pgrst,'reload schema';
commit;
