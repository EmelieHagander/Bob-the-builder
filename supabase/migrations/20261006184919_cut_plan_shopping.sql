-- K4: whole catalog sheets contribute to the existing Shopping register.
-- CLI native-crash fallback: filename is the observed UTC creation time.
begin;
create table bob.cut_plan_purchase_groups (
 id uuid primary key default gen_random_uuid(), project_id text not null references bob.projects(id) on delete cascade,
 part_id uuid not null, part_revision integer not null, grain text not null check(grain in ('length','width','none')),
 material_id text unique references bob.materials(id) on delete set null,
 synced_name text not null default '', synced_qty text not null default '',
 foreign key(part_id,part_revision) references bob.catalog_item_revisions(item_id,revision),
 unique(project_id,part_id,part_revision,grain), unique(id,project_id)
);
create table bob.cut_plan_shopping (
 plan_id uuid primary key, project_id text not null, current_revision integer not null check(current_revision>0),
 foreign key(plan_id,project_id) references bob.material_cut_plans(id,project_id) on delete cascade, unique(plan_id,project_id)
);
create table bob.cut_plan_shopping_revisions (
 plan_id uuid not null, project_id text not null, revision integer not null check(revision>0), plan_revision integer not null,
 published boolean not null, change_note text not null, recorded_by uuid not null, actor_label text not null,
 recorded_at timestamptz not null default now(), primary key(plan_id,revision), unique(plan_id,project_id,revision),
 foreign key(plan_id,project_id) references bob.cut_plan_shopping(plan_id,project_id) on delete cascade,
 foreign key(plan_id,plan_revision,project_id) references bob.material_cut_plan_revisions(plan_id,revision,project_id)
);
alter table bob.cut_plan_shopping add constraint cut_plan_shopping_current_fk foreign key(plan_id,project_id,current_revision)
 references bob.cut_plan_shopping_revisions(plan_id,project_id,revision) deferrable initially deferred;
create table bob.cut_plan_shopping_contributions (
 plan_id uuid not null, project_id text not null, shopping_revision integer not null, group_id uuid not null,
 quantity integer not null check(quantity between 1 and 16), material_id_snapshot text not null,
 primary key(plan_id,shopping_revision,group_id),
 foreign key(plan_id,project_id,shopping_revision) references bob.cut_plan_shopping_revisions(plan_id,project_id,revision) on delete cascade,
 foreign key(group_id,project_id) references bob.cut_plan_purchase_groups(id,project_id)
);
create index cut_plan_purchase_groups_part_idx on bob.cut_plan_purchase_groups(part_id,part_revision);
create index cut_plan_shopping_project_idx on bob.cut_plan_shopping(project_id);
create index cut_plan_shopping_current_idx on bob.cut_plan_shopping(plan_id,project_id,current_revision);
create index cut_plan_shopping_revisions_plan_idx on bob.cut_plan_shopping_revisions(plan_id,plan_revision,project_id);
create index cut_plan_shopping_contributions_group_idx on bob.cut_plan_shopping_contributions(group_id,project_id);
create index cut_plan_shopping_contributions_revision_idx on bob.cut_plan_shopping_contributions(plan_id,project_id,shopping_revision);
alter table bob.cut_plan_purchase_groups enable row level security;
alter table bob.cut_plan_shopping enable row level security;
alter table bob.cut_plan_shopping_revisions enable row level security;
alter table bob.cut_plan_shopping_contributions enable row level security;
revoke all on bob.cut_plan_purchase_groups,bob.cut_plan_shopping,bob.cut_plan_shopping_revisions,bob.cut_plan_shopping_contributions from public,anon,authenticated,service_role;
grant select on bob.cut_plan_purchase_groups,bob.cut_plan_shopping,bob.cut_plan_shopping_revisions,bob.cut_plan_shopping_contributions to authenticated;
create policy project_read on bob.cut_plan_purchase_groups for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.cut_plan_shopping for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.cut_plan_shopping_revisions for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.cut_plan_shopping_contributions for select to authenticated using(bob_private.has_project_access(project_id));

-- Published purchase commitments must be withdrawn before changing the layout.
-- This prevents revising into reserved stock while silently retaining purchases.
create function bob_private.guard_cut_plan_shopping_revision() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if new.current_revision<>old.current_revision and exists(select 1 from bob.cut_plan_shopping h join bob.cut_plan_shopping_revisions r
  on r.plan_id=h.plan_id and r.revision=h.current_revision where h.plan_id=old.id and r.published) then
  raise exception 'cut_plan_shopping_withdraw_required' using errcode='PT409'; end if;
 return new;
