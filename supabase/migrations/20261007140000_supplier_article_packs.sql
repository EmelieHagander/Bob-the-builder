-- K4: versioned supplier-article/source binding and pack-rounded Shopping purchases.
-- Contract: Docs/material-planning.md#k4-supplier-articles-and-pack-purchases.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A supplier article is project-private declared product evidence over one exact
-- catalog revision. It is not stock inspection, suitability or structural approval.
create table bob.supplier_articles (
 id uuid primary key, project_id text not null references bob.projects(id) on delete cascade,
 current_revision integer not null check(current_revision>0), unique(id,project_id)
);
create table bob.supplier_article_revisions (
 article_id uuid not null, project_id text not null, revision integer not null check(revision>0),
 catalog_item_id uuid not null, catalog_item_revision integer not null,
 title text not null check(char_length(btrim(title)) between 1 and 200),
 supplier text not null default '' check(char_length(supplier)<=200),
 manufacturer text not null default '' check(char_length(manufacturer)<=200),
 article_number text not null check(char_length(btrim(article_number)) between 1 and 120),
 variant text not null default '' check(char_length(variant)<=200),
 source_url text check(source_url is null or (char_length(source_url)<=2000 and source_url ~ '^https?://[^[:space:]]+$')),
 source_document text not null default '' check(char_length(source_document)<=500),
 source_version text not null default '' check(char_length(source_version)<=120),
 source_date date,
 supported_fields text[] not null check(cardinality(supported_fields)<=10 and array_position(supported_fields,null) is null
  and supported_fields <@ array['title','manufacturer','article_number','variant','purchase_unit','content_per_purchase_unit','content_unit','dimensions','material','application']),
 purchase_unit text not null check(purchase_unit in ('pack','box','bag','pcs','sheet','roll','bucket','length')),
 content_per_purchase_unit numeric(18,4) check(content_per_purchase_unit is null or content_per_purchase_unit between 0.0001 and 1000000000),
 content_unit text not null check(content_unit in ('pcs','m','m2','m3','kg','l')),
 notes text not null default '' check(char_length(notes)<=2000),
 withdrawn boolean not null default false,
 change_note text not null check(char_length(btrim(change_note)) between 1 and 1000),
 recorded_by uuid not null, actor_label text not null, recorded_at timestamptz not null default clock_timestamp(),
 primary key(article_id,revision), unique(article_id,project_id,revision),
 foreign key(article_id,project_id) references bob.supplier_articles(id,project_id) on delete cascade,
 foreign key(catalog_item_id,catalog_item_revision) references bob.catalog_item_revisions(item_id,revision),
 check(char_length(btrim(supplier))>0 or char_length(btrim(manufacturer))>0),
 check(source_url is not null or char_length(btrim(source_document))>0),
 -- A known pack size must be a field the cited source actually supports.
 check(content_per_purchase_unit is null or ('content_per_purchase_unit'=any(supported_fields) and 'purchase_unit'=any(supported_fields))),
 check(content_unit<>'pcs' or content_per_purchase_unit is null or content_per_purchase_unit=trunc(content_per_purchase_unit))
);
alter table bob.supplier_articles add constraint supplier_article_current_fk foreign key(id,project_id,current_revision)
 references bob.supplier_article_revisions(article_id,project_id,revision) deferrable initially deferred;

-- One pack purchase per article. Its revisions pin the article revision and the
-- exact requirement revisions aggregated before rounding.
create table bob.pack_purchases (
 article_id uuid primary key, project_id text not null, current_revision integer not null check(current_revision>0),
 material_id text unique references bob.materials(id) on delete set null,
 synced_name text not null default '', synced_qty text not null default '', synced_category text not null default '',
 foreign key(article_id,project_id) references bob.supplier_articles(id,project_id) on delete cascade, unique(article_id,project_id)
);
create table bob.pack_purchase_revisions (
 article_id uuid not null, project_id text not null, revision integer not null check(revision>0),
 article_revision integer not null, published boolean not null,
 total_quantity numeric(18,4) not null check(total_quantity>=0), content_unit text not null,
 content_per_purchase_unit numeric(18,4), purchase_unit text not null,
 purchase_count integer check(purchase_count>=0), surplus_quantity numeric(18,4) check(surplus_quantity>=0),
 change_note text not null check(char_length(btrim(change_note)) between 1 and 1000),
 recorded_by uuid not null, actor_label text not null, recorded_at timestamptz not null default clock_timestamp(),
 primary key(article_id,revision), unique(article_id,project_id,revision),
 foreign key(article_id,project_id) references bob.pack_purchases(article_id,project_id) on delete cascade,
 foreign key(article_id,project_id,article_revision) references bob.supplier_article_revisions(article_id,project_id,revision)
);
alter table bob.pack_purchases add constraint pack_purchase_current_fk foreign key(article_id,project_id,current_revision)
 references bob.pack_purchase_revisions(article_id,project_id,revision) deferrable initially deferred;
