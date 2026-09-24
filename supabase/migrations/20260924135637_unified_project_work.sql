-- Unified work ownership. Existing IDs/evidence/history remain intact.
-- Source replacements below are static definitions based on main 1d4c984;
-- no runtime introspection or text-rewriting of deployed functions.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob.tasks add column project_id text references bob.projects(id) on delete cascade;
update bob.tasks t set project_id=a.project_id from bob.areas a where a.id=t.area_id;
alter table bob.tasks alter column project_id set not null;
alter table bob.tasks alter column area_id drop not null;
alter table bob.tasks drop constraint tasks_area_id_fkey;
alter table bob.tasks add constraint tasks_area_id_fkey foreign key(area_id) references bob.areas(id) on delete set null;
alter table bob.tasks add column primary_step_id uuid;
alter table bob.tasks add constraint tasks_primary_step_fk foreign key(project_id,primary_step_id)
  references bob.project_plan_step_identities(project_id,step_id) deferrable initially deferred;
create index tasks_project_idx on bob.tasks(project_id);
create index tasks_primary_step_idx on bob.tasks(project_id,primary_step_id);

-- Only promote an unambiguous existing link with the same organisational scope.
-- Cross-Area/multiple links remain references, never guessed ownership.
update bob.tasks t set primary_step_id=x.step_id from (
 select l.task_id,(array_agg(l.step_id))[1] step_id
 from bob.project_plan_step_tasks l join bob.project_plans p on p.project_id=l.project_id
 join bob.project_plan_steps s on s.project_id=p.project_id and s.plan_revision=p.current_revision and s.step_id=l.step_id
 group by l.task_id having count(*)=1
) x join bob.project_plan_steps s on s.step_id=x.step_id
join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision
where t.id=x.task_id and t.project_id=s.project_id and t.area_id is not distinct from s.area_id;

alter table bob.project_plan_revisions add column task_links jsonb not null default '[]'::jsonb;
alter table bob.project_plan_steps add column phase bob.project_phase;
alter table bob.project_plans add column focus_step_id uuid;
alter table bob.project_plans add constraint project_plans_focus_fk foreign key(project_id,focus_step_id)
  references bob.project_plan_step_identities(project_id,step_id) deferrable initially deferred;
create index project_plans_focus_idx on bob.project_plans(project_id,focus_step_id);
update bob.project_plans p set focus_step_id=s.step_id from bob.project_plan_steps s
 where s.project_id=p.project_id and s.plan_revision=p.current_revision and s.state='active';
drop index bob.project_plan_one_active_idx;

create function bob_private.task_work_scope_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent_project text; parent_area text; rev integer;
begin
 if new.project_id is null and new.area_id is not null then
  select project_id into new.project_id from bob.areas where id=new.area_id;
 end if;
 if tg_op='UPDATE' and new.project_id is distinct from old.project_id then
  raise exception 'task_project_immutable' using errcode='42501'; end if;
 if new.primary_step_id is not null and (tg_op='INSERT' or new.primary_step_id is distinct from old.primary_step_id or new.area_id is distinct from old.area_id) then
  select current_revision into rev from bob.project_plans where project_id=new.project_id;
  select area_id into parent_area from bob.project_plan_steps
   where project_id=new.project_id and plan_revision=rev and step_id=new.primary_step_id;
  if not found then raise exception 'plan_step_not_found' using errcode='22023'; end if;
  new.area_id:=parent_area;
 end if;
 if new.area_id is not null then
  select project_id into parent_project from bob.areas where id=new.area_id;
  if parent_project is distinct from new.project_id then raise exception 'project_denied' using errcode='42501'; end if;
 end if;
 return new;
end $$;
revoke all on function bob_private.task_work_scope_guard() from public,anon,authenticated;
create trigger task_work_scope_guard before insert or update on bob.tasks
 for each row execute function bob_private.task_work_scope_guard();

drop policy project_members on bob.tasks;
create policy project_members on bob.tasks for all to authenticated
 using(bob_private.has_project_access(project_id)) with check(bob_private.has_project_access(project_id));
drop policy project_members on bob.task_assignees;
create policy project_members on bob.task_assignees for all to authenticated
 using(exists(select 1 from bob.tasks t join bob.people p on p.project_id=t.project_id
  where t.id=task_id and p.id=person_id and bob_private.has_project_access(t.project_id)))
 with check(exists(select 1 from bob.tasks t join bob.people p on p.project_id=t.project_id
  where t.id=task_id and p.id=person_id and bob_private.has_project_access(t.project_id)));