end $$;
revoke all on function bob_private.guard_cut_plan_shopping_revision() from public,anon,authenticated,service_role;
create trigger cut_plan_shopping_revision_guard before update on bob.material_cut_plans for each row execute function bob_private.guard_cut_plan_shopping_revision();

alter function bob_private.read_cut_plan(text,uuid,integer) rename to read_cut_plan_before_shopping;
revoke all on function bob_private.read_cut_plan_before_shopping(text,uuid,integer) from public,anon,authenticated,service_role;
create function bob_private.read_cut_plan(p_project text,p_plan uuid,p_revision integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; shopping jsonb;
begin
 result:=bob_private.read_cut_plan_before_shopping(p_project,p_plan,p_revision);
 select to_jsonb(r)||jsonb_build_object('contributions',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object(
  'material_id',g.material_id,'part_id',g.part_id,'part_revision',g.part_revision,'grain',g.grain,
  'material_missing',m.id is null,'shopping_edited',m.id is not null and (m.name<>g.synced_name or m.qty<>g.synced_qty or m.area_label<>'' or m.category<>'Timber')) order by c.group_id)
  from bob.cut_plan_shopping_contributions c join bob.cut_plan_purchase_groups g on g.id=c.group_id
  left join bob.materials m on m.id=g.material_id and m.project_id=p_project
  where c.plan_id=r.plan_id and c.shopping_revision=r.revision),'[]')) into shopping
 from bob.cut_plan_shopping h join bob.cut_plan_shopping_revisions r on r.plan_id=h.plan_id and r.revision=h.current_revision
 where h.plan_id=p_plan and h.project_id=p_project;
 -- A current publication is traceable planning, not product/pack/fabrication approval.
 return result||jsonb_build_object('shopping_revision',coalesce((shopping->>'revision')::integer,0),'shopping',shopping,
  'shopping_ready',result->>'source_state'='current' and coalesce((shopping->>'published')::boolean,false)
   and shopping->'plan_revision'=result->'revision' and not exists(select 1 from jsonb_array_elements(shopping->'contributions') c
     where (c->>'material_missing')::boolean or (c->>'shopping_edited')::boolean));
