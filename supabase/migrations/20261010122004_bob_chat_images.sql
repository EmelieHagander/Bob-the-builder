-- Private logical-turn image pointers. Originals remain in project media.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table bob.bob_messages add column image_ids uuid[];
alter table bob.bob_messages add constraint bob_message_images_shape check (
 image_ids is null or (role='user' and cardinality(image_ids)<=4
  and coalesce(array_ndims(image_ids),1)=1 and array_position(image_ids,null) is null)
);

create function bob_private.bind_turn_images(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_images uuid[])
returns uuid[] language plpgsql security definer set search_path='' as $$
declare m bob.bob_messages; captured uuid[];
begin
 perform bob_private.bob_assert_server_actor(p_project,p_user);
 if not exists(select 1 from bob.bob_threads where id=p_thread and project_id=p_project
  and owner_user_id=p_user and status='active') then raise exception 'project_denied' using errcode='42501'; end if;
 if p_images is not null and (cardinality(p_images)>4 or coalesce(array_ndims(p_images),1)<>1
  or array_position(p_images,null) is not null or cardinality(p_images)<>(select count(distinct id) from unnest(p_images) id)) then
  raise exception 'invalid_images' using errcode='22023';
 end if;
 select * into m from bob.bob_messages where thread_id=p_thread and turn_id=p_turn and role='user' for update;
 if not found then raise exception 'turn_not_claimed' using errcode='42501'; end if;
 captured:=m.image_ids;
 if captured is null then
  captured:=coalesce(p_images,'{}'::uuid[]);
  if cardinality(captured)>0 and m.delivery_state<>'pending' then raise exception 'turn_images_changed' using errcode='22023'; end if;
  perform 1 from bob.media_assets where project_id=p_project and state='ready' and id=any(captured) for share;
  if (select count(*) from bob.media_assets where project_id=p_project and state='ready' and id=any(captured))<>cardinality(captured) then
   raise exception 'image_unavailable' using errcode='22023';
  end if;
  update bob.bob_messages set image_ids=captured where id=m.id;
 elsif p_images is not null and captured is distinct from p_images then
  raise exception 'turn_images_changed' using errcode='22023';
 end if;
 return captured;
end $$;
revoke all on function bob_private.bind_turn_images(text,uuid,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;

create function bob_private.capture_turn_images(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_images uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform bob_private.bob_assert_context_claim(p_project,p_user,p_thread,p_turn,p_generation);
 return jsonb_build_object('imageIds',bob_private.bind_turn_images(p_project,p_user,p_thread,p_turn,p_images));
end $$;
create function bob.bob_capture_turn_images(p_project text,p_user uuid,p_thread uuid,p_turn uuid,p_generation bigint,p_images uuid[])
returns jsonb language sql security invoker set search_path='' as $$
 select bob_private.capture_turn_images(p_project,p_user,p_thread,p_turn,p_generation,p_images)
$$;
revoke all on function bob_private.capture_turn_images(text,uuid,uuid,uuid,bigint,uuid[]),bob.bob_capture_turn_images(text,uuid,uuid,uuid,bigint,uuid[]) from public,anon,authenticated;
grant execute on function bob_private.capture_turn_images(text,uuid,uuid,uuid,bigint,uuid[]),bob.bob_capture_turn_images(text,uuid,uuid,uuid,bigint,uuid[]) to service_role;

-- Enqueue and image binding commit together before any worker can see the job.
-- v1/v2 callers retain their original text-only request shape.
create function bob_private.enqueue_job_with_images(p_project text,p_user uuid,p_turn uuid,p_message text,p_credential jsonb,p_expires timestamptz,p_worker_url text,p_screen jsonb,p_images uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; thread uuid;
begin
 perform bob_private.bob_assert_server_actor(p_project,p_user);
 perform pg_advisory_xact_lock(hashtextextended(p_project||':'||p_user::text,0));
 result:=bob.bob_enqueue_job_v2(p_project,p_user,p_turn,p_message,p_credential,p_expires,p_worker_url,p_screen);
 if result->>'status' in ('accepted','completed') then
  select t.id into thread from bob.bob_threads t join bob.bob_messages m on m.thread_id=t.id
   where t.project_id=p_project and t.owner_user_id=p_user and t.status='active' and m.turn_id=p_turn and m.role='user';
  result:=result||jsonb_build_object('imageIds',bob_private.bind_turn_images(p_project,p_user,thread,p_turn,p_images));
 end if;
 return result;
end $$;
create function bob.bob_enqueue_job_v3(p_project text,p_user uuid,p_turn uuid,p_message text,p_credential jsonb,p_expires timestamptz,p_worker_url text,p_screen jsonb,p_images uuid[])
returns jsonb language sql security invoker set search_path='' as $$
 select bob_private.enqueue_job_with_images(p_project,p_user,p_turn,p_message,p_credential,p_expires,p_worker_url,p_screen,p_images)
$$;
revoke all on function bob_private.enqueue_job_with_images(text,uuid,uuid,text,jsonb,timestamptz,text,jsonb,uuid[]),bob.bob_enqueue_job_v3(text,uuid,uuid,text,jsonb,timestamptz,text,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function bob_private.enqueue_job_with_images(text,uuid,uuid,text,jsonb,timestamptz,text,jsonb,uuid[]),bob.bob_enqueue_job_v3(text,uuid,uuid,text,jsonb,timestamptz,text,jsonb,uuid[]) to service_role;

notify pgrst,'reload schema';
commit;