create table bob.pack_purchase_needs (
 article_id uuid not null, project_id text not null, revision integer not null,
 requirement_id uuid not null, requirement_revision integer not null, quantity numeric(18,4) not null check(quantity>=0),
 primary key(article_id,revision,requirement_id),
 foreign key(article_id,project_id,revision) references bob.pack_purchase_revisions(article_id,project_id,revision) on delete cascade,
 foreign key(requirement_id,requirement_revision) references bob.material_requirement_revisions(requirement_id,revision) on delete cascade
);
create index supplier_articles_project_idx on bob.supplier_articles(project_id);
create index supplier_article_revisions_catalog_idx on bob.supplier_article_revisions(catalog_item_id,catalog_item_revision);
create index pack_purchases_project_idx on bob.pack_purchases(project_id);
create index pack_purchase_revisions_article_idx on bob.pack_purchase_revisions(article_id,project_id,article_revision);
create index pack_purchase_needs_requirement_idx on bob.pack_purchase_needs(requirement_id,requirement_revision);
create index pack_purchase_needs_revision_idx on bob.pack_purchase_needs(article_id,project_id,revision);
alter table bob.supplier_articles enable row level security;
alter table bob.supplier_article_revisions enable row level security;
alter table bob.pack_purchases enable row level security;
alter table bob.pack_purchase_revisions enable row level security;
alter table bob.pack_purchase_needs enable row level security;
revoke all on bob.supplier_articles,bob.supplier_article_revisions,bob.pack_purchases,bob.pack_purchase_revisions,bob.pack_purchase_needs from public,anon,authenticated,service_role;
grant select on bob.supplier_articles,bob.supplier_article_revisions,bob.pack_purchases,bob.pack_purchase_revisions,bob.pack_purchase_needs to authenticated;
create policy project_read on bob.supplier_articles for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.supplier_article_revisions for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.pack_purchases for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.pack_purchase_revisions for select to authenticated using(bob_private.has_project_access(project_id));
create policy project_read on bob.pack_purchase_needs for select to authenticated using(bob_private.has_project_access(project_id));

