-- Owner decision 2026-10-30: Bob's conversation memory becomes a stair of
-- summaries that are written once, and the project's main state is locked high
-- in the prompt. Until now one summary per thread was rewritten almost every
-- turn and the project briefing changed every turn, so little of a turn's input
-- could be reused from the previous one.
--
-- - bob_thread_memory: the project snapshot locked for the thread (name, phase,
--   plan steps as a checklist, areas and their phases). It is taken at the
--   thread's first managed turn and again whenever a summary is saved; main
--   changes in between reach Bob as events in the history.
-- - bob_thread_memory_summaries: summaries with their exact message range
--   (source). Level 2 summarizes a chunk of messages, level 1 merges level-2
--   summaries, level 0 merges level-1 summaries. A merged summary supersedes the
--   ones it covers; nothing is rewritten in place.
-- - Events are read from the existing phase_history and project_plan_revisions:
--   one immutable event per phase change, per plan revision and per decision.
-- The old single rewritten summary stays for pinned jobs.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table bob_private.bob_thread_memory (
  thread_id uuid primary key references bob.bob_threads(id) on delete cascade,
  snapshot jsonb not null,
  snapshot_locked_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create table bob_private.bob_thread_memory_summaries (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references bob.bob_threads(id) on delete cascade,
  level smallint not null check(level between 0 and 2),
  seq_from bigint not null check(seq_from>0),
  seq_to bigint not null check(seq_to>=seq_from),
  text text not null check(char_length(btrim(text)) between 1 and 4000),
  created_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz
);
create index bob_thread_memory_summaries_active_idx on bob_private.bob_thread_memory_summaries(thread_id,seq_from) where superseded_at is null;
alter table bob_private.bob_thread_memory enable row level security;
alter table bob_private.bob_thread_memory_summaries enable row level security;
revoke all on bob_private.bob_thread_memory,bob_private.bob_thread_memory_summaries from public,anon,authenticated;

-- The project's main state only: what the checklist and the phase say. Details
-- stay in the project records Bob reads with his tools. jsonb gives a stable
-- key order, so an unchanged project yields the same bytes.
create function bob_private.bob_memory_snapshot(p_project text) returns jsonb
 language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'project',(select jsonb_build_object('name',p.name,'type',p.type,'location',p.location,'phase',p.phase,'description',left(coalesce(p.description,''),2000))
    from bob.projects p where p.id=p_project),
  'plan',(select jsonb_build_object('revision',pl.current_revision,
     'status',(select r.status from bob.project_plan_revisions r where r.project_id=p_project and r.revision=pl.current_revision),
     'steps',coalesce((select jsonb_agg(jsonb_build_object('position',s.position,'title',s.title,'phase',s.phase,'state',s.state,
        'area',(select a.name from bob.areas a where a.id=s.area_id)) order by s.position)
      from bob.project_plan_steps s where s.project_id=p_project and s.plan_revision=pl.current_revision),'[]'::jsonb))
    from bob.project_plans pl where pl.project_id=p_project),
  'areas',coalesce((select jsonb_agg(jsonb_build_object('name',a.name,'phase',a.phase) order by a.sort_order nulls last,a.name)
    from bob.areas a where a.project_id=p_project and a.archived_at is null),'[]'::jsonb))
$$;

-- Main changes since the snapshot, oldest first. Each event is immutable, so a
-- later turn only appends to what an earlier turn saw.
create function bob_private.bob_memory_events(p_project text,p_since timestamptz) returns jsonb
 language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(e.item order by e.at,e.ord),'[]'::jsonb) from (
  select h.recorded_at at,1 ord,jsonb_build_object('at',h.recorded_at,'kind',h.scope_kind||'_phase','from',h.from_phase,'to',h.to_phase,
    'area',(select a.name from bob.areas a where a.id=h.area_id),'reason',left(coalesce(h.reason,''),300),'by',h.actor_label) item
   from bob.phase_history h where h.project_id=p_project and h.recorded_at>p_since
  union all
  select r.created_at,2,jsonb_build_object('at',r.created_at,'kind','plan_revision','revision',r.revision,'summary',left(coalesce(r.summary,''),300))
   from bob.project_plan_revisions r where r.project_id=p_project and r.created_at>p_since
  union all
  select r.decided_at,3,jsonb_build_object('at',r.decided_at,'kind','plan_decision','revision',r.revision,'status',r.status)
   from bob.project_plan_revisions r where r.project_id=p_project and r.decided_at is not null and r.decided_at>p_since
  order by 1,2 limit 60
 ) e
$$;
revoke all on function bob_private.bob_memory_snapshot(text),bob_private.bob_memory_events(text,timestamptz) from public,anon,authenticated;

