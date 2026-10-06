-- K4: independent stock and catalog commitments for the same saved layout.
-- CLI migration new --help aborted in its native Bun binary; filename uses observed UTC.
-- Existing project locks, CAS, source fences, receipts, history and ACLs stay in place.
begin;
create or replace function bob_private.cut_plan_stock_command(p_project text,p_action text,p_plan uuid,p_expected integer,p_reservation_expected integer,p_note text) returns jsonb
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
   where s is null or coalesce(s->>'kind','') not in ('stock','catalog_part'))
   or not exists(select 1 from jsonb_array_elements_text(r.layout->'used_sheets') u
    join jsonb_array_elements(r.candidate_sources) s on s->>'candidate_id'=regexp_replace(u,':[0-9]+$','') where s->>'kind'='stock') then raise exception 'cut_plan_stock_sources_required' using errcode='22023'; end if;
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
   where s->>'kind'='stock'
   group by s->>'record_id',s->>'revision' order by s->>'record_id';
 end if;
 update bob.material_cut_plan_reservations set current_revision=n where project_id=p_project and plan_id=p_plan;
 return bob_private.read_cut_plan(p_project,p_plan,h.current_revision);
end $$;

create or replace function bob_private.cut_plan_shopping_command(p_project text,p_action text,p_plan uuid,p_expected integer,p_shopping_expected integer,p_note text) returns jsonb
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
   where cs is null or coalesce(cs->>'kind','') not in ('stock','catalog_part'))
   or not exists(select 1 from jsonb_array_elements_text(r.layout->'used_sheets') u
    join jsonb_array_elements(r.candidate_sources) cs on cs->>'candidate_id'=regexp_replace(u,':[0-9]+$','') where cs->>'kind'='catalog_part') then raise exception 'cut_plan_shopping_catalog_required' using errcode='22023'; end if;
  for s in select cs from jsonb_array_elements_text(r.layout->'used_sheets') u join jsonb_array_elements(r.candidate_sources) cs on cs->>'candidate_id'=regexp_replace(u,':[0-9]+$','') where cs->>'kind'='catalog_part' loop
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

create or replace function bob_private.read_cut_plan(p_project text,p_plan uuid,p_revision integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; shopping jsonb; used_count integer; stock_count integer; catalog_count integer; stock_current boolean; purchase_current boolean;
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
 if result is null then return null; end if;
 select count(*),count(*) filter(where s->>'kind'='stock'),count(*) filter(where s->>'kind'='catalog_part')
 into used_count,stock_count,catalog_count
 from jsonb_array_elements_text(result->'layout'->'used_sheets') u
 left join jsonb_array_elements(result->'candidate_sources') s on s->>'candidate_id'=regexp_replace(u,':[0-9]+$','');
 stock_current:=stock_count>0 and coalesce((result->>'stock_reserved')::boolean,false);
 -- Publication covers only the catalog portion; stock remains a separate commitment.
 purchase_current:=catalog_count>0 and result->>'source_state'='current' and coalesce((shopping->>'published')::boolean,false)
   and shopping->'plan_revision'=result->'revision' and not exists(select 1 from jsonb_array_elements(shopping->'contributions') c
     where (c->>'material_missing')::boolean or (c->>'shopping_edited')::boolean);
 return result||jsonb_build_object('shopping_revision',coalesce((shopping->>'revision')::integer,0),'shopping',shopping,
  'stock_reserved',stock_current and stock_count=used_count,'shopping_ready',purchase_current,
  'supply',jsonb_build_object('used_sheets',used_count,'stock_sheets',stock_count,'catalog_sheets',catalog_count,
   'hypothetical_sheets',used_count-stock_count-catalog_count,'stock_commitment_current',stock_current,
   'purchase_commitment_current',purchase_current,'commitments_current',used_count>0 and stock_count+catalog_count=used_count
     and (stock_count=0 or stock_current) and (catalog_count=0 or purchase_current)));
end $$;

update bob.tool_catalog set how_to='Read current resources and target first. Full revisions preserve existing allocations. Publish only reviewed current requirements; creating a Shopping entry is not buying anything. Stock create/revise may include sheet_format:{material_id,material_revision,length_mm,width_mm,thickness_mm,grain,basis,note} for exact sheet_stock materials and whole pcs. basis is measured, provided_spec or estimated; never invent inspection or stock. Omission on revise preserves the format; explicit null removes it. Existing construction blank reservation and Shopping guards remain in force even after saving a cut plan. For a current saved cut_plan with actually used stock sheets, resource=cut_plan with reserve/release changes one shared whole-sheet reservation, not the blank quantities. Read cut_plan first; expected_revision is its plan revision and data is {reservation_revision,change_note}. Reserve commits only the stock-bound used sheets, leaving catalog-bound sheets for explicit publish. Used hypothetical sheets are rejected; release is explicit and remains possible after source changes. No raw quantity or allocation input. Reopen cut_plan and stock to verify. Shopping remains blocked for construction blank needs. For catalog-bound cut plans, publish/withdraw uses data {shopping_revision,change_note} with exact plan UUID/current expected_revision. Publish counts only actually used whole sheets, aggregated by exact catalog part revision and grain, into existing Shopping. Publish commits only the catalog-bound used sheets; reserve separately commits stock-bound used sheets. Every used sheet must be stock or catalog_part; used hypothetical sheets are rejected. At least one catalog sheet is required to publish and at least one stock sheet to reserve. Read cut_plan and shopping after saving. Preserve manual/ordered/delivered/deleted Shopping rows; withdraw before revising a published plan. Catalog format is not verified product/pack evidence. Construction blank requirements still cannot publish individually. Mixed supply uses the same plan and independent reservation/Shopping revisions. Either command may run first; each is atomic, not an atomic pair. After partial success reopen the plan and retry only the missing operation; never silently release or withdraw the successful commitment. Release and withdraw affect only their own portion, and both active commitments must be cleared before revising the layout.' where name='manage_project_material';
update bob.tool_catalog set how_to='Read exact records before changing them. Follow next_cursor. Stock quantities and deliveries remain recorded observations, not inferred availability. Saved cut plans are read through resource=cut_plan (list or exact record_id); inspect source_state, exact need/source pins and current capacity. Stock reads include structured sheet_format and unreserved_sheets; a capacity preview never reserves stock. Cut plans now include reservation_revision and immutable reservation history with stock allocations. Stale reservations still hold capacity until explicit release; stock reads count both manual and cut-plan commitments once. stock_reserved is current full-stock coverage only (false for mixed plans); fabrication/input-evidence approval remains false. Cut plans also return shopping_revision and versioned shopping contributions. shopping_ready means only a current unchanged publication; product, pack and fabrication approval remain separate. Shopping rows include cut_plan_source with exact contribution plan/construction revisions, sheet quantities and edited status. Its bounded contribution list declares truncation and source_state=not_checked; reopen contributing cut_plan records for current source assessment before ordering. Cut-plan supply reports actual used stock/catalog/hypothetical sheet counts and stock_commitment_current, purchase_commitment_current and commitments_current. A mixed plan is fully committed only when both portions are current; this is planning coverage, never physical/product/pack/fabrication approval. A failed second operation or explicit release/withdraw leaves honest partial coverage; stale commitments remain held until explicit removal.' where name='read_project_work';
commit;
