-- Shared whole-sheet reservations beneath existing saved cut plans.
-- Actual UTC filename fallback: the installed migration CLI aborts in this workspace.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob.material_cut_plan_reservations (
 plan_id uuid primary key,
 project_id text not null,
 current_revision integer not null check(current_revision>0),
 unique(plan_id,project_id),
 foreign key(plan_id,project_id) references bob.material_cut_plans(id,project_id) on delete cascade
);
create table bob.material_cut_plan_reservation_revisions (
 plan_id uuid not null,
 project_id text not null,
 revision integer not null check(revision>0),
 plan_revision integer not null check(plan_revision>0),
 reserved boolean not null,
 change_note text not null check(char_length(btrim(change_note)) between 1 and 1000),
 recorded_by uuid not null,
 actor_label text not null,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(plan_id,revision),
 unique(plan_id,project_id,revision),
 foreign key(plan_id,project_id) references bob.material_cut_plan_reservations(plan_id,project_id) on delete cascade,
 foreign key(plan_id,project_id,plan_revision) references bob.material_cut_plan_revisions(plan_id,project_id,revision) on delete cascade
);
alter table bob.material_cut_plan_reservations add constraint cut_plan_reservation_current_fk
 foreign key(plan_id,project_id,current_revision) references bob.material_cut_plan_reservation_revisions(plan_id,project_id,revision) deferrable initially deferred;
create table bob.material_cut_plan_stock (
 project_id text not null,
 plan_id uuid not null,
 reservation_revision integer not null,
 stock_id uuid not null,
 stock_revision integer not null,
 quantity integer not null check(quantity>0 and quantity<=16),
 primary key(plan_id,reservation_revision,stock_id),
 foreign key(plan_id,project_id,reservation_revision) references bob.material_cut_plan_reservation_revisions(plan_id,project_id,revision) on delete cascade,
 foreign key(stock_id,project_id) references bob.stock_items(id,project_id) on delete cascade,
 foreign key(stock_id,stock_revision) references bob.stock_revisions(stock_id,revision)
);
create index cut_plan_reservations_current_idx on bob.material_cut_plan_reservations(plan_id,project_id,current_revision);
create index cut_plan_reservations_project_idx on bob.material_cut_plan_reservations(project_id);
create index cut_plan_reservation_revisions_parent_idx on bob.material_cut_plan_reservation_revisions(plan_id,project_id);
create index cut_plan_reservation_revisions_plan_idx on bob.material_cut_plan_reservation_revisions(plan_id,project_id,plan_revision);
create index cut_plan_stock_reservation_idx on bob.material_cut_plan_stock(plan_id,project_id,reservation_revision);
create index cut_plan_stock_identity_idx on bob.material_cut_plan_stock(stock_id,project_id);
create index cut_plan_stock_revision_idx on bob.material_cut_plan_stock(stock_id,stock_revision);
create index cut_plan_stock_project_idx on bob.material_cut_plan_stock(project_id);
alter table bob.material_cut_plan_reservations enable row level security;
alter table bob.material_cut_plan_reservation_revisions enable row level security;
alter table bob.material_cut_plan_stock enable row level security;
revoke all on bob.material_cut_plan_reservations,bob.material_cut_plan_reservation_revisions,bob.material_cut_plan_stock from public,anon,authenticated,service_role;
grant select on bob.material_cut_plan_reservations,bob.material_cut_plan_reservation_revisions,bob.material_cut_plan_stock to authenticated;
create policy project_read on bob.material_cut_plan_reservations for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.material_cut_plan_reservation_revisions for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.material_cut_plan_stock for select to authenticated using(bob_private.has_project_access(project_id));

