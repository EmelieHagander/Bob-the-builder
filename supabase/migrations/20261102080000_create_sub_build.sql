-- Owner decision 2026-11-02: Bob decides where a build belongs and makes its
-- sub-build in the room; Konrad decides how it is built and saves its
-- constructions inside. A sub-build can now start empty: a shell with no
-- pieces yet. Pieces are still added through bob.cad_shell_command.
-- Needs 20261101220000_build_tree.sql.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Creates an empty sub-build and places it. The same title in the same place
-- returns the existing sub-build, so a repeated request does not make a twin.
create function bob.create_sub_build(p_project text,p_title text,p_description text,p_parent uuid,p_space uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare new_id uuid; existing uuid; saved jsonb; rev integer; target integer;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 if char_length(btrim(coalesce(p_title,''))) not between 1 and 200 or char_length(btrim(coalesce(p_description,''))) not between 1 and 2000 then raise exception 'build_invalid' using errcode='22023'; end if;
 perform 1 from bob.projects where id=p_project for no key update;
 select a.id into existing from bob.artifacts a
  join bob.artifact_revisions r on r.artifact_id=a.id and r.revision=a.current_revision and not r.archived
  join bob.artifact_cad_shell_revisions s on s.artifact_id=a.id and s.artifact_revision=a.current_revision
  left join bob.build_placements p on p.artifact_id=a.id
  where a.project_id=p_project and lower(btrim(r.title))=lower(btrim(p_title))
   and p.parent_id is not distinct from p_parent and p.space_id is not distinct from p_space
  order by a.id limit 1;
 if existing is not null then
  return jsonb_build_object('status','exists','id',existing,'kind','sub_build','parent_id',p_parent,'space_id',p_space);
 end if;
 select current_revision into target from bob.project_targets where project_id=p_project;
 new_id:=gen_random_uuid();
 saved:=bob_private.artifact_command(p_project,'create',new_id,0,jsonb_build_object('title',btrim(p_title),'description',btrim(p_description),'assumptions','',
  'kind','plan','status','concept','target_revision',target,'measurements','[]'::jsonb,'area_id',null,'source_media_id',null));
 rev:=(saved->>'revision')::integer;
 insert into bob.artifact_cad_shell_revisions values(p_project,new_id,rev);
 if p_parent is not null or p_space is not null then perform bob.place_build(p_project,new_id,p_parent,p_space); end if;
 return jsonb_build_object('status','saved','id',new_id,'kind','sub_build','revision',rev,'parent_id',p_parent,'space_id',p_space,
  'place',case when p_parent is not null then 'sub_build' when p_space is not null then 'room' else 'workshop' end);
end $$;
revoke all on function bob.create_sub_build(text,text,text,uuid,uuid) from public,anon;
grant execute on function bob.create_sub_build(text,text,text,uuid,uuid) to authenticated;
commit;