-- bob_private.material_requirement_command — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.material_requirement_command(p_project text, p_action text, p_requirement uuid, p_expected integer, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      from bob.tasks t left join bob.areas a on a.id=t.area_id
      where t.id=task and t.project_id=p_project for share of t;
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
end $function$
;

-- bob.search_project_data — updated work ownership.
CREATE OR REPLACE FUNCTION bob.search_project_data(p_project_id text, p_dataset text, p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_area_id text DEFAULT NULL::text, p_record_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_rows jsonb := '[]'; v_links jsonb := '[]'; v_truncated boolean := false; v_result jsonb;
begin
  if not bob_private.has_project_access(p_project_id) then
    raise exception 'project_denied' using errcode = '42501';
  end if;
  if p_dataset is null or p_dataset <> all(array['project','areas','tasks','materials','crew','events','announcements'])
    or length(coalesce(p_query,'')) > 200 or length(coalesce(p_record_id,'')) > 200
    or length(coalesce(p_area_id,'')) > 200
    or (p_area_id is not null and p_dataset <> 'tasks')
    or (p_status is not null and not (
      (p_dataset = 'tasks' and p_status = any(array['todo','doing','done','blocked'])) or
      (p_dataset = 'materials' and p_status = any(array['needed','ordered','delivered','backorder'])) or
      (p_dataset = 'events' and p_status = any(array['going','open'])))) then
    raise exception 'invalid_lookup' using errcode = '22023';
  end if;
  case p_dataset
    when 'project' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description, 'location', r.location, 'type', r.type, 'start_label', r.start_label, 'start_date', r.start_date, 'end_date', r.end_date, 'updated_at', r.updated_at) as item
        from bob.projects r
        where r.id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.description))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'areas' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description, 'lead_id', r.lead_id, 'updated_at', r.updated_at) as item
        from bob.areas r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.description))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'tasks' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'project_id',r.project_id,'primary_step_id',r.primary_step_id,'area_id', r.area_id, 'name', r.name, 'skill', r.skill, 'hours', r.hours, 'status', r.status, 'materials', r.materials, 'updated_at', r.updated_at, 'area_name', a.name) as item
        from bob.tasks r left join bob.areas a on a.id = r.area_id
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.materials, a.name))) > 0)
          and (p_status is null or r.status::text = p_status)
          and (p_area_id is null or r.area_id = p_area_id)
        order by r.id limit 26
      ) bounded;
    when 'materials' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'name', r.name, 'qty', r.qty, 'area_label', r.area_label, 'supplier', r.supplier, 'status', r.status, 'cost', r.cost, 'category', r.category, 'updated_at', r.updated_at) as item
        from bob.materials r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.area_label, r.supplier))) > 0)
          and (p_status is null or r.status::text = p_status)
        order by r.id limit 26
      ) bounded;
    when 'crew' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'name', r.name, 'role', r.role, 'updated_at', r.updated_at) as item
        from bob.people r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.role))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'events' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'title', r.title, 'day', r.day, 'time', r.time, 'place', r.place, 'spots', r.spots, 'status', r.status, 'updated_at', r.updated_at) as item
        from bob.events r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.title, r.place))) > 0)
          and (p_status is null or r.status::text = p_status)
        order by r.id limit 26
      ) bounded;
    when 'announcements' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'text', r.text, 'pinned', r.pinned, 'time_label', r.time_label, 'author_id', r.author_id, 'updated_at', r.updated_at) as item
        from bob.announcements r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.text))) > 0)
        order by r.id limit 26
      ) bounded;
  end case;
  if jsonb_array_length(v_rows) > 25 then
    v_truncated := true;
    v_rows := v_rows - 25;
  end if;

  -- Each query checks both relation ends even though RLS already does so.
  if p_dataset = 'tasks' then
    select coalesce(jsonb_agg(item order by parent_id, id), '[]') into v_links from (
      select t.id parent_id, p.id, jsonb_build_object('kind','assignee','parent_id',t.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.task_assignees ta join bob.tasks t on t.id = ta.task_id
      left join bob.areas a on a.id = t.area_id
      join bob.people p on p.id = ta.person_id and p.project_id = t.project_id
      where t.project_id = p_project_id and t.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by t.id, p.id limit 26
    ) bounded;
  elsif p_dataset = 'crew' then
    select coalesce(jsonb_agg(item order by parent_id, name), '[]') into v_links from (
      select p.id parent_id, s.name, jsonb_build_object('kind','skill','parent_id',p.id,
        'id',jsonb_build_array(p.id,s.name)::text,'name',s.name,'level',s.level,'updated_at',null) item
      from bob.person_skills s join bob.people p on p.id = s.person_id
      where p.project_id = p_project_id and p.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by p.id, s.name limit 26
    ) bounded;
  elsif p_dataset = 'events' then
    select coalesce(jsonb_agg(item order by parent_id, id), '[]') into v_links from (
      select e.id parent_id, p.id, jsonb_build_object('kind','attendee','parent_id',e.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.event_attendees ea join bob.events e on e.id = ea.event_id
      join bob.people p on p.id = ea.person_id and p.project_id = e.project_id
      where e.project_id = p_project_id and e.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by e.id, p.id limit 26
    ) bounded;
  elsif p_dataset = 'announcements' then
    select coalesce(jsonb_agg(item order by parent_id), '[]') into v_links from (
      select a.id parent_id, jsonb_build_object('kind','author','parent_id',a.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.announcements a join bob.people p on p.id = a.author_id and p.project_id = a.project_id
      where a.project_id = p_project_id and a.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by a.id limit 26
    ) bounded;
  end if;
  if jsonb_array_length(v_links) > 25 then
    v_truncated := true;
    v_links := v_links - 25;
  end if;

  loop
    v_result := jsonb_build_object('records',v_rows,'related',v_links,'truncated',v_truncated);
    -- Reserve room for the edge's provenance envelope within the 16 KiB cap.
    exit when octet_length(v_result::text) <= 14000;
    v_truncated := true;
    if jsonb_array_length(v_links) > 0 then
      v_links := v_links - (jsonb_array_length(v_links)-1);
    else
      v_rows := v_rows - (jsonb_array_length(v_rows)-1);
    end if;
  end loop;
  return v_result;
end $function$
;

-- bob_private.link_media — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.link_media(p_project text, p_media uuid, p_kind text, p_target text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target_project text;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 perform 1 from bob.media_assets where id=p_media and project_id=p_project and state<>'deleting' for update;
 if not found then raise exception 'Image unavailable'; end if;
 if p_kind='project' and p_target=p_project then return;
 elsif p_kind='area' then select project_id into target_project from bob.areas where id=p_target for share;
 elsif p_kind='task' then select t.project_id into target_project from bob.tasks t left join bob.areas a on a.id=t.area_id where t.id=p_target for share of t;
 elsif p_kind='step' then select project_id into target_project from bob.task_steps where id=p_target::uuid for share;
 elsif p_kind='plan_step' then
  perform 1 from bob.project_plans where project_id=p_project for share;
  select s.project_id into target_project from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=p_project and s.step_id=p_target::uuid;
 else raise exception 'Invalid image attachment'; end if;
 if target_project is distinct from p_project then raise exception 'project_denied' using errcode='42501'; end if;
 insert into bob.media_links(project_id,media_id,area_id,task_id,step_id,plan_step_id) values(p_project,p_media,
 case when p_kind='area' then p_target end,case when p_kind='task' then p_target end,case when p_kind='step' then p_target::uuid end,case when p_kind='plan_step' then p_target::uuid end) on conflict do nothing;
end $function$
;

-- bob_private.task_steps_command — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.task_steps_command(p_project text, p_task text, p_action text, p_step uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t bob.tasks; s bob.task_steps; neighbour bob.task_steps; next_position integer;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  select t0.* into t from bob.tasks t0 left join bob.areas a on a.id=t0.area_id
    where t0.id=p_task and t0.project_id=p_project for update of t0;
  if not found or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_action='instructions' then
    if (p_data->>'expected_updated_at')::timestamptz is distinct from t.updated_at then
      raise exception 'Task changed. Reload before saving your edits.' using errcode='40001';
    end if;
    update bob.tasks set instructions=p_data->>'instructions', updated_at=now() where id=p_task;
  elsif p_action='create' then
    select coalesce(max(position),0)+1 into next_position from bob.task_steps where task_id=p_task;
    insert into bob.task_steps(project_id,task_id,title,instructions,position,is_checkpoint,required,created_by)
      values(p_project,p_task,p_data->>'title',coalesce(p_data->>'instructions',''),next_position,
        coalesce((p_data->>'is_checkpoint')::boolean,false),coalesce((p_data->>'required')::boolean,false),auth.uid());
  else
    select * into s from bob.task_steps where id=p_step and task_id=p_task and project_id=p_project for update;
    if not found then raise exception 'Step unavailable'; end if;
    if (p_data->>'revision')::integer is distinct from s.revision then
      raise exception 'Step changed. Reload before saving your edits.' using errcode='40001';
    end if;
    if p_action='edit' then
      update bob.task_steps set title=p_data->>'title', instructions=coalesce(p_data->>'instructions',''),
        is_checkpoint=coalesce((p_data->>'is_checkpoint')::boolean,false),
        required=coalesce((p_data->>'required')::boolean,false),
        revision=revision+1, updated_at=now() where id=s.id;
    elsif p_action='complete' then
      if jsonb_typeof(p_data->'completed') is distinct from 'boolean' then raise exception 'Choose a completion state'; end if;
      update bob.task_steps set completed_at=case when (p_data->>'completed')::boolean then now() end,
        completed_by=case when (p_data->>'completed')::boolean then auth.uid() end,
        revision=revision+1, updated_at=now() where id=s.id;
    elsif p_action='move' then
      if p_data->>'direction'='up' then
        select * into neighbour from bob.task_steps where task_id=p_task and position<s.position order by position desc limit 1;
      elsif p_data->>'direction'='down' then
        select * into neighbour from bob.task_steps where task_id=p_task and position>s.position order by position limit 1;
      else raise exception 'Choose up or down'; end if;
      if neighbour.id is not null then
        update bob.task_steps set position=case when id=s.id then neighbour.position else s.position end,
          revision=revision+1, updated_at=now() where id in (s.id,neighbour.id);
      end if;
    elsif p_action='delete' then
      delete from bob.task_steps where id=s.id;
    else raise exception 'Unknown step command'; end if;
  end if;
  if t.status='done' and exists(select 1 from bob.task_steps where task_id=p_task and required and completed_at is null) then
    raise exception 'Reopen the task before adding or reopening a required check.';
  end if;
  return jsonb_build_object('saved',true);
end $function$
;

-- bob_volunteer_private.volunteer_media — updated work ownership.
CREATE OR REPLACE FUNCTION bob_volunteer_private.volunteer_media(p_secret text, p_task text, p_media uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); result jsonb;
begin
  select jsonb_build_object('bucket',m.bucket_id,'path',m.object_path,'contentType',m.content_type,'byteSize',m.byte_size) into result
    from bob.media_assets m join bob.tasks t on t.id=p_task left join bob.areas a on a.id=t.area_id
    where t.project_id=s.project_id and m.project_id=s.project_id and m.id=p_media and m.state='ready'
      and exists(select 1 from bob.media_links l left join bob.task_steps st on st.id=l.step_id where l.media_id=m.id
        and (l.task_id=t.id or l.area_id=t.area_id or st.task_id=t.id));
  if result is null then raise exception 'Image unavailable.' using errcode='42501'; end if;
  return result;
end $function$
;

-- bob_private.bob_project_write — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.bob_project_write(p_project text, p_thread uuid, p_turn uuid, p_generation bigint, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  kind text := p_payload->>'kind'; rid text := p_payload->>'record_id';
  d jsonb := p_payload->'data'; before_row jsonb; after_row jsonb; result jsonb;
  op_key text; existing bob_private.bob_write_receipts; expected_time timestamptz;
  expected_revision int; fact_id uuid; message text; quote text := p_payload->>'request_quote';
  allowed text[]; project_row bob.projects; task_row bob.tasks; area_row bob.areas;
begin
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>24000
    or kind is null or kind<>all(array['project','area','task','measurement'])
    or d is null or jsonb_typeof(d)<>'object'
    or (select count(*) from jsonb_object_keys(p_payload))<>6
    or jsonb_typeof(p_payload->'request_quote') is distinct from 'string'
    or exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(array['kind','record_id','expected_updated_at','expected_revision','data','request_quote']))
    or coalesce(char_length(quote),0) not between 1 and 500
    or (p_payload->'record_id'<>'null'::jsonb and jsonb_typeof(p_payload->'record_id')<>'string') then
    raise exception 'invalid_write' using errcode='22023';
  end if;
  select text into message from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  if position(quote in message)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
  if kind='project' then allowed:=array['description'];
  elsif kind='area' then allowed:=array['name','description'];
  elsif kind='task' then allowed:=array['area_id','step_id','name','instructions'];
  else allowed:=array['area_id','component_id','subject','value','unit','truth','source','notes','required','change_note']; end if;
  if exists(select 1 from jsonb_object_keys(d) k where k<>all(allowed)) then
    raise exception 'unsupported_write_fields' using errcode='22023';
  end if;
  -- Stable semantic create key: reworded attempts cannot create two copies of
  -- the same named task/measurement in one turn. Changed payloads conflict.
  op_key:=kind || ':' || coalesce(rid,concat_ws(':','new',d->>'area_id',d->>'step_id',d->>'component_id',lower(btrim(coalesce(d->>'name',d->>'subject')))));
  select * into existing from bob_private.bob_write_receipts
    where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op_key;
  if found then
    if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if;
    return existing.receipt;
  end if;
  if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then
    raise exception 'write_budget_exhausted' using errcode='22023';
  end if;
  if kind='project' then
    if rid is distinct from p_project or jsonb_typeof(d->'description') is distinct from 'string'
      or char_length(d->>'description')>12000 then raise exception 'invalid_write' using errcode='22023'; end if;
    select * into project_row from bob.projects where id=p_project for update;
    expected_time:=(p_payload->>'expected_updated_at')::timestamptz;
    if expected_time is null or expected_time is distinct from project_row.updated_at then raise exception 'record_changed' using errcode='40001'; end if;
    before_row:=jsonb_build_object('id',project_row.id,'name',project_row.name,'description',project_row.description,'updated_at',project_row.updated_at);
    update bob.projects set description=d->>'description' where id=p_project;
    select jsonb_build_object('id',id,'name',name,'description',description,'updated_at',updated_at) into after_row from bob.projects where id=p_project;
  elsif kind='area' then
    if jsonb_typeof(d->'name') is distinct from 'string' or char_length(btrim(d->>'name')) not between 1 and 200
      or jsonb_typeof(d->'description') is distinct from 'string' or char_length(d->>'description')>4000 then
      raise exception 'invalid_write' using errcode='22023'; end if;
    if rid is null then
      if p_payload->>'expected_updated_at' is not null then raise exception 'invalid_write' using errcode='22023'; end if;
      rid:='a_'||replace(gen_random_uuid()::text,'-','');
      insert into bob.areas(id,project_id,slug,name,description) values(rid,p_project,rid,btrim(d->>'name'),d->>'description');
    else
      select * into area_row from bob.areas where id=rid and project_id=p_project for update;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
      if area_row.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then raise exception 'record_changed' using errcode='40001'; end if;
      before_row:=to_jsonb(area_row);
      update bob.areas set name=btrim(d->>'name'),description=d->>'description' where id=rid;
    end if;
    select to_jsonb(a) into after_row from bob.areas a where id=rid and project_id=p_project;
  elsif kind='task' then
    perform 1 from bob.project_plans where project_id=p_project for share;
    if jsonb_typeof(d->'name') is distinct from 'string' or char_length(btrim(d->>'name')) not between 1 and 300
      or jsonb_typeof(d->'instructions') is distinct from 'string' or char_length(d->>'instructions')>12000 then
      raise exception 'invalid_write' using errcode='22023'; end if;
    if rid is null then
      if p_payload->>'expected_updated_at' is not null then raise exception 'invalid_write' using errcode='22023'; end if;
      if d->>'step_id' is null and not exists(select 1 from bob.areas where id=d->>'area_id' and project_id=p_project) then raise exception 'project_denied' using errcode='42501'; end if;
      rid:='t_' || replace(gen_random_uuid()::text,'-','');
      insert into bob.tasks(id,project_id,primary_step_id,area_id,name,instructions,status) values(rid,p_project,(d->>'step_id')::uuid,d->>'area_id',btrim(d->>'name'),d->>'instructions','todo');
    else
      select t.* into task_row from bob.tasks t left join bob.areas a on a.id=t.area_id
        where t.id=rid and t.project_id=p_project for update of t;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
      if d->>'step_id' is null and d->>'area_id' is distinct from task_row.area_id then raise exception 'project_denied' using errcode='42501'; end if;
      expected_time:=(p_payload->>'expected_updated_at')::timestamptz;
      if expected_time is null or expected_time is distinct from task_row.updated_at then raise exception 'record_changed' using errcode='40001'; end if;
      before_row:=jsonb_build_object('id',task_row.id,'name',task_row.name,'instructions',task_row.instructions,'updated_at',task_row.updated_at);
      update bob.tasks set name=btrim(d->>'name'),instructions=d->>'instructions',primary_step_id=coalesce((d->>'step_id')::uuid,primary_step_id) where id=rid;
    end if;
    select jsonb_build_object('id',id,'project_id',project_id,'primary_step_id',primary_step_id,'area_id',area_id,'name',name,'instructions',instructions,'status',status,'updated_at',updated_at)
      into after_row from bob.tasks where id=rid;
  else
    expected_revision:=(p_payload->>'expected_revision')::int;
    if rid is null then
      if expected_revision is distinct from 0 then raise exception 'invalid_write' using errcode='22023'; end if;
      fact_id:=gen_random_uuid();
    else
      fact_id:=rid::uuid;
      select jsonb_build_object('id',id,'subject',subject,'value',value,'unit',unit,'truth',truth,'source',source,'revision',revision,'source_media_id',source_media_id) into before_row
        from bob.current_measurements where id=fact_id and project_id=p_project;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
      if d ? 'area_id' or d ? 'component_id' then raise exception 'unsupported_write_fields' using errcode='22023'; end if;
      -- Revising a measurement must not silently discard an attached source image.
      d:=d || jsonb_build_object('source_media_id',before_row->'source_media_id');
    end if;
    perform bob.evidence_command(p_project,'measurement',case when rid is null then 'create' else 'revise' end,fact_id,expected_revision,d);
    rid:=fact_id::text;
    select jsonb_build_object('id',id,'subject',subject,'area_id',area_id,'component_id',component_id,'value',value,'unit',unit,'truth',truth,
      'source',source,'notes',notes,'required',required,'revision',revision,'archived',archived,'updated_at',recorded_at)
      into after_row from bob.current_measurements where id=fact_id and project_id=p_project;
  end if;
  if after_row is null then raise exception 'write_readback_failed'; end if;
  result:=jsonb_build_object('projectId',p_project,'dataset',case kind when 'area' then 'areas' when 'task' then 'tasks' when 'measurement' then 'measurements' else 'project' end,
    'recordId',rid,'label',coalesce(after_row->>'name',after_row->>'subject',rid),
    'operation',case when before_row is null then 'created' else 'updated' end,
    'savedAt',clock_timestamp(),'record',after_row);
  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
    values(p_project,auth.uid(),p_turn,op_key,p_payload,before_row,result);
  return result;
end $function$
;

-- bob_volunteer_private.volunteer_feed — updated work ownership.
CREATE OR REPLACE FUNCTION bob_volunteer_private.volunteer_feed(p_secret text, p_section text, p_after text, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); items jsonb; page jsonb; next_id text;
begin
  if p_limit is null or p_limit not between 1 and 50 or char_length(coalesce(p_after,''))>200 then raise exception 'Invalid page.' using errcode='22023'; end if;
  if p_section='tasks' then
    select coalesce(jsonb_agg(j order by id),'[]') into items from (
      select t.id,jsonb_build_object('id',t.id,'name',t.name,'area',a.name,'status',t.status,'skill',t.skill,'hours',t.hours,
        'mine',exists(select 1 from bob.task_assignees where task_id=t.id and person_id=s.person_id)) j
      from bob.tasks t left join bob.areas a on a.id=t.area_id where t.project_id=s.project_id and t.id>coalesce(p_after,'') order by t.id limit p_limit+1) rows;
  elsif p_section='events' then
    select coalesce(jsonb_agg(j order by id),'[]') into items from (
      select e.id,jsonb_build_object('id',e.id,'title',e.title,'day',e.day,'time',e.time,'place',e.place,'food',e.food,
        'going',exists(select 1 from bob.event_attendees where event_id=e.id and person_id=s.person_id)) j
      from bob.events e where e.project_id=s.project_id and e.id>coalesce(p_after,'') order by e.id limit p_limit+1) rows;
  elsif p_section='updates' then
    select coalesce(jsonb_agg(j order by id),'[]') into items from (
      select a.id,jsonb_build_object('id',a.id,'text',a.text,'pinned',a.pinned,'createdAt',a.created_at) j
      from bob.announcements a where a.project_id=s.project_id and a.id>coalesce(p_after,'') order by a.id limit p_limit+1) rows;
  elsif p_section='meals' then
    select coalesce(jsonb_agg(j order by id),'[]') into items from (
      select m.id,jsonb_build_object('id',m.id,'meal',m.meal,'time',m.time,'dish',m.dish,'notes',m.notes) j
      from bob.meals m where m.project_id=s.project_id and m.id>coalesce(p_after,'') order by m.id limit p_limit+1) rows;
  else raise exception 'Unknown volunteer section.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(value order by ordinality),'[]') into page from jsonb_array_elements(items) with ordinality where ordinality<=p_limit;
  if jsonb_array_length(items)>p_limit then next_id:=page->(p_limit-1)->>'id'; end if;
  return jsonb_build_object('projectId',s.project_id,'items',page,'nextCursor',next_id);
end $function$
;

-- bob_volunteer_private.volunteer_task — updated work ownership.
CREATE OR REPLACE FUNCTION bob_volunteer_private.volunteer_task(p_secret text, p_task text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); t bob.tasks; area_name text; steps jsonb; images jsonb;
begin
  select t0.* into t from bob.tasks t0 left join bob.areas a on a.id=t0.area_id where t0.id=p_task and t0.project_id=s.project_id;
  if not found then raise exception 'Task unavailable.' using errcode='42501'; end if;
  select name into area_name from bob.areas where id=t.area_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'instructions',instructions,'required',required,
    'isCheckpoint',is_checkpoint,'completedAt',completed_at,'revision',revision) order by position),'[]') into steps from bob.task_steps where task_id=t.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'title',m.title) order by m.created_at,m.id),'[]') into images from bob.media_assets m
    where m.project_id=s.project_id and m.state='ready' and exists(select 1 from bob.media_links l left join bob.task_steps st on st.id=l.step_id
      where l.media_id=m.id and (l.task_id=t.id or l.area_id=t.area_id or st.task_id=t.id));
  return jsonb_build_object('projectId',s.project_id,'id',t.id,'name',t.name,'area',area_name,'instructions',t.instructions,'status',t.status,
    'updatedAt',t.updated_at,'mine',exists(select 1 from bob.task_assignees where task_id=t.id and person_id=s.person_id),'steps',steps,'images',images);
end $function$
;

