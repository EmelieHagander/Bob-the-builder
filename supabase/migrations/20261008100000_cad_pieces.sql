-- 2026-10-08: large builds (a room, a house) are split into pieces. Each piece is
-- an ordinary drawing request with its own budget. Releasing a piece marks one
-- unseen drawing event for it, so the existing queue designs and saves the pieces
-- one at a time after the turn. A failed piece no longer stops the others.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob.release_drawing_pieces(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare rev bigint; released jsonb;
begin
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 if p_ids is null or cardinality(p_ids) not between 1 and 12 then raise exception 'invalid_drawing_pieces' using errcode='22023'; end if;
 insert into bob_private.drawing_project_events(project_id) values(p_project) on conflict(project_id) do nothing;
 select revision into rev from bob_private.drawing_project_events where project_id=p_project;
 -- Only fresh, never-designed pieces this turn created. Failed or older requests
 -- keep waiting for real new data, as before.
 with r as (
  update bob_private.project_drawing_requests set observed_event=least(observed_event,rev-1)
  where id=any(p_ids) and project_id=p_project and owner_user_id=p_user and thread_id=p_thread and origin_turn_id=p_turn and status='collecting'
  returning id)
 select coalesce(jsonb_agg(id order by id),'[]') into released from r;
 return jsonb_build_object('released',released);
end $$;
revoke all on function bob.release_drawing_pieces(text,uuid,uuid,uuid,bigint,uuid[]) from public,anon,authenticated;
grant execute on function bob.release_drawing_pieces(text,uuid,uuid,uuid,bigint,uuid[]) to service_role;

insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values('plan_cad_pieces',
 'Split a large build into separately designed and saved drawing pieces.',
 'Use instead of design_project_cad when one drawing would need more than about 24 parts or several structural systems (walls, floor, roof, stairs, built-in furniture). Give 2-12 pieces, each with a complete standalone brief and handoff in one shared coordinate system. Pieces are designed one at a time after your reply while the owner has Bob open; each saved piece appears in the conversation. Tell the owner the pieces and that they arrive one by one. A failed piece can be resumed alone by its request_id. Saved pieces are concepts, not measured truth or structural approval.',
 1,false,array['design'],true);
commit;
