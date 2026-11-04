-- A new bounded window can be fastened to an unchanged long wall plate.
-- Its entire 6 m length is not part of the new window's workpiece. Preserve
-- the existing facade and affected-part checks, and exempt a through-member
-- from the longitudinal run ONLY for new, physically touching joints to new
-- parts. Changed members and joint-only edits among existing parts remain
-- fully bounded by the original P1 gate.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.construction_boxes_contact(a jsonb,ad jsonb,b jsonb,bd jsonb)
returns boolean language sql immutable strict security invoker set search_path='' as $$
 select coalesce(
  ad->>'primitive'='box' and bd->>'primitive'='box'
  and (a#>>'{placement,rx}')::numeric=0 and (a#>>'{placement,ry}')::numeric=0 and (a#>>'{placement,rz}')::numeric=0
  and (b#>>'{placement,rx}')::numeric=0 and (b#>>'{placement,ry}')::numeric=0 and (b#>>'{placement,rz}')::numeric=0
  and (a#>>'{placement,x}')::numeric<=(b#>>'{placement,x}')::numeric+(bd->>'x_mm')::numeric
  and (b#>>'{placement,x}')::numeric<=(a#>>'{placement,x}')::numeric+(ad->>'x_mm')::numeric
  and (a#>>'{placement,y}')::numeric<=(b#>>'{placement,y}')::numeric+(bd->>'y_mm')::numeric
  and (b#>>'{placement,y}')::numeric<=(a#>>'{placement,y}')::numeric+(ad->>'y_mm')::numeric
  and (a#>>'{placement,z}')::numeric<=(b#>>'{placement,z}')::numeric+(bd->>'z_mm')::numeric
  and (b#>>'{placement,z}')::numeric<=(a#>>'{placement,z}')::numeric+(ad->>'z_mm')::numeric,
 false)
$$;

create function bob_private.construction_only_new_local_joints(
 p_part text,p_instance jsonb,p_definition jsonb,
 p_old_recipe jsonb,p_new_recipe jsonb,p_old_joints jsonb,p_new_joints jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare j record;neighbor text;attached jsonb;attached_def jsonb;has_joint boolean:=false;
begin
 for j in
  select o.value as before,n.value as after
   from jsonb_array_elements(coalesce(p_old_joints,'[]'::jsonb)) o
   full join jsonb_array_elements(coalesce(p_new_joints,'[]'::jsonb)) n
    on n.value->>'id'=o.value->>'id'
   where o.value is distinct from n.value
 loop
  if p_part is distinct from j.before#>>'{first,instance_id}'
   and p_part is distinct from j.before#>>'{second,instance_id}'
   and p_part is distinct from j.after#>>'{first,instance_id}'
   and p_part is distinct from j.after#>>'{second,instance_id}' then continue;end if;
  has_joint:=true;
  -- Replacing/removing an existing joint is never a local-anchor exemption.
  if j.before is not null or j.after is null then return false;end if;
  if p_part=j.after#>>'{first,instance_id}' then neighbor:=j.after#>>'{second,instance_id}';
  elsif p_part=j.after#>>'{second,instance_id}' then neighbor:=j.after#>>'{first,instance_id}';
  else return false;end if;
  if neighbor is null or neighbor=p_part or exists(
   select 1 from jsonb_array_elements(p_old_recipe->'instances') i
    where i.value->>'id'=neighbor) then return false;end if;
  select i.value into attached from jsonb_array_elements(p_new_recipe->'instances') i
   where i.value->>'id'=neighbor;
  if not found then return false;end if;
  select d.value into attached_def from jsonb_array_elements(p_new_recipe->'definitions') d
   where d.value->>'id'=attached->>'definition_id';
  if not found or not bob_private.construction_boxes_contact(p_instance,p_definition,attached,attached_def)
   then return false;end if;
 end loop;
 return has_joint;
end $$;
revoke all on function bob_private.construction_boxes_contact(jsonb,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role;
revoke all on function bob_private.construction_only_new_local_joints(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role;

do $local_joint_guard$
declare body text;old text;replacement text;
begin
 body:=pg_get_functiondef('bob_private.enforce_construction_piece_revision()'::regprocedure);
 old:=$old$ old_solution uuid; next_solution uuid;$old$;
 replacement:=$new$ old_solution uuid; next_solution uuid;
 role_before jsonb;role_after jsonb;$new$;
 if position(old in body)=0 then raise exception 'local_joint_guard_declaration_changed';end if;
 body:=replace(body,old,replacement);
 old:=$old$  -- Distinct windows widely separated on the same wall are distinct workpieces.
  -- This is only a geometric bound, never proof that exactly one opening exists.
  axis:=case when chosen_view in ('left','right') then 'y' else 'x' end;$old$;
 replacement:=$new$  -- An unchanged through-member is still counted and checked against the
  -- exact facade. It does not widen the workpiece merely because new, locally
  -- touching studs are fastened to it. Changing the member, its role or an
  -- existing joint retains the full original longitudinal span check.
  select r.value into role_before from jsonb_array_elements(coalesce(old_roles->'instances','[]'::jsonb)) r
   where r.value->>'instance_id'=part_id;
  select r.value into role_after from jsonb_array_elements(coalesce(new_roles->'instances','[]'::jsonb)) r
   where r.value->>'instance_id'=part_id;
  if old_inst is not null and old_inst is not distinct from new_inst
   and old_def is not distinct from new_def and old_mat is not distinct from new_mat
   and role_before is not distinct from role_after
   and bob_private.construction_only_new_local_joints(
    part_id,old_inst,old_def,previous.recipe,new.recipe,previous.joints,new.joints)
  then continue;end if;
  -- Distinct windows widely separated on the same wall are distinct workpieces.
  -- This is only a geometric bound, never proof that exactly one opening exists.
  axis:=case when chosen_view in ('left','right') then 'y' else 'x' end;$new$;
 if position(old in body)=0 then raise exception 'local_joint_guard_span_branch_changed';end if;
 execute replace(body,old,replacement);
end $local_joint_guard$;
commit;