-- bob_private.material_requirement_geometry_command — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.material_requirement_geometry_command(p_project text, p_action text, p_requirement uuid, p_expected integer, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  allowed text[];
  v_artifact_id uuid;
  v_artifact_revision integer;
  artifact_title text;
  artifact_status text;
  artifact_area text;
  v_area text;
  v_task text;
  task_area text;
  wall_width_mm numeric;
  wall_height_mm numeric;
  opening_width_mm numeric;
  opening_height_mm numeric;
  has_estimate boolean;
  net_area_m2 numeric;
  normalized_area_m2 numeric;
  v_basis text;
  payload jsonb;
  saved jsonb;
  saved_revision integer;
  layer_input jsonb;
  layer_snapshot jsonb;
  layers integer := 1;
  coverage_kind text;
  coverage_truth text;
  coverage_source text;
  sheet_width numeric;
  sheet_height numeric;
  coverage numeric;
  v_method text := 'stud_wall_net_area';
  v_version text := '4B2b-v1';
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_requirement is null or p_action is null or p_action not in ('create','revise')
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>30000 then
    raise exception 'Invalid deterministic material requirement command';
  end if;
  allowed := array['name','category','area_id','task_id','waste_percent','assumptions',
    'artifact_id','artifact_revision','target_revision','stock_allocations'];
  if p_action='revise' then allowed := allowed || array['change_note']; end if;
  if p_data ? 'sheet_layer' then
    allowed := allowed || array['sheet_layer'];
    layer_input := p_data->'sheet_layer';
    if jsonb_typeof(layer_input) is distinct from 'object' then
      raise exception 'Supply an explicit sheet layer coverage basis';
    end if;
    coverage_kind := layer_input->>'coverage_kind';
    coverage_truth := layer_input->>'coverage_truth';
    coverage_source := btrim(layer_input->>'coverage_source');
    if coverage_kind is null or coverage_kind not in ('sheet_dimensions','pack_coverage')
      or coverage_truth is null or coverage_truth not in ('provided_spec','measured','estimated')
      or jsonb_typeof(layer_input->'coverage_source') is distinct from 'string'
      or char_length(coverage_source) not between 1 and 1000
      or coalesce(layer_input->>'layer_count','') !~ '^[0-9]{1,2}$' then
      raise exception 'Sheet layers require a whole layer count, coverage type, certainty and source';
    end if;
    layers := (layer_input->>'layer_count')::integer;
    if layers not between 1 and 20 then raise exception 'Use between 1 and 20 layers'; end if;
    if coverage_kind='sheet_dimensions' then
      if layer_input-array['layer_count','coverage_kind','coverage_truth','coverage_source','sheet_width_mm','sheet_height_mm']<>'{}'::jsonb
        or coalesce(layer_input->>'sheet_width_mm','') !~ '^[0-9]{1,5}$'
        or coalesce(layer_input->>'sheet_height_mm','') !~ '^[0-9]{1,5}$' then
        raise exception 'Supply only whole sheet dimensions in mm, not pack coverage or derived values';
      end if;
      sheet_width := (layer_input->>'sheet_width_mm')::numeric;
      sheet_height := (layer_input->>'sheet_height_mm')::numeric;
      if sheet_width not between 1 and 20000 or sheet_height not between 1 and 20000 then
        raise exception 'Sheet dimensions must be between 1 and 20000 mm';
      end if;
      coverage := sheet_width * sheet_height / 1000000;
    else
      if layer_input-array['layer_count','coverage_kind','coverage_truth','coverage_source','pack_coverage_m2']<>'{}'::jsonb
        or coalesce(layer_input->>'pack_coverage_m2','') !~ '^[0-9]{1,9}(\.[0-9]{1,4})?$' then
        raise exception 'Supply only declared pack coverage in m2 with at most four decimal places';
      end if;
      coverage := (layer_input->>'pack_coverage_m2')::numeric;
    end if;
    if coverage<=0 or coverage>1000000000 or coverage<>trunc(coverage,4) then
      raise exception 'Coverage must be positive and exactly representable at 0.0001 m2 precision; it is never rounded up';
    end if;
    v_method := 'stud_wall_sheet_layer';
    v_version := '1';
  else
    allowed := allowed || array['purchase_increment'];
  end if;
  if p_data-allowed<>'{}'::jsonb then
    raise exception 'Unsupported deterministic material fields. Quantity, unit, basis, source, method and sheet purchase increment are derived by the server.';
  end if;

  -- Serialize source validation with other project target/drawing commands.
  perform 1 from bob.projects where id=p_project for no key update;
  v_artifact_id := nullif(p_data->>'artifact_id','')::uuid;
  v_artifact_revision := nullif(p_data->>'artifact_revision','')::integer;
  if v_artifact_id is null or v_artifact_revision is null then
    raise exception 'Choose a current generated drawing before calculating material quantity';
  end if;
  select ar.title,ar.status,ah.area_id into artifact_title,artifact_status,artifact_area
  from bob.artifacts ah
  join bob.artifact_revisions ar on ar.artifact_id=ah.id and ar.revision=ah.current_revision
  join bob.artifact_generations g
    on g.artifact_id=ar.artifact_id and g.artifact_revision=ar.revision and g.project_id=ar.project_id
  where ah.id=v_artifact_id and ah.project_id=p_project and ah.current_revision=v_artifact_revision
    and not ar.archived and g.generator='stud_wall_opening_v1' and g.generator_version=1;
  if not found then
    raise exception 'A current stud_wall_opening_v1 drawing version is required for this calculation';
  end if;
  if layer_input is not null then
    v_area := nullif(p_data->>'area_id','');
    v_task := nullif(p_data->>'task_id','');
    if v_task is not null then
      select t.area_id into task_area from bob.tasks t left join bob.areas a on a.id=t.area_id
        where t.id=v_task and t.project_id=p_project;
      if not found then raise exception 'project_denied' using errcode='42501'; end if;
      if v_area is not null and v_area is distinct from task_area then
        raise exception 'The material requirement must use its task area.';
      end if;
      v_area := task_area;
    end if;
    if artifact_area is distinct from v_area then
      raise exception 'The sheet layer must use a drawing in the same Project/Area scope';
    end if;
  end if;
  select
    max(case when i.role='wall_width' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    max(case when i.role='wall_height' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    max(case when i.role='opening_width' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    max(case when i.role='opening_height' then r.value * case r.unit when 'mm' then 1 when 'cm' then 10 when 'm' then 1000 end end),
    bool_or(r.truth='estimated')
  into wall_width_mm,wall_height_mm,opening_width_mm,opening_height_mm,has_estimate
  from bob.artifact_geometry_inputs i
  join bob.measurement_revisions r
    on r.measurement_id=i.measurement_id and r.revision=i.measurement_revision and r.project_id=i.project_id
  where i.project_id=p_project and i.artifact_id=v_artifact_id and i.artifact_revision=v_artifact_revision;
  if wall_width_mm is null or wall_height_mm is null or opening_width_mm is null or opening_height_mm is null then
    raise exception 'The generated drawing is missing required wall/opening geometry inputs';
  end if;
  net_area_m2 := ((wall_width_mm*wall_height_mm)-(opening_width_mm*opening_height_mm))/1000000;
  if net_area_m2<=0 then raise exception 'The generated drawing does not contain a positive net wall area'; end if;
  normalized_area_m2 := ceil(net_area_m2*layers*10000)/10000;
  if layer_input is null then
    v_basis := format(
      'Calculated from %s v%s using stud_wall_net_area 4B2b-v1: (%s mm × %s mm − %s mm × %s mm) ÷ 1,000,000 = %s m²; persisted base quantity %s m² after upward normalization to 0.0001 m². Drawing status: %s. Input certainty: %s.',
      artifact_title,v_artifact_revision,wall_width_mm,wall_height_mm,opening_width_mm,opening_height_mm,
      net_area_m2,normalized_area_m2,artifact_status,
      case when has_estimate then 'contains explicit estimate' else 'measured/provided inputs only' end
    );
  else
    layer_snapshot := jsonb_build_object(
      'layer_count',layers,'coverage_kind',coverage_kind,'coverage_truth',coverage_truth,'coverage_source',coverage_source,
      'sheet_width_mm',sheet_width::text,'sheet_height_mm',sheet_height::text,
      'pack_coverage_m2',case when coverage_kind='pack_coverage' then trim_scale(coverage)::text else null end,
      'unit_coverage_m2',trim_scale(coverage)::text,'net_wall_area_m2',trim_scale(net_area_m2)::text
    );
    v_basis := format(
      'Calculated from %s v%s using stud_wall_sheet_layer v1: (%s mm × %s mm − %s mm × %s mm) ÷ 1,000,000 = %s m² net wall area × %s layers = %s m²; persisted base %s m² after upward normalization to 0.0001 m². Coverage: %s m² per %s. Apply allowance once, subtract compatible confirmed m² stock, then round the shortfall to whole purchase units. Drawing status: %s. Input certainty: %s. Product input: %s; source: %s. AREA-BASED ONLY: not a cut/layout plan or product/structural suitability approval. Openings, offcuts, orientation and joints may require additional material.',
      artifact_title,v_artifact_revision,wall_width_mm,wall_height_mm,opening_width_mm,opening_height_mm,
      trim_scale(net_area_m2),layers,trim_scale(net_area_m2*layers),normalized_area_m2,trim_scale(coverage),
      case when coverage_kind='sheet_dimensions' then 'sheet' else 'pack' end,artifact_status,
      case when has_estimate or coverage_truth='estimated' then 'contains explicit estimate' else 'measured/provided inputs only' end,
      coverage_truth,coverage_source
    );
  end if;
  payload := (p_data-'sheet_layer') || jsonb_build_object(
    'unit','m2','required_quantity',normalized_area_m2::text,'basis',v_basis,'component_allocations','[]'::jsonb
  );
  if layer_input is not null then payload := payload || jsonb_build_object('purchase_increment',coverage::text); end if;
  saved := bob_private.material_requirement_command(p_project,p_action,p_requirement,p_expected,payload);
  saved_revision := (saved->>'revision')::integer;
  update bob.material_requirement_revisions
    set source_kind='deterministic',method_key=v_method,method_version=v_version,basis=v_basis,sheet_layer=layer_snapshot
    where project_id=p_project and requirement_id=p_requirement and revision=saved_revision;
  if not found then raise exception 'Calculated material requirement was not persisted'; end if;
  return saved;
end $function$
;

-- bob_volunteer_private.volunteer_task_action — updated work ownership.
CREATE OR REPLACE FUNCTION bob_volunteer_private.volunteer_task_action(p_secret text, p_task text, p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); t bob.tasks; st bob.task_steps; complete boolean;
begin
  select t0.* into t from bob.tasks t0 left join bob.areas a on a.id=t0.area_id where t0.id=p_task and t0.project_id=s.project_id for update of t0;
  if not found then raise exception 'Task unavailable.' using errcode='42501'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid task action.' using errcode='22023'; end if;
  if p_action in ('claim','release') then
    if p_data<>'{}'::jsonb then raise exception 'Invalid task action.' using errcode='22023'; end if;
    if p_action='claim' then
      if t.status='done' then raise exception 'This task is already done. Refresh the task list.' using errcode='40001'; end if;
      insert into bob.task_assignees(task_id,person_id) values(t.id,s.person_id) on conflict do nothing;
    else delete from bob.task_assignees where task_id=t.id and person_id=s.person_id; end if;
  else
    if not exists(select 1 from bob.task_assignees where task_id=t.id and person_id=s.person_id) then raise exception 'Join this task before updating it.' using errcode='42501'; end if;
    if p_action='status' then
      if p_data-array['status','expectedUpdatedAt']<>'{}'::jsonb or p_data->>'status' is null or p_data->>'status' not in ('todo','doing','blocked','done') then raise exception 'Invalid task status.' using errcode='22023'; end if;
      if (p_data->>'expectedUpdatedAt')::timestamptz is distinct from t.updated_at then raise exception 'Task changed. Refresh before saving.' using errcode='40001'; end if;
      update bob.tasks set status=(p_data->>'status')::bob.task_status where id=t.id;
    elsif p_action='check' then
      if p_data-array['stepId','revision','completed']<>'{}'::jsonb or jsonb_typeof(p_data->'completed') is distinct from 'boolean' then raise exception 'Invalid task check.' using errcode='22023'; end if;
      select * into st from bob.task_steps where id=(p_data->>'stepId')::uuid and task_id=t.id and project_id=s.project_id for update;
      if not found then raise exception 'Step unavailable.' using errcode='42501'; end if;
      if (p_data->>'revision')::integer is distinct from st.revision then raise exception 'Step changed. Refresh before saving.' using errcode='40001'; end if;
      complete:=(p_data->>'completed')::boolean;
      if not complete and st.required and t.status='done' then raise exception 'Reopen the task before reopening a required check.' using errcode='40001'; end if;
      update bob.task_steps set completed_at=case when complete then clock_timestamp() end,completed_by=null,
        completed_by_volunteer=case when complete then s.person_id end,revision=revision+1 where id=st.id;
    else raise exception 'Unknown task action.' using errcode='22023'; end if;
  end if;
  return bob_volunteer_private.volunteer_task(p_secret,p_task);
end $function$
;

-- bob_private.validate_task_dependency_row — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.validate_task_dependency_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  task_project text;
  prerequisite_project text;
  checkpoint_project text;
  checkpoint_task text;
  checkpoint boolean;
begin
  select t.project_id into task_project
  from bob.tasks t left join bob.areas a on a.id=t.area_id
  where t.id=new.task_id;
  select t.project_id into prerequisite_project
  from bob.tasks t left join bob.areas a on a.id=t.area_id
  where t.id=new.prerequisite_task_id;
  if task_project is null or prerequisite_project is null
    or task_project is distinct from new.project_id
    or prerequisite_project is distinct from new.project_id then
    raise exception 'Task dependency must stay inside one Project.';
  end if;
  if new.prerequisite_step_id is not null then
    select project_id,task_id,is_checkpoint into checkpoint_project,checkpoint_task,checkpoint
    from bob.task_steps where id=new.prerequisite_step_id;
    if checkpoint_project is distinct from new.project_id
      or checkpoint_task is distinct from new.prerequisite_task_id
      or checkpoint is distinct from true then
      raise exception 'Dependency checkpoint must be a checkpoint on the prerequisite task.';
    end if;
  end if;
  if exists(
    with recursive chain(task_id) as (
      select new.prerequisite_task_id
      union
      select d.prerequisite_task_id
      from bob.task_dependencies d join chain c on d.task_id=c.task_id
      where d.project_id=new.project_id
    )
    select 1 from chain where task_id=new.task_id
  ) then
    raise exception 'Task dependencies cannot form a cycle.';
  end if;
  return new;
end $function$
;

-- bob_private.validate_task_parent_row — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.validate_task_parent_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare task_project text;
begin
  select t.project_id into task_project
  from bob.tasks t left join bob.areas a on a.id=t.area_id
  where t.id=new.task_id;
  if task_project is null or task_project is distinct from new.project_id then
    raise exception 'Task planning record must stay inside its Project.';
  end if;
  return new;
end $function$
;

-- bob_private.work_plan_command — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.work_plan_command(p_project text, p_task text, p_action text, p_item uuid, p_expected integer, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  actor text;
  allowed text[];
  prerequisite text;
  checkpoint uuid;
  need bob.task_needs;
  current_readiness bob.current_task_readiness%rowtype;
  next_revision integer;
begin
  if uid is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  if p_task is null or p_action is null
    or p_action not in ('add_dependency','remove_dependency','add_need','revise_need','set_need_ready','remove_need','confirm_readiness')
    or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>12000 then
    raise exception 'Invalid work-plan command';
  end if;
  perform 1 from bob.projects where id=p_project for no key update;
  perform 1 from bob.tasks t left join bob.areas a on a.id=t.area_id
    where t.id=p_task and t.project_id=p_project for share of t;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  select name into actor from bob.people where project_id=p_project and auth_user_id=uid;
  if actor is null then raise exception 'project_denied' using errcode='42501'; end if;

  if p_action='confirm_readiness' then
    allowed := array['note'];
    if p_item is not null or p_data-allowed<>'{}'::jsonb then raise exception 'Invalid readiness confirmation'; end if;
    select * into current_readiness from bob.current_task_readiness
      where project_id=p_project and task_id=p_task;
    if not found or current_readiness.task_status='done'::bob.task_status then
      raise exception 'Only active tasks can be confirmed ready.';
    end if;
    if current_readiness.blocker_count>0 then raise exception 'Resolve named blockers before confirming readiness.'; end if;
    insert into bob.task_readiness_reviews(task_id,project_id,note,confirmed_by,actor_label)
      values(p_task,p_project,btrim(coalesce(p_data->>'note','')),uid,actor)
      on conflict(task_id) do update set project_id=excluded.project_id,note=excluded.note,
        confirmed_by=excluded.confirmed_by,actor_label=excluded.actor_label,confirmed_at=clock_timestamp();
    return jsonb_build_object('id',p_task,'readiness','ready');
  end if;

  if p_action='add_dependency' then
    allowed := array['prerequisite_task_id','prerequisite_step_id','note'];
    if p_item is null or p_expected is distinct from 0 or p_data-allowed<>'{}'::jsonb then
      raise exception 'Invalid dependency command';
    end if;
    prerequisite := nullif(p_data->>'prerequisite_task_id','');
    checkpoint := nullif(p_data->>'prerequisite_step_id','')::uuid;
    if prerequisite is null then raise exception 'Choose a prerequisite task'; end if;
    insert into bob.task_dependencies(id,project_id,task_id,prerequisite_task_id,prerequisite_step_id,note,created_by,actor_label)
      values(p_item,p_project,p_task,prerequisite,checkpoint,btrim(coalesce(p_data->>'note','')),uid,actor);
    delete from bob.task_readiness_reviews where task_id=p_task and project_id=p_project;
    return jsonb_build_object('id',p_item,'action',p_action);
  end if;

  if p_action='remove_dependency' then
    if p_item is null or p_data<>'{}'::jsonb then raise exception 'Invalid dependency command'; end if;
    delete from bob.task_dependencies where id=p_item and project_id=p_project and task_id=p_task;
    if not found then raise exception 'Dependency changed. Reload first.'; end if;
    delete from bob.task_readiness_reviews where task_id=p_task and project_id=p_project;
    return jsonb_build_object('id',p_item,'removed',true);
  end if;

  if p_action='add_need' then
    allowed := array['kind','label','notes'];
    if p_item is null or p_expected is distinct from 0 or p_data-allowed<>'{}'::jsonb
      or p_data->>'kind' not in ('tool','information') then
      raise exception 'Invalid task need';
    end if;
    insert into bob.task_needs(id,project_id,task_id,kind,label,notes,created_by,updated_by,actor_label)
      values(p_item,p_project,p_task,p_data->>'kind',btrim(p_data->>'label'),btrim(coalesce(p_data->>'notes','')),uid,uid,actor)
      returning * into need;
    delete from bob.task_readiness_reviews where task_id=p_task and project_id=p_project;
    return jsonb_build_object('id',need.id,'revision',need.revision);
  end if;

  select * into need from bob.task_needs
    where id=p_item and project_id=p_project and task_id=p_task for update;
  if not found then raise exception 'Task need changed. Reload first.'; end if;
  if p_expected is distinct from need.revision then raise exception 'Task need changed. Reload first.'; end if;

  if p_action='remove_need' then
    if p_data<>'{}'::jsonb then raise exception 'Invalid task need'; end if;
    delete from bob.task_needs where id=need.id;
    delete from bob.task_readiness_reviews where task_id=p_task and project_id=p_project;
    return jsonb_build_object('id',need.id,'removed',true);
  end if;

  next_revision := need.revision+1;
  if p_action='set_need_ready' then
    if p_data-array['ready']<>'{}'::jsonb or jsonb_typeof(p_data->'ready')<>'boolean' then
      raise exception 'Invalid readiness update';
    end if;
    update bob.task_needs set ready=(p_data->>'ready')::boolean,revision=next_revision,
      updated_by=uid,actor_label=actor,updated_at=clock_timestamp()
      where id=need.id returning * into need;
  else
    allowed := array['label','notes','ready'];
    if p_data-allowed<>'{}'::jsonb or not (p_data ? 'label') then raise exception 'Invalid task need'; end if;
    update bob.task_needs set label=btrim(p_data->>'label'),notes=btrim(coalesce(p_data->>'notes','')),
      ready=coalesce((p_data->>'ready')::boolean,need.ready),revision=next_revision,
      updated_by=uid,actor_label=actor,updated_at=clock_timestamp()
      where id=need.id returning * into need;
  end if;
  delete from bob.task_readiness_reviews where task_id=p_task and project_id=p_project;
  return jsonb_build_object('id',need.id,'revision',need.revision,'ready',need.ready);
end $function$
;

-- bob.search_bob_project_data — updated work ownership.
CREATE OR REPLACE FUNCTION bob.search_bob_project_data(p_project_id text, p_dataset text, p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_area_id text DEFAULT NULL::text, p_record_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb; rows jsonb; truncated boolean;
begin
  if not bob_private.has_project_access(p_project_id) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_dataset='measurements' then
    if p_status is not null or length(coalesce(p_query,''))>200 or length(coalesce(p_record_id,''))>200 or length(coalesce(p_area_id,''))>200 then
      raise exception 'invalid_lookup' using errcode='22023'; end if;
    select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into rows from (
      select id,jsonb_build_object('id',id,'subject',subject,'area_id',area_id,'component_id',component_id,'value',value,'unit',unit,'truth',truth,
        'source',source,'notes',notes,'required',required,'revision',revision,'archived',archived,'updated_at',recorded_at) item
      from bob.current_measurements where project_id=p_project_id and not archived
        and (p_record_id is null or id::text=p_record_id) and (p_area_id is null or area_id=p_area_id)
        and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',subject,notes,source)))>0)
      order by id limit 26
    ) bounded;
    truncated:=jsonb_array_length(rows)>25;
    if truncated then rows:=rows-25; end if;
    result:=jsonb_build_object('records',rows,'related','[]'::jsonb,'truncated',truncated);
  else
    result:=bob.search_project_data(p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id);
    if p_dataset='tasks' then
      select coalesce(jsonb_agg(r.value || jsonb_build_object('instructions',t.instructions) order by r.ordinality),'[]'::jsonb) into rows
        from jsonb_array_elements(result->'records') with ordinality r(value,ordinality)
        join bob.tasks t on t.id=r.value->>'id' and t.project_id=p_project_id left join bob.areas a on a.id=t.area_id and t.project_id=p_project_id;
      result:=jsonb_set(result,'{records}',rows);
    end if;
  end if;
  while octet_length(result::text)>14000 loop
    result:=jsonb_set(result,'{truncated}','true');
    if jsonb_array_length(result->'related')>0 then result:=jsonb_set(result,'{related}',(result->'related')-(jsonb_array_length(result->'related')-1));
    else result:=jsonb_set(result,'{records}',(result->'records')-(jsonb_array_length(result->'records')-1)); end if;
  end loop;
  return result;
end $function$
;

-- bob.search_bob_project_data_v2 — updated work ownership.
CREATE OR REPLACE FUNCTION bob.search_bob_project_data_v2(p_project_id text, p_dataset text, p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_area_id text DEFAULT NULL::text, p_record_id text DEFAULT NULL::text, p_after_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_rows jsonb := '[]'; v_links jsonb := '[]'; v_truncated boolean := false; v_result jsonb; v_more boolean:=false;
begin
  if not bob_private.has_project_access(p_project_id) then
    raise exception 'project_denied' using errcode = '42501';
  end if;
  if p_dataset is null or p_dataset <> all(array['project','areas','tasks','materials','crew','events','announcements','measurements','components','solutions','target','artifacts','requirements'])
    or length(coalesce(p_query,'')) > 200 or length(coalesce(p_record_id,'')) > 200
    or length(coalesce(p_area_id,'')) > 200 or length(coalesce(p_after_id,'')) > 200
    or (p_area_id is not null and p_dataset <> all(array['tasks','measurements','components','solutions','target','artifacts','requirements']))
    or (p_status is not null and not (
      (p_dataset = 'tasks' and p_status = any(array['todo','doing','done','blocked'])) or
      (p_dataset = 'materials' and p_status = any(array['needed','ordered','delivered','backorder'])) or
      (p_dataset = 'events' and p_status = any(array['going','open'])))) then
    raise exception 'invalid_lookup' using errcode = '22023';
  end if;
  case p_dataset
    when 'project' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description, 'location', r.location, 'type', r.type, 'start_label', r.start_label, 'start_date', r.start_date, 'end_date', r.end_date, 'updated_at', r.updated_at) as item
        from bob.projects r
        where r.id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.description))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'areas' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'description', r.description, 'lead_id', r.lead_id, 'updated_at', r.updated_at) as item
        from bob.areas r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.description))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'tasks' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'project_id',r.project_id,'primary_step_id',r.primary_step_id,'area_id', r.area_id, 'name', r.name, 'skill', r.skill, 'hours', r.hours, 'status', r.status, 'materials', r.materials, 'instructions', r.instructions, 'updated_at', r.updated_at, 'area_name', a.name) as item
        from bob.tasks r left join bob.areas a on a.id = r.area_id
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.materials, r.instructions, a.name))) > 0)
          and (p_status is null or r.status::text = p_status)
          and (p_area_id is null or r.area_id = p_area_id)
        order by r.id limit 26
      ) bounded;
    when 'materials' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'name', r.name, 'qty', r.qty, 'area_label', r.area_label, 'supplier', r.supplier, 'status', r.status, 'cost', r.cost, 'category', r.category, 'updated_at', r.updated_at) as item
        from bob.materials r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.area_label, r.supplier))) > 0)
          and (p_status is null or r.status::text = p_status)
        order by r.id limit 26
      ) bounded;
    when 'crew' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'name', r.name, 'role', r.role, 'updated_at', r.updated_at) as item
        from bob.people r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.name, r.role))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'events' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'slug', r.slug, 'title', r.title, 'day', r.day, 'time', r.time, 'place', r.place, 'spots', r.spots, 'status', r.status, 'updated_at', r.updated_at) as item
        from bob.events r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.title, r.place))) > 0)
          and (p_status is null or r.status::text = p_status)
        order by r.id limit 26
      ) bounded;
    when 'announcements' then
      select coalesce(jsonb_agg(item order by id), '[]') into v_rows from (
        select r.id, jsonb_build_object('id', r.id, 'text', r.text, 'pinned', r.pinned, 'time_label', r.time_label, 'author_id', r.author_id, 'updated_at', r.updated_at) as item
        from bob.announcements r
        where r.project_id = p_project_id
          and (p_record_id is null or r.id = p_record_id)
          and (p_after_id is null or r.id > p_after_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ', r.text))) > 0)
        order by r.id limit 26
      ) bounded;
    when 'measurements' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'subject', r.subject,'area_id', r.area_id,'component_id', r.component_id,'value', r.value,'unit', r.unit,'millimetres', r.millimetres,'truth', r.truth,'source', r.source,'notes', r.notes,'required', r.required,'revision', r.revision,'archived', r.archived,'updated_at', r.recorded_at) item
        from bob.current_measurements r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.subject,r.source,r.notes)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
    when 'components' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'name', r.name,'area_id', r.area_id,'kind', r.kind,'quantity', r.quantity,'condition', r.condition,'specification', r.specification,'intent', r.intent,'notes', r.notes,'revision', r.revision,'archived', r.archived,'updated_at', r.recorded_at) item
        from bob.current_components r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.name,r.kind,r.specification,r.notes)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
    when 'solutions' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'title', r.title,'area_id', r.area_id,'description', r.description,'assumptions', r.assumptions,'tradeoffs', r.tradeoffs,'revision', r.revision,'archived', r.archived,'updated_at', r.recorded_at) item
        from bob.current_solutions r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.title,r.description,r.assumptions,r.tradeoffs)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
    when 'target' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.scope_key id,jsonb_build_object('id',r.scope_key,'area_id',r.area_id,'scope_key',r.scope_key,'revision',r.revision,'reason',r.reason,'updated_at',r.recorded_at,
          'solution_id',r.solution_id,'solution_revision',r.solution_revision,'title',chosen.title,
          'description',chosen.description,'assumptions',chosen.assumptions,'tradeoffs',chosen.tradeoffs,'archived',chosen.archived) item
        from bob.current_target r left join bob.solution_revisions chosen on chosen.solution_id=r.solution_id and chosen.revision=r.solution_revision and chosen.project_id=r.project_id
        where r.project_id=p_project_id and (p_record_id is null or r.scope_key=p_record_id)
          and (p_after_id is null or r.scope_key>p_after_id) and (p_area_id is null or r.area_id=p_area_id)
          and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.reason,chosen.title,chosen.description)))>0)
        order by r.scope_key limit 26
      ) bounded;
    when 'artifacts' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'title', r.title,'area_id', r.area_id,'kind', r.kind,'description', r.description,'status', r.status,'assumptions', r.assumptions,'revision', r.revision,'archived', r.archived,'target_revision', r.target_revision,'solution_id', r.solution_id,'solution_revision', r.solution_revision,'solution_title', r.solution_title,'updated_at', r.recorded_at) item
        from bob.current_artifacts r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.title,r.description,r.assumptions)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
    when 'requirements' then
      select coalesce(jsonb_agg(item order by id),'[]'::jsonb) into v_rows from (
        select r.id::text id,jsonb_build_object('id', r.id::text,'name', r.name,'area_id', r.area_id,'task_id', r.task_id,'unit', r.unit,'required_quantity', r.required_quantity,'waste_percent', r.waste_percent,'required_with_waste', r.required_with_waste,'stock_quantity', r.stock_quantity,'component_quantity', r.component_quantity,'purchase_quantity', r.purchase_quantity,'source_kind', r.source_kind,'method_key', r.method_key,'basis', r.basis,'assumptions', r.assumptions,'revision', r.revision,'archived', r.archived,'target_revision', r.target_revision,'solution_id', r.solution_id,'solution_revision', r.solution_revision,'artifact_id', r.artifact_id,'artifact_revision', r.artifact_revision,'target_changed', r.target_changed,'artifact_changed', r.artifact_changed,'stock_changed', r.stock_changed,'component_changed', r.component_changed,'updated_at', r.recorded_at) item
        from bob.current_material_requirements r where r.project_id=p_project_id and (p_record_id is null or r.id::text=p_record_id) and (p_after_id is null or r.id::text>p_after_id) and (p_query is null or position(lower(p_query) in lower(concat_ws(' ',r.name,r.basis,r.assumptions)))>0) and (p_area_id is null or r.area_id=p_area_id) and not r.archived order by r.id::text limit 26
      ) bounded;
  end case;
  if jsonb_array_length(v_rows) > 25 then
    v_truncated := true;
    v_rows := v_rows - 25;
    v_more:=true;
  end if;

  -- Each query checks both relation ends even though RLS already does so.
  if p_dataset = 'tasks' then
    select coalesce(jsonb_agg(item order by parent_id, id), '[]') into v_links from (
      select t.id parent_id, p.id, jsonb_build_object('kind','assignee','parent_id',t.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.task_assignees ta join bob.tasks t on t.id = ta.task_id
      left join bob.areas a on a.id = t.area_id
      join bob.people p on p.id = ta.person_id and p.project_id = t.project_id
      where t.project_id = p_project_id and t.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by t.id, p.id limit 26
    ) bounded;
  elsif p_dataset = 'target' then
    select coalesce(jsonb_agg(item order by parent_id,id),'[]'::jsonb) into v_links from (
      select t.scope_key parent_id,d.measurement_id::text id,jsonb_build_object('kind','selected_measurement','parent_id',t.scope_key,'area_id',t.area_id,'id',d.measurement_id::text,'subject',d.subject,'value',d.value,'unit',d.unit,'truth',d.truth,'source',d.source,
        'revision',d.measurement_revision,'latest_revision',d.latest_revision,'currently_archived',d.currently_archived) item
      from bob.solution_measurement_details d join bob.current_target t on t.project_id=d.project_id and t.solution_id=d.solution_id and t.solution_revision=d.solution_revision
      where d.project_id=p_project_id and t.scope_key in (select value->>'id' from jsonb_array_elements(v_rows))
      order by t.scope_key,d.measurement_id::text limit 26
    ) bounded;
  elsif p_dataset = 'artifacts' then
    select coalesce(jsonb_agg(item order by parent_id,id),'[]'::jsonb) into v_links from (
      select a.id::text parent_id,d.measurement_id::text id,jsonb_build_object('kind','drawing_measurement','parent_id',a.id::text,'id',d.measurement_id::text,'subject',d.subject,'value',d.value,'unit',d.unit,'truth',d.truth,'source',d.source,
        'revision',d.measurement_revision,'latest_revision',d.latest_revision,'currently_archived',d.currently_archived) item
      from bob.artifact_measurement_details d join bob.current_artifacts a on a.id=d.artifact_id and a.revision=d.artifact_revision and a.project_id=d.project_id
      where d.project_id=p_project_id and a.id::text in (select value->>'id' from jsonb_array_elements(v_rows)) order by a.id::text,d.measurement_id::text limit 26
    ) bounded;
  elsif p_dataset = 'crew' then
    select coalesce(jsonb_agg(item order by parent_id, name), '[]') into v_links from (
      select p.id parent_id, s.name, jsonb_build_object('kind','skill','parent_id',p.id,
        'id',jsonb_build_array(p.id,s.name)::text,'name',s.name,'level',s.level,'updated_at',null) item
      from bob.person_skills s join bob.people p on p.id = s.person_id
      where p.project_id = p_project_id and p.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by p.id, s.name limit 26
    ) bounded;
  elsif p_dataset = 'events' then
    select coalesce(jsonb_agg(item order by parent_id, id), '[]') into v_links from (
      select e.id parent_id, p.id, jsonb_build_object('kind','attendee','parent_id',e.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.event_attendees ea join bob.events e on e.id = ea.event_id
      join bob.people p on p.id = ea.person_id and p.project_id = e.project_id
      where e.project_id = p_project_id and e.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by e.id, p.id limit 26
    ) bounded;
  elsif p_dataset = 'announcements' then
    select coalesce(jsonb_agg(item order by parent_id), '[]') into v_links from (
      select a.id parent_id, jsonb_build_object('kind','author','parent_id',a.id,
        'id',p.id,'name',p.name,'updated_at',p.updated_at) item
      from bob.announcements a join bob.people p on p.id = a.author_id and p.project_id = a.project_id
      where a.project_id = p_project_id and a.id in (select value->>'id' from jsonb_array_elements(v_rows))
      order by a.id limit 26
    ) bounded;
  end if;
  if jsonb_array_length(v_links) > 25 then
    v_truncated := true;
    v_links := v_links - 25;
  end if;

  loop
    v_result := jsonb_build_object('records',v_rows,'related',v_links,'truncated',v_truncated,'next_cursor',case when v_more then v_rows->-1->>'id' else null end);
    -- Reserve room for the edge's provenance envelope within the 32 KiB cap.
    exit when octet_length(v_result::text) <= 30000;
    v_truncated := true;
    if jsonb_array_length(v_links) > 0 then
      v_links := v_links - (jsonb_array_length(v_links)-1);
    else
      if jsonb_array_length(v_rows)<=1 then raise exception 'lookup_record_too_large' using errcode='54000'; end if;
      v_rows := v_rows - (jsonb_array_length(v_rows)-1);
      v_more:=true;
    end if;
  end loop;
  return v_result;
end $function$
;

-- bob_private.bob_project_write_v9 — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.bob_project_write_v9(p_project text, p_thread uuid, p_turn uuid, p_generation bigint, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare kind text:=p_payload->>'kind'; d jsonb:=p_payload->'data'; rid text:=p_payload->>'record_id';
 quote text:=p_payload->>'request_quote'; msg text; op text; existing bob_private.bob_write_receipts;
 expected integer; saved jsonb; rec jsonb; before_row jsonb; result jsonb; dataset text; label text; task bob.tasks;
 aid uuid; source bob.artifact_cad_revisions; recipe jsonb; packet jsonb; revision integer;
begin
 if kind<>all(array['cad','measurement_state','solution','target','task_work']) then
  return bob_private.bob_project_write_v8(p_project,p_thread,p_turn,p_generation,p_payload); end if;
 perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>6600000
  or p_payload-array['kind','record_id','expected_updated_at','expected_revision','request_quote','data']::text[]<>'{}'
  or (select count(*) from jsonb_object_keys(p_payload))<>6 or jsonb_typeof(d)<>'object'
  or jsonb_typeof(p_payload->'request_quote')<>'string' or coalesce(char_length(quote),0) not between 1 and 500 then
  raise exception 'invalid_write' using errcode='22023'; end if;
 select text into msg from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
 if msg is null or position(quote in msg)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;
 op:=kind||':'||coalesce(rid,concat_ws(':','new',d->>'area_id',lower(btrim(d->>'title'))))||case when kind='target' then ':'||coalesce(d->>'area_id','project') else '' end;
 select * into existing from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=op;
 if found then if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if; return existing.receipt; end if;
 if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then
  raise exception 'write_budget_exhausted' using errcode='22023'; end if;
 if kind<>'task_work' then
  if coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$' or p_payload->'expected_updated_at' is distinct from 'null'::jsonb then raise exception 'invalid_write' using errcode='22023'; end if;
  expected:=(p_payload->>'expected_revision')::integer;
 end if;
 if kind='measurement_state' then
  if d-array['action']::text[]<>'{}' or d->>'action' is null or d->>'action'<>all(array['archive','restore']) then raise exception 'invalid_write' using errcode='22023'; end if;
  saved:=bob_private.evidence_command(p_project,'measurement',d->>'action',rid::uuid,expected,'{}');
  select to_jsonb(m) into rec from bob.current_measurements m where id=rid::uuid and project_id=p_project;
  dataset:='measurements';label:=rec->>'subject';
 elsif kind='solution' then
  aid:=coalesce(rid::uuid,gen_random_uuid());
  -- Retain an existing source image when changing text/measurements.
  if rid is not null then select to_jsonb(s) into before_row from bob.current_solutions s where id=aid and project_id=p_project;
   if before_row is null then raise exception 'project_denied' using errcode='42501'; end if;
   d:=d||jsonb_build_object('source_media_id',before_row->'source_media_id'); end if;
  saved:=bob_private.solution_command(p_project,case when rid is null then 'create' else 'revise' end,aid,expected,d);
  select to_jsonb(s) into rec from bob.current_solutions s where id=aid and project_id=p_project;
  dataset:='solutions';label:=rec->>'title';
 elsif kind='target' then
  if d-array['solution_revision','area_id','reason']::text[]<>'{}' then raise exception 'invalid_write' using errcode='22023'; end if;
  saved:=bob_private.solution_command(p_project,'select',rid::uuid,expected,d);
  select to_jsonb(t)||jsonb_build_object('id',coalesce(d->>'area_id',p_project)) into rec from bob.current_target t where project_id=p_project and area_id is not distinct from (d->>'area_id');
  dataset:='target';label:='Selected project target';
 elsif kind='task_work' then
  if d-array['status','person_ids']::text[]<>'{}' or d->>'status' is null or d->>'status'<>all(array['todo','doing','done','blocked'])
   or jsonb_typeof(d->'person_ids')<>'array' or jsonb_array_length(d->'person_ids')>40 then raise exception 'invalid_write' using errcode='22023'; end if;
  select t.* into task from bob.tasks t left join bob.areas a on a.id=t.area_id where t.id=rid and t.project_id=p_project for update of t;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  if task.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then raise exception 'record_changed' using errcode='40001'; end if;
  if exists(select 1 from jsonb_array_elements_text(d->'person_ids') v where not exists(select 1 from bob.people p where p.id=v and p.project_id=p_project)) then raise exception 'project_denied' using errcode='42501'; end if;
  before_row:=to_jsonb(task);
  update bob.tasks set status=(d->>'status')::bob.task_status where id=rid;
  delete from bob.task_assignees where task_id=rid;
  insert into bob.task_assignees(task_id,person_id) select rid,v from jsonb_array_elements_text(d->'person_ids') v;
  select to_jsonb(t)||jsonb_build_object('person_ids',d->'person_ids') into rec from bob.tasks t where id=rid;
  dataset:='tasks';label:=task.name;
 else
  -- Use the canonical Artifact lock before validating the source revision.
  perform 1 from bob.projects where id=p_project for no key update;
  -- Plan acceptance serializes on this row, independently of Artifact writes.
  if d->>'step_id' is not null then
   perform 1 from bob.project_plans where project_id=p_project for share;
  end if;
  packet:=d->'packet';recipe:=packet->'recipe';
  if d-array['packet','title','description','assumptions','target_revision','measurements','source_artifact_id','source_revision','part_ids','area_id','component_id','step_id','artifact_id','expected_revision']::text[]<>'{}'
   or jsonb_typeof(recipe)<>'object' or recipe->>'contract_version'<>'1' or recipe->>'units'<>'mm'
   or jsonb_typeof(recipe->'instances')<>'array' or jsonb_array_length(recipe->'instances') not between 1 and 512
   or jsonb_typeof(recipe->'definitions')<>'array' or jsonb_array_length(recipe->'definitions') not between 1 and 128
   or jsonb_typeof(packet->'manifest')<>'object' or jsonb_typeof(packet->'files')<>'object'
   or packet->'manifest'->>'assembly_id' is distinct from recipe->>'assembly_id'
   or packet->'manifest'->'engine'->>'name' is distinct from 'build123d' then raise exception 'invalid_cad' using errcode='22023'; end if;
  if d->>'component_id' is not null and not exists(select 1 from bob.existing_components where id=(d->>'component_id')::uuid and project_id=p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if d->>'step_id' is not null and not exists(select 1 from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=p_project and s.step_id=(d->>'step_id')::uuid) then raise exception 'step_changed' using errcode='40001'; end if;
  if d->>'source_artifact_id' is not null then
   select c.* into source from bob.artifact_cad_revisions c join bob.artifacts a on a.id=c.artifact_id and a.current_revision=c.artifact_revision
    where c.project_id=p_project and c.artifact_id=(d->>'source_artifact_id')::uuid and c.artifact_revision=(d->>'source_revision')::integer;
   if not found then raise exception 'source_changed' using errcode='40001'; end if;
   if exists(select 1 from jsonb_array_elements(recipe->'instances') i where not exists(select 1 from jsonb_array_elements(source.recipe->'instances') j where i=j))
    or exists(select 1 from jsonb_array_elements(recipe->'definitions') i where not exists(select 1 from jsonb_array_elements(source.recipe->'definitions') j where i=j)) then raise exception 'detail_must_reuse_source' using errcode='22023'; end if;
  end if;
  aid:=coalesce(rid::uuid,gen_random_uuid());
  saved:=bob_private.artifact_command_before_cad(p_project,case when rid is null then 'create' else 'revise' end,aid,expected,
   jsonb_build_object('title',d->>'title','description',d->>'description','assumptions',d->>'assumptions','kind','detail','status','concept','target_revision',d->'target_revision','measurements',d->'measurements')
   ||case when rid is null then jsonb_build_object('area_id',d->'area_id') else jsonb_build_object('change_note','CAD design revision') end);
  revision:=(saved->>'revision')::integer;
  insert into bob.artifact_cad_revisions values(p_project,aid,revision,recipe,packet->'manifest',packet->'files',(d->>'source_artifact_id')::uuid,(d->>'source_revision')::integer,d->'part_ids',(d->>'component_id')::uuid,(d->>'step_id')::uuid);
  select to_jsonb(a) into rec from bob.current_artifacts a where id=aid and project_id=p_project;
  rec:=rec||jsonb_build_object('cad',true,'step_id',d->'step_id');dataset:='artifacts';label:=rec->>'title';
 end if;
 if rec is null or rec->>'id' is null then raise exception 'readback_unavailable'; end if;
 result:=jsonb_build_object('projectId',p_project,'dataset',dataset,'recordId',rec->>'id','revision',rec->'revision','areaId',rec->'area_id',
  'label',label,'operation',case when rid is null then 'created' else 'updated' end,'savedAt',clock_timestamp(),'record',rec);
 insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt) values(p_project,auth.uid(),p_turn,op,p_payload,before_row,result);
 return result;
end $function$
;

-- bob_private.plan_evidence_current — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.plan_evidence_current(p_project text, p_kind text, p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  case p_kind
    when 'measurement' then
      select jsonb_build_object('exists',true,'revision',m.revision,'label',m.subject,'updated_at',m.recorded_at,
        'value',m.value,'unit',m.unit,'truth',m.truth,'actor',m.actor_label)
      into r from bob.current_measurements m
      where m.project_id=p_project and m.id::text=p_id and not m.archived;
    when 'artifact' then
      select jsonb_build_object('exists',true,'revision',a.revision,'label',a.title,'updated_at',a.recorded_at)
      into r from bob.current_artifacts a
      where a.project_id=p_project and a.id::text=p_id and not a.archived;
    when 'material_requirement' then
      select jsonb_build_object('exists',true,'revision',m.revision,'label',m.name,'updated_at',m.recorded_at)
      into r from bob.current_material_requirements m
      where m.project_id=p_project and m.id::text=p_id and not m.archived;
    when 'solution' then
      select jsonb_build_object('exists',true,'revision',s.revision,'label',s.title,'updated_at',s.recorded_at)
      into r from bob.current_solutions s
      where s.project_id=p_project and s.id::text=p_id and not s.archived;
    when 'media' then
      select jsonb_build_object('exists',true,'revision',null,'label',m.title,'updated_at',m.updated_at)
      into r from bob.media_assets m where m.project_id=p_project and m.id::text=p_id and m.state='ready';
    when 'task' then
      select jsonb_build_object('exists',true,'revision',null,'label',t.name,'updated_at',t.updated_at)
      into r from bob.tasks t left join bob.areas a on a.id=t.area_id
      where t.project_id=p_project and t.id=p_id;
    else
      raise exception 'plan_invalid_evidence_kind' using errcode='22023';
  end case;
  return coalesce(r,jsonb_build_object('exists',false,'revision',null,'label',null,'updated_at',null));
end $function$
;

-- bob.project_plan_briefing — updated work ownership.
CREATE OR REPLACE FUNCTION bob.project_plan_briefing(p_project text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare rev integer; meta bob.project_plan_revisions; active bob.project_plan_steps;
  reqs jsonb:='[]'::jsonb; counts jsonb; spine jsonb:='[]'::jsonb; tasks jsonb:='[]'::jsonb;
  recent jsonb:='[]'::jsonb; new_count integer:=0; task_count integer:=0;
  pending jsonb;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  select current_revision into rev from bob.project_plans where project_id=p_project;

  -- The writer permits one pending proposal per project. Expose its exact
  -- read handle without confusing it with the approved working plan.
  select jsonb_build_object('record_id',revision::text,'revision',revision,
    'based_on_revision',coalesce(based_on_revision,0),'summary',summary,
    'created_at',created_at) into pending
  from bob.project_plan_revisions where project_id=p_project and status='proposed'
  order by revision desc limit 1;

  if rev is null then
    select coalesce(jsonb_agg(jsonb_build_object('id',m.id::text,'subject',m.subject,'value',m.value,'unit',m.unit,'truth',m.truth,
      'area_id',m.area_id,'revision',m.revision,'actor',m.actor_label,'recorded_at',m.recorded_at)
      order by m.recorded_at desc,m.id),'[]'::jsonb)
      into recent from (select * from bob.current_measurements where project_id=p_project and not archived order by recorded_at desc limit 6) m;
    return jsonb_build_object('status','not_initialized','plan_needed',pending is null,'current_revision',null,
      'plan_spine','[]'::jsonb,'current_step',null,'completion',null,'recent_shared_facts',recent,
      'pending_proposal',pending,
      'vocabulary_version','2026-09-24.1','note','No approved living plan exists yet. A pending proposal is a saved draft, readable by its exact revision. Recent shared facts are current project data, regardless of which collaborator recorded them.');
  end if;

  select * into meta from bob.project_plan_revisions where project_id=p_project and revision=rev;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.step_id,'position',s.position,'title',s.title,'state',s.state,'area_id',s.area_id,'phase',s.phase)
    order by s.position),'[]'::jsonb) into spine
    from bob.project_plan_steps s where s.project_id=p_project and s.plan_revision=rev;

  select * into active from bob.project_plan_steps
    where project_id=p_project and plan_revision=rev and state<>'completed'
    order by (step_id=(select focus_step_id from bob.project_plans where project_id=p_project)) desc nulls last,(state='active') desc,position limit 1;

  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',q.requirement_id,'type',q.requirement_type,'title',q.title,'description',q.description,
      'resolution',q.resolution,'responsible_kind',q.responsible_kind,'responsible_person_id',q.responsible_person_id,
      'status',bob_private.plan_requirement_state(p_project,rev,q.requirement_id)
    ) order by q.position),'[]'::jsonb)
      into reqs from bob.project_plan_requirements q
      where q.project_id=p_project and q.plan_revision=rev and q.step_id=active.step_id;

    select jsonb_build_object(
      'total',count(*),
      'satisfied',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state')='satisfied'),
      'missing',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state')='missing'),
      'conflicted',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state')='conflicted'),
      'stale',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state')='stale'),
      'waived',count(*) filter(where (bob_private.plan_requirement_state(p_project,rev,q.requirement_id)->>'state') in ('waived','not_applicable'))
    ) into counts from bob.project_plan_requirements q
      where q.project_id=p_project and q.plan_revision=rev and q.step_id=active.step_id;

    select count(*) into task_count from bob.tasks t where t.project_id=p_project and (t.primary_step_id=active.step_id or exists(select 1 from bob.project_plan_step_tasks x where x.task_id=t.id and x.step_id=active.step_id));
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'position',x.position,'name',t.name,'status',t.status,'area_id',t.area_id,'primary_step_id',t.primary_step_id,
      'updated_at',t.updated_at
    ) order by x.position,x.task_id),'[]'::jsonb) into tasks
      from (select project_id,step_id,task_id,position from bob.project_plan_step_tasks
        union select project_id,primary_step_id,id,1001 from bob.tasks where primary_step_id is not null
          and not exists(select 1 from bob.project_plan_step_tasks x where x.task_id=tasks.id and x.step_id=tasks.primary_step_id)) x
      join bob.tasks t on t.id=x.task_id and t.project_id=x.project_id
      left join bob.areas a on a.id=t.area_id and t.project_id=x.project_id
      where x.project_id=p_project and x.step_id=active.step_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',m.id::text,'subject',m.subject,'value',m.value,'unit',m.unit,'truth',m.truth,
    'area_id',m.area_id,'revision',m.revision,'actor',m.actor_label,'recorded_at',m.recorded_at)
    order by m.recorded_at desc,m.id),'[]'::jsonb)
    into recent from (select * from bob.current_measurements where project_id=p_project and not archived order by recorded_at desc limit 4) m;
  select count(*) into new_count from bob.current_measurements m
    where m.project_id=p_project and not m.archived and m.recorded_at>meta.created_at;

  return jsonb_build_object(
    'vocabulary_version','2026-09-24.1','status','ok','plan_needed',false,'current_revision',rev,'summary',meta.summary,
    'pending_proposal',pending,
    'plan_spine',spine,
    'current_step',case when active.step_id is null then null else jsonb_build_object(
      'id',active.step_id,'position',active.position,'title',active.title,'goal',active.goal,'brief',active.notes,
      'state',active.state,'area_id',active.area_id,'responsible_kind',active.responsible_kind,
      'responsible_person_id',active.responsible_person_id,'tasks',tasks,'task_count',task_count,'requirements',reqs
    ) end,
    'completion',counts,'recent_shared_facts',recent,
    'new_shared_facts_since_plan',new_count,'plan_review_hint',new_count>0,
    'note','Plan spine is orientation. Current Step is the working desk: Tasks are actions; Completion Requirements are criteria. Requirement state comes from project evidence. Use exact tools when more detail is needed.'
  );
