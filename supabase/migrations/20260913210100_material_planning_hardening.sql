-- Hardening for manual material planning 4B2a: allocation capacity remains
-- conservative across source revisions and archive/restore, and zero purchase
-- needs remain explicit in the legacy Shopping text field.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function bob_private.guard_material_stock_allocation()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  current_revision integer;
  available numeric;
  current_status text;
  current_archived boolean;
  reserved numeric;
begin
  select s.current_revision, r.quantity, r.status, r.archived
    into current_revision, available, current_status, current_archived
  from bob.stock_items s
  join bob.stock_revisions r on r.stock_id=s.id and r.revision=s.current_revision
  where s.id=new.stock_id and s.project_id=new.project_id
  for share of s;
  if not found or current_revision<>new.stock_revision or current_archived or current_status<>'available' then
    raise exception 'Stock changed. Review the material requirement before reserving it.';
  end if;

  select coalesce(sum(a.quantity),0) into reserved
  from bob.material_requirement_stock a
  join bob.material_requirements h on h.id=a.requirement_id and h.project_id=a.project_id
  join bob.material_requirement_revisions r
    on r.requirement_id=h.id and r.revision=h.current_revision
  where a.project_id=new.project_id and a.stock_id=new.stock_id
    and a.requirement_id<>new.requirement_id and not r.archived;
  if reserved + new.quantity > available then
    raise exception 'Stock quantity is already reserved by another active material requirement';
  end if;
  return new;
end $$;
revoke all on function bob_private.guard_material_stock_allocation() from public,anon,authenticated;

create trigger guard_material_stock_allocation
before insert or update on bob.material_requirement_stock
for each row execute function bob_private.guard_material_stock_allocation();

create function bob_private.guard_material_component_allocation()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  current_revision integer;
  available integer;
  current_intent text;
  current_archived boolean;
  reserved numeric;
begin
  select c.current_revision, r.quantity, r.intent, r.archived
    into current_revision, available, current_intent, current_archived
  from bob.existing_components c
  join bob.component_revisions r on r.component_id=c.id and r.revision=c.current_revision
  where c.id=new.component_id and c.project_id=new.project_id
  for share of c;
  if not found or current_revision<>new.component_revision or current_archived
    or current_intent<>'reuse' or available is null then
    raise exception 'Reusable component changed. Review the material requirement before reserving it.';
  end if;

  select coalesce(sum(a.quantity),0) into reserved
  from bob.material_requirement_components a
  join bob.material_requirements h on h.id=a.requirement_id and h.project_id=a.project_id
  join bob.material_requirement_revisions r
    on r.requirement_id=h.id and r.revision=h.current_revision
  where a.project_id=new.project_id and a.component_id=new.component_id
    and a.requirement_id<>new.requirement_id and not r.archived;
  if reserved + new.quantity > available then
    raise exception 'Reusable component quantity is already reserved by another active material requirement';
  end if;
  return new;
end $$;
revoke all on function bob_private.guard_material_component_allocation() from public,anon,authenticated;

create trigger guard_material_component_allocation
before insert or update on bob.material_requirement_components
for each row execute function bob_private.guard_material_component_allocation();

-- The original Shopping surface stores quantity as authored text. Keep a real
-- zero explicit when a plan is fully covered by stock/reuse. The same
-- normalisation applies to the sync snapshot so the row is not immediately
-- reported as independently edited.
create function bob_private.normalise_material_plan_shopping_zero()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.id like 'mr_%' and new.qty ~ '^ (pcs|m|m²|m³|kg|l)$' then
    new.qty := '0' || new.qty;
  end if;
  return new;
end $$;

create trigger normalise_material_plan_shopping_zero
before insert or update of qty on bob.materials
for each row execute function bob_private.normalise_material_plan_shopping_zero();

create function bob_private.normalise_material_plan_sync_zero()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.synced_qty ~ '^ (pcs|m|m²|m³|kg|l)$' then
    new.synced_qty := '0' || new.synced_qty;
  end if;
  return new;
end $$;

create trigger normalise_material_plan_sync_zero
before insert or update of synced_qty on bob.material_requirement_shopping
for each row execute function bob_private.normalise_material_plan_sync_zero();

revoke all on function bob_private.normalise_material_plan_shopping_zero() from public,anon,authenticated;
revoke all on function bob_private.normalise_material_plan_sync_zero() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
