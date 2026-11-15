begin;

-- Images are tied to immutable catalogue revisions. A claim serializes paid work.
create table bob.guide_item_illustrations (
  item_id uuid not null, revision integer not null,
  reference_media_id uuid references bob.media_assets(id) on delete set null,
  png text check (png ~ '^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$' and length(png) <= 2400),
  claim_token uuid, retry_after timestamptz,
  primary key (item_id,revision),
  foreign key (item_id,revision) references bob.catalog_item_revisions(item_id,revision) on delete cascade
);
alter table bob.guide_item_illustrations enable row level security;
revoke all on bob.guide_item_illustrations from public, anon, authenticated;
grant select,insert,update on bob.guide_item_illustrations to service_role;

-- An explicitly linked photo must belong to the catalogue item's own project.
-- Replacing/removing it also fences any in-flight review based on the previous photo.
create function bob_private.guide_item_reference_changed() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.reference_media_id is not null and not exists (
    select 1 from bob.catalog_items i join bob.media_assets m on m.project_id=i.project_id
    where i.id=new.item_id and m.id=new.reference_media_id and m.state='ready' and m.source_kind='user_upload'
  ) then raise exception 'guide_reference_unavailable'; end if;
  new.png=null; new.claim_token=null; new.retry_after=null;
  return new;
end $$;
create trigger guide_item_photo_update before update of reference_media_id on bob.guide_item_illustrations
for each row when (old.reference_media_id is distinct from new.reference_media_id)
execute function bob_private.guide_item_reference_changed();
create trigger guide_item_photo_insert before insert on bob.guide_item_illustrations
for each row when (new.reference_media_id is not null) execute function bob_private.guide_item_reference_changed();

create function bob.claim_guide_item_art(p_project text,p_item uuid,p_revision integer,p_token uuid,p_builtin boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item record; art bob.guide_item_illustrations;
begin
  select r.name,r.notes into item from bob.catalog_item_revisions r join bob.catalog_items i on i.id=r.item_id
    where i.id=p_item and r.revision=p_revision and (i.project_id is null or i.project_id=p_project);
  if not found or p_token is null then return jsonb_build_object('status','unavailable'); end if;
  if p_builtin and not exists (select 1 from bob.guide_item_illustrations where item_id=p_item and revision=p_revision) then
    return jsonb_build_object('status','builtin'); end if;
  insert into bob.guide_item_illustrations(item_id,revision) values(p_item,p_revision) on conflict do nothing;
  select * into strict art from bob.guide_item_illustrations where item_id=p_item and revision=p_revision for update;
  if art.png is not null then return jsonb_build_object('status','ready','png',art.png); end if;
  if p_builtin and art.reference_media_id is null then return jsonb_build_object('status','builtin'); end if;
  if art.retry_after > now() then return jsonb_build_object('status','unavailable'); end if;
  update bob.guide_item_illustrations set claim_token=p_token,retry_after=now()+interval '5 minutes'
    where item_id=p_item and revision=p_revision;
  return jsonb_build_object('status','claimed','name',item.name,'notes',item.notes,'reference',art.reference_media_id,'token',p_token);
end $$;
revoke all on function bob.claim_guide_item_art(text,uuid,integer,uuid,boolean) from public, anon, authenticated;
grant execute on function bob.claim_guide_item_art(text,uuid,integer,uuid,boolean) to service_role;
commit;
