-- Build guide pages in their own store (owner decision 2026-11-09: long guides,
-- in sections, with no page ceiling from the drawing row). Until now every page
-- lived as base64 in the drawing revision's `files`, so a guide had to fit in
-- one row next to the drawing (about 100 pages) and in one transport answer.
--
-- 1. bob.cad_guide_pages: one row per page, keyed by the guide's content id
--    (sha256 of its page hashes, see cad-assistant guideId). The Edge stores
--    pages right after the worker draws them, section by section, through
--    bob.store_cad_guide_pages (service role only). Rows are immutable.
-- 2. The save trigger accepts notes with store 'pages': no guide-* files in the
--    row, and every noted page must already be stored with that exact hash, so
--    a saved drawing never points at a missing page. Guides already saved with
--    their pages in the row are unchanged.
-- 3. Members read pages through RLS (project access). Volunteers read them only
--    for a drawing their task already shows, through bob.volunteer_guide_pages.
-- Re-running is a no-op. Apply BEFORE the Edge deploy that stores pages.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table if not exists bob.cad_guide_pages(
 project_id text not null references bob.projects(id) on delete cascade,
 guide_id text not null check(guide_id ~ '^[0-9a-f]{64}$'),
 page_key text not null check(page_key ~ '^guide-[0-9]{1,3}$'),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 svg text not null check(left(svg,4)='<svg' and octet_length(svg)<=1048576),
 created_at timestamptz not null default now(),
 primary key(project_id,guide_id,page_key));
alter table bob.cad_guide_pages enable row level security;
revoke all on bob.cad_guide_pages from public,anon,authenticated;
grant select on bob.cad_guide_pages to authenticated;
drop policy if exists cad_guide_pages_read on bob.cad_guide_pages;
create policy cad_guide_pages_read on bob.cad_guide_pages for select to authenticated
 using(bob_private.has_project_access(project_id));

-- Pages are written once; a repeat with the same bytes is a no-op and a
-- different body under the same key is refused.
create or replace function bob.store_cad_guide_pages(p_project text,p_guide text,p_pages jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare page jsonb; stored text; written integer:=0;
begin
 if p_guide !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_pages)<>'array' or jsonb_array_length(p_pages) not between 1 and 60 then
  raise exception 'cad_guide_pages_invalid' using errcode='22023'; end if;
 for page in select value from jsonb_array_elements(p_pages) loop
  if jsonb_typeof(page)<>'object' or coalesce(page->>'key','') !~ '^guide-[0-9]{1,3}$' or jsonb_typeof(page->'svg')<>'string'
    or encode(sha256(convert_to(page->>'svg','UTF8')),'hex') is distinct from page->>'sha256' then
   raise exception 'cad_guide_pages_invalid' using errcode='22023',detail='page'; end if;
  select sha256 into stored from bob.cad_guide_pages where project_id=p_project and guide_id=p_guide and page_key=page->>'key';
  if stored is null then
   insert into bob.cad_guide_pages(project_id,guide_id,page_key,sha256,svg) values(p_project,p_guide,page->>'key',page->>'sha256',page->>'svg');
   written:=written+1;
  elsif stored<>page->>'sha256' then raise exception 'cad_guide_pages_conflict' using errcode='23505'; end if;
 end loop;
 return written;
end $$;
revoke all on function bob.store_cad_guide_pages(text,text,jsonb) from public,anon,authenticated;
grant execute on function bob.store_cad_guide_pages(text,text,jsonb) to service_role;

create or replace function bob_private.validate_cad_build_guide() returns trigger
language plpgsql set search_path='' as $$
declare
 guide jsonb:=new.manifest->'build_guide';
 pin jsonb:=new.manifest->'bob_construction';
 page jsonb; noted text[]:='{}'; stray text[]; stored boolean:=false; max_pages integer:=60; key_pattern text:='^guide-[0-9]{1,2}$';
