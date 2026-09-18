-- Thread-scoped working context, not project truth or cross-session memory.
-- Reset's existing thread FK cascade removes the summary as well as originals.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table bob_private.bob_thread_summary (
  thread_id uuid primary key references bob.bob_threads(id) on delete cascade,
  last_folded_seq bigint not null default 0 check(last_folded_seq>=0),
  summary text not null default '' check(char_length(summary)<=12000),
  updated_at timestamptz not null default clock_timestamp()
);
alter table bob_private.bob_thread_summary enable row level security;
revoke all on bob_private.bob_thread_summary from public,anon,authenticated;

create function bob_private.bob_assert_context_claim(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint)
returns void language plpgsql security definer set search_path='' as $$
declare s bob_private.bob_thread_provider_state;
begin
  perform bob_private.bob_assert_server_actor(p_project,p_user);
  perform pg_advisory_xact_lock(hashtextextended(p_project||':'||p_user::text,0));
  perform 1 from bob.bob_threads where id=p_thread and project_id=p_project and owner_user_id=p_user and status='active' for update;
  if not found then raise exception 'project_denied' using errcode='42501'; end if;
  select * into s from bob_private.bob_thread_provider_state where thread_id=p_thread for update;
  if not found or s.generation is distinct from p_generation or s.in_flight_turn_id is distinct from p_turn
    or s.lock_started_at < clock_timestamp()-interval '5 minutes'
    or not exists(select 1 from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user' and delivery_state='pending') then
    raise exception 'turn_not_claimed' using errcode='40001';
  end if;
  perform bob_private.bob_assert_server_actor(p_project,p_user);
end $$;
revoke all on function bob_private.bob_assert_context_claim(text,uuid,uuid,uuid,bigint) from public,anon,authenticated;

-- Four latest previous messages, plus the current request in full. No character
-- slicing of T1. An older failed request retried later is still the final input.
-- T2 folds only the prefix before T1, incrementally from a durable high-water mark.
create function bob.bob_load_context(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint)
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
    'summary',memo,'lastFoldedSeq',folded,'recent',recent,'older',older,'foldThroughSeq',through_seq,
    'hasMore',exists(select 1 from bob.bob_messages where thread_id=p_thread and seq>through_seq and seq<cutoff and not(turn_id=p_turn and role='user')));
end $$;
revoke all on function bob.bob_load_context(text,uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function bob.bob_load_context(text,uuid,uuid,uuid,bigint) to service_role;

-- Compare-and-swap prevents stale summarizers advancing a new turn/reset. The
-- exact chunk boundary is recomputed, so the server cannot accidentally skip rows.
create function bob.bob_save_context_summary(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_expected_seq bigint,p_through_seq bigint,p_summary text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare frame jsonb;
begin
  frame:=bob.bob_load_context(p_project,p_user,p_thread,p_turn,p_generation);
  if p_summary is null or char_length(btrim(p_summary)) not between 1 and 12000
    or p_expected_seq is distinct from (frame->>'lastFoldedSeq')::bigint
    or p_through_seq is distinct from (frame->>'foldThroughSeq')::bigint
    or p_through_seq<=p_expected_seq or jsonb_array_length(frame->'older')=0 then
    raise exception 'context_changed' using errcode='40001';
  end if;
  update bob_private.bob_thread_summary set summary=p_summary,last_folded_seq=p_through_seq,updated_at=clock_timestamp() where thread_id=p_thread;
  return jsonb_build_object('lastFoldedSeq',p_through_seq);
end $$;
revoke all on function bob.bob_save_context_summary(text,uuid,uuid,uuid,bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function bob.bob_save_context_summary(text,uuid,uuid,uuid,bigint,bigint,bigint,text) to service_role;

-- Verbatim T3 retrieval, bound to this caller's exact active thread and claim.
-- It exposes neither other members' chats nor provider ids/evidence/usage data.
create function bob.bob_search_context_history(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_query text,p_before_seq bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; rows jsonb:='[]'::jsonb; chars int:=0; more boolean:=false; cursor bigint;
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  if p_query is null or char_length(p_query)>200 or (p_before_seq is not null and p_before_seq<1) then
    raise exception 'invalid_history_search' using errcode='22023';
  end if;
  for r in select seq,role,text,delivery_state from bob.bob_messages where thread_id=p_thread
    and not(turn_id=p_turn and role='user') and (p_before_seq is null or seq<p_before_seq)
    and position(lower(p_query) in lower(text))>0 order by seq desc limit 6 loop
    if jsonb_array_length(rows)>=5 or (chars>0 and chars+char_length(r.text)>60000) then more:=true; exit; end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('seq',r.seq,'role',r.role,'text',r.text,'state',r.delivery_state));
    chars:=chars+char_length(r.text); cursor:=r.seq;
  end loop;
  return jsonb_build_object('projectId',p_project,'threadId',p_thread,'messages',rows,'truncated',more,'nextBeforeSeq',case when more then cursor else null end);
end $$;
revoke all on function bob.bob_search_context_history(text,uuid,uuid,uuid,bigint,text,bigint) from public,anon,authenticated;
grant execute on function bob.bob_search_context_history(text,uuid,uuid,uuid,bigint,text,bigint) to service_role;
notify pgrst,'reload schema';
commit;
