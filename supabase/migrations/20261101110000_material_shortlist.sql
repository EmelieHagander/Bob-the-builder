-- A compact list of the materials a project can use (owner decision 2026-11-01).
--
-- The structural designer names what he needs in words; a small model matches
-- those words against this list and answers with item IDs only. Code then
-- copies each item's own values from the list, so no model retypes catalog
-- facts. One row per material of the shared catalog and of this project, at
-- its current revision: id, revision, name, profile, fastener kind (if any),
-- whether it is the project's own, and its stated sizes as text.
-- Read-only. SECURITY DEFINER because material types are not readable by
-- users directly; the caller's project access is checked first.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob.read_material_shortlist(p_project text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(x.row order by x.own, x.name, x.id) from (
  select i.project_id is not null own, r.name, i.id,
   jsonb_build_object('id',i.id,'revision',r.revision,'name',r.name,'profile',r.profile_code,'fastener',t.fastener_kind,'own',i.project_id is not null,
    'sizes',(select coalesce(jsonb_object_agg(k,(r.properties->k->>'value')||coalesce(' '||(r.properties->k->>'unit'),'')),'{}'::jsonb)
     from unnest(array['thickness','width','diameter','length','nominal_size','volume']) k where r.properties->k->>'value' is not null)) row
  from bob.catalog_items i
  join bob.catalog_item_revisions r on r.item_id=i.id and r.revision=i.current_revision
  left join bob.material_types t on t.id=i.material_type_id
  where i.kind='material' and (i.project_id is null or i.project_id=p_project)
  order by i.project_id nulls first, r.name, i.id
  limit 400) x),'[]'::jsonb);
end $$;
revoke all on function bob.read_material_shortlist(text) from public,anon,service_role;
grant execute on function bob.read_material_shortlist(text) to authenticated;

commit;