end $function$
;

-- bob_private.project_plan_step_task_scope_guard — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.project_plan_step_task_scope_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actual_project text;
begin
  select t.project_id into actual_project
  from bob.tasks t left join bob.areas a on a.id=t.area_id
  where t.id=new.task_id;
  if actual_project is distinct from new.project_id then
    raise exception 'project_denied' using errcode='42501';
  end if;
  return new;
end $function$
;

-- bob_private.project_plan_link_task — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.project_plan_link_task(p_project text, p_expected integer, p_step uuid, p_task text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_rev integer; pos integer; task_name text; step_title text; previous_step uuid;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then
    raise exception 'project_denied' using errcode='42501';
  end if;
  select current_revision into current_rev from bob.project_plans where project_id=p_project for update;
  if current_rev is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
  if current_rev is null or not exists(
    select 1 from bob.project_plan_steps
    where project_id=p_project and plan_revision=current_rev and step_id=p_step
  ) then raise exception 'plan_step_not_found' using errcode='22023'; end if;
  select t.name into task_name from bob.tasks t left join bob.areas a on a.id=t.area_id
    where t.id=p_task and t.project_id=p_project for update of t;
  if not found then raise exception 'plan_task_not_found' using errcode='22023'; end if;
  select title into step_title from bob.project_plan_steps
    where project_id=p_project and plan_revision=current_rev and step_id=p_step;

  select primary_step_id into previous_step from bob.tasks where id=p_task;
  if p_action in ('link','move') then
    if not exists(select 1 from bob.project_plan_step_tasks where project_id=p_project and step_id=p_step and task_id=p_task) then
      select coalesce(max(position),0)+1 into pos from bob.project_plan_step_tasks
        where project_id=p_project and step_id=p_step;
      insert into bob.project_plan_step_tasks(project_id,step_id,task_id,position,linked_by)
        values(p_project,p_step,p_task,pos,auth.uid());
    end if;
    if p_action='move' or previous_step is null then
      if p_action='move' and previous_step is distinct from p_step then
        delete from bob.project_plan_step_tasks where project_id=p_project and task_id=p_task and step_id=previous_step;
      end if;
      update bob.tasks set primary_step_id=p_step where id=p_task;
    end if;
  elsif p_action='unlink' then
    update bob.tasks set primary_step_id=null where id=p_task and primary_step_id=p_step;
    delete from bob.project_plan_step_tasks
      where project_id=p_project and step_id=p_step and task_id=p_task;
  else raise exception 'plan_invalid_task_action' using errcode='22023';
  end if;

  return jsonb_build_object('id',p_project,'revision',current_rev,'name','Living project plan v'||current_rev,
    'step_id',p_step,'step_title',step_title,'task_id',p_task,'task_name',task_name,'action',p_action,'updated_at',clock_timestamp());
end $function$
;

-- bob_private.project_plan_propose — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.project_plan_propose(p_project text, p_expected integer, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h bob.project_plans; new_rev integer; current_rev integer; step jsonb; req jsonb; sid uuid; qid uuid;
  step_pos integer:=0; req_pos integer; completed_count integer:=0; active_count integer:=0; selector jsonb; link jsonb; staged_links jsonb:='[]'::jsonb; task_stamp timestamptz;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if jsonb_typeof(p_data)<>'object' or p_data-array['summary','reason','steps','task_links']::text[]<>'{}'
    or (select count(*) from jsonb_object_keys(p_data)) not in (3,4)
    or jsonb_typeof(p_data->'summary')<>'string' or char_length(btrim(p_data->>'summary')) not between 1 and 4000
    or jsonb_typeof(p_data->'reason')<>'string' or char_length(btrim(p_data->>'reason')) not between 1 and 4000
    or jsonb_typeof(p_data->'steps')<>'array' or jsonb_array_length(p_data->'steps') not between 1 and 30
    or octet_length(p_data::text)>80000 then raise exception 'plan_invalid_proposal' using errcode='22023'; end if;

  insert into bob.project_plans(project_id) values(p_project) on conflict do nothing;
  select * into h from bob.project_plans where project_id=p_project for update;
  current_rev:=h.current_revision;
  if coalesce(current_rev,0) is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
  if exists(select 1 from bob.project_plan_revisions where project_id=p_project and status='proposed') then
    raise exception 'plan_proposal_pending' using errcode='40001'; end if;
  new_rev:=h.next_revision;
  update bob.project_plans set next_revision=next_revision+1,updated_at=clock_timestamp() where project_id=p_project;
  insert into bob.project_plan_revisions(project_id,revision,status,based_on_revision,summary,reason,proposed_by)
    values(p_project,new_rev,'proposed',current_rev,btrim(p_data->>'summary'),btrim(p_data->>'reason'),auth.uid());

  if current_rev is not null then
    insert into bob.project_plan_steps(project_id,plan_revision,step_id,position,title,goal,state,area_id,responsible_kind,responsible_person_id,notes,phase)
      select project_id,new_rev,step_id,position,title,goal,state,area_id,responsible_kind,responsible_person_id,notes,phase
      from bob.project_plan_steps where project_id=p_project and plan_revision=current_rev and state='completed' order by position;
    get diagnostics completed_count=row_count;
    insert into bob.project_plan_requirements(project_id,plan_revision,requirement_id,step_id,position,requirement_type,title,description,resolution,responsible_kind,responsible_person_id,evidence_selector)
      select project_id,new_rev,requirement_id,step_id,position,requirement_type,title,description,resolution,responsible_kind,responsible_person_id,evidence_selector
      from bob.project_plan_requirements q where q.project_id=p_project and q.plan_revision=current_rev
        and exists(select 1 from bob.project_plan_steps s where s.project_id=p_project and s.plan_revision=current_rev and s.step_id=q.step_id and s.state='completed');
    insert into bob.project_plan_evidence(project_id,plan_revision,requirement_id,evidence_kind,evidence_id,evidence_revision,relation,linked_by,linked_at)
      select project_id,new_rev,requirement_id,evidence_kind,evidence_id,evidence_revision,relation,linked_by,linked_at
      from bob.project_plan_evidence e where e.project_id=p_project and e.plan_revision=current_rev
        and exists(select 1 from bob.project_plan_requirements q join bob.project_plan_steps s
          on s.project_id=q.project_id and s.plan_revision=q.plan_revision and s.step_id=q.step_id
          where q.project_id=p_project and q.plan_revision=current_rev and q.requirement_id=e.requirement_id and s.state='completed');
  end if;
  step_pos:=completed_count;

  for step in select value from jsonb_array_elements(p_data->'steps') loop
    if jsonb_typeof(step)<>'object' or step-array['step_id','title','goal','state','area_id','responsible_kind','responsible_person_id','notes','requirements','phase']::text[]<>'{}'
      or (select count(*) from jsonb_object_keys(step)) not in (9,10)
      or jsonb_typeof(step->'title')<>'string' or char_length(btrim(step->>'title')) not between 1 and 240
      or jsonb_typeof(step->'goal')<>'string' or char_length(btrim(step->>'goal')) not between 1 and 4000
      or coalesce(step->>'state','')<>all(array['planned','active','blocked','completed'])
      or not(step->'area_id'='null'::jsonb or (jsonb_typeof(step->'area_id')='string' and char_length(step->>'area_id') between 1 and 200))
      or coalesce(step->>'responsible_kind','')<>all(array['bob','person','unassigned'])
      or not(step->'responsible_person_id'='null'::jsonb or jsonb_typeof(step->'responsible_person_id')='string')
      or jsonb_typeof(step->'notes')<>'string' or char_length(step->>'notes')>4000
      or (step->>'phase' is not null and step->>'phase'<>all(array['concept','design','planning','build','complete']))
      or jsonb_typeof(step->'requirements')<>'array' or jsonb_array_length(step->'requirements')>20 then
      raise exception 'plan_invalid_step' using errcode='22023'; end if;
    if (step->>'responsible_kind'='person') is distinct from (step->'responsible_person_id'<>'null'::jsonb) then
      raise exception 'plan_invalid_responsibility' using errcode='22023'; end if;
    if step->'area_id'<>'null'::jsonb and not exists(select 1 from bob.areas where id=step->>'area_id' and project_id=p_project) then
      raise exception 'project_denied' using errcode='42501'; end if;
    if step->>'responsible_kind'='person' and not exists(select 1 from bob.people where id=step->>'responsible_person_id' and project_id=p_project) then
      raise exception 'project_denied' using errcode='42501'; end if;

    if step->'step_id'='null'::jsonb then sid:=gen_random_uuid();
    else
      sid:=(step->>'step_id')::uuid;
      if current_rev is null or not exists(select 1 from bob.project_plan_steps
        where project_id=p_project and plan_revision=current_rev and step_id=sid and state<>'completed') then
        raise exception 'plan_unknown_step_id' using errcode='22023'; end if;
    end if;
    if exists(select 1 from bob.project_plan_steps where project_id=p_project and plan_revision=new_rev and step_id=sid) then
      raise exception 'plan_duplicate_step' using errcode='22023'; end if;
    step_pos:=step_pos+1;
    -- Step execution state is independent from the single Bob focus.
    insert into bob.project_plan_steps values(p_project,new_rev,sid,step_pos,btrim(step->>'title'),btrim(step->>'goal'),step->>'state',
      nullif(step->>'area_id',''),step->>'responsible_kind',nullif(step->>'responsible_person_id',''),step->>'notes',case when step ? 'phase' then (step->>'phase')::bob.project_phase else
        (select phase from bob.project_plan_steps where project_id=p_project and plan_revision=current_rev and step_id=sid) end);

    req_pos:=0;
    for req in select value from jsonb_array_elements(step->'requirements') loop
      if jsonb_typeof(req)<>'object'
        or req-array['requirement_id','type','title','description','resolution','responsible_kind','responsible_person_id','evidence_selector']::text[]<>'{}'
        or (select count(*) from jsonb_object_keys(req))<>8
        or coalesce(req->>'type','')<>all(array['measurement','photo','decision','drawing','material_requirement','material_delivery','task','approval','check','other'])
        or jsonb_typeof(req->'title')<>'string' or char_length(btrim(req->>'title')) not between 1 and 240
        or jsonb_typeof(req->'description')<>'string' or char_length(req->>'description')>2000
        or coalesce(req->>'resolution','')<>all(array['open','waived','not_applicable'])
        or coalesce(req->>'responsible_kind','')<>all(array['bob','person','unassigned'])
        or not bob_private.plan_selector_valid(req->'evidence_selector') then
        raise exception 'plan_invalid_requirement' using errcode='22023'; end if;
      if (req->>'responsible_kind'='person') is distinct from (req->'responsible_person_id'<>'null'::jsonb) then
        raise exception 'plan_invalid_responsibility' using errcode='22023'; end if;
      if req->>'responsible_kind'='person' and not exists(select 1 from bob.people where id=req->>'responsible_person_id' and project_id=p_project) then
        raise exception 'project_denied' using errcode='42501'; end if;
      selector:=req->'evidence_selector';
      if selector->>'kind'='measurement' and selector->'area_id'<>'null'::jsonb
        and not exists(select 1 from bob.areas where id=selector->>'area_id' and project_id=p_project) then
        raise exception 'project_denied' using errcode='42501'; end if;

      if req->'requirement_id'='null'::jsonb then qid:=gen_random_uuid();
      else
        qid:=(req->>'requirement_id')::uuid;
        if current_rev is null or step->'step_id'='null'::jsonb or not exists(select 1 from bob.project_plan_requirements
          where project_id=p_project and plan_revision=current_rev and requirement_id=qid and step_id=sid) then
          raise exception 'plan_unknown_requirement_id' using errcode='22023'; end if;
      end if;
      if exists(select 1 from bob.project_plan_requirements where project_id=p_project and plan_revision=new_rev and requirement_id=qid) then
        raise exception 'plan_duplicate_requirement' using errcode='22023'; end if;
      req_pos:=req_pos+1;
      insert into bob.project_plan_requirements values(p_project,new_rev,qid,sid,req_pos,req->>'type',btrim(req->>'title'),req->>'description',
        req->>'resolution',req->>'responsible_kind',nullif(req->>'responsible_person_id',''),selector);
    end loop;
  end loop;
  if p_data ? 'task_links' then
    if jsonb_typeof(p_data->'task_links')<>'array' or jsonb_array_length(p_data->'task_links')>200 then
      raise exception 'plan_invalid_task_links' using errcode='22023'; end if;
    for link in select value from jsonb_array_elements(p_data->'task_links') loop
      if link-array['step_position','task_id']::text[]<>'{}' or coalesce(link->>'step_position','')!~'^[0-9]{1,3}$' then
        raise exception 'plan_invalid_task_links' using errcode='22023'; end if;
      select step_id into sid from bob.project_plan_steps where project_id=p_project and plan_revision=new_rev
        and position=completed_count+(link->>'step_position')::integer;
      if not found then raise exception 'plan_step_not_found' using errcode='22023'; end if;
      select updated_at into task_stamp from bob.tasks where project_id=p_project and id=link->>'task_id' for share;
      if not found then raise exception 'plan_task_not_found' using errcode='22023'; end if;
      if exists(select 1 from jsonb_array_elements(staged_links) l where l->>'task_id'=link->>'task_id') then
        raise exception 'plan_duplicate_task_owner' using errcode='22023'; end if;
      staged_links:=staged_links||jsonb_build_array(jsonb_build_object('task_id',link->>'task_id','step_id',sid,'expected_updated_at',task_stamp));
    end loop;
  end if;
  update bob.project_plan_revisions set task_links=staged_links where project_id=p_project and revision=new_rev;
  return bob.project_plan_read(p_project,new_rev);
end $function$
;

-- bob_private.project_plan_decide — updated work ownership.
CREATE OR REPLACE FUNCTION bob_private.project_plan_decide(p_project text, p_expected integer, p_proposal integer, p_action text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h bob.project_plans; r bob.project_plan_revisions; link jsonb; stamp timestamptz;
begin
  if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_action<>all(array['approve','reject']) or p_proposal<1 or char_length(coalesce(p_note,''))>2000 then
    raise exception 'plan_invalid_decision' using errcode='22023'; end if;
  select * into h from bob.project_plans where project_id=p_project for update;
  if not found or coalesce(h.current_revision,0) is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
  select * into r from bob.project_plan_revisions where project_id=p_project and revision=p_proposal for update;
  if not found or r.status<>'proposed' or coalesce(r.based_on_revision,0) is distinct from p_expected then
    raise exception 'record_changed' using errcode='40001'; end if;
  if p_action='reject' then
    update bob.project_plan_revisions set status='rejected',decided_at=clock_timestamp() where project_id=p_project and revision=p_proposal;
    return bob.project_plan_read(p_project,p_proposal);
  end if;
  for link in select value from jsonb_array_elements(r.task_links) loop
    select updated_at into stamp from bob.tasks where project_id=p_project and id=link->>'task_id' for update;
    if not found or stamp is distinct from (link->>'expected_updated_at')::timestamptz then
      raise exception 'plan_task_changed' using errcode='40001'; end if;
  end loop;
  if h.current_revision is not null then
    update bob.project_plan_revisions set status='superseded',decided_at=coalesce(decided_at,clock_timestamp()),
      approved_by=coalesce(approved_by,auth.uid())
    where project_id=p_project and revision=h.current_revision and status='approved';
  end if;
  update bob.project_plan_revisions set status='approved',approved_by=auth.uid(),decided_at=clock_timestamp()
    where project_id=p_project and revision=p_proposal;
  update bob.project_plans set current_revision=p_proposal,updated_at=clock_timestamp() where project_id=p_project;
  for link in select value from jsonb_array_elements(r.task_links) loop
    perform bob_private.project_plan_link_task(p_project,p_proposal,(link->>'step_id')::uuid,link->>'task_id','move');
  end loop;
  -- Preserve work whose old Step was intentionally removed; expose it as unorganised.
  update bob.tasks t set primary_step_id=null where t.project_id=p_project and t.primary_step_id is not null
    and not exists(select 1 from bob.project_plan_steps s where s.project_id=p_project and s.plan_revision=p_proposal and s.step_id=t.primary_step_id);
  update bob.tasks t set area_id=s.area_id from bob.project_plan_steps s
    where t.project_id=p_project and s.project_id=p_project and s.plan_revision=p_proposal and s.step_id=t.primary_step_id and t.area_id is distinct from s.area_id;
  update bob.project_plans p set focus_step_id=(select s.step_id from bob.project_plan_steps s
    where s.project_id=p_project and s.plan_revision=p_proposal and s.state<>'completed'
    order by (s.step_id=p.focus_step_id) desc nulls last,(s.state='active') desc,s.position limit 1)
    where p.project_id=p_project;
  return bob.project_plan_read(p_project,p_proposal);
end $function$
;

create or replace view bob.current_task_readiness with(security_invoker=true) as
 SELECT t.id AS task_id,
    t.project_id,
    t.area_id,
    a.phase AS area_phase,
    t.status AS task_status,
        CASE
            WHEN (t.status = 'done'::bob.task_status) THEN 'complete'::text
            WHEN (COALESCE(jsonb_array_length(blockers.items), 0) > 0) THEN 'blocked'::text
            WHEN (review.confirmed_at IS NULL) THEN 'unreviewed'::text
            WHEN ((source_change.latest_change IS NOT NULL) AND (source_change.latest_change > review.confirmed_at)) THEN 'unreviewed'::text
            ELSE 'ready'::text
        END AS readiness_state,
        CASE
            WHEN (t.status = 'done'::bob.task_status) THEN 0
            ELSE COALESCE(jsonb_array_length(blockers.items), 0)
        END AS blocker_count,
        CASE
            WHEN (t.status = 'done'::bob.task_status) THEN '[]'::jsonb
            ELSE COALESCE(blockers.items, '[]'::jsonb)
        END AS blockers,
    review.confirmed_at AS reviewed_at,
    review.actor_label AS reviewed_by,
    review.note AS review_note
   FROM ((((bob.tasks t
     LEFT JOIN bob.areas a ON ((a.id = t.area_id)))
     LEFT JOIN bob.task_readiness_reviews review ON (((review.project_id = t.project_id) AND (review.task_id = t.id))))
     LEFT JOIN LATERAL ( SELECT max(changes.changed_at) AS latest_change
           FROM ( SELECT dependency.created_at AS changed_at
                   FROM bob.task_dependencies dependency
                  WHERE (dependency.task_id = t.id)
                UNION ALL
                 SELECT need.updated_at
                   FROM bob.task_needs need
                  WHERE (need.task_id = t.id)
                UNION ALL
                 SELECT material.recorded_at
                   FROM bob.current_material_requirements material
                  WHERE (material.task_id = t.id)) changes) source_change ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('kind', reasons.kind, 'id', reasons.id, 'label', reasons.label) ORDER BY reasons.priority, reasons.label) AS items
           FROM ( SELECT 1 AS priority,
                    'phase'::text AS kind,
                    a.id,
                        CASE
                            WHEN (coalesce((select s.phase from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=t.project_id and s.step_id=t.primary_step_id),a.phase) IS NULL) THEN case when t.primary_step_id is null then 'Set Area phase before starting' else 'Set Step phase before starting' end
                            ELSE ((case when t.primary_step_id is null then 'Area is in ' else 'Step is in ' end || initcap((coalesce((select s.phase from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=t.project_id and s.step_id=t.primary_step_id),a.phase))::text)) || '; move to Build when work is actually ready'::text)
                        END AS label
                  WHERE ((t.status <> 'done'::bob.task_status) AND (coalesce((select s.phase from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision where s.project_id=t.project_id and s.step_id=t.primary_step_id),a.phase) IS DISTINCT FROM 'build'::bob.project_phase))
                UNION ALL
                 SELECT 2,
                    'status'::text,
                    t.id,
                    'Task is manually marked Blocked'::text
                  WHERE (t.status = 'blocked'::bob.task_status)
                UNION ALL
                 SELECT 3,
                    'dependency'::text,
                    (dependency.id)::text AS id,
                        CASE
                            WHEN (dependency.prerequisite_step_id IS NULL) THEN ('Finish '::text || dependency.prerequisite_task_name)
                            ELSE ((dependency.prerequisite_task_name || ': complete '::text) || dependency.prerequisite_step_title)
                        END AS "case"
                   FROM bob.task_dependency_status dependency
                  WHERE ((t.status <> 'done'::bob.task_status) AND (dependency.task_id = t.id) AND (NOT dependency.satisfied))
                UNION ALL
                 SELECT 4,
                    'material'::text,
                    (material.requirement_id)::text AS requirement_id,
                    material.reason
                   FROM bob.task_material_readiness material
                  WHERE ((t.status <> 'done'::bob.task_status) AND (material.task_id = t.id) AND (NOT material.ready))
                UNION ALL
                 SELECT
                        CASE need.kind
                            WHEN 'tool'::text THEN 5
                            ELSE 6
                        END AS "case",
                    need.kind,
                    (need.id)::text AS id,
                        CASE need.kind
                            WHEN 'tool'::text THEN ('Tool needed: '::text || need.label)
                            ELSE ('Confirm: '::text || need.label)
                        END AS "case"
                   FROM bob.task_needs need
                  WHERE ((t.status <> 'done'::bob.task_status) AND (need.task_id = t.id) AND (NOT need.ready))) reasons) blockers ON (true));

create or replace view bob.today_tasks with(security_invoker=true) as
 SELECT t.id,
    t.project_id,
    COALESCE(a.name,'Project') AS area_name,
    t.name,
    t.skill,
    t.status,
    COALESCE(( SELECT array_agg(ta.person_id) AS array_agg
           FROM bob.task_assignees ta
          WHERE (ta.task_id = t.id)), '{}'::text[]) AS assignee_ids,
    t.area_id,
    a.phase AS area_phase, t.primary_step_id
   FROM (bob.tasks t
     LEFT JOIN bob.areas a ON ((a.id = t.area_id)))
  WHERE (t.status = ANY (ARRAY['todo'::bob.task_status, 'doing'::bob.task_status, 'blocked'::bob.task_status]));

-- Plan revision facts plus current operational Task ownership.
CREATE OR REPLACE FUNCTION bob.project_plan_read(p_project text, p_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare rev integer; meta bob.project_plan_revisions; steps jsonb; result jsonb;
begin
  if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
  if p_revision is null then select current_revision into rev from bob.project_plans where project_id=p_project;
  else rev:=p_revision; end if;
  if rev is null then return jsonb_build_object('status','not_initialized','projectId',p_project,'record',null); end if;
  select * into meta from bob.project_plan_revisions where project_id=p_project and revision=rev;
  if not found then return jsonb_build_object('status','not_found','projectId',p_project,'record',null); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'phase',s.phase,'id',s.step_id,'position',s.position,'title',s.title,'goal',s.goal,'state',s.state,'area_id',s.area_id,
    'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status,
      'project_id',t.project_id,'area_id',t.area_id,'primary_step_id',t.primary_step_id,
      'assignee_ids',coalesce((select jsonb_agg(person_id order by person_id) from bob.task_assignees where task_id=t.id),'[]'::jsonb)) order by t.id)
      from bob.tasks t where t.project_id=p_project and t.primary_step_id=s.step_id),'[]'::jsonb),
    'related_tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'primary_step_id',t.primary_step_id) order by t.id)
      from bob.project_plan_step_tasks x join bob.tasks t on t.id=x.task_id and t.project_id=x.project_id
      where x.project_id=p_project and x.step_id=s.step_id and t.primary_step_id is distinct from s.step_id),'[]'::jsonb),
    'responsible_kind',s.responsible_kind,'responsible_person_id',s.responsible_person_id,'notes',s.notes,
    'requirements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',q.requirement_id,'position',q.position,'type',q.requirement_type,'title',q.title,'description',q.description,
        'resolution',q.resolution,'responsible_kind',q.responsible_kind,'responsible_person_id',q.responsible_person_id,
        'evidence_selector',q.evidence_selector,'status',bob_private.plan_requirement_state(p_project,rev,q.requirement_id)
      ) order by q.position,q.requirement_id)
      from bob.project_plan_requirements q
      where q.project_id=p_project and q.plan_revision=rev and q.step_id=s.step_id
    ),'[]'::jsonb)
  ) order by s.position,s.step_id),'[]'::jsonb) into steps
  from bob.project_plan_steps s where s.project_id=p_project and s.plan_revision=rev;

  result:=jsonb_build_object('id',p_project,'name','Living project plan v'||rev,'project_id',p_project,
    'focus_step_id',(select focus_step_id from bob.project_plans where project_id=p_project),'vocabulary_version','2026-09-24.1','task_links',meta.task_links,'revision',rev,'status',meta.status,'based_on_revision',meta.based_on_revision,'summary',meta.summary,'reason',meta.reason,
    'proposed_by',meta.proposed_by,'approved_by',meta.approved_by,'created_at',meta.created_at,'updated_at',coalesce(meta.decided_at,meta.created_at),
    'steps',steps);
  return jsonb_build_object('status','ok','projectId',p_project,'record',result);
