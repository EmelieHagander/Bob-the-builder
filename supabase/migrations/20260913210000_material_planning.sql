-- Manual Slice 4B2a. Contract: Docs/material-planning.md.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table bob.stock_items (
  id uuid primary key,
  project_id text not null references bob.projects(id) on delete cascade,
  current_revision integer not null check(current_revision > 0),
  unique(id, project_id)
);
create index stock_items_project_idx on bob.stock_items(project_id);

create table bob.stock_revisions (
  stock_id uuid not null,
  project_id text not null,
  revision integer not null check(revision > 0),
  name text not null check(char_length(btrim(name)) between 1 and 200),
  specification text not null default '' check(char_length(specification) <= 4000),
  quantity numeric(18,4) not null check(quantity > 0 and quantity <= 1000000000),
  unit text not null check(unit in ('pcs','m','m2','m3','kg','l')),
  status text not null check(status in ('available','inspect','unavailable')),
  area_id text references bob.areas(id) on delete set null,
  area_title text not null default '',
  notes text not null default '' check(char_length(notes) <= 4000),
  archived boolean not null default false,
  change_note text not null check(char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(stock_id, revision),
  foreign key(stock_id, project_id) references bob.stock_items(id, project_id) on delete cascade,
  check(unit <> 'pcs' or quantity = trunc(quantity))
);
create index stock_revisions_project_idx on bob.stock_revisions(project_id);
create index stock_revisions_area_idx on bob.stock_revisions(area_id);
create index stock_revisions_parent_idx on bob.stock_revisions(stock_id, project_id);
alter table bob.stock_items add constraint stock_current_revision_fk
  foreign key(id, current_revision) references bob.stock_revisions(stock_id, revision)
  deferrable initially deferred;
create index stock_items_current_idx on bob.stock_items(id, current_revision);

create table bob.material_requirements (
  id uuid primary key,
  project_id text not null references bob.projects(id) on delete cascade,
  current_revision integer not null check(current_revision > 0),
  unique(id, project_id)
);
create index material_requirements_project_idx on bob.material_requirements(project_id);

create table bob.material_requirement_revisions (
  requirement_id uuid not null,
  project_id text not null,
  revision integer not null check(revision > 0),
  name text not null check(char_length(btrim(name)) between 1 and 200),
  category text not null default 'Other' check(char_length(btrim(category)) between 1 and 120),
  area_id text references bob.areas(id) on delete set null,
  area_title text not null default '',
  task_id text references bob.tasks(id) on delete set null,
  task_title text not null default '',
  unit text not null check(unit in ('pcs','m','m2','m3','kg','l')),
  required_quantity numeric(18,4) not null check(required_quantity > 0 and required_quantity <= 1000000000),
  waste_percent numeric(7,3) not null default 0 check(waste_percent between 0 and 100),
  purchase_increment numeric(18,4) not null check(purchase_increment > 0 and purchase_increment <= 1000000000),
  required_with_waste numeric(18,4) not null check(required_with_waste > 0),
  stock_quantity numeric(18,4) not null default 0 check(stock_quantity >= 0),
  component_quantity numeric(18,4) not null default 0 check(component_quantity >= 0),
  purchase_quantity numeric(18,4) not null check(purchase_quantity >= 0),
  source_kind text not null check(source_kind in ('manual','deterministic')),
  method_key text not null check(char_length(btrim(method_key)) between 1 and 120),
  method_version text not null check(char_length(btrim(method_version)) between 1 and 80),
  basis text not null check(char_length(btrim(basis)) between 1 and 6000),
  assumptions text not null default '' check(char_length(assumptions) <= 4000),
  artifact_id uuid,
  artifact_revision integer,
  artifact_title text not null default '',
  target_revision integer not null check(target_revision > 0),
  solution_id uuid not null,
  solution_revision integer not null check(solution_revision > 0),
  solution_title text not null,
  archived boolean not null default false,
  change_note text not null check(char_length(btrim(change_note)) between 1 and 1000),
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(requirement_id, revision),
  foreign key(requirement_id, project_id) references bob.material_requirements(id, project_id) on delete cascade,
  foreign key(project_id, target_revision) references bob.target_revisions(project_id, revision) on delete cascade,
  foreign key(solution_id, solution_revision) references bob.solution_revisions(solution_id, revision) on delete cascade,
  foreign key(artifact_id, artifact_revision) references bob.artifact_revisions(artifact_id, revision),
  check((artifact_id is null and artifact_revision is null) or (artifact_id is not null and artifact_revision is not null)),
  check(unit <> 'pcs' or (required_quantity = trunc(required_quantity) and purchase_increment = trunc(purchase_increment)))
);
create index material_requirement_revisions_project_idx on bob.material_requirement_revisions(project_id);
create index material_requirement_revisions_area_idx on bob.material_requirement_revisions(area_id);
create index material_requirement_revisions_task_idx on bob.material_requirement_revisions(task_id);
create index material_requirement_revisions_target_idx on bob.material_requirement_revisions(project_id, target_revision);
create index material_requirement_revisions_solution_idx on bob.material_requirement_revisions(solution_id, solution_revision);
create index material_requirement_revisions_artifact_idx on bob.material_requirement_revisions(artifact_id, artifact_revision);
alter table bob.material_requirements add constraint material_requirement_current_revision_fk
  foreign key(id, current_revision) references bob.material_requirement_revisions(requirement_id, revision)
  deferrable initially deferred;
create index material_requirements_current_idx on bob.material_requirements(id, current_revision);

create table bob.material_requirement_stock (
  project_id text not null references bob.projects(id) on delete cascade,
  requirement_id uuid not null,
  requirement_revision integer not null,
  stock_id uuid not null,
  stock_revision integer not null,
  quantity numeric(18,4) not null check(quantity > 0),
  primary key(requirement_id, requirement_revision, stock_id),
  foreign key(requirement_id, requirement_revision)
    references bob.material_requirement_revisions(requirement_id, revision) on delete cascade,
  foreign key(stock_id, stock_revision)
    references bob.stock_revisions(stock_id, revision) on delete cascade
);
create index material_requirement_stock_project_idx on bob.material_requirement_stock(project_id);
create index material_requirement_stock_source_idx on bob.material_requirement_stock(stock_id, stock_revision);

create table bob.material_requirement_components (
  project_id text not null references bob.projects(id) on delete cascade,
  requirement_id uuid not null,
  requirement_revision integer not null,
  component_id uuid not null,
  component_revision integer not null,
  quantity integer not null check(quantity > 0),
  primary key(requirement_id, requirement_revision, component_id),
  foreign key(requirement_id, requirement_revision)
    references bob.material_requirement_revisions(requirement_id, revision) on delete cascade,
  foreign key(component_id, component_revision)
    references bob.component_revisions(component_id, revision) on delete cascade
);
create index material_requirement_components_project_idx on bob.material_requirement_components(project_id);
create index material_requirement_components_source_idx on bob.material_requirement_components(component_id, component_revision);

create table bob.material_requirement_shopping (
  requirement_id uuid primary key references bob.material_requirements(id) on delete cascade,
  project_id text not null references bob.projects(id) on delete cascade,
  material_id text unique references bob.materials(id) on delete set null,
  synced_requirement_revision integer not null check(synced_requirement_revision > 0),
  synced_name text not null,
  synced_qty text not null,
  synced_area_label text not null,
  synced_category text not null,
  recorded_by uuid not null,
  actor_label text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index material_requirement_shopping_project_idx on bob.material_requirement_shopping(project_id);

alter table bob.stock_items enable row level security;
alter table bob.stock_revisions enable row level security;
alter table bob.material_requirements enable row level security;
alter table bob.material_requirement_revisions enable row level security;
alter table bob.material_requirement_stock enable row level security;
alter table bob.material_requirement_components enable row level security;
alter table bob.material_requirement_shopping enable row level security;
revoke all on bob.stock_items, bob.stock_revisions, bob.material_requirements,
  bob.material_requirement_revisions, bob.material_requirement_stock,
  bob.material_requirement_components, bob.material_requirement_shopping
  from public, anon, authenticated;
grant select on bob.stock_items, bob.stock_revisions, bob.material_requirements,
  bob.material_requirement_revisions, bob.material_requirement_stock,
  bob.material_requirement_components, bob.material_requirement_shopping to authenticated;
create policy project_read on bob.stock_items for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.stock_revisions for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.material_requirements for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.material_requirement_revisions for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.material_requirement_stock for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.material_requirement_components for select to authenticated
  using (bob_private.has_project_access(project_id));
create policy project_read on bob.material_requirement_shopping for select to authenticated
  using (bob_private.has_project_access(project_id));

create view bob.current_stock_items with(security_invoker=true) as
select h.id, r.*
from bob.stock_items h
join bob.stock_revisions r
  on r.stock_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id;

create view bob.current_material_requirements with(security_invoker=true) as
select h.id, r.*,
  (pt.current_revision is distinct from r.target_revision) as target_changed,
  (r.artifact_id is not null and (
    ah.current_revision is distinct from r.artifact_revision
    or ar.archived is distinct from false
  )) as artifact_changed,
  exists(
    select 1
    from bob.material_requirement_stock rs
    join bob.stock_items sh on sh.id=rs.stock_id and sh.project_id=rs.project_id
    join bob.stock_revisions sr on sr.stock_id=sh.id and sr.revision=sh.current_revision
    where rs.requirement_id=h.id and rs.requirement_revision=h.current_revision
      and (sh.current_revision <> rs.stock_revision or sr.archived or sr.status <> 'available')
  ) as stock_changed,
  exists(
    select 1
    from bob.material_requirement_components rc
    join bob.existing_components ch on ch.id=rc.component_id and ch.project_id=rc.project_id
    join bob.component_revisions cr on cr.component_id=ch.id and cr.revision=ch.current_revision
    where rc.requirement_id=h.id and rc.requirement_revision=h.current_revision
      and (ch.current_revision <> rc.component_revision or cr.archived or cr.intent <> 'reuse' or cr.quantity is null)
  ) as component_changed
from bob.material_requirements h
join bob.material_requirement_revisions r
  on r.requirement_id=h.id and r.revision=h.current_revision and r.project_id=h.project_id
left join bob.project_targets pt on pt.project_id=h.project_id
left join bob.artifacts ah on ah.id=r.artifact_id and ah.project_id=h.project_id
left join bob.artifact_revisions ar on ar.artifact_id=ah.id and ar.revision=ah.current_revision;

create view bob.material_requirement_stock_details with(security_invoker=true) as
select rs.*, sr.name, sr.specification, sr.unit, sr.status, sr.area_title,
  sh.current_revision as latest_revision, current_sr.quantity::text as current_quantity,
  current_sr.status as current_status, current_sr.archived as currently_archived
from bob.material_requirement_stock rs
join bob.stock_revisions sr
  on sr.stock_id=rs.stock_id and sr.revision=rs.stock_revision and sr.project_id=rs.project_id
join bob.stock_items sh on sh.id=rs.stock_id and sh.project_id=rs.project_id
join bob.stock_revisions current_sr on current_sr.stock_id=sh.id and current_sr.revision=sh.current_revision;

create view bob.material_requirement_component_details with(security_invoker=true) as
select rc.*, cr.name, cr.kind, cr.specification, cr.intent,
  ch.current_revision as latest_revision, current_cr.quantity as current_quantity,
  current_cr.intent as current_intent, current_cr.archived as currently_archived
from bob.material_requirement_components rc
join bob.component_revisions cr
  on cr.component_id=rc.component_id and cr.revision=rc.component_revision and cr.project_id=rc.project_id
join bob.existing_components ch on ch.id=rc.component_id and ch.project_id=rc.project_id
join bob.component_revisions current_cr on current_cr.component_id=ch.id and current_cr.revision=ch.current_revision;

create view bob.material_requirement_shopping_state with(security_invoker=true) as
select l.project_id, l.requirement_id, l.material_id, l.synced_requirement_revision,
  l.synced_name, l.synced_qty, l.synced_area_label, l.synced_category,
  h.current_revision,
  (m.id is null) as material_missing,
  (h.current_revision <> l.synced_requirement_revision) as source_outdated,
  (coalesce(m.name,'') <> l.synced_name
    or coalesce(m.qty,'') <> l.synced_qty
    or coalesce(m.area_label,'') <> l.synced_area_label
    or coalesce(m.category,'') <> l.synced_category) as shopping_edited,
  coalesce(cm.target_changed,false) or coalesce(cm.artifact_changed,false)
    or coalesce(cm.stock_changed,false) or coalesce(cm.component_changed,false) as source_stale
from bob.material_requirement_shopping l
join bob.material_requirements h on h.id=l.requirement_id and h.project_id=l.project_id
join bob.current_material_requirements cm on cm.id=h.id and cm.project_id=h.project_id
left join bob.materials m on m.id=l.material_id and m.project_id=l.project_id;

revoke all on bob.current_stock_items, bob.current_material_requirements,
  bob.material_requirement_stock_details, bob.material_requirement_component_details,
  bob.material_requirement_shopping_state from public, anon, authenticated;
grant select on bob.current_stock_items, bob.current_material_requirements,
  bob.material_requirement_stock_details, bob.material_requirement_component_details,
  bob.material_requirement_shopping_state to authenticated;

create function bob_private.stock_command(
  p_project text,
  p_action text,
  p_stock uuid,
  p_expected integer,
  p_data jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  actor text;
  allowed text[];
  h bob.stock_items;
  r bob.stock_revisions;
  previous bob.stock_revisions;
  n integer;
  area text;
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_stock is null or p_action is null or p_action not in ('create','revise','archive','restore')
    or p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 20000 then
    raise exception 'Invalid stock command';
  end if;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  if actor is null then raise exception 'project_denied' using errcode='42501'; end if;

  allowed := case when p_action in ('create','revise')
    then array['name','specification','quantity','unit','status','area_id','notes','change_note']
    else array[]::text[] end;
  if p_data - allowed <> '{}'::jsonb then
    raise exception 'Unsupported fields. Identity and recorded history cannot be rewritten.';
  end if;

  if p_action='create' then
    if p_expected is distinct from 0 then raise exception 'New stock starts at revision zero'; end if;
    if exists(select 1 from bob.stock_items where id=p_stock) then
      raise exception 'Stock item already exists. Reload before creating another.';
    end if;
    insert into bob.stock_items(id,project_id,current_revision) values(p_stock,p_project,1);
    n := 1;
  else
    select * into h from bob.stock_items where id=p_stock and project_id=p_project for update;
    if not found then raise exception 'Stock item unavailable'; end if;
    if p_expected is distinct from h.current_revision then
      raise exception 'Stock item changed. Reload before saving again.';
    end if;
    select * into previous from bob.stock_revisions where stock_id=h.id and revision=h.current_revision;
    if (p_action='revise' and previous.archived)
      or (p_action='archive' and previous.archived)
      or (p_action='restore' and not previous.archived) then
      raise exception 'Stock item state changed. Reload first.';
    end if;
    n := p_expected + 1;
  end if;

  if p_action in ('create','revise') then
    r.name := btrim(p_data->>'name');
    r.specification := btrim(coalesce(p_data->>'specification',''));
    r.quantity := (p_data->>'quantity')::numeric;
    r.unit := p_data->>'unit';
    r.status := p_data->>'status';
    r.notes := btrim(coalesce(p_data->>'notes',''));
    area := nullif(p_data->>'area_id','');
    r.area_id := area;
    r.area_title := '';
    if area is not null then
      select name into r.area_title from bob.areas where id=area and project_id=p_project for share;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
    end if;
    if p_action='revise' and r.unit is distinct from previous.unit then
      raise exception 'Stock units cannot change. Create a new stock item for a different unit.';
    end if;
    if r.quantity is null or r.quantity <= 0 or r.quantity > 1000000000
      or r.quantity <> trunc(r.quantity,4) or r.unit not in ('pcs','m','m2','m3','kg','l')
      or r.status not in ('available','inspect','unavailable')
      or (r.unit='pcs' and r.quantity <> trunc(r.quantity)) then
      raise exception 'Invalid stock quantity, unit or status';
    end if;
    r.archived := false;
  else
    r := previous;
    r.archived := (p_action='archive');
  end if;

  r.stock_id := p_stock;
  r.project_id := p_project;
  r.revision := n;
  r.recorded_by := uid;
  r.actor_label := actor;
  r.recorded_at := clock_timestamp();
  r.change_note := case p_action
    when 'create' then 'Initial stock record'
    when 'archive' then 'Archived'
    when 'restore' then 'Restored'
    else btrim(p_data->>'change_note') end;

  insert into bob.stock_revisions select r.*;
  update bob.stock_items set current_revision=n where id=p_stock;
  return jsonb_build_object('id',p_stock,'revision',n);
end $$;

revoke all on function bob_private.stock_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob_private.stock_command(text,text,uuid,integer,jsonb) to authenticated;
create function bob.stock_command(
  p_project text,
  p_action text,
  p_stock uuid,
  p_expected integer,
  p_data jsonb default '{}'::jsonb
)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.stock_command(p_project,p_action,p_stock,p_expected,p_data)
$$;
revoke all on function bob.stock_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob.stock_command(text,text,uuid,integer,jsonb) to authenticated;

create function bob_private.material_requirement_command(
  p_project text,
  p_action text,
  p_requirement uuid,
  p_expected integer,
  p_data jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  actor text;
  allowed text[];
  h bob.material_requirements;
  r bob.material_requirement_revisions;
  previous bob.material_requirement_revisions;
  target bob.target_revisions;
  artifact bob.artifact_revisions;
  stock bob.stock_revisions;
  component bob.component_revisions;
  link bob.material_requirement_shopping;
  n integer;
  area text;
  task text;
  task_area text;
  stock_refs jsonb;
  component_refs jsonb;
  ref jsonb;
  q numeric;
  already numeric;
  stock_total numeric := 0;
  component_total numeric := 0;
  net numeric;
  qty_text text;
  area_label text;
  icon text;
  material text;
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_requirement is null or p_action is null
    or p_action not in ('create','revise','archive','restore','publish')
    or p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 32000 then
    raise exception 'Invalid material requirement command';
  end if;

  perform 1 from bob.projects where id=p_project for no key update;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  if actor is null then raise exception 'project_denied' using errcode='42501'; end if;

  allowed := case when p_action in ('create','revise') then
    array['name','category','area_id','task_id','unit','required_quantity','waste_percent',
      'purchase_increment','basis','assumptions','artifact_id','artifact_revision','target_revision',
      'stock_allocations','component_allocations','change_note']
    else array[]::text[] end;
  if p_data - allowed <> '{}'::jsonb then
    raise exception 'Unsupported fields. Identity, solution lineage, actor and derived quantities cannot be rewritten.';
  end if;

  if p_action='create' then
    if p_expected is distinct from 0 then raise exception 'New requirements start at revision zero'; end if;
    if exists(select 1 from bob.material_requirements where id=p_requirement) then
      raise exception 'Material requirement already exists. Reload before creating another.';
    end if;
    insert into bob.material_requirements(id,project_id,current_revision) values(p_requirement,p_project,1);
    n := 1;
  else
    select * into h from bob.material_requirements where id=p_requirement and project_id=p_project for update;
    if not found then raise exception 'Material requirement unavailable'; end if;
    if p_expected is distinct from h.current_revision then
      raise exception 'Material requirement changed. Reload before saving again.';
    end if;
    select * into previous from bob.material_requirement_revisions
      where requirement_id=h.id and revision=h.current_revision;
    if (p_action='revise' and previous.archived)
      or (p_action='archive' and previous.archived)
      or (p_action='restore' and not previous.archived) then
      raise exception 'Material requirement state changed. Reload first.';
    end if;
    n := p_expected + 1;
  end if;

  if p_action='publish' then
    if previous.archived then raise exception 'Restore the material requirement before sending it to Shopping.'; end if;
    perform 1 from bob.project_targets where project_id=p_project and current_revision=previous.target_revision;
    if not found then raise exception 'Project target changed. Review the material requirement before Shopping.'; end if;
    if previous.artifact_id is not null then
      perform 1 from bob.artifacts ah
      join bob.artifact_revisions ar on ar.artifact_id=ah.id and ar.revision=ah.current_revision
      where ah.id=previous.artifact_id and ah.project_id=p_project
        and ah.current_revision=previous.artifact_revision and not ar.archived;
      if not found then raise exception 'Drawing changed. Review the material requirement before Shopping.'; end if;
    end if;
    if exists(
      select 1 from bob.material_requirement_stock rs
      join bob.stock_items sh on sh.id=rs.stock_id and sh.project_id=rs.project_id
      join bob.stock_revisions sr on sr.stock_id=sh.id and sr.revision=sh.current_revision
      where rs.requirement_id=p_requirement and rs.requirement_revision=p_expected
        and (sh.current_revision<>rs.stock_revision or sr.archived or sr.status<>'available')
    ) then raise exception 'Stock changed. Review the material requirement before Shopping.'; end if;
    if exists(
      select 1 from bob.material_requirement_components rc
      join bob.existing_components ch on ch.id=rc.component_id and ch.project_id=rc.project_id
      join bob.component_revisions cr on cr.component_id=ch.id and cr.revision=ch.current_revision
      where rc.requirement_id=p_requirement and rc.requirement_revision=p_expected
        and (ch.current_revision<>rc.component_revision or cr.archived or cr.intent<>'reuse' or cr.quantity is null)
    ) then raise exception 'Reusable component changed. Review the material requirement before Shopping.'; end if;

    qty_text := regexp_replace(regexp_replace(previous.purchase_quantity::text,'0+$',''),'\.$','') || ' ' ||
      case previous.unit when 'm2' then 'm²' when 'm3' then 'm³' else previous.unit end;
    area_label := coalesce(nullif(previous.area_title,''),'Project');
    icon := case lower(previous.category)
      when 'timber' then 'tree'
      when 'fasteners & glue' then 'nut'
      when 'electrical' then 'lightning'
      when 'paint & finish' then 'paint-roller'
      when 'sauna & plumbing' then 'drop'
      when 'tools' then 'wrench'
      else 'package' end;

    select * into link from bob.material_requirement_shopping where requirement_id=p_requirement for update;
    material := coalesce(link.material_id, 'mr_' || p_requirement::text);
    if link.requirement_id is null or link.material_id is null
      or not exists(select 1 from bob.materials where id=material and project_id=p_project) then
      if exists(select 1 from bob.materials where id=material) then
        raise exception 'Shopping identity collision. Reload before trying again.';
      end if;
      insert into bob.materials(id,project_id,name,qty,area_label,supplier,status,cost,category,category_icon,sort_order)
      values(material,p_project,previous.name,qty_text,area_label,'','needed','',previous.category,icon,
        coalesce((select max(sort_order)+1 from bob.materials where project_id=p_project),1));
    else
      update bob.materials set name=previous.name, qty=qty_text, area_label=area_label,
        category=previous.category, category_icon=icon, updated_at=now()
      where id=material and project_id=p_project;
    end if;

    insert into bob.material_requirement_shopping(requirement_id,project_id,material_id,
      synced_requirement_revision,synced_name,synced_qty,synced_area_label,synced_category,
      recorded_by,actor_label,recorded_at)
    values(p_requirement,p_project,material,p_expected,previous.name,qty_text,area_label,previous.category,
      uid,actor,clock_timestamp())
    on conflict(requirement_id) do update set
      material_id=excluded.material_id,
      synced_requirement_revision=excluded.synced_requirement_revision,
      synced_name=excluded.synced_name,
      synced_qty=excluded.synced_qty,
      synced_area_label=excluded.synced_area_label,
      synced_category=excluded.synced_category,
      recorded_by=excluded.recorded_by,
      actor_label=excluded.actor_label,
      recorded_at=excluded.recorded_at;
    return jsonb_build_object('id',p_requirement,'revision',p_expected,'material_id',material);
  end if;

  if p_action in ('create','revise') then
    select tr.* into target
    from bob.project_targets pt
    join bob.target_revisions tr on tr.project_id=pt.project_id and tr.revision=pt.current_revision
    where pt.project_id=p_project and tr.revision=(p_data->>'target_revision')::integer;
    if not found then raise exception 'Project target changed. Reload before saving the material requirement.'; end if;
    if target.solution_id is null then raise exception 'Choose a project target before saving a material requirement.'; end if;

    r.name := btrim(p_data->>'name');
    r.category := btrim(coalesce(nullif(p_data->>'category',''),'Other'));
    r.unit := p_data->>'unit';
    r.required_quantity := (p_data->>'required_quantity')::numeric;
    r.waste_percent := coalesce((p_data->>'waste_percent')::numeric,0);
    r.purchase_increment := (p_data->>'purchase_increment')::numeric;
    r.basis := btrim(p_data->>'basis');
    r.assumptions := btrim(coalesce(p_data->>'assumptions',''));
    if r.required_quantity is null or r.required_quantity<=0 or r.required_quantity>1000000000
      or r.required_quantity<>trunc(r.required_quantity,4)
      or r.waste_percent is null or r.waste_percent<0 or r.waste_percent>100 or r.waste_percent<>trunc(r.waste_percent,3)
      or r.purchase_increment is null or r.purchase_increment<=0 or r.purchase_increment>1000000000
      or r.purchase_increment<>trunc(r.purchase_increment,4)
      or r.unit not in ('pcs','m','m2','m3','kg','l')
      or (r.unit='pcs' and (r.required_quantity<>trunc(r.required_quantity) or r.purchase_increment<>trunc(r.purchase_increment))) then
      raise exception 'Invalid material quantity, unit, allowance or purchase increment';
    end if;

    task := nullif(p_data->>'task_id','');
    area := nullif(p_data->>'area_id','');
    r.task_id := task;
    r.task_title := '';
    r.area_id := area;
    r.area_title := '';
    if task is not null then
      select t.area_id, t.name into task_area, r.task_title
      from bob.tasks t join bob.areas a on a.id=t.area_id
      where t.id=task and a.project_id=p_project for share;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
      if area is not null and area is distinct from task_area then
        raise exception 'The material requirement must use its task area.';
      end if;
      area := task_area;
      r.area_id := area;
    end if;
    if area is not null then
      select name into r.area_title from bob.areas where id=area and project_id=p_project for share;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
    end if;

    r.artifact_id := nullif(p_data->>'artifact_id','')::uuid;
    r.artifact_revision := nullif(p_data->>'artifact_revision','')::integer;
    r.artifact_title := '';
    if (r.artifact_id is null) <> (r.artifact_revision is null) then
      raise exception 'Drawing id and version must be supplied together';
    end if;
    if r.artifact_id is not null then
      select ar.* into artifact
      from bob.artifacts ah
      join bob.artifact_revisions ar on ar.artifact_id=ah.id and ar.revision=ah.current_revision
      where ah.id=r.artifact_id and ah.project_id=p_project
        and ah.current_revision=r.artifact_revision and not ar.archived;
      if not found then raise exception 'Drawing version unavailable in this project'; end if;
      if artifact.target_revision<>target.revision or artifact.solution_id<>target.solution_id
        or artifact.solution_revision<>target.solution_revision then
        raise exception 'Drawing belongs to a different project target. Review the material basis.';
      end if;
      r.artifact_title := artifact.title;
    end if;

    r.target_revision := target.revision;
    r.solution_id := target.solution_id;
    r.solution_revision := target.solution_revision;
    select title into r.solution_title from bob.solution_revisions
      where solution_id=r.solution_id and revision=r.solution_revision and project_id=p_project;
    if not found then raise exception 'Selected solution version unavailable in this project'; end if;

    stock_refs := coalesce(p_data->'stock_allocations','[]'::jsonb);
    component_refs := coalesce(p_data->'component_allocations','[]'::jsonb);
    if jsonb_typeof(stock_refs)<>'array' or jsonb_array_length(stock_refs)>20
      or jsonb_typeof(component_refs)<>'array' or jsonb_array_length(component_refs)>20 then
      raise exception 'Use up to 20 stock/component allocations per requirement version';
    end if;
    if (select count(*)<>count(distinct v->>'id') from jsonb_array_elements(stock_refs) v)
      or (select count(*)<>count(distinct v->>'id') from jsonb_array_elements(component_refs) v) then
      raise exception 'Each stock/component source can be allocated once per requirement version';
    end if;

    for ref in select * from jsonb_array_elements(stock_refs) loop
      if jsonb_typeof(ref)<>'object' or ref-array['id','revision','quantity']<>'{}'::jsonb then
        raise exception 'Invalid stock allocation';
      end if;
      select sr.* into stock
      from bob.stock_items sh join bob.stock_revisions sr
        on sr.stock_id=sh.id and sr.revision=sh.current_revision
      where sh.id=(ref->>'id')::uuid and sh.project_id=p_project
        and sh.current_revision=(ref->>'revision')::integer
        and not sr.archived and sr.status='available' for share;
      if not found then raise exception 'Stock version unavailable or not confirmed available in this project'; end if;
      q := (ref->>'quantity')::numeric;
      if stock.unit<>r.unit or q is null or q<=0 or q>stock.quantity or q<>trunc(q,4)
        or (r.unit='pcs' and q<>trunc(q)) then
        raise exception 'Stock allocation must use the same unit and an available quantity';
      end if;
      select coalesce(sum(rs.quantity),0) into already
      from bob.material_requirement_stock rs
      join bob.material_requirements oh on oh.id=rs.requirement_id and oh.project_id=rs.project_id
      join bob.material_requirement_revisions orr on orr.requirement_id=oh.id and orr.revision=oh.current_revision
      join bob.stock_items current_stock on current_stock.id=rs.stock_id and current_stock.project_id=rs.project_id
      where rs.stock_id=stock.stock_id and rs.requirement_id<>p_requirement
        and not orr.archived and current_stock.current_revision=rs.stock_revision;
      if already+q>stock.quantity then raise exception 'Stock quantity is already reserved by another active material requirement'; end if;
      stock_total := stock_total+q;
    end loop;

    for ref in select * from jsonb_array_elements(component_refs) loop
      if jsonb_typeof(ref)<>'object' or ref-array['id','revision','quantity']<>'{}'::jsonb then
        raise exception 'Invalid reusable component allocation';
      end if;
      if r.unit<>'pcs' then raise exception 'Reusable components can only satisfy piece-count requirements'; end if;
      select cr.* into component
      from bob.existing_components ch join bob.component_revisions cr
        on cr.component_id=ch.id and cr.revision=ch.current_revision
      where ch.id=(ref->>'id')::uuid and ch.project_id=p_project
        and ch.current_revision=(ref->>'revision')::integer
        and not cr.archived and cr.intent='reuse' and cr.quantity is not null for share;
      if not found then raise exception 'Reusable component version unavailable or not confirmed for reuse in this project'; end if;
      q := (ref->>'quantity')::numeric;
      if q is null or q<=0 or q<>trunc(q) or q>component.quantity then
        raise exception 'Reusable component allocation must be a whole available piece count';
      end if;
      select coalesce(sum(rc.quantity),0) into already
      from bob.material_requirement_components rc
      join bob.material_requirements oh on oh.id=rc.requirement_id and oh.project_id=rc.project_id
      join bob.material_requirement_revisions orr on orr.requirement_id=oh.id and orr.revision=oh.current_revision
      join bob.existing_components current_component on current_component.id=rc.component_id and current_component.project_id=rc.project_id
      where rc.component_id=component.component_id and rc.requirement_id<>p_requirement
        and not orr.archived and current_component.current_revision=rc.component_revision;
      if already+q>component.quantity then raise exception 'Reusable component quantity is already reserved by another active material requirement'; end if;
      component_total := component_total+q;
    end loop;

    r.required_with_waste := ceil(r.required_quantity*(1+r.waste_percent/100)*10000)/10000;
    r.stock_quantity := stock_total;
    r.component_quantity := component_total;
    net := greatest(r.required_with_waste-stock_total-component_total,0);
    r.purchase_quantity := ceil(net/r.purchase_increment)*r.purchase_increment;
    if r.purchase_quantity<>trunc(r.purchase_quantity,4) then
      r.purchase_quantity := ceil(r.purchase_quantity*10000)/10000;
    end if;
    r.source_kind := 'manual';
    r.method_key := 'manual';
    r.method_version := '4B2a-v1';
    r.archived := false;
  else
    r := previous;
    r.archived := (p_action='archive');
  end if;

  r.requirement_id := p_requirement;
  r.project_id := p_project;
  r.revision := n;
  r.recorded_by := uid;
  r.actor_label := actor;
  r.recorded_at := clock_timestamp();
  r.change_note := case p_action
    when 'create' then 'Initial material requirement'
    when 'archive' then 'Archived'
    when 'restore' then 'Restored'
    else btrim(p_data->>'change_note') end;

  insert into bob.material_requirement_revisions select r.*;
  if p_action in ('archive','restore') then
    insert into bob.material_requirement_stock
      select project_id,requirement_id,n,stock_id,stock_revision,quantity
      from bob.material_requirement_stock where requirement_id=p_requirement and requirement_revision=p_expected;
    insert into bob.material_requirement_components
      select project_id,requirement_id,n,component_id,component_revision,quantity
      from bob.material_requirement_components where requirement_id=p_requirement and requirement_revision=p_expected;
  else
    insert into bob.material_requirement_stock
      select p_project,p_requirement,n,(v->>'id')::uuid,(v->>'revision')::integer,(v->>'quantity')::numeric
      from jsonb_array_elements(stock_refs) v;
    insert into bob.material_requirement_components
      select p_project,p_requirement,n,(v->>'id')::uuid,(v->>'revision')::integer,(v->>'quantity')::integer
      from jsonb_array_elements(component_refs) v;
  end if;
  update bob.material_requirements set current_revision=n where id=p_requirement;
  return jsonb_build_object('id',p_requirement,'revision',n);
end $$;

revoke all on function bob_private.material_requirement_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob_private.material_requirement_command(text,text,uuid,integer,jsonb) to authenticated;
create function bob.material_requirement_command(
  p_project text,
  p_action text,
  p_requirement uuid,
  p_expected integer,
  p_data jsonb default '{}'::jsonb
)
returns jsonb language sql security invoker set search_path='' as $$
  select bob_private.material_requirement_command(p_project,p_action,p_requirement,p_expected,p_data)
$$;
revoke all on function bob.material_requirement_command(text,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function bob.material_requirement_command(text,text,uuid,integer,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
