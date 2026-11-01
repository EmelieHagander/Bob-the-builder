begin;
set local lock_timeout='5s';
do $$ begin
 if (select count(*) from bob.materials where project_id='p_bygga_in_entren')<>71
 or (select count(*) from bob.materials where project_id='p_bygga_in_entren' and id like 'tool\_entre\_%')<>33
 or exists(select 1 from bob.material_requirement_shopping s join bob.materials m on m.id=s.material_id where m.project_id='p_bygga_in_entren')
 or exists(select 1 from bob.pack_purchases x join bob.materials m on m.id=x.material_id where m.project_id='p_bygga_in_entren')
 or exists(select 1 from bob.cut_plan_purchase_groups x join bob.materials m on m.id=x.material_id where m.project_id='p_bygga_in_entren')
 or exists(select 1 from bob.task_needs where task_id='t_entre_tools_check')
 or exists(select 1 from bob.task_readiness_reviews where task_id='t_entre_tools_check')
 then raise exception 'state changed - stop'; end if; end $$;
-- 1. The tools checklist becomes tool needs of the existing checklist task.
insert into bob.task_needs(id,project_id,task_id,kind,label,notes,created_by,updated_by,actor_label)
select gen_random_uuid(),m.project_id,'t_entre_tools_check','tool',m.name,
       concat_ws(' · ',nullif(m.qty,''),nullif(m.supplier,'')),p.auth_user_id,p.auth_user_id,p.name
from bob.materials m join bob.people p on p.project_id=m.project_id and p.id='u_8b8f311cff394c6b9d0ff1718738d6c5'
where m.project_id='p_bygga_in_entren' and m.id like 'tool\_entre\_%' order by m.sort_order;
delete from bob.materials where project_id='p_bygga_in_entren' and id like 'tool\_entre\_%';
-- 2. Duplicate of the two reused windows (registered as existing parts).
delete from bob.materials where project_id='p_bygga_in_entren' and id='m_entre_001';
-- 3. Amounts the construction and material list will produce.
delete from bob.materials where project_id='p_bygga_in_entren' and id in
 ('m_entre_004','m_entre_007','m_entre_008','m_entre_016','m_entre_017','m_entre_018','m_entre_021','m_entre_027','m_entre_029','m_entre_033');
do $$ begin
 if (select count(*) from bob.materials where project_id='p_bygga_in_entren')<>27
 or (select count(*) from bob.task_needs where task_id='t_entre_tools_check' and kind='tool')<>33
 then raise exception 'count mismatch'; end if; end $$;
commit;