end $function$
;

CREATE OR REPLACE FUNCTION bob_private.bob_project_write_v8(p_project text, p_thread uuid, p_turn uuid, p_generation bigint, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare kind text:=p_payload->>'kind'; d jsonb; quote text; message text; saved jsonb; record jsonb; result jsonb;
  key text; existing bob_private.bob_write_receipts; expected integer; proposal integer; action text;
begin
  if kind<>all(array['plan_proposal','plan_decision','plan_evidence','plan_task','plan_focus']) then
    return bob_private.bob_project_write_v7(p_project,p_thread,p_turn,p_generation,p_payload);
  end if;
  perform bob_private.bob_assert_write_claim(p_project,p_thread,p_turn,p_generation);
  if p_payload-array['kind','record_id','expected_updated_at','expected_revision','data','request_quote']::text[]<>'{}'
    or (select count(*) from jsonb_object_keys(p_payload))<>6
    or p_payload->'record_id' is distinct from 'null'::jsonb
    or p_payload->'expected_updated_at' is distinct from 'null'::jsonb
    or jsonb_typeof(p_payload->'expected_revision')<>'number' or coalesce(p_payload->>'expected_revision','')!~'^[0-9]{1,9}$'
    or jsonb_typeof(p_payload->'data')<>'object'
    or jsonb_typeof(p_payload->'request_quote')<>'string' or char_length(p_payload->>'request_quote') not between 1 and 500 then
    raise exception 'invalid_write' using errcode='22023'; end if;
  d:=p_payload->'data'; quote:=p_payload->>'request_quote'; expected:=(p_payload->>'expected_revision')::integer;
  select text into message from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  if message is null or position(quote in message)=0 then raise exception 'request_quote_required' using errcode='22023'; end if;

  if kind='plan_proposal' then key:='plan:proposal';
  elsif kind='plan_decision' then key:='plan:decision:'||coalesce(d->>'proposal_revision','');
  elsif kind='plan_evidence' then
    key:='plan:evidence:'||coalesce(d->>'requirement_id','')||':'||coalesce(d->>'evidence_kind','')||':'||coalesce(d->>'evidence_id','')||':'||coalesce(d->>'relation','');
  elsif kind='plan_focus' then key:='plan:focus';
  else key:='plan:task:'||coalesce(d->>'step_id','')||':'||coalesce(d->>'task_id','')||':'||coalesce(d->>'action',''); end if;

  select * into existing from bob_private.bob_write_receipts
    where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn and operation_key=key;
  if found then
    if existing.payload is distinct from p_payload then raise exception 'operation_reused' using errcode='40001'; end if;
    return existing.receipt;
  end if;
  if (select count(*) from bob_private.bob_write_receipts where project_id=p_project and actor_id=auth.uid() and turn_id=p_turn)>=8 then
    raise exception 'write_budget_exhausted' using errcode='22023'; end if;

  if kind='plan_proposal' then
    saved:=bob_private.project_plan_propose(p_project,expected,d);
    record:=saved->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',record->'revision',
      'label','Plan proposal v'||(record->>'revision'),'operation','created','savedAt',clock_timestamp(),'record',record);
  elsif kind='plan_decision' then
    if d-array['action','proposal_revision','decision_note']::text[]<>'{}' or (select count(*) from jsonb_object_keys(d))<>3 then
      raise exception 'invalid_write' using errcode='22023'; end if;
    proposal:=(d->>'proposal_revision')::integer; action:=d->>'action';
    saved:=bob_private.project_plan_decide(p_project,expected,proposal,action,d->>'decision_note');
    record:=saved->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',record->'revision',
      'label','Project plan v'||(record->>'revision')||' '||action,'operation','updated','savedAt',clock_timestamp(),'record',record);
  elsif kind='plan_evidence' then
    if d-array['requirement_id','relation','evidence_kind','evidence_id','evidence_revision']::text[]<>'{}'
      or (select count(*) from jsonb_object_keys(d))<>5 then raise exception 'invalid_write' using errcode='22023'; end if;
    saved:=bob_private.project_plan_link_evidence(p_project,expected,(d->>'requirement_id')::uuid,d->>'evidence_kind',d->>'evidence_id',
      (d->>'evidence_revision')::integer,d->>'relation');
    record:=bob.project_plan_read(p_project,expected)->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',expected,
      'label',saved->>'requirement_title','operation','updated','savedAt',clock_timestamp(),'record',record);
  elsif kind='plan_focus' then
    if d-array['step_id']::text[]<>'{}' or (select count(*) from jsonb_object_keys(d))<>1 then raise exception 'invalid_write' using errcode='22023'; end if;
    perform bob_private.project_plan_set_focus(p_project,expected,(d->>'step_id')::uuid);
    record:=bob.project_plan_read(p_project,expected)->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',expected,
      'label','Bob focus','operation','updated','savedAt',clock_timestamp(),'record',record);
  else
    if d-array['action','step_id','task_id']::text[]<>'{}' or (select count(*) from jsonb_object_keys(d))<>3
      or d->>'action'<>all(array['link','unlink','move']) then raise exception 'invalid_write' using errcode='22023'; end if;
    saved:=bob_private.project_plan_link_task(p_project,expected,(d->>'step_id')::uuid,d->>'task_id',d->>'action');
    record:=bob.project_plan_read(p_project,expected)->'record';
    result:=jsonb_build_object('projectId',p_project,'dataset','plan','recordId',p_project,'revision',expected,
      'label',(saved->>'task_name')||' ↔ '||(saved->>'step_title'),'operation','updated','savedAt',clock_timestamp(),'record',record);
  end if;

  insert into bob_private.bob_write_receipts(project_id,actor_id,turn_id,operation_key,payload,before_record,receipt)
    values(p_project,auth.uid(),p_turn,key,p_payload,null,result);
  return result;
