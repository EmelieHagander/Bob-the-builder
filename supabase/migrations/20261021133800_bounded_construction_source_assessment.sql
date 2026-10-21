-- Preserve exact source-status semantics while avoiding two repeated catalog joins.
-- The original two EXISTS scans of the material pin array are folded into one
-- bounded aggregate. The invoker's RLS and original base assessment remain in force.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function bob_private.artifact_source_assessment_before_construction_drawings(
  p_project text, p_artifact uuid, p_revision integer)
returns table(source_state text, source_reasons text[])
language plpgsql stable security invoker
set search_path = ''
set join_collapse_limit = 1
set from_collapse_limit = 1
as $$
declare
 c bob.artifact_construction_revisions;
 base_state text; reasons text[];
 changed boolean := false; unavailable boolean := false;
begin
 select s.source_state,s.source_reasons into base_state,reasons
 from bob_private.artifact_source_assessment_before_construction(p_project,p_artifact,p_revision) s;
 if not found then return; end if;
 select * into c from bob.artifact_construction_revisions
 where project_id=p_project and artifact_id=p_artifact and artifact_revision=p_revision;
 if not found then return query select base_state,reasons;return; end if;

 select coalesce(bool_or(material.id is null or
   (m->>'part_id' is not null and part.id is null)),false),
   coalesce(bool_or(material.id is not null and
   (material.current_revision is distinct from (m->>'material_revision')::integer
    or (m->>'part_id' is not null and part.current_revision is distinct from (m->>'part_revision')::integer))),false)
 into unavailable,changed
 from jsonb_array_elements(c.materials) m
 left join bob.catalog_items material on material.id=(m->>'material_id')::uuid
 left join bob.catalog_items part on part.id=(m->>'part_id')::uuid;
 if changed then reasons:=array_append(reasons,'construction_catalog_changed'); end if;

 if exists(select 1 from jsonb_array_elements(c.parameters->'nodes') n
   where n->>'role'='source' and n->'source'->>'kind'='space_measurement'
   and not exists(select 1 from bob.space_measurements m
     join bob.project_spaces s on s.id=m.space_id and s.project_id=p_project
     join bob.project_buildings b on b.id=m.building_id and b.project_id=p_project
     where m.id=(n->'source'->>'id')::uuid
       and m.space_revision=(n->'source'->>'space_revision')::integer
       and s.revision=m.space_revision and not s.archived and not b.archived)) then
  unavailable:=true;
  reasons:=array_append(reasons,'construction_physical_source_changed_or_unavailable');
 end if;
 if exists(select 1 from jsonb_array_elements(c.parameters->'frames') f
   where f->>'kind'='image' and not bob_private.cad_image_version_matches(
     p_project,substring(f->>'source_ref' from 7)::uuid,f->>'source_version')) then
  changed:=true;reasons:=array_append(reasons,'construction_image_changed');
 end if;
 return query select case when unavailable or base_state='unavailable' then 'unavailable'
   when changed or base_state='changed' then 'changed' else base_state end,reasons;
end $$;
revoke all on function bob_private.artifact_source_assessment_before_construction_drawings(text,uuid,integer) from public,anon,service_role;
grant execute on function bob_private.artifact_source_assessment_before_construction_drawings(text,uuid,integer) to authenticated;
commit;
