-- Fastener needs for any kind of joint hardware (owner decision 2026-11-01).
--
-- The structural designer may add joint hardware the catalog lacks
-- (20261101100000_joint_fasteners_from_catalog.sql, profile joint_hardware):
-- dowels, brackets, staples and the like, counted along the contact, per joint
-- or once per construction. Their totals carry their own kind word and may
-- have no size. The material list took only screw, nail and bolt with a size.
--
-- 1. bob.material_requirement_fastener_sources: kind is any lowercase word;
--    a size is required only where it was before for screws, nails and bolts,
--    and glue still has none.
-- 2. bob_private.material_requirement_fastener_command: quantity_mode
--    fasteners takes the kind of one totals row (not glue) with its diameter
--    and length as numbers or null, matched exactly, null to null; joints still
--    waiting for a choice or a count are open; a size-less group's basis names
--    no size (guarded replace of its installed body).
-- 3. bob_private.fastener_consequence: a later revision matches the same
--    group null to null (guarded replace).
-- Existing needs are unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

alter table bob.material_requirement_fastener_sources drop constraint material_requirement_fastener_sources_kind_check;
alter table bob.material_requirement_fastener_sources add constraint material_requirement_fastener_sources_kind_check
 check (kind ~ '^[a-z][a-z_]{1,31}$');
alter table bob.material_requirement_fastener_sources drop constraint material_requirement_fastener_sources_check;
alter table bob.material_requirement_fastener_sources add constraint material_requirement_fastener_sources_check check (
 case when kind='glue' then diameter_mm is null and length_mm is null
  when kind in ('screw','nail','bolt') then diameter_mm is not null and length_mm is not null
  else true end);

do $$
declare fn regprocedure:='bob_private.material_requirement_fastener_command(text,text,uuid,integer,jsonb)'::regprocedure; def text;
 old_kind constant text:=$q$(mode='fasteners' and (coalesce(p_data->>'fastener_kind','') not in ('screw','nail','bolt')
   or jsonb_typeof(p_data->'diameter_mm') is distinct from 'number' or jsonb_typeof(p_data->'length_mm') is distinct from 'number'))$q$;
 new_kind constant text:=$q$(mode='fasteners' and (coalesce(p_data->>'fastener_kind','')!~'^[a-z][a-z_]{1,31}$' or p_data->>'fastener_kind'='glue'
   or coalesce(jsonb_typeof(p_data->'diameter_mm'),'missing') not in ('number','null') or coalesce(jsonb_typeof(p_data->'length_mm'),'missing') not in ('number','null')
   or (p_data->>'fastener_kind' in ('screw','nail','bolt') and (jsonb_typeof(p_data->'diameter_mm')<>'number' or jsonb_typeof(p_data->'length_mm')<>'number'))))$q$;
 old_match constant text:=$q$where t->>'kind'=v_kind and (t->>'diameter_mm')::numeric=(p_data->>'diameter_mm')::numeric and (t->>'length_mm')::numeric=(p_data->>'length_mm')::numeric;$q$;
 new_match constant text:=$q$where t->>'kind'=v_kind and (t->>'diameter_mm')::numeric is not distinct from (p_data->>'diameter_mm')::numeric and (t->>'length_mm')::numeric is not distinct from (p_data->>'length_mm')::numeric;$q$;
 -- A joint still waiting for a choice or a count is open, as an unsized one was.
 old_open constant text:=$q$where x->>'source'='no_rule' or (x->>'kind' in ('screw','nail','bolt') and (jsonb_typeof(x->'count') is distinct from 'number'$q$;
 new_open constant text:=$q$where x->>'source' in ('no_rule','none') or (x->>'counting' in ('along_contact','per_joint') and jsonb_typeof(x->'count') is distinct from 'number')
   or (x->>'kind' in ('screw','nail','bolt') and (jsonb_typeof(x->'count') is distinct from 'number'$q$;
 -- A size-less group says nothing about a size; a sized one reads as before.
 old_size constant text:=$q$%s %s of %s x %s mm over %s %s, from the joint fastener schedule.$q$;
 new_size constant text:=$q$%s %s%s over %s %s, from the joint fastener schedule.$q$;
 old_args constant text:=$q$coalesce(v_title,'construction'),n,word,trim_scale(d),trim_scale(l),jsonb_array_length(joints)$q$;
 new_args constant text:=$q$coalesce(v_title,'construction'),n,word,case when d is null and l is null then '' else format(' of %s x %s mm',coalesce(trim_scale(d)::text,'?'),coalesce(trim_scale(l)::text,'?')) end,jsonb_array_length(joints)$q$;
begin
 def:=pg_get_functiondef(fn);
 if position(old_kind in def)=0 or position(old_match in def)=0 or position(old_open in def)=0 or position(old_size in def)=0 or position(old_args in def)=0
  then raise exception 'fastener_needs_command_changed'; end if;
 execute replace(replace(replace(replace(replace(def,old_kind,new_kind),old_match,new_match),old_open,new_open),old_size,new_size),old_args,new_args);
end $$;

do $$
declare fn regproc:='bob_private.fastener_consequence'::regproc; def text;
 old_match constant text:=$q$where t->>'kind'=f.kind and (t->>'diameter_mm')::numeric=f.diameter_mm and (t->>'length_mm')::numeric=f.length_mm;$q$;
 new_match constant text:=$q$where t->>'kind'=f.kind and (t->>'diameter_mm')::numeric is not distinct from f.diameter_mm and (t->>'length_mm')::numeric is not distinct from f.length_mm;$q$;
begin
 def:=pg_get_functiondef(fn);
 if position(old_match in def)=0 then raise exception 'fastener_consequence_changed'; end if;
 execute replace(def,old_match,new_match);
end $$;

commit;