-- The current request, the locked snapshot, the active summaries, every later
-- message (bounded) and the events since the snapshot. The first call for a
-- thread locks its snapshot.
create function bob.bob_load_memory_stair(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m bob_private.bob_thread_memory; current_message jsonb; summarized bigint; raw jsonb:='[]'::jsonb; r record; chars int:=0; more boolean:=false;
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  insert into bob_private.bob_thread_memory(thread_id,snapshot) values(p_thread,bob_private.bob_memory_snapshot(p_project)) on conflict do nothing;
  select * into m from bob_private.bob_thread_memory where thread_id=p_thread;
  -- Events are capped at 60, oldest first; at the cap the snapshot is locked
  -- again so no later change is left out.
  if jsonb_array_length(bob_private.bob_memory_events(p_project,m.snapshot_locked_at))>=60 then
    update bob_private.bob_thread_memory set snapshot=bob_private.bob_memory_snapshot(p_project),snapshot_locked_at=clock_timestamp(),updated_at=clock_timestamp()
     where thread_id=p_thread returning * into m;
  end if;
  select jsonb_build_object('seq',seq,'role',role,'text',text,'state',delivery_state) into current_message
    from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  select coalesce(max(seq_to),0) into summarized from bob_private.bob_thread_memory_summaries where thread_id=p_thread and superseded_at is null;
  for r in select seq,role,text,delivery_state,created_at from bob.bob_messages
    where thread_id=p_thread and seq>summarized and not(turn_id=p_turn and role='user') order by seq limit 201 loop
    if jsonb_array_length(raw)>=200 or (chars>0 and chars+char_length(r.text)>200000) then more:=true; exit; end if;
    raw:=raw||jsonb_build_array(jsonb_build_object('seq',r.seq,'role',r.role,'text',r.text,'state',r.delivery_state,'createdAt',r.created_at));
    chars:=chars+char_length(r.text);
  end loop;
  return jsonb_build_object('projectId',p_project,'threadId',p_thread,'generation',p_generation,
    'snapshot',m.snapshot,'snapshotLockedAt',m.snapshot_locked_at,'summarizedThroughSeq',summarized,
    'summaries',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'level',s.level,'seqFrom',s.seq_from,'seqTo',s.seq_to,'text',s.text) order by s.seq_from)
      from bob_private.bob_thread_memory_summaries s where s.thread_id=p_thread and s.superseded_at is null),'[]'::jsonb),
    'raw',raw,'hasMore',more,'current',current_message,
    'events',bob_private.bob_memory_events(p_project,m.snapshot_locked_at),
    'recentWrites',coalesce((select jsonb_agg(x.item order by x.created_at) from (
      select w.receipt - 'record' as item,w.created_at
      from bob_private.bob_write_receipts w
      where w.project_id=p_project and w.actor_id=p_user and w.turn_id<>p_turn
        and exists(select 1 from bob.bob_messages m2 where m2.thread_id=p_thread and m2.turn_id=w.turn_id)
      order by w.created_at desc,w.operation_key limit 16
    ) x),'[]'::jsonb),
    'recentSources',coalesce((select jsonb_agg(jsonb_build_object('dataset',s->>'dataset','recordId',s->>'recordId','label',left(s->>'label',200)))
      from (select m3.evidence from bob.bob_messages m3 where m3.thread_id=p_thread and m3.role='assistant' and m3.delivery_state='completed'
        and m3.turn_id<>p_turn order by m3.seq desc limit 1) last_reply,
      lateral (select value s from jsonb_array_elements(case when jsonb_typeof(last_reply.evidence->'sources')='array' then last_reply.evidence->'sources' else '[]'::jsonb end) limit 24) src
      where s->>'dataset' is not null and s->>'recordId' is not null and s->>'label' is not null),'[]'::jsonb));
end $$;

-- Append a chunk summary (level 2) right after the last summarized message, or
-- merge the active summaries of the level below (level 1 merges level 2; level
-- 0 merges levels 0 and 1). The covered range is exact and contiguous; the
-- snapshot is locked again, so events up to now are folded into it.
create function bob.bob_save_memory_summary(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,
  p_level integer,p_seq_from bigint,p_seq_to bigint,p_text text,p_supersede uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare summarized bigint; current_seq bigint; expected uuid[]; lo bigint; hi bigint;
begin
  perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
  if p_text is null or char_length(btrim(p_text)) not between 1 and 4000 or p_level not between 0 and 2 then
    raise exception 'memory_summary_invalid' using errcode='22023'; end if;
  select coalesce(max(seq_to),0) into summarized from bob_private.bob_thread_memory_summaries where thread_id=p_thread and superseded_at is null;
  select seq into current_seq from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user';
  if p_level=2 then
    if coalesce(cardinality(p_supersede),0)<>0 or p_seq_from is distinct from summarized+1 or p_seq_to<p_seq_from or p_seq_to>=current_seq
      or not exists(select 1 from bob.bob_messages where thread_id=p_thread and seq=p_seq_to) then
      raise exception 'memory_changed' using errcode='40001'; end if;
  else
    select array_agg(id order by id),min(seq_from),max(seq_to) into expected,lo,hi from bob_private.bob_thread_memory_summaries
     where thread_id=p_thread and superseded_at is null and (case when p_level=1 then level=2 else level in (0,1) end);
    if expected is null or cardinality(expected)<2 or (select array_agg(x order by x) from unnest(p_supersede) x) is distinct from expected
      or p_seq_from is distinct from lo or p_seq_to is distinct from hi then
      raise exception 'memory_changed' using errcode='40001'; end if;
    update bob_private.bob_thread_memory_summaries set superseded_at=clock_timestamp() where id=any(expected);
  end if;
  insert into bob_private.bob_thread_memory_summaries(thread_id,level,seq_from,seq_to,text) values(p_thread,p_level,p_seq_from,p_seq_to,btrim(p_text));
  update bob_private.bob_thread_memory set snapshot=bob_private.bob_memory_snapshot(p_project),snapshot_locked_at=clock_timestamp(),updated_at=clock_timestamp()
   where thread_id=p_thread;
  return bob.bob_load_memory_stair(p_project,p_user,p_thread,p_turn,p_generation);
end $$;
revoke all on function bob.bob_load_memory_stair(text,uuid,uuid,uuid,bigint),
  bob.bob_save_memory_summary(text,uuid,uuid,uuid,bigint,integer,bigint,bigint,text,uuid[]) from public,anon,authenticated;
grant execute on function bob.bob_load_memory_stair(text,uuid,uuid,uuid,bigint),
  bob.bob_save_memory_summary(text,uuid,uuid,uuid,bigint,integer,bigint,bigint,text,uuid[]) to service_role;
commit;