end $function$
;

-- A separate focus pointer does not change any Step's execution state.
create function bob_private.project_plan_set_focus(p_project text,p_expected integer,p_step uuid)
returns void language plpgsql security definer set search_path='' as $$
declare rev integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select current_revision into rev from bob.project_plans where project_id=p_project for update;
 if rev is distinct from p_expected then raise exception 'record_changed' using errcode='40001'; end if;
 if p_step is not null and not exists(select 1 from bob.project_plan_steps where project_id=p_project and plan_revision=rev and step_id=p_step and state<>'completed') then
  raise exception 'plan_step_not_found' using errcode='22023'; end if;
 update bob.project_plans set focus_step_id=p_step,updated_at=clock_timestamp() where project_id=p_project;
end $$;
revoke all on function bob_private.project_plan_set_focus(text,integer,uuid) from public,anon,authenticated;

-- One typed read surface, including older work that has not acquired a primary Step.
create function bob.project_work_read(p_project text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare plan jsonb; areas jsonb; pending_tasks jsonb;
begin
 if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 plan:=bob.project_plan_read(p_project,null);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'slug',slug,'phase',phase) order by sort_order,id),'[]'::jsonb)
  into areas from bob.areas where project_id=p_project;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'area_id',t.area_id,'primary_step_id',t.primary_step_id) order by t.id),'[]'::jsonb)
  into pending_tasks from bob.tasks t where t.project_id=p_project and (t.primary_step_id is null or not exists(
    select 1 from bob.project_plan_steps s join bob.project_plans p on p.project_id=s.project_id and p.current_revision=s.plan_revision
    where s.project_id=p_project and s.step_id=t.primary_step_id));
 return jsonb_build_object('project_id',p_project,'vocabulary_version','2026-09-24.1','status',plan->'status',
  'revision',plan->'record'->'revision','focus_step_id',(select focus_step_id from bob.project_plans where project_id=p_project),
  'areas',areas,'steps',coalesce(plan->'record'->'steps','[]'::jsonb),'unorganised_tasks',pending_tasks);
