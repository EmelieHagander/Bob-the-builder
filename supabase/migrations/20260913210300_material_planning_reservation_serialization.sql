-- Slice 4B2a: serialize material stock and reusable-component reservation capacity.
-- Multiple concurrent requirement saves must not both reserve the same remaining quantity.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function bob_private.guard_material_stock_allocation()
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
  for update of s;
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

create or replace function bob_private.guard_material_component_allocation()
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
  for update of c;
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

revoke all on function bob_private.guard_material_stock_allocation() from public,anon,authenticated;
revoke all on function bob_private.guard_material_component_allocation() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;