end $$;
revoke all on function bob_private.read_cut_plan(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.read_cut_plan(text,uuid,integer) to authenticated;

create function bob_private.cut_plan_shopping_command(p_project text,p_action text,p_plan uuid,p_expected integer,p_shopping_expected integer,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h bob.material_cut_plans; r bob.material_cut_plan_revisions; sh bob.cut_plan_shopping; prior bob.cut_plan_shopping_revisions;
 c bob.artifact_construction_revisions; packet bob.artifact_cad_revisions; g bob.cut_plan_purchase_groups; m bob.materials;
 part bob.catalog_item_revisions; s jsonb; f jsonb; gid uuid; desired jsonb:='{}'; total_qty integer; quantity_text text; label text; actor text; n integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action is null or p_action not in ('publish','withdraw') or p_plan is null or p_expected is null or p_expected<1 or p_shopping_expected is null or p_shopping_expected<0
  or p_note is null or char_length(btrim(p_note)) not between 1 and 1000 then raise exception 'cut_plan_invalid_shopping' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select * into h from bob.material_cut_plans where project_id=p_project and id=p_plan for update;
 if not found then raise exception 'project_denied' using errcode='42501'; end if;
 if h.current_revision<>p_expected then raise exception 'cut_plan_changed' using errcode='PT409'; end if;
 select * into sh from bob.cut_plan_shopping where plan_id=p_plan and project_id=p_project for update;
 if coalesce(sh.current_revision,0)<>p_shopping_expected then raise exception 'cut_plan_shopping_changed' using errcode='PT409'; end if;
 select * into prior from bob.cut_plan_shopping_revisions where plan_id=p_plan and revision=sh.current_revision;
 select name into actor from bob.people where project_id=p_project and auth_user_id=auth.uid();
 if actor is null then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action='withdraw' and not coalesce(prior.published,false) then raise exception 'cut_plan_shopping_not_published' using errcode='PT409'; end if;
 if p_action='publish' then
  select * into r from bob.material_cut_plan_revisions where plan_id=p_plan and revision=h.current_revision;
  select * into c from bob.artifact_construction_revisions where project_id=p_project and artifact_id=r.artifact_id and artifact_revision=r.artifact_revision;
  perform 1 from bob.artifacts where project_id=p_project and id=c.artifact_id and current_revision=c.artifact_revision for share;
  if not found then raise exception 'cut_plan_construction_changed' using errcode='PT409'; end if;
  perform 1 from bob.measurements where project_id=p_project and id in(select measurement_id from bob.artifact_measurements where artifact_id=c.artifact_id and artifact_revision=c.artifact_revision) order by id for share;
  packet.project_id:=p_project;packet.artifact_id:=c.artifact_id;packet.artifact_revision:=c.artifact_revision;packet.recipe:=c.recipe;packet.manifest:=jsonb_build_object('bob_parameters',c.parameters);
  perform bob_private.check_cad_parameter_graph(packet,false);
  perform 1 from bob.catalog_items where id in(select (value->>'material_id')::uuid from jsonb_array_elements(r.candidates)) order by id for share;
  perform bob_private.cut_plan_sources(p_project,r.candidates,r.candidate_sources,true,p_plan);
  if bob_private.read_cut_plan_before_shopping(p_project,p_plan,h.current_revision)->>'source_state' is distinct from 'current' then raise exception 'cut_plan_sources_changed' using errcode='PT409'; end if;
  if jsonb_array_length(r.layout->'used_sheets')=0 or exists(select 1 from jsonb_array_elements_text(r.layout->'used_sheets') u
   left join jsonb_array_elements(r.candidate_sources) cs on cs->>'candidate_id'=regexp_replace(u,':[0-9]+$','')
   where cs is null or cs->>'kind' is distinct from 'catalog_part') then raise exception 'cut_plan_shopping_catalog_required' using errcode='22023'; end if;
  for s in select cs from jsonb_array_elements_text(r.layout->'used_sheets') u join jsonb_array_elements(r.candidate_sources) cs on cs->>'candidate_id'=regexp_replace(u,':[0-9]+$','') loop
   select value into f from jsonb_array_elements(r.candidates) where value->>'id'=s->>'candidate_id';
   insert into bob.cut_plan_purchase_groups(project_id,part_id,part_revision,grain) values(p_project,(s->>'record_id')::uuid,(s->>'revision')::integer,f->>'grain')
    on conflict(project_id,part_id,part_revision,grain) do nothing;
   select id into gid from bob.cut_plan_purchase_groups where project_id=p_project and part_id=(s->>'record_id')::uuid and part_revision=(s->>'revision')::integer and grain=f->>'grain';
   desired:=jsonb_set(desired,array[gid::text],to_jsonb(coalesce((desired->>gid::text)::integer,0)+1));
  end loop;
 end if;
 -- Lock shared Shopping rows in a stable order. Only this plan's latest contribution
 -- is replaced; all other current commitments, even stale ones, remain counted.
 for g in select * from bob.cut_plan_purchase_groups where project_id=p_project and (desired ? id::text or id in
  (select group_id from bob.cut_plan_shopping_contributions where plan_id=p_plan and shopping_revision=sh.current_revision)) order by id for update loop
  select coalesce(sum(a.quantity),0)::integer+coalesce((desired->>g.id::text)::integer,0) into total_qty
   from bob.cut_plan_shopping_contributions a join bob.cut_plan_shopping ah on ah.plan_id=a.plan_id and ah.current_revision=a.shopping_revision
   join bob.cut_plan_shopping_revisions ar on ar.plan_id=ah.plan_id and ar.revision=ah.current_revision
   where a.group_id=g.id and a.plan_id<>p_plan and ar.published;
  select * into part from bob.catalog_item_revisions where item_id=g.part_id and revision=g.part_revision;
  label:=part.name||' — '||(part.properties->'length'->>'value')||' × '||(part.properties->'width'->>'value')||' × '||(part.properties->'thickness'->>'value')||' mm · grain '||g.grain;
  quantity_text:=total_qty::text||' pcs';
  select * into m from bob.materials where id=g.material_id and project_id=p_project for update;
  if found then
   if m.name<>g.synced_name or m.qty<>g.synced_qty or m.area_label<>'' or m.category<>'Timber' then raise exception 'cut_plan_shopping_edited' using errcode='PT409'; end if;
   if m.status<>'needed' and (m.name<>label or m.qty<>quantity_text) then raise exception 'cut_plan_shopping_committed' using errcode='PT409'; end if;
   update bob.materials set name=label,qty=quantity_text where id=m.id and (name<>label or qty<>quantity_text);
  elsif g.material_id is not null or g.synced_name<>'' then
   -- Deletion never silently recreates purchases that may already have been ordered.
   raise exception 'cut_plan_shopping_missing' using errcode='PT409';
  elsif total_qty>0 then
   insert into bob.materials(id,project_id,name,qty,category,category_icon) values('m_'||replace(gen_random_uuid()::text,'-',''),p_project,label,quantity_text,'Timber','package') returning * into m;
  end if;
  update bob.cut_plan_purchase_groups set material_id=m.id,synced_name=label,synced_qty=quantity_text where id=g.id;
 end loop;
 n:=coalesce(sh.current_revision,0)+1;
 if sh.plan_id is null then insert into bob.cut_plan_shopping values(p_plan,p_project,n); end if;
 insert into bob.cut_plan_shopping_revisions(plan_id,project_id,revision,plan_revision,published,change_note,recorded_by,actor_label)
  values(p_plan,p_project,n,h.current_revision,p_action='publish',btrim(p_note),auth.uid(),actor);
 insert into bob.cut_plan_shopping_contributions(plan_id,project_id,shopping_revision,group_id,quantity,material_id_snapshot)
  select p_plan,p_project,n,grp.id,e.value::integer,grp.material_id from jsonb_each_text(desired) e join bob.cut_plan_purchase_groups grp on grp.id=e.key::uuid;
 update bob.cut_plan_shopping set current_revision=n where plan_id=p_plan;
 return bob_private.read_cut_plan(p_project,p_plan,h.current_revision);
end $$;
revoke all on function bob_private.cut_plan_shopping_command(text,text,uuid,integer,integer,text) from public,anon,service_role;
grant execute on function bob_private.cut_plan_shopping_command(text,text,uuid,integer,integer,text) to authenticated;
create function bob.material_cut_plan_shopping_command(p_project text,p_action text,p_plan uuid,p_expected integer,p_shopping_expected integer,p_note text) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.cut_plan_shopping_command(p_project,p_action,p_plan,p_expected,p_shopping_expected,p_note) $$;
revoke all on function bob.material_cut_plan_shopping_command(text,text,uuid,integer,integer,text) from public,anon,service_role;
grant execute on function bob.material_cut_plan_shopping_command(text,text,uuid,integer,integer,text) to authenticated;

-- Preserve the deployed writer ABI; extend its dispatch and retain exact old delegates.
alter function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_shopping;
revoke all on function bob_private.bob_project_write_before_shopping(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v16(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; existing bob_private.bob_write_receipts; msg text; op text; before_row jsonb; rec jsonb; result jsonb; aid uuid;
begin
 if p_payload->>'kind' is distinct from 'cut_plan_shopping' then return bob_private.bob_project_write_before_shopping(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>6000 or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or coalesce(p_payload->>'expected_revision','')!~'^[1-9][0-9]{0,8}$' or p_payload->>'record_id' is null
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(p_payload->>'request_quote') not between 1 and 500
  or jsonb_typeof(d) is distinct from 'object' or d-array['action','shopping_revision','change_note']<>'{}' or (select count(*) from jsonb_object_keys(d))<>3
  or coalesce(d->>'action','') not in ('publish','withdraw') or coalesce(d->>'shopping_revision','')!~'^[0-9]{1,9}$'
  or jsonb_typeof(d->'shopping_revision') is distinct from 'number' or jsonb_typeof(d->'change_note') is distinct from 'string'
  then raise exception 'cut_plan_invalid_shopping' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 aid:=(p_payload->>'record_id')::uuid;op:='cut_plan_shopping:'||aid::text||':'||(d->>'action')||':'||(d->>'shopping_revision');
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='PT409'; end if;
  return existing.receipt;
 end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=32 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 before_row:=bob_private.read_cut_plan(p_project,aid,null);
 rec:=bob_private.cut_plan_shopping_command(p_project,d->>'action',aid,(p_payload->>'expected_revision')::integer,(d->>'shopping_revision')::integer,d->>'change_note');
 result:=jsonb_build_object('projectId',p_project,'dataset','cut_plans','recordId',aid,'revision',(rec->>'revision')::integer,'areaId',null,'label','Construction cut plan','operation','updated','savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) to authenticated;

create function bob_private.cut_plan_purchase_sources(p_project text,p_material text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g bob.cut_plan_purchase_groups; result jsonb; amount bigint;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select * into g from bob.cut_plan_purchase_groups where project_id=p_project and material_id=p_material;
 if not found then return null; end if;
 select count(*) into amount from bob.cut_plan_shopping_contributions c join bob.cut_plan_shopping h on h.plan_id=c.plan_id and h.current_revision=c.shopping_revision
  join bob.cut_plan_shopping_revisions r on r.plan_id=h.plan_id and r.revision=h.current_revision where c.group_id=g.id and r.published;
 select coalesce(jsonb_agg(to_jsonb(v) order by v.plan_id),'[]') into result from (
  select c.plan_id,r.plan_revision,c.shopping_revision,c.quantity,pr.artifact_id,pr.artifact_revision,
   h.current_revision<>r.plan_revision as plan_changed
  from bob.cut_plan_shopping_contributions c join bob.cut_plan_shopping sh on sh.plan_id=c.plan_id and sh.current_revision=c.shopping_revision
  join bob.cut_plan_shopping_revisions r on r.plan_id=sh.plan_id and r.revision=sh.current_revision
  join bob.material_cut_plans h on h.id=c.plan_id join bob.material_cut_plan_revisions pr on pr.plan_id=h.id and pr.revision=r.plan_revision
  where c.group_id=g.id and r.published order by c.plan_id limit 25
 ) v;
 return jsonb_build_object('part_id',g.part_id,'part_revision',g.part_revision,'grain',g.grain,'unit','pcs','purchase_unit','sheet',
  'contributions',result,'contribution_count',amount,'truncated',amount>25,'source_state','not_checked','product_verified',false,'pack_count',null,
  'shopping_edited',exists(select 1 from bob.materials m where m.id=g.material_id and (m.name<>g.synced_name or m.qty<>g.synced_qty or m.area_label<>'' or m.category<>'Timber')));
end $$;
revoke all on function bob_private.cut_plan_purchase_sources(text,text) from public,anon,service_role;
grant execute on function bob_private.cut_plan_purchase_sources(text,text) to authenticated;
alter function bob.read_project_work(text,jsonb) rename to read_project_work_before_cut_plan_shopping;
create function bob.read_project_work(p_project text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; rows jsonb;
begin
 result:=bob.read_project_work_before_cut_plan_shopping(p_project,p_input);
 if p_input->>'resource'='shopping' then
  select coalesce(jsonb_agg(value||jsonb_build_object('cut_plan_source',bob_private.cut_plan_purchase_sources(p_project,value->>'id'))),'[]') into rows from jsonb_array_elements(result->'records');
  result:=jsonb_set(result,'{records}',rows);
 end if;
 return result;
end $$;
revoke all on function bob.read_project_work(text,jsonb) from public,anon,service_role;
grant execute on function bob.read_project_work(text,jsonb) to authenticated;
update bob.tool_catalog set how_to=how_to||' For catalog-bound cut plans, publish/withdraw uses data {shopping_revision,change_note} with exact plan UUID/current expected_revision. Publish counts only actually used whole sheets, aggregated by exact catalog part revision and grain, into existing Shopping. All used sheets must be catalog_part; hypothetical, stock and mixed sources cannot publish. Read cut_plan and shopping after saving. Preserve manual/ordered/delivered/deleted Shopping rows; withdraw before revising a published plan. Catalog format is not verified product/pack evidence. Construction blank requirements still cannot publish individually.' where name='manage_project_material';
update bob.tool_catalog set how_to=replace(how_to,'fabrication/input-evidence/Shopping approval remains false.','fabrication/input-evidence approval remains false.')||' Cut plans also return shopping_revision and versioned shopping contributions. shopping_ready means only a current unchanged publication; product, pack and fabrication approval remain separate. Shopping rows include cut_plan_source with exact contribution plan/construction revisions, sheet quantities and edited status. Its bounded contribution list declares truncation and source_state=not_checked; reopen contributing cut_plan records for current source assessment before ordering.' where name='read_project_work';
notify pgrst,'reload schema';
commit;