end $$;
revoke all on function bob.project_work_read(text) from public,anon;
grant execute on function bob.project_work_read(text) to authenticated;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active)
 values('set_project_plan_focus','Choose Bob''s focus in the current plan without stopping parallel work.',
 'Read the current plan revision and exact Step identity. This changes attention only, not work state, phase or readiness. Use a saved write receipt.',1,true,array[]::text[],true)
 on conflict(name) do update set description=excluded.description,how_to=excluded.how_to,always_load=true,active=true;
update bob.tool_catalog set description='Create or revise a Task in the unified plan; a Task is not a living Project Plan. Its primary Step may be directly in the Project or in an Area.',
 how_to='Read current plan Steps and Tasks. Give step_id to create and organise the Task atomically. Area is optional and derives from the primary Step. Legacy unorganised Area Tasks remain readable. Read the saved ownership before claiming success.'
 where name='save_project_task';
update bob.tool_catalog set description='Link, move or unlink an existing Task and a stable current plan Step.',
 how_to='link assigns an unowned Task or adds a reference to an already owned Task; move explicitly changes its primary Step; unlink removes the association. Tasks have one primary owner and are counted once. Read current revision and identities; finish criteria remain separate.'
 where name='link_project_plan_task';
update bob.tool_catalog set how_to=how_to||' Compiled task ownership links are staged with the proposal and applied atomically on approval; no separate follow-up link calls are needed for those staged links.'
 where name in ('save_compiled_project_plan','decide_project_plan');