begin
 select coalesce(array_agg(k order by k),'{}') into stray from jsonb_object_keys(new.files) k where k ~ '^guide-';
 if guide is null then
  if cardinality(stray)>0 then raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_files_without_notes'; end if;
  return new;
 end if;
 if jsonb_typeof(guide)<>'object' or guide->>'version' is distinct from '1'
   or guide->>'status' not in ('generated','not_generated','failed')
   or jsonb_typeof(guide->'construction')<>'object' or pin is null
   or guide->'construction'->>'artifact_id' is distinct from pin->>'artifact_id'
   or guide->'construction'->>'revision' is distinct from pin->>'revision' then
  raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_notes_or_pin';
 end if;
 if guide->>'status'<>'generated' then
  if cardinality(stray)>0 or coalesce(jsonb_array_length(guide->'pages'),0)>0 then
   raise exception 'cad_build_guide_invalid' using errcode='22023',detail='pages_without_guide';
  end if;
  return new;
 end if;
 -- 2026-11-09: pages kept in bob.cad_guide_pages under the guide's content id.
 if guide ? 'store' then
  if guide->>'store' is distinct from 'pages' or coalesce(guide->>'guide_id','') !~ '^[0-9a-f]{64}$' or cardinality(stray)>0 then
   raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_store';
  end if;
  stored:=true; max_pages:=999; key_pattern:='^guide-[0-9]{1,3}$';
 end if;
 if jsonb_typeof(guide->'pages')<>'array' or jsonb_array_length(guide->'pages') not between 1 and max_pages then
  raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_pages';
 end if;
 for page in select value from jsonb_array_elements(guide->'pages') loop
  if jsonb_typeof(page)<>'object' or coalesce(page->>'key','') !~ key_pattern
    or page->>'key'=any(noted) or coalesce(page->>'sha256','') !~ '^[0-9a-f]{64}$' then
   raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_page_file';
  end if;
  if stored then
   if not exists(select 1 from bob.cad_guide_pages g where g.project_id=new.project_id and g.guide_id=guide->>'guide_id'
     and g.page_key=page->>'key' and g.sha256=page->>'sha256') then
    raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_page_not_stored';
   end if;
  elsif jsonb_typeof(new.files->(page->>'key'))<>'string'
    or encode(sha256(decode(new.files->>(page->>'key'),'base64')),'hex')<>page->>'sha256' then
   raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_page_file';
  end if;
  noted:=noted||(page->>'key');
 end loop;
 if not stored and stray is distinct from (select array_agg(k order by k) from unnest(noted) k) then
  raise exception 'cad_build_guide_invalid' using errcode='22023',detail='guide_files_without_notes';
 end if;
 return new;
end $$;
revoke all on function bob_private.validate_cad_build_guide() from public,anon,authenticated;

-- Volunteers: the pages of a stored guide, only for a drawing revision their
-- task's drawing scope already returns (the same rule as volunteer_drawing).
create or replace function bob_volunteer_private.volunteer_guide_pages(p_secret text,p_task text,p_drawing uuid,p_revision integer,p_keys text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare s bob.volunteer_sessions:=bob_volunteer_private.volunteer_session(p_secret); result jsonb; guide jsonb; project text;
begin
 if p_keys is null or cardinality(p_keys) not between 1 and 30 then raise exception 'cad_guide_pages_invalid' using errcode='22023'; end if;
 select d.project_id,cad.manifest->'build_guide' into project,guide
 from bob_volunteer_private.task_drawing_scope(s.project_id,p_task) d
 join bob.artifact_cad_revisions cad on cad.project_id=d.project_id and cad.artifact_id=d.artifact_id and cad.artifact_revision=d.revision
 where d.artifact_id=p_drawing and d.revision=p_revision and d.source_state<>'unavailable';
 if guide is null or guide->>'store' is distinct from 'pages' then
  raise exception 'Drawing unavailable or changed. Refresh the task to see its current drawings.' using errcode='42501'; end if;
 select jsonb_build_object('projectId',project,'taskId',p_task,'id',p_drawing,'revision',p_revision,
  'pages',coalesce(jsonb_object_agg(g.page_key,g.svg),'{}'::jsonb)) into result
 from bob.cad_guide_pages g
 where g.project_id=project and g.guide_id=guide->>'guide_id' and g.page_key=any(p_keys)
  and exists(select 1 from jsonb_array_elements(guide->'pages') n where n->>'key'=g.page_key and n->>'sha256'=g.sha256);
 return result;
end $$;
create or replace function bob.volunteer_guide_pages(p_secret text,p_task text,p_drawing uuid,p_revision integer,p_keys text[]) returns jsonb
language sql security invoker set search_path='' as $$ select bob_volunteer_private.volunteer_guide_pages(p_secret,p_task,p_drawing,p_revision,p_keys) $$;
revoke all on function bob_volunteer_private.volunteer_guide_pages(text,text,uuid,integer,text[]) from public,anon,authenticated,service_role;
grant execute on function bob_volunteer_private.volunteer_guide_pages(text,text,uuid,integer,text[]) to anon,authenticated,service_role;
revoke all on function bob.volunteer_guide_pages(text,text,uuid,integer,text[]) from public,anon,authenticated,service_role;
grant execute on function bob.volunteer_guide_pages(text,text,uuid,integer,text[]) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