-- Count only each live requirement/allocation head, and each current explicit
-- plan reservation. Stale plan/source/stock pins still hold capacity until
-- release; a read or revision must never silently free a physical commitment.
create function bob_private.material_stock_reserved(p_project text,p_stock uuid,p_exclude_requirement uuid default null,p_exclude_plan uuid default null) returns numeric
language sql stable security definer set search_path='' as $$
 select coalesce((select sum(a.quantity) from bob.material_requirement_stock a
  join bob.material_requirements h on h.project_id=a.project_id and h.id=a.requirement_id and h.current_revision=a.requirement_revision
  join bob.material_requirement_revisions r on r.project_id=h.project_id and r.requirement_id=h.id and r.revision=h.current_revision
  where a.project_id=p_project and a.stock_id=p_stock and not r.archived and a.requirement_id is distinct from p_exclude_requirement),0)
 +coalesce((select sum(a.quantity) from bob.material_cut_plan_stock a
  join bob.material_cut_plan_reservations h on h.project_id=a.project_id and h.plan_id=a.plan_id and h.current_revision=a.reservation_revision
  join bob.material_cut_plan_reservation_revisions r on r.project_id=h.project_id and r.plan_id=h.plan_id and r.revision=h.current_revision
  where a.project_id=p_project and a.stock_id=p_stock and r.reserved and a.plan_id is distinct from p_exclude_plan),0)
