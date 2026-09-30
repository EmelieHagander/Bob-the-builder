begin;

-- Preserve the legacy image union for old clients and expose exact instruction
-- links separately. The existing capability/session and byte authorization do
-- not change. No Auth, shared-app, table, role or function ACL changes.
create or replace function bob_volunteer_private.volunteer_task(p_secret text, p_task text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s bob.volunteer_sessions := bob_volunteer_private.volunteer_session(p_secret);
  t bob.tasks;
  area_name text;
  steps jsonb;
  images jsonb;
  context_images jsonb;
begin
  select t0.* into t from bob.tasks t0
    where t0.id=p_task and t0.project_id=s.project_id;
  if not found then raise exception 'Task unavailable.' using errcode='42501'; end if;
  select name into area_name from bob.areas where id=t.area_id and project_id=s.project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',st.id,'title',st.title,'instructions',st.instructions,'required',st.required,
    'isCheckpoint',st.is_checkpoint,'completedAt',st.completed_at,'revision',st.revision,
    'images',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'purpose',m.purpose)
      order by m.created_at,m.id),'[]'::jsonb)
      from bob.media_assets m where m.project_id=s.project_id and m.state='ready'
        and exists(select 1 from bob.media_links l where l.project_id=s.project_id
          and l.media_id=m.id and l.step_id=st.id)))
    order by st.position,st.id),'[]'::jsonb) into steps
    from bob.task_steps st where st.project_id=s.project_id and st.task_id=t.id;

  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'purpose',m.purpose)
    order by m.created_at,m.id),'[]'::jsonb) into images from bob.media_assets m
    where m.project_id=s.project_id and m.state='ready' and exists(
      select 1 from bob.media_links l left join bob.task_steps st on st.id=l.step_id
        and st.project_id=s.project_id
      where l.project_id=s.project_id and l.media_id=m.id and (
        l.task_id=t.id or l.area_id=t.area_id or st.task_id=t.id
        or (l.plan_step_id=t.primary_step_id and exists(
          select 1 from bob.project_plans p join bob.project_plan_steps ps
            on ps.project_id=p.project_id and ps.plan_revision=p.current_revision
          where p.project_id=s.project_id and ps.step_id=t.primary_step_id))));

  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'purpose',m.purpose)
    order by m.created_at,m.id),'[]'::jsonb) into context_images from bob.media_assets m
    where m.project_id=s.project_id and m.state='ready' and exists(
      select 1 from bob.media_links l where l.project_id=s.project_id and l.media_id=m.id and (
        l.task_id=t.id or l.area_id=t.area_id
        or (l.plan_step_id=t.primary_step_id and exists(
          select 1 from bob.project_plans p join bob.project_plan_steps ps
            on ps.project_id=p.project_id and ps.plan_revision=p.current_revision
          where p.project_id=s.project_id and ps.step_id=t.primary_step_id))));

  return jsonb_build_object('projectId',s.project_id,'id',t.id,'name',t.name,'area',area_name,
    'instructions',t.instructions,'status',t.status,'updatedAt',t.updated_at,
    'mine',exists(select 1 from bob.task_assignees where task_id=t.id and person_id=s.person_id),
    'steps',steps,'images',images,'contextImages',context_images);
end;
$$;

commit;
