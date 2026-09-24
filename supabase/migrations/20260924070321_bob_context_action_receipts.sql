-- Compact actual action state alongside verbatim chat and the older brief.
-- Same service-only claim guard; no cross-thread history or record payloads.
begin;
create or replace function bob.bob_load_context(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  recent jsonb; current_message jsonb; older jsonb:='[]'::jsonb;
  cutoff bigint; folded bigint; through_seq bigint; memo text; r record; chars int:=0;
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  insert into bob_private.bob_thread_summary(thread_id) values(p_thread) on conflict do nothing;
  select last_folded_seq,summary into folded,memo from bob_private.bob_thread_summary where thread_id=p_thread;
  select jsonb_build_object('seq',seq,'role',role,'text',text,'state',delivery_state) into current_message
    from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  select coalesce(jsonb_agg(item order by seq),'[]'::jsonb),min(seq) into recent,cutoff from (
    select seq,jsonb_build_object('seq',seq,'role',role,'text',text,'state',delivery_state) item
    from bob.bob_messages where thread_id=p_thread and not(turn_id=p_turn and role='user')
    order by seq desc limit 4
  ) t;
  recent:=recent||jsonb_build_array(current_message);
  cutoff:=coalesce(cutoff,(current_message->>'seq')::bigint);
  through_seq:=folded;
  for r in select seq,role,text,delivery_state from bob.bob_messages
    where thread_id=p_thread and seq>folded and seq<cutoff and not(turn_id=p_turn and role='user')
    order by seq limit 16 loop
    -- Never cut a message in half, even for a legacy long answer. One row is at
    -- most 100k characters by the transcript constraint; later rows stay bounded.
    exit when chars>0 and chars+char_length(r.text)>60000;
    older:=older||jsonb_build_array(jsonb_build_object('seq',r.seq,'role',r.role,'text',r.text,'state',r.delivery_state));
    chars:=chars+char_length(r.text); through_seq:=r.seq;
  end loop;
  return jsonb_build_object('projectId',p_project,'threadId',p_thread,'generation',p_generation,
    'recentWrites',coalesce((select jsonb_agg(x.item order by x.created_at) from (
      select w.receipt - 'record' as item,w.created_at
      from bob_private.bob_write_receipts w
      where w.project_id=p_project and w.actor_id=p_user and w.turn_id<>p_turn
        and exists(select 1 from bob.bob_messages m where m.thread_id=p_thread and m.turn_id=w.turn_id)
      order by w.created_at desc,w.operation_key limit 16
    ) x),'[]'::jsonb),
    'summary',memo,'lastFoldedSeq',folded,'recent',recent,'older',older,'foldThroughSeq',through_seq,
    'hasMore',exists(select 1 from bob.bob_messages where thread_id=p_thread and seq>through_seq and seq<cutoff and not(turn_id=p_turn and role='user')));
end $$;
revoke all on function bob.bob_load_context(text,uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function bob.bob_load_context(text,uuid,uuid,uuid,bigint) to service_role;

commit;