create function bob_private.read_supplier_article(p_project text,p_article uuid,p_revision integer default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h bob.supplier_articles; r bob.supplier_article_revisions; item bob.catalog_items; cat bob.catalog_item_revisions;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select * into h from bob.supplier_articles where id=p_article and project_id=p_project;
 if not found then raise exception 'supplier_article_unavailable' using errcode='P0002'; end if;
 select * into r from bob.supplier_article_revisions where article_id=p_article and revision=coalesce(p_revision,h.current_revision);
 if not found then raise exception 'supplier_article_unavailable' using errcode='P0002'; end if;
 select * into item from bob.catalog_items where id=r.catalog_item_id;
 select * into cat from bob.catalog_item_revisions where item_id=r.catalog_item_id and revision=r.catalog_item_revision;
 return to_jsonb(r)-'article_id'||jsonb_build_object('id',p_article,'name',r.title,'current_revision',h.current_revision,
  'catalog_item_name',cat.name,'catalog_item_kind',item.kind,'catalog_changed',item.current_revision<>r.catalog_item_revision,
  'source_state',case when r.withdrawn then 'withdrawn' when h.current_revision<>r.revision then 'superseded' else 'current' end,
  'pack_known',r.content_per_purchase_unit is not null,
  -- Declared source fields only; no inspection, compatibility or structural approval.
  'product_bound',true,'suitability_verified',false,'physical_verified',false);
end $$;
revoke all on function bob_private.read_supplier_article(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.read_supplier_article(text,uuid,integer) to authenticated;

create function bob_private.supplier_article_command(p_project text,p_action text,p_article uuid,p_expected integer,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h bob.supplier_articles; prior bob.supplier_article_revisions; n integer; actor text; d jsonb:=p_data; item bob.catalog_items; content numeric; fields text[];
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action is null or p_action not in ('create','revise','withdraw') or p_article is null or p_expected is null or p_expected<0
  or (p_action='create')<>(p_expected=0) or jsonb_typeof(d) is distinct from 'object' then raise exception 'supplier_article_invalid' using errcode='22023'; end if;
 select name into actor from bob.people where project_id=p_project and auth_user_id=auth.uid();
 if actor is null then raise exception 'project_denied' using errcode='42501'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select * into h from bob.supplier_articles where id=p_article for update;
 if p_action='create' then
  if found then raise exception 'supplier_article_changed' using errcode='PT409'; end if;
 elsif not found or h.project_id<>p_project then raise exception 'supplier_article_unavailable' using errcode='P0002';
 elsif h.current_revision<>p_expected then raise exception 'supplier_article_changed' using errcode='PT409'; end if;
 select * into prior from bob.supplier_article_revisions where article_id=p_article and revision=h.current_revision;
 n:=coalesce(h.current_revision,0)+1;
 if p_action='withdraw' then
  if d-array['change_note']<>'{}' or jsonb_typeof(d->'change_note') is distinct from 'string' then raise exception 'supplier_article_invalid' using errcode='22023'; end if;
  if prior.withdrawn then raise exception 'supplier_article_withdrawn' using errcode='PT409'; end if;
  prior.revision:=n;prior.withdrawn:=true;prior.change_note:=btrim(d->>'change_note');prior.recorded_by:=auth.uid();prior.actor_label:=actor;prior.recorded_at:=clock_timestamp();
  insert into bob.supplier_article_revisions values(prior.*);
 else
  if d-array['catalog_item_id','catalog_item_revision','title','supplier','manufacturer','article_number','variant','source_url','source_document','source_version','source_date','supported_fields','purchase_unit','content_per_purchase_unit','content_unit','notes','change_note']<>'{}'
   or (select count(*) from jsonb_object_keys(d))<>17
   or coalesce(d->>'catalog_item_id','')!~'^[0-9a-fA-F-]{36}$' or jsonb_typeof(d->'catalog_item_revision') is distinct from 'number'
   or exists(select 1 from unnest(array['title','supplier','manufacturer','article_number','variant','source_document','source_version','purchase_unit','content_unit','notes','change_note']) k where jsonb_typeof(d->k) is distinct from 'string')
   or jsonb_typeof(d->'source_url') not in ('string','null') or jsonb_typeof(d->'source_date') not in ('string','null')
   or jsonb_typeof(d->'content_per_purchase_unit') not in ('string','null') or jsonb_typeof(d->'supported_fields') is distinct from 'array'
   or (d->>'source_date' is not null and d->>'source_date'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
   or (d->>'content_per_purchase_unit' is not null and d->>'content_per_purchase_unit'!~'^[0-9]{1,10}(\.[0-9]{1,4})?$')
   or exists(select 1 from jsonb_array_elements(d->'supported_fields') f where jsonb_typeof(f) is distinct from 'string')
  then raise exception 'supplier_article_invalid' using errcode='22023'; end if;
  select * into item from bob.catalog_items where id=(d->>'catalog_item_id')::uuid and (project_id is null or project_id=p_project) for share;
  if not found or not exists(select 1 from bob.catalog_item_revisions where item_id=item.id and revision=(d->>'catalog_item_revision')::integer)
   then raise exception 'supplier_article_catalog_unavailable' using errcode='22023'; end if;
  content:=(d->>'content_per_purchase_unit')::numeric;
  select coalesce(array_agg(distinct value order by value),'{}') into fields from jsonb_array_elements_text(d->'supported_fields');
  if p_action='create' then insert into bob.supplier_articles values(p_article,p_project,n); end if;
  insert into bob.supplier_article_revisions(article_id,project_id,revision,catalog_item_id,catalog_item_revision,title,supplier,manufacturer,article_number,variant,
   source_url,source_document,source_version,source_date,supported_fields,purchase_unit,content_per_purchase_unit,content_unit,notes,withdrawn,change_note,recorded_by,actor_label)
  values(p_article,p_project,n,item.id,(d->>'catalog_item_revision')::integer,btrim(d->>'title'),btrim(d->>'supplier'),btrim(d->>'manufacturer'),btrim(d->>'article_number'),btrim(d->>'variant'),
   nullif(btrim(d->>'source_url'),''),btrim(d->>'source_document'),btrim(d->>'source_version'),(d->>'source_date')::date,fields,d->>'purchase_unit',content,d->>'content_unit',
   d->>'notes',false,btrim(d->>'change_note'),auth.uid(),actor);
 end if;
 update bob.supplier_articles set current_revision=n where id=p_article;
 return bob_private.read_supplier_article(p_project,p_article,null);
end $$;
revoke all on function bob_private.supplier_article_command(text,text,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function bob_private.supplier_article_command(text,text,uuid,integer,jsonb) to authenticated;
create function bob.supplier_article_command(p_project text,p_action text,p_article uuid,p_expected integer,p_data jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.supplier_article_command(p_project,p_action,p_article,p_expected,p_data) $$;
revoke all on function bob.supplier_article_command(text,text,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function bob.supplier_article_command(text,text,uuid,integer,jsonb) to authenticated;
create function bob.read_supplier_article(p_project text,p_article uuid,p_revision integer default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select bob_private.read_supplier_article(p_project,p_article,p_revision) $$;
revoke all on function bob.read_supplier_article(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.read_supplier_article(text,uuid,integer) to authenticated;

-- Deterministic AC-14 arithmetic: aggregate the net need of exact current
-- requirement revisions (held stock/reuse already subtracted once by each
-- requirement), then round the total once to whole purchase units.
create function bob_private.pack_purchase_quote(p_project text,p_article uuid,p_article_revision integer,p_needs jsonb,p_exclude_claim boolean default true) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a bob.supplier_article_revisions; e jsonb; r record; lines jsonb:='[]'; total numeric:=0; held numeric:=0; reused numeric:=0; net numeric; cnt integer; category text; categories integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select * into a from bob.supplier_article_revisions where article_id=p_article and project_id=p_project and revision=p_article_revision;
 if not found then raise exception 'supplier_article_unavailable' using errcode='P0002'; end if;
 if jsonb_typeof(p_needs) is distinct from 'array' or jsonb_array_length(p_needs) not between 1 and 24
  or exists(select 1 from jsonb_array_elements(p_needs) x where jsonb_typeof(x) is distinct from 'object' or x-array['id','revision']<>'{}'
   or coalesce(x->>'id','')!~'^[0-9a-fA-F-]{36}$' or coalesce(x->>'revision','')!~'^[1-9][0-9]{0,8}$')
  or (select count(distinct lower(x->>'id')) from jsonb_array_elements(p_needs) x)<>jsonb_array_length(p_needs)
 then raise exception 'pack_purchase_invalid' using errcode='22023'; end if;
 for e in select x from jsonb_array_elements(p_needs) x order by x->>'id' loop
  select * into r from bob.current_material_requirements where project_id=p_project and id=(e->>'id')::uuid;
  if not found then raise exception 'pack_requirement_unavailable' using errcode='P0002'; end if;
  if r.revision<>(e->>'revision')::integer then raise exception 'pack_requirement_changed' using errcode='PT409'; end if;
  if r.archived then raise exception 'pack_requirement_archived' using errcode='PT409'; end if;
  if r.unit<>a.content_unit then raise exception 'pack_unit_mismatch' using errcode='22023'; end if;
  if r.target_changed or r.artifact_changed or r.stock_changed or r.component_changed then raise exception 'pack_requirement_sources_changed' using errcode='PT409'; end if;
  if exists(select 1 from bob.material_requirement_construction_sources s where s.requirement_id=r.id and s.requirement_revision=r.revision)
   then raise exception 'pack_construction_blank' using errcode='22023'; end if;
  -- One requirement belongs to at most one active purchase route.
  if exists(select 1 from bob.material_requirement_shopping l join bob.materials m on m.id=l.material_id where l.requirement_id=r.id)
   then raise exception 'pack_requirement_in_shopping' using errcode='PT409'; end if;
  if p_exclude_claim and exists(select 1 from bob.pack_purchase_needs n join bob.pack_purchases h on h.article_id=n.article_id and h.current_revision=n.revision
   join bob.pack_purchase_revisions pr on pr.article_id=h.article_id and pr.revision=h.current_revision
   where n.requirement_id=r.id and pr.published and h.article_id<>p_article) then raise exception 'pack_requirement_claimed' using errcode='PT409'; end if;
  net:=greatest(0,r.required_with_waste-r.stock_quantity-r.component_quantity);
  total:=total+net;held:=held+r.stock_quantity;reused:=reused+r.component_quantity;
  lines:=lines||jsonb_build_object('id',r.id,'revision',r.revision,'name',r.name,'category',r.category,'unit',r.unit,'required_quantity',r.required_quantity,
   'required_with_waste',r.required_with_waste,'stock_quantity',r.stock_quantity,'component_quantity',r.component_quantity,'net_quantity',net);
 end loop;
 select min(x->>'category'),count(distinct x->>'category') into category,categories from jsonb_array_elements(lines) x;
 cnt:=case when a.content_per_purchase_unit is null then null else ceil(total/a.content_per_purchase_unit)::integer end;
 return jsonb_build_object('article_id',p_article,'article_revision',a.revision,'purchase_unit',a.purchase_unit,'content_per_purchase_unit',a.content_per_purchase_unit,
  'content_unit',a.content_unit,'needs',lines,'total_quantity',total,'stock_quantity',held,'component_quantity',reused,
  'pack_state',case when cnt is null then 'unknown' else 'known' end,'purchase_count',cnt,
  'surplus_quantity',case when cnt is null then null else cnt*a.content_per_purchase_unit-total end,
  'category',case when categories=1 then category else 'Other' end,'calculation_version','k4-pack-aggregate-v1',
  -- A read-only calculation is not a purchase, delivery or stock consumption.
  'purchase_recorded',false);
end $$;
revoke all on function bob_private.pack_purchase_quote(text,uuid,integer,jsonb,boolean) from public,anon,service_role;
grant execute on function bob_private.pack_purchase_quote(text,uuid,integer,jsonb,boolean) to authenticated;
create function bob.pack_purchase_quote(p_project text,p_article uuid,p_article_revision integer,p_needs jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$ select bob_private.pack_purchase_quote(p_project,p_article,p_article_revision,p_needs,true) $$;
revoke all on function bob.pack_purchase_quote(text,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function bob.pack_purchase_quote(text,uuid,integer,jsonb) to authenticated;

create function bob_private.read_pack_purchase(p_project text,p_article uuid,p_revision integer default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare h bob.pack_purchases; r bob.pack_purchase_revisions; article jsonb; needs jsonb; m bob.materials; changed boolean; edited boolean;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select * into h from bob.pack_purchases where article_id=p_article and project_id=p_project;
 if not found then raise exception 'pack_purchase_unavailable' using errcode='P0002'; end if;
 select * into r from bob.pack_purchase_revisions where article_id=p_article and revision=coalesce(p_revision,h.current_revision);
 if not found then raise exception 'pack_purchase_unavailable' using errcode='P0002'; end if;
 article:=bob_private.read_supplier_article(p_project,p_article,r.article_revision);
 select coalesce(jsonb_agg(to_jsonb(n)-'article_id'-'project_id'-'revision'||jsonb_build_object('name',c.name,
   'requirement_changed',c.id is null or c.revision<>n.requirement_revision or c.archived or c.target_changed or c.artifact_changed or c.stock_changed or c.component_changed)
  order by n.requirement_id),'[]') into needs
  from bob.pack_purchase_needs n left join bob.current_material_requirements c on c.id=n.requirement_id and c.project_id=p_project
  where n.article_id=p_article and n.revision=r.revision;
 changed:=article->>'source_state'<>'current' or exists(select 1 from jsonb_array_elements(needs) x where (x->>'requirement_changed')::boolean);
 select * into m from bob.materials where id=h.material_id and project_id=p_project;
 edited:=m.id is not null and (m.name<>h.synced_name or m.qty<>h.synced_qty or m.category<>h.synced_category);
 return jsonb_build_object('id',p_article,'article_id',p_article,'name',article->>'title','revision',r.revision,'current_revision',h.current_revision,
  'article_revision',r.article_revision,'article',article,'published',r.published,'needs',needs,
  'total_quantity',r.total_quantity,'content_unit',r.content_unit,'content_per_purchase_unit',r.content_per_purchase_unit,'purchase_unit',r.purchase_unit,
  'purchase_count',r.purchase_count,'surplus_quantity',r.surplus_quantity,'calculation_version','k4-pack-aggregate-v1',
  'change_note',r.change_note,'actor_label',r.actor_label,'recorded_at',r.recorded_at,
  'source_state',case when changed then 'changed' else 'current' end,
  'material_id',h.material_id,'material_status',m.status,'shopping_missing',h.material_id is null and h.synced_name<>'','shopping_edited',edited,
  'shopping_ready',r.revision=h.current_revision and r.published and not changed and m.id is not null and not edited,
  'product_bound',true,'suitability_verified',false,'physical_verified',false);
end $$;
revoke all on function bob_private.read_pack_purchase(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.read_pack_purchase(text,uuid,integer) to authenticated;
create function bob.read_pack_purchase(p_project text,p_article uuid,p_revision integer default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select bob_private.read_pack_purchase(p_project,p_article,p_revision) $$;
revoke all on function bob.read_pack_purchase(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.read_pack_purchase(text,uuid,integer) to authenticated;

create function bob_private.pack_purchase_command(p_project text,p_action text,p_article uuid,p_article_expected integer,p_purchase_expected integer,p_needs jsonb,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ah bob.supplier_articles; a bob.supplier_article_revisions; h bob.pack_purchases; prior bob.pack_purchase_revisions; m bob.materials;
 q jsonb; label text; qty_text text; v_category text; actor text; n integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if p_action is null or p_action not in ('publish','withdraw') or p_article is null or p_article_expected is null or p_article_expected<1
  or p_purchase_expected is null or p_purchase_expected<0 or p_note is null or char_length(btrim(p_note)) not between 1 and 1000
  or jsonb_typeof(p_needs) is distinct from 'array' or (p_action='withdraw' and p_needs<>'[]'::jsonb)
 then raise exception 'pack_purchase_invalid' using errcode='22023'; end if;
 select name into actor from bob.people where project_id=p_project and auth_user_id=auth.uid();
 if actor is null then raise exception 'project_denied' using errcode='42501'; end if;
 -- The project lock serializes concurrent publications that could claim the same need.
 perform 1 from bob.projects where id=p_project for no key update;
 select * into ah from bob.supplier_articles where id=p_article and project_id=p_project for update;
 if not found then raise exception 'supplier_article_unavailable' using errcode='P0002'; end if;
 if ah.current_revision<>p_article_expected then raise exception 'supplier_article_changed' using errcode='PT409'; end if;
 select * into a from bob.supplier_article_revisions where article_id=p_article and revision=ah.current_revision;
 select * into h from bob.pack_purchases where article_id=p_article and project_id=p_project for update;
 if coalesce(h.current_revision,0)<>p_purchase_expected then raise exception 'pack_purchase_changed' using errcode='PT409'; end if;
 select * into prior from bob.pack_purchase_revisions where article_id=p_article and revision=h.current_revision;
 if p_action='publish' then
  if a.withdrawn then raise exception 'supplier_article_withdrawn' using errcode='PT409'; end if;
  if a.content_per_purchase_unit is null then raise exception 'pack_size_unknown' using errcode='22023'; end if;
  perform 1 from bob.material_requirements where project_id=p_project and id in(select (x->>'id')::uuid from jsonb_array_elements(p_needs) x
   where coalesce(x->>'id','')~'^[0-9a-fA-F-]{36}$') order by id for update;
  q:=bob_private.pack_purchase_quote(p_project,p_article,a.revision,p_needs,true);
  if (q->>'purchase_count')::integer<1 then raise exception 'pack_purchase_empty' using errcode='22023'; end if;
  label:=a.title||' · '||concat_ws(' ',nullif(a.manufacturer,''),a.article_number,nullif(a.variant,''))||' ('||
   regexp_replace(regexp_replace(a.content_per_purchase_unit::text,'0+$',''),'\.$','')||' '||a.content_unit||'/'||a.purchase_unit||')';
  qty_text:=(q->>'purchase_count')||' '||a.purchase_unit;v_category:=q->>'category';
 else
  if not coalesce(prior.published,false) then raise exception 'pack_purchase_not_published' using errcode='PT409'; end if;
  label:=h.synced_name;qty_text:='0 '||prior.purchase_unit;v_category:=h.synced_category;
 end if;
 select * into m from bob.materials where id=h.material_id and project_id=p_project for update;
 if found then
  if m.name<>h.synced_name or m.qty<>h.synced_qty or m.category<>h.synced_category then raise exception 'pack_purchase_shopping_edited' using errcode='PT409'; end if;
  -- Changed evidence never silently rewrites an ordered or delivered purchase.
  if m.status<>'needed' and (m.name<>label or m.qty<>qty_text or m.category<>v_category) then raise exception 'pack_purchase_shopping_committed' using errcode='PT409'; end if;
  update bob.materials set name=label,qty=qty_text,category=v_category,updated_at=now() where id=m.id and (name<>label or qty<>qty_text or bob.materials.category<>v_category);
 elsif h.material_id is not null or coalesce(h.synced_name,'')<>'' then
  raise exception 'pack_purchase_shopping_missing' using errcode='PT409';
 else
  insert into bob.materials(id,project_id,name,qty,area_label,supplier,status,cost,category,category_icon,sort_order)
  values('mp_'||replace(gen_random_uuid()::text,'-',''),p_project,label,qty_text,'',a.supplier,'needed','',v_category,
   case lower(v_category) when 'fasteners & glue' then 'nut' when 'timber' then 'tree' else 'package' end,
   coalesce((select max(x.sort_order)+1 from bob.materials x where x.project_id=p_project),1)) returning * into m;
 end if;
 n:=coalesce(h.current_revision,0)+1;
 if h.article_id is null then insert into bob.pack_purchases(article_id,project_id,current_revision) values(p_article,p_project,n); end if;
 update bob.pack_purchases set material_id=m.id,synced_name=label,synced_qty=qty_text,synced_category=v_category where article_id=p_article;
 if p_action='publish' then
  insert into bob.pack_purchase_revisions(article_id,project_id,revision,article_revision,published,total_quantity,content_unit,content_per_purchase_unit,purchase_unit,purchase_count,surplus_quantity,change_note,recorded_by,actor_label)
  values(p_article,p_project,n,a.revision,true,(q->>'total_quantity')::numeric,a.content_unit,a.content_per_purchase_unit,a.purchase_unit,(q->>'purchase_count')::integer,(q->>'surplus_quantity')::numeric,btrim(p_note),auth.uid(),actor);
  insert into bob.pack_purchase_needs(article_id,project_id,revision,requirement_id,requirement_revision,quantity)
   select p_article,p_project,n,(x->>'id')::uuid,(x->>'revision')::integer,(x->>'net_quantity')::numeric from jsonb_array_elements(q->'needs') x;
 else
  insert into bob.pack_purchase_revisions(article_id,project_id,revision,article_revision,published,total_quantity,content_unit,content_per_purchase_unit,purchase_unit,purchase_count,surplus_quantity,change_note,recorded_by,actor_label)
  values(p_article,p_project,n,prior.article_revision,false,0,prior.content_unit,prior.content_per_purchase_unit,prior.purchase_unit,0,null,btrim(p_note),auth.uid(),actor);
 end if;
 update bob.pack_purchases set current_revision=n where article_id=p_article;
 return bob_private.read_pack_purchase(p_project,p_article,null);
end $$;
revoke all on function bob_private.pack_purchase_command(text,text,uuid,integer,integer,jsonb,text) from public,anon,service_role;
grant execute on function bob_private.pack_purchase_command(text,text,uuid,integer,integer,jsonb,text) to authenticated;
create function bob.pack_purchase_command(p_project text,p_action text,p_article uuid,p_article_expected integer,p_purchase_expected integer,p_needs jsonb,p_note text) returns jsonb
language sql security invoker set search_path='' as $$ select bob_private.pack_purchase_command(p_project,p_action,p_article,p_article_expected,p_purchase_expected,p_needs,p_note) $$;
revoke all on function bob.pack_purchase_command(text,text,uuid,integer,integer,jsonb,text) from public,anon,service_role;
grant execute on function bob.pack_purchase_command(text,text,uuid,integer,integer,jsonb,text) to authenticated;

-- The legacy one-requirement handoff must not publish a need a pack purchase holds.
create function bob_private.guard_requirement_shopping_pack() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from bob.pack_purchase_needs n join bob.pack_purchases h on h.article_id=n.article_id and h.current_revision=n.revision
  join bob.pack_purchase_revisions r on r.article_id=h.article_id and r.revision=h.current_revision where n.requirement_id=new.requirement_id and r.published)
 then raise exception 'pack_requirement_claimed' using errcode='PT409'; end if;
 return new;
end $$;
revoke all on function bob_private.guard_requirement_shopping_pack() from public,anon,authenticated,service_role;
create trigger requirement_shopping_pack_guard before insert or update on bob.material_requirement_shopping for each row execute function bob_private.guard_requirement_shopping_pack();

create function bob_private.pack_purchase_source(p_project text,p_material text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare aid uuid;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select article_id into aid from bob.pack_purchases where project_id=p_project and material_id=p_material;
 if aid is null then return null; end if;
 return bob_private.read_pack_purchase(p_project,aid,null);
end $$;
revoke all on function bob_private.pack_purchase_source(text,text) from public,anon,service_role;
grant execute on function bob_private.pack_purchase_source(text,text) to authenticated;

alter function bob.read_project_work(text,jsonb) rename to read_project_work_before_pack_purchases;
create function bob.read_project_work(p_project text,p_input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; rows jsonb; page jsonb; more boolean; resource text:=p_input->>'resource';
begin
 if resource is distinct from 'product' and resource is distinct from 'pack_purchase' then
  result:=bob.read_project_work_before_pack_purchases(p_project,p_input);
  if resource='shopping' then
   select coalesce(jsonb_agg(value||jsonb_build_object('pack_source',bob_private.pack_purchase_source(p_project,value->>'id'))),'[]') into rows from jsonb_array_elements(result->'records');
   result:=jsonb_set(result,'{records}',rows);
  end if;
  return result;
 end if;
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_input-array['resource','record_id','after_id']<>'{}' or (select count(*) from jsonb_object_keys(p_input))<>3
  or coalesce(length(p_input->>'record_id'),0)>200 or coalesce(length(p_input->>'after_id'),0)>200 then raise exception 'invalid_read' using errcode='22023'; end if;
 if resource='product' then
  select coalesce(jsonb_agg(bob_private.read_supplier_article(p_project,id,null) order by id),'[]') into rows
   from (select id from bob.supplier_articles where project_id=p_project and (p_input->>'record_id' is null or id::text=p_input->>'record_id')
    and (p_input->>'after_id' is null or id::text>p_input->>'after_id') order by id limit 26) h;
 else
  select coalesce(jsonb_agg(bob_private.read_pack_purchase(p_project,article_id,null) order by article_id),'[]') into rows
   from (select article_id from bob.pack_purchases where project_id=p_project and (p_input->>'record_id' is null or article_id::text=p_input->>'record_id')
    and (p_input->>'after_id' is null or article_id::text>p_input->>'after_id') order by article_id limit 26) h;
 end if;
 more:=jsonb_array_length(rows)>25;
 select coalesce(jsonb_agg(value order by ordinality),'[]') into page from jsonb_array_elements(rows) with ordinality where ordinality<=25;
 return jsonb_build_object('projectId',p_project,'resource',resource,'records',page,'truncated',more,'next_cursor',case when more then page->24->>'id' else null end);
end $$;
revoke all on function bob.read_project_work(text,jsonb) from public,anon,service_role;
grant execute on function bob.read_project_work(text,jsonb) to authenticated;

-- Preserve the deployed writer ABI; extend dispatch and delegate older kinds unchanged.
alter function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) rename to bob_project_write_before_pack_purchases;
revoke all on function bob_private.bob_project_write_before_pack_purchases(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
create function bob_private.bob_project_write_v16(p_project text,p_thread uuid,p_turn uuid,p_generation bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_payload->'data'; kind text:=p_payload->>'kind'; existing bob_private.bob_write_receipts; msg text; op text; before_row jsonb; rec jsonb; result jsonb; aid uuid; expected integer;
begin
 if kind is null or kind not in ('supplier_article','pack_purchase') then return bob_private.bob_project_write_before_pack_purchases(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 perform 1 from bob.projects where id=p_project for no key update;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>12000 or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
  or coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$' or jsonb_typeof(p_payload->'expected_revision') is distinct from 'number'
  or jsonb_typeof(p_payload->'request_quote') is distinct from 'string' or char_length(p_payload->>'request_quote') not between 1 and 500
  or jsonb_typeof(d) is distinct from 'object' or (p_payload->>'record_id' is not null and p_payload->>'record_id'!~'^[0-9a-fA-F-]{36}$')
 then raise exception '%',kind||'_invalid' using errcode='22023'; end if;
 expected:=(p_payload->>'expected_revision')::integer;
 if kind='supplier_article' then
  if d-array['action','fields']<>'{}' or (select count(*) from jsonb_object_keys(d))<>2 or coalesce(d->>'action','') not in ('create','revise','withdraw')
   or jsonb_typeof(d->'fields') is distinct from 'object' or (d->>'action'='create')<>(p_payload->>'record_id' is null)
   or (d->>'action'='create')<>(expected=0) then raise exception 'supplier_article_invalid' using errcode='22023'; end if;
  op:='supplier_article:'||coalesce(p_payload->>'record_id',lower(btrim(coalesce(d->'fields'->>'title',''))))||':'||(d->>'action')||':'||expected;
 else
  if d-array['action','purchase_revision','needs','change_note']<>'{}' or (select count(*) from jsonb_object_keys(d))<>4
   or coalesce(d->>'action','') not in ('publish','withdraw') or p_payload->>'record_id' is null or expected<1
   or jsonb_typeof(d->'purchase_revision') is distinct from 'number' or coalesce(d->>'purchase_revision','')!~'^[0-9]{1,9}$'
   or jsonb_typeof(d->'needs') is distinct from 'array' or jsonb_typeof(d->'change_note') is distinct from 'string'
  then raise exception 'pack_purchase_invalid' using errcode='22023'; end if;
  op:='pack_purchase:'||(p_payload->>'record_id')||':'||(d->>'action')||':'||(d->>'purchase_revision');
 end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(p_payload->>'request_quote' in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then
  if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='PT409'; end if;
  return existing.receipt;
 end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=32 then raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 if kind='supplier_article' then
  aid:=coalesce((p_payload->>'record_id')::uuid,gen_random_uuid());
  if d->>'action'<>'create' then before_row:=bob_private.read_supplier_article(p_project,aid,null); end if;
  rec:=bob_private.supplier_article_command(p_project,d->>'action',aid,expected,d->'fields');
  result:=jsonb_build_object('projectId',p_project,'dataset','catalog','recordId',aid,'revision',(rec->>'revision')::integer,'areaId',null,
   'label','Supplier article '||(rec->>'title'),'operation',case when d->>'action'='create' then 'created' else 'updated' end,'savedAt',clock_timestamp(),'record',rec);
 else
  aid:=(p_payload->>'record_id')::uuid;
  if exists(select 1 from bob.pack_purchases where article_id=aid and project_id=p_project) then before_row:=bob_private.read_pack_purchase(p_project,aid,null); end if;
  rec:=bob_private.pack_purchase_command(p_project,d->>'action',aid,expected,(d->>'purchase_revision')::integer,d->'needs',d->>'change_note');
  result:=jsonb_build_object('projectId',p_project,'dataset','materials','recordId',aid,'revision',(rec->>'revision')::integer,'areaId',null,
   'label','Pack purchase '||(rec->>'name'),'operation',case when before_row is null then 'created' else 'updated' end,'savedAt',clock_timestamp(),'record',rec);
 end if;
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
end $$;
revoke all on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb) to authenticated;

update bob.tool_catalog set how_to=how_to||' Supplier products: resource=product create/revise/withdraw stores a versioned supplier article over one exact catalog item revision. create/revise data is {fields:{catalog_item_id,catalog_item_revision,title,supplier,manufacturer,article_number,variant,source_url,source_document,source_version,source_date,supported_fields,purchase_unit,content_per_purchase_unit,content_unit,notes,change_note}}; withdraw is {fields:{change_note}}. Use only fields the cited source actually states and list them in supported_fields; a known pack size requires purchase_unit and content_per_purchase_unit there, otherwise content_per_purchase_unit is null and the pack count stays unresolved. Never invent an article, source or pack size. resource=pack_purchase publish/withdraw: record_id is the article UUID, expected_revision its current revision, data {purchase_revision,needs:[{id,revision}],change_note} (withdraw needs []). The server aggregates the exact current requirements net of held stock/reuse before rounding once to whole purchase units and writes one Shopping row; the surplus is reported, not added as a need. Needs must share the article content unit, be current, and not belong to another pack purchase, ordinary Shopping publication or construction blank list. An article is not suitability, inspection or structural approval.' where name='manage_project_material';
update bob.tool_catalog set how_to=how_to||' resource=product lists supplier articles with exact catalog pin, declared supported_fields, pack_known and source_state; suitability_verified and physical_verified stay false. resource=pack_purchase returns the pinned needs, total, purchase_count, surplus and source_state; changed evidence or needs make it stale but keep the commitment until explicit republish/withdraw. Shopping rows include pack_source when a pack purchase owns them.' where name='read_project_work';
notify pgrst,'reload schema';
commit;