$$;
revoke all on function bob_private.material_stock_reserved(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Preserve the existing arithmetic implementation/OID/ACL while replacing
-- its one obsolete stock sum. Fail closed if the installed body has drifted.
do $migration$
declare fn regprocedure:='bob_private.material_requirement_before_construction_fit(text,text,uuid,integer,jsonb)'::regprocedure;
 definition text:=pg_get_functiondef(fn);
 old_sum text:=$oldsum$      select coalesce(sum(rs.quantity),0) into already
      from bob.material_requirement_stock rs
      join bob.material_requirements oh on oh.id=rs.requirement_id and oh.project_id=rs.project_id
      join bob.material_requirement_revisions orr on orr.requirement_id=oh.id and orr.revision=oh.current_revision
      join bob.stock_items current_stock on current_stock.id=rs.stock_id and current_stock.project_id=rs.project_id
      where rs.stock_id=stock.stock_id and rs.requirement_id<>p_requirement
        and not orr.archived and current_stock.current_revision=rs.stock_revision;
$oldsum$;
 new_sum text:=$newsum$      already:=bob_private.material_stock_reserved(p_project,stock.stock_id,p_requirement,null);
$newsum$;
begin
 if position(old_sum in definition)=0 or (length(definition)-length(replace(definition,old_sum,'')))/length(old_sum)<>1 then
  raise exception 'material_reservation_sum_definition_changed'; end if;
 execute replace(definition,old_sum,new_sum);
end $migration$;

create or replace function bob_private.guard_material_stock_allocation() returns trigger
language plpgsql security definer set search_path='' as $$
declare stock bob.stock_revisions;
begin
 select r.* into stock from bob.stock_items h join bob.stock_revisions r on r.stock_id=h.id and r.revision=h.current_revision
  where h.project_id=new.project_id and h.id=new.stock_id and h.current_revision=new.stock_revision for update of h;
 if not found or stock.archived or stock.status<>'available' then raise exception 'Stock changed. Review the material requirement before reserving it.'; end if;
 if bob_private.material_stock_reserved(new.project_id,new.stock_id,new.requirement_id,null)+new.quantity>stock.quantity then
  raise exception 'Stock quantity is already reserved by another active material requirement or cut plan'; end if;
 return new;
end $$;

create function bob_private.guard_reserved_cut_plan_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.current_revision<>old.current_revision and exists(select 1 from bob.material_cut_plan_reservations h
  join bob.material_cut_plan_reservation_revisions r on r.project_id=h.project_id and r.plan_id=h.plan_id and r.revision=h.current_revision
  where h.project_id=old.project_id and h.plan_id=old.id and r.reserved) then raise exception 'cut_plan_reservation_release_required' using errcode='PT409'; end if;
 return new;
end $$;
revoke all on function bob_private.guard_reserved_cut_plan_revision() from public,anon,authenticated,service_role;
create trigger cut_plan_reserved_revision before update of current_revision on bob.material_cut_plans for each row execute function bob_private.guard_reserved_cut_plan_revision();

create function bob_private.guard_cut_plan_stock_allocation() returns trigger
language plpgsql security definer set search_path='' as $$
declare stock bob.stock_revisions;
begin
 select r.* into stock from bob.stock_items h join bob.stock_revisions r on r.stock_id=h.id and r.revision=h.current_revision
  where h.project_id=new.project_id and h.id=new.stock_id and h.current_revision=new.stock_revision for update of h;
 if not found or stock.archived or stock.status<>'available' or stock.unit<>'pcs' or stock.sheet_format is null then
  raise exception 'cut_plan_stock_changed' using errcode='PT409'; end if;
 if bob_private.material_stock_reserved(new.project_id,new.stock_id,null,new.plan_id)+new.quantity>stock.quantity then
  raise exception 'cut_plan_stock_capacity_changed' using errcode='PT409'; end if;
 return new;
end $$;
revoke all on function bob_private.guard_cut_plan_stock_allocation() from public,anon,authenticated,service_role;
create trigger cut_plan_stock_capacity before insert on bob.material_cut_plan_stock for each row execute function bob_private.guard_cut_plan_stock_allocation();

create function bob_private.cut_plan_sources(p_project text,candidates jsonb,sources jsonb,p_lock boolean,p_exclude_plan uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb; f jsonb; fmt jsonb; stock bob.current_stock_items; item bob.catalog_items; part bob.catalog_item_revisions;
 reserved numeric; requested numeric; held numeric; capacity jsonb:='[]'; k text;
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
   reserved:=bob_private.material_stock_reserved(p_project,stock.id,null,p_exclude_plan);
   select sum((c->>'count')::numeric) into requested from jsonb_array_elements(sources) sr join jsonb_array_elements(candidates) c on c->'id'=sr->'candidate_id'
    where sr->>'kind'='stock' and sr->'record_id'=s->'record_id';
   -- A held plan needs its actual committed sheets, not every unused sheet
   -- offered when fitting. Other plans/manual needs may use those spares.
   held:=0;
   if p_exclude_plan is not null then
    select coalesce(sum(a.quantity),0) into held from bob.material_cut_plan_stock a
     join bob.material_cut_plan_reservations h on h.project_id=a.project_id and h.plan_id=a.plan_id and h.current_revision=a.reservation_revision
     join bob.material_cut_plan_reservation_revisions rr on rr.project_id=h.project_id and rr.plan_id=h.plan_id and rr.revision=h.current_revision
     where a.project_id=p_project and a.plan_id=p_exclude_plan and a.stock_id=stock.id and rr.reserved;
    if held>0 then requested:=held; end if;
   end if;
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

create or replace function bob_private.read_cut_plan(p_project text,p_plan uuid,p_revision integer default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h bob.material_cut_plans; r bob.material_cut_plan_revisions; state text; pins jsonb; capacity jsonb; reason text; reservation jsonb; covered boolean:=false;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select * into h from bob.material_cut_plans where project_id=p_project and id=p_plan;
 if not found then return null; end if;
 select * into r from bob.material_cut_plan_revisions where project_id=p_project and plan_id=p_plan and revision=coalesce(p_revision,h.current_revision);
 if not found then return null; end if;
 select source_state into state from bob_private.artifact_source_assessment(p_project,r.artifact_id,r.artifact_revision);
 state:=case when state='current' and r.revision=h.current_revision and exists(select 1 from bob.artifacts a join bob.artifact_revisions ar on ar.artifact_id=a.id and ar.revision=a.current_revision
  where a.project_id=p_project and a.id=r.artifact_id and a.current_revision=r.artifact_revision and not ar.archived) then 'current' else 'changed' end;
 select coalesce(jsonb_agg(jsonb_build_object('id',requirement_id,'revision',requirement_revision) order by requirement_id),'[]') into pins
  from bob.material_cut_plan_requirements where project_id=p_project and plan_id=p_plan and plan_revision=r.revision;
 -- The plan's construction/source graph was assessed once above. Read each
 -- pinned need's indexed head/revision and reuse the canonical Area target
 -- selector; the current-needs view would reassess that same expensive graph
 -- for every pin and can exceed the ordinary PostgREST statement budget.
 if exists(select 1 from bob.material_cut_plan_requirements p
  left join bob.material_requirements nh on nh.project_id=p.project_id and nh.id=p.requirement_id
  left join bob.material_requirement_revisions q on q.project_id=nh.project_id and q.requirement_id=nh.id and q.revision=nh.current_revision
  where p.project_id=p_project and p.plan_id=p_plan and p.plan_revision=r.revision and
   (q.requirement_id is null or nh.current_revision<>p.requirement_revision or q.archived
    or q.artifact_id is distinct from r.artifact_id or q.artifact_revision is distinct from r.artifact_revision
    or bob_private.effective_target_revision(q.project_id,q.area_id) is distinct from q.target_revision))
  then state:='changed'; end if;
 if exists(select 1 from jsonb_array_elements(r.candidates) f left join bob.catalog_items m on m.id=(f->>'material_id')::uuid
  where m.id is null or (m.project_id is not null and m.project_id<>p_project) or m.current_revision is distinct from (f->>'material_revision')::integer)
  then state:='changed'; end if;
 begin capacity:=bob_private.cut_plan_sources(p_project,r.candidates,r.candidate_sources,false,p_plan);
 exception when sqlstate 'PT409' or sqlstate '22023' then state:='changed'; reason:='format_or_capacity_changed'; capacity:='[]'; end;
 select to_jsonb(v)||jsonb_build_object('allocations',coalesce((select jsonb_agg(to_jsonb(a) order by stock_id) from bob.material_cut_plan_stock a where a.project_id=p_project and a.plan_id=p_plan and a.reservation_revision=v.revision),'[]')) into reservation
  from bob.material_cut_plan_reservations rh join bob.material_cut_plan_reservation_revisions v on v.plan_id=rh.plan_id and v.project_id=rh.project_id and v.revision=rh.current_revision
  where rh.project_id=p_project and rh.plan_id=p_plan;
 covered:=state='current' and coalesce((reservation->>'reserved')::boolean,false) and (reservation->>'plan_revision')::integer=r.revision;
 return to_jsonb(r)||jsonb_build_object('id',h.id,'name','Construction cut plan','current_revision',h.current_revision,'requirements',pins,'source_state',state,
  'capacity',capacity,'gap',reason,'saved',true,'stock_reserved',covered,'reservation_revision',coalesce((reservation->>'revision')::integer,0),'reservation',reservation,'shopping_ready',false,'fabrication_ready',false,'input_evidence_verified',false);
end $$;

revoke all on function bob_private.cut_plan_sources(text,jsonb,jsonb,boolean,uuid) from public,anon,authenticated,service_role;
create or replace function bob_private.cut_plan_sources(p_project text,candidates jsonb,sources jsonb,p_lock boolean default false) returns jsonb
language sql security definer set search_path='' as $$ select bob_private.cut_plan_sources(p_project,candidates,sources,p_lock,null) $$;

create function bob_private.cut_plan_stock_command(p_project text,p_action text,p_plan uuid,p_expected integer,p_reservation_expected integer,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h bob.material_cut_plans; rh bob.material_cut_plan_reservations; prior bob.material_cut_plan_reservation_revisions;
 r bob.material_cut_plan_revisions; c bob.artifact_construction_revisions; packet bob.artifact_cad_revisions;
 record jsonb; actor text; n integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action is null or p_action not in ('reserve','release') or p_plan is null or p_expected is null or p_expected<1
  or p_reservation_expected is null or p_reservation_expected<0 or p_note is null or char_length(btrim(p_note)) not between 1 and 1000 then
  raise exception 'cut_plan_invalid_reservation' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select * into h from bob.material_cut_plans where project_id=p_project and id=p_plan for update;
 if not found then raise exception 'project_denied' using errcode='42501'; end if;
 if h.current_revision<>p_expected then raise exception 'cut_plan_changed' using errcode='PT409'; end if;
 select * into rh from bob.material_cut_plan_reservations where project_id=p_project and plan_id=p_plan for update;
 if coalesce(rh.current_revision,0)<>p_reservation_expected then raise exception 'cut_plan_reservation_changed' using errcode='PT409'; end if;
 if rh.plan_id is not null then
  select * into prior from bob.material_cut_plan_reservation_revisions where project_id=p_project and plan_id=p_plan and revision=rh.current_revision;
 end if;
 if p_action='reserve' and coalesce(prior.reserved,false) then raise exception 'cut_plan_reservation_release_required' using errcode='PT409'; end if;
 if p_action='release' and not coalesce(prior.reserved,false) then raise exception 'cut_plan_not_reserved' using errcode='PT409'; end if;
 select name into actor from bob.people where project_id=p_project and auth_user_id=auth.uid();
 if actor is null then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action='reserve' then
  select * into r from bob.material_cut_plan_revisions where project_id=p_project and plan_id=p_plan and revision=h.current_revision;
  select * into c from bob.artifact_construction_revisions where project_id=p_project and artifact_id=r.artifact_id and artifact_revision=r.artifact_revision;
  perform 1 from bob.artifacts where project_id=p_project and id=c.artifact_id and current_revision=c.artifact_revision for share;
  if not found then raise exception 'cut_plan_construction_changed' using errcode='PT409'; end if;
  perform 1 from bob.measurements where project_id=p_project and id in (select measurement_id from bob.artifact_measurements where project_id=p_project and artifact_id=c.artifact_id and artifact_revision=c.artifact_revision) order by id for share;
  packet.project_id:=p_project;packet.artifact_id:=c.artifact_id;packet.artifact_revision:=c.artifact_revision;packet.recipe:=c.recipe;packet.manifest:=jsonb_build_object('bob_parameters',c.parameters);
  perform bob_private.check_cad_parameter_graph(packet,false);
  perform 1 from bob.catalog_items where id in (select (value->>'material_id')::uuid from jsonb_array_elements(r.candidates)) order by id for share;
  perform bob_private.cut_plan_sources(p_project,r.candidates,r.candidate_sources,true,null);
  record:=bob_private.read_cut_plan(p_project,p_plan,h.current_revision);
  if record->>'source_state' is distinct from 'current' then raise exception 'cut_plan_sources_changed' using errcode='PT409'; end if;
  -- Count actual used canonical sheet IDs, not blank quantities or offered
  -- candidate counts. Aliases sharing a stock identity are aggregated below.
  if jsonb_array_length(r.layout->'used_sheets')=0 or exists(select 1 from jsonb_array_elements_text(r.layout->'used_sheets') u
   left join jsonb_array_elements(r.candidate_sources) s on s->>'candidate_id'=regexp_replace(u,':[0-9]+$','')
   where s is null or s->>'kind' is distinct from 'stock') then raise exception 'cut_plan_stock_sources_required' using errcode='22023'; end if;
 end if;
 n:=coalesce(rh.current_revision,0)+1;
 if rh.plan_id is null then insert into bob.material_cut_plan_reservations values(p_plan,p_project,n); end if;
 insert into bob.material_cut_plan_reservation_revisions(plan_id,project_id,revision,plan_revision,reserved,change_note,recorded_by,actor_label)
  values(p_plan,p_project,n,h.current_revision,p_action='reserve',btrim(p_note),auth.uid(),actor);
 if p_action='reserve' then
  insert into bob.material_cut_plan_stock(project_id,plan_id,reservation_revision,stock_id,stock_revision,quantity)
   select p_project,p_plan,n,(s->>'record_id')::uuid,(s->>'revision')::integer,count(*)
   from jsonb_array_elements_text(r.layout->'used_sheets') u
   join jsonb_array_elements(r.candidate_sources) s on s->>'candidate_id'=regexp_replace(u,':[0-9]+$','')
   group by s->>'record_id',s->>'revision' order by s->>'record_id';
 end if;
 update bob.material_cut_plan_reservations set current_revision=n where project_id=p_project and plan_id=p_plan;
 return bob_private.read_cut_plan(p_project,p_plan,h.current_revision);
end $$;
revoke all on function bob_private.cut_plan_stock_command(text,text,uuid,integer,integer,text) from public,anon,service_role;
grant execute on function bob_private.cut_plan_stock_command(text,text,uuid,integer,integer,text) to authenticated;
create function bob.material_cut_plan_stock_command(p_project text,p_action text,p_plan uuid,p_expected integer,p_reservation_expected integer,p_note text) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.cut_plan_stock_command(p_project,p_action,p_plan,p_expected,p_reservation_expected,p_note) $$;
revoke all on function bob.material_cut_plan_stock_command(text,text,uuid,integer,integer,text) from public,anon,service_role;
grant execute on function bob.material_cut_plan_stock_command(text,text,uuid,integer,integer,text) to authenticated;

-- Add normal claimed-turn writes without changing older domain payloads.
create function bob_private.bob_project_write_v16(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; existing bob_private.bob_write_receipts; msg text; op text; before_row jsonb; rec jsonb; result jsonb; aid uuid;
begin
 if p_payload->>'kind' is distinct from 'cut_plan_stock' then return bob_private.bob_project_write_v15(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>6000 or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or coalesce(p_payload->>'expected_revision','')!~'^[1-9][0-9]{0,8}$' or p_payload->>'record_id' is null
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(p_payload->>'request_quote') not between 1 and 500
  or jsonb_typeof(d) is distinct from 'object' or d-array['action','reservation_revision','change_note']<>'{}' or (select count(*) from jsonb_object_keys(d))<>3
  or coalesce(d->>'action','') not in ('reserve','release') or coalesce(d->>'reservation_revision','')!~'^[0-9]{1,9}$'
  or jsonb_typeof(d->'reservation_revision') is distinct from 'number' or jsonb_typeof(d->'change_note') is distinct from 'string'
  then raise exception 'cut_plan_invalid_reservation' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 aid:=(p_payload->>'record_id')::uuid;op:='cut_plan_stock:'||aid::text||':'||(d->>'action')||':'||(d->>'reservation_revision');
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='PT409'; end if;
  return existing.receipt;
 end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=32 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 before_row:=bob_private.read_cut_plan(p_project,aid,null);
 rec:=bob_private.cut_plan_stock_command(p_project,d->>'action',aid,(p_payload->>'expected_revision')::integer,(d->>'reservation_revision')::integer,d->>'change_note');
 result:=jsonb_build_object('projectId',p_project,'dataset','cut_plans','recordId',aid,'revision',(rec->>'revision')::integer,'areaId',null,'label','Construction cut plan','operation','updated','savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
end $$;
create function bob.bob_project_write_v16(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.bob_project_write_v16(p_project,p_thread,p_turn,p_generation,p_payload) $$;
revoke all on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb),bob.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) to authenticated;

alter function bob.read_project_work(text,jsonb) rename to read_project_work_before_cut_plan_reservations;
create function bob.read_project_work(p_project text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; rows jsonb;
begin
 result:=bob.read_project_work_before_cut_plan_reservations(p_project,p_input);
 if p_input->>'resource'='stock' then
  select coalesce(jsonb_agg(value||jsonb_build_object('reserved_quantity',bob_private.read_stock_reservations(p_project,(value->>'id')::uuid),
   'unreserved_sheets',case when value->>'unit'='pcs' and value->'sheet_format' is not null and value->'sheet_format'<>'null' then greatest(0,(value->>'quantity')::numeric-bob_private.read_stock_reservations(p_project,(value->>'id')::uuid)) else null end)),'[]') into rows
   from jsonb_array_elements(result->'records');
  result:=jsonb_set(result,'{records}',rows);
 end if;
 return result;
end $$;
revoke all on function bob.read_project_work(text,jsonb) from public,anon,service_role;
grant execute on function bob.read_project_work(text,jsonb) to authenticated;

-- The stock-count helper stays private; an invoker read must use a guarded bridge.
create function bob_private.read_stock_reservations(p_project text,p_stock uuid) returns numeric
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) or not exists(select 1 from bob.stock_items where project_id=p_project and id=p_stock) then raise exception 'project_denied' using errcode='42501'; end if;
 return bob_private.material_stock_reserved(p_project,p_stock,null,null);
end $$;
revoke all on function bob_private.read_stock_reservations(text,uuid) from public,anon,service_role;
grant execute on function bob_private.read_stock_reservations(text,uuid) to authenticated;

update bob.tool_catalog set how_to=how_to||' For a current saved cut_plan whose actually used sheets all pin available matching stock, resource=cut_plan with reserve/release changes one shared whole-sheet reservation, not the blank quantities. Read cut_plan first; expected_revision is its plan revision and data is {reservation_revision,change_note}. Reserve rejects hypothetical/catalog used sheets; release is explicit and remains possible after source changes. No raw quantity or allocation input. Reopen cut_plan and stock to verify. Shopping remains blocked for construction blank needs.' where name='manage_project_material';
update bob.tool_catalog set how_to=how_to||' Cut plans now include reservation_revision and immutable reservation history with stock allocations. Stale reservations still hold capacity until explicit release; stock reads count both manual and cut-plan commitments once. stock_reserved is current full-stock coverage only; fabrication/input-evidence/Shopping approval remains false.' where name='read_project_work';
notify pgrst,'reload schema';
commit;
