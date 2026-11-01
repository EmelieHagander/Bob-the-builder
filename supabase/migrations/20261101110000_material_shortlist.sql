-- A compact list of the materials a project can use (owner decision 2026-11-01).
--
-- The structural designer names what he needs in words; a small model matches
-- those words against this list and answers with item IDs only. Code then
-- copies each item's own values from the list, so no model retypes catalog
-- facts. One row per material of the shared catalog and of this project, at
-- its current revision: id, revision, name, profile, fastener kind (if any,
-- from bob_private.joint_fastener_item),
-- whether it is the project's own, and its stated sizes and grade as text.
-- At most 500 rows, the project's own first; complete=false says it was cut.
-- Read-only. SECURITY DEFINER because material types are not readable by
-- users directly; the caller's project access is checked first.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob.read_material_shortlist(p_project text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb;
begin
 if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 -- The project's own items first, so a cut list never drops them; one row past
 -- the limit says the list is cut.
 select coalesce(jsonb_agg(x.row order by x.own desc, x.name, x.id),'[]'::jsonb) into items from (
  select i.project_id is not null own, r.name, i.id,
   jsonb_build_object('id',i.id,'revision',r.revision,'name',r.name,'profile',r.profile_code,'fastener',bob_private.joint_fastener_item(i.id,r.revision)->>'kind','own',i.project_id is not null,
    'sizes',(select coalesce(jsonb_object_agg(k,(r.properties->k->>'value')||coalesce(' '||(r.properties->k->>'unit'),'')),'{}'::jsonb)
     from unnest(array['thickness','width','diameter','length','nominal_size','volume','grade']) k where r.properties->k->>'value' is not null)) row
  from bob.catalog_items i
  join bob.catalog_item_revisions r on r.item_id=i.id and r.revision=i.current_revision
  where i.kind='material' and (i.project_id is null or i.project_id=p_project)
  order by i.project_id is not null desc, r.name, i.id
  limit 501) x;
 return jsonb_build_object('items',case when jsonb_array_length(items)>500 then items-500 else items end,'complete',jsonb_array_length(items)<=500);
end $$;
revoke all on function bob.read_material_shortlist(text) from public,anon,service_role;
grant execute on function bob.read_material_shortlist(text) to authenticated;

commit;