comment on column bob.tasks.project_id is 'Canonical Project ownership; never inferred only from an optional Area.';
comment on column bob.tasks.primary_step_id is 'Single primary Plan Step. Null means legacy/unorganised work, not a second plan.';
comment on table bob.task_steps is 'Task instructions/checkpoints, distinct from project_plan_steps and CAD STEP files.';
comment on table bob.project_plan_step_tasks is 'Related-work links; primary ownership is tasks.primary_step_id.';
comment on column bob.project_plans.focus_step_id is 'Bob attention; independent from parallel Step execution state.';

-- Manual creation uses the same ownership lock order as Bob and plan approval.
create function bob_private.create_work_task(p_project text,p_step uuid,p_area text,p_name text,p_skill bob.skill_level,p_hours text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved bob.tasks;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if char_length(btrim(coalesce(p_name,''))) not between 1 and 300 or char_length(coalesce(p_hours,''))>100 or p_skill is null
   or (p_step is null and p_area is null) then raise exception 'invalid_task' using errcode='22023'; end if;
 perform 1 from bob.project_plans where project_id=p_project for share;
 if p_area is not null and not exists(select 1 from bob.areas where id=p_area and project_id=p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 insert into bob.tasks(id,project_id,primary_step_id,area_id,name,skill,hours)
  values('t_'||replace(gen_random_uuid()::text,'-',''),p_project,p_step,p_area,btrim(p_name),p_skill,coalesce(p_hours,'')) returning * into saved;
 return to_jsonb(saved);
end $$;
create function bob.create_work_task(p_project text,p_step uuid,p_area text,p_name text,p_skill bob.skill_level,p_hours text)
returns jsonb language sql security invoker set search_path='' as $$
 select bob_private.create_work_task(p_project,p_step,p_area,p_name,p_skill,p_hours) $$;
revoke all on function bob_private.create_work_task(text,uuid,text,text,bob.skill_level,text),bob.create_work_task(text,uuid,text,text,bob.skill_level,text) from public,anon;
grant execute on function bob_private.create_work_task(text,uuid,text,text,bob.skill_level,text),bob.create_work_task(text,uuid,text,text,bob.skill_level,text) to authenticated;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active)
 values('save_project_area','Create or revise an optional Area grouping for project Steps.',
 'Read existing Areas first. Reuse exact IDs. Create a grouping when scope needs it; no placeholder Area is needed for a Step directly in the Project. This does not create a physical room or move existing work.',1,true,array[]::text[],true)
 on conflict(name) do nothing;

notify pgrst,'reload schema';
commit;
