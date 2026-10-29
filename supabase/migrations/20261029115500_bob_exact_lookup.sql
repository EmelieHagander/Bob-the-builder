-- Exact artifact lookups for Bob (2026-10-29).
--
-- `bob.search_bob_project_data_v10` returns exactly what v9 returns. Only the
-- artifacts dataset is rewritten. v4, v6 and v7 joined the room-layout,
-- multifloor and stair detail views for every artifact record. Those are large
-- security-invoker views with per-row access checks: planning and evaluating
-- them took about 1-3 s for one plain box drawing (over the 8 s statement
-- timeout under shared load), although the box has none of those details.
--
-- Here each record is checked against the small base tables first. A detail
-- view is read only for a record that has that detail, keyed by project,
-- artifact and revision. A statement that never runs is never planned.
--
-- Semantics kept from the v9 chain for artifacts:
-- * v4: project access first (42501), then v3 (validation, records, related,
--   recipes, its own size trim); a record needs its revision row and artifact
--   row (the inner join on artifact_revision_details); has_room_layout and
--   room_layout; then the 30000-byte trim with related filtering.
-- * v6/v7: a record needs its artifact row; has_multifloor_plan and
--   has_stair_study from it; plan and stair details only for an exact record
--   read (p_record_id given), null otherwise.
-- Older execution journals keep calling v8/v9; new executions pin v10.
begin;

create function bob.search_bob_project_data_v10(
  p_project_id text,p_dataset text,p_query text default null,p_status text default null,p_area_id text default null,p_record_id text default null,p_after_id text default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; rows jsonb; links jsonb; n integer; item jsonb; aid uuid; rev integer;
  has_layout boolean; layout jsonb; flags record; plan jsonb; stair jsonb;
begin
  if p_dataset is distinct from 'artifacts' then
    return bob.search_bob_project_data_v9(p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id,p_after_id);
  end if;
  if not bob_private.has_project_access(p_project_id) then raise exception 'project_denied' using errcode='42501'; end if;
  result:=bob.search_bob_project_data_v3(p_project_id,p_dataset,p_query,p_status,p_area_id,p_record_id,p_after_id);

  -- v4: revision details (required) and room layout.
  rows:='[]'::jsonb;
  for item in select e.value from jsonb_array_elements(result->'records') with ordinality e(value,ord) order by e.ord loop
    -- Record ids are canonical uuid text; anything else matched nothing in v4 either.
    aid:=case when item->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (item->>'id')::uuid end;
    rev:=(item->>'revision')::integer;
    if not exists(select 1 from bob.artifact_revisions r join bob.artifacts h on h.id=r.artifact_id and h.project_id=r.project_id
      where r.project_id=p_project_id and r.artifact_id=aid and r.revision=rev) then continue; end if;
    has_layout:=exists(select 1 from bob.artifact_room_layouts l where l.artifact_id=aid and l.artifact_revision=rev);
    layout:=null;
    if has_layout then
      select to_jsonb(x) into layout from bob.artifact_room_layout_details x
        where x.project_id=p_project_id and x.artifact_id=aid and x.artifact_revision=rev;
    end if;
    rows:=rows||jsonb_build_array(item||jsonb_build_object('has_room_layout',has_layout,'room_layout',layout));
  end loop;
  result:=jsonb_set(result,'{records}',rows);
  while octet_length(result::text)>30000 loop
    n:=jsonb_array_length(result->'records');
    if n=0 then raise exception 'Research result too large' using errcode='22023'; end if;
    rows:=(result->'records')-(n-1);
    select coalesce(jsonb_agg(value),'[]'::jsonb) into links from jsonb_array_elements(result->'related')
      where value->>'parent_id' in(select r->>'id' from jsonb_array_elements(rows) r);
    result:=result||jsonb_build_object('records',rows,'related',links,'truncated',true,'next_cursor',rows->-1->>'id');
  end loop;

  -- v6 + v7: the artifact row (required), then plan/stair detail only for an exact read.
  rows:='[]'::jsonb;
  for item in select e.value from jsonb_array_elements(result->'records') with ordinality e(value,ord) order by e.ord loop
    aid:=case when item->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (item->>'id')::uuid end;
    rev:=(item->>'revision')::integer;
    select x.has_multifloor_plan,x.has_stair_study into flags from bob.artifacts x where x.id=aid and x.project_id=p_project_id;
    if not found then continue; end if;
    plan:=null; stair:=null;
    if p_record_id is not null then
      if exists(select 1 from bob.artifact_multifloor_plans m where m.artifact_id=aid and m.artifact_revision=rev) then
        select to_jsonb(x) into plan from bob.artifact_multifloor_details x
          where x.project_id=p_project_id and x.artifact_id=aid and x.artifact_revision=rev;
      end if;
      if exists(select 1 from bob.artifact_stair_studies s where s.artifact_id=aid and s.artifact_revision=rev) then
        select to_jsonb(x) into stair from bob.artifact_stair_details x
          where x.project_id=p_project_id and x.artifact_id=aid and x.artifact_revision=rev;
      end if;
    end if;
    rows:=rows||jsonb_build_array(item
      ||jsonb_build_object('has_multifloor_plan',flags.has_multifloor_plan,'multifloor_plan',plan)
      ||jsonb_build_object('has_stair_study',flags.has_stair_study,'stair_study',stair));
  end loop;
  return jsonb_set(result,'{records}',rows);
end $$;
revoke all on function bob.search_bob_project_data_v10(text,text,text,text,text,text,text) from public,anon;
grant execute on function bob.search_bob_project_data_v10(text,text,text,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
