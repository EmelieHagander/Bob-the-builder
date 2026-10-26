-- Fastener and glue needs are exact (owner decision 2026-10-26): "show the
-- exact count, not with waste; Bob may recommend extra for waste, but the
-- numbers must be exact".
--
-- 20261026172000_fastener_requirements.sql derives one need per schedule group
-- (and one glue package) through the arithmetic writer, which stores
-- coalesce(waste_percent,0) on create and revise alike. From here on:
--  * quantity_mode fasteners/glue refuses a waste_percent that is present and
--    not 0 with fastener_quantity_exact (22023), before any lock is taken;
--  * the payload to the arithmetic writer always carries waste_percent 0, so
--    the stored need is the schedule count;
--  * construction change work (fastener_consequence) recalculates with
--    waste_percent 0 instead of copying the previous revision's value, so a
--    need saved earlier with an allowance becomes exact and is not refused.
-- purchase_increment (pack size) stays allowed: buying whole packs is not
-- waste, and the need itself still shows the exact count.
--
-- Both functions are recreated from their installed bodies with guarded
-- replaces; a changed body fails loudly.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$
declare fn regprocedure:='bob_private.material_requirement_fastener_command(text,text,uuid,integer,jsonb)'::regprocedure; def text;
 old_check constant text:=$q$then raise exception 'invalid_cad_requirement' using errcode='22023'; end if;$q$;
 new_check constant text:=$q$then raise exception 'invalid_cad_requirement' using errcode='22023'; end if;
 -- Owner decision 2026-10-26: the need is the exact schedule count. A spare
 -- is Bob's recommendation in words, never a stored allowance.
 if (case when p_data->>'waste_percent' is null then false
  when p_data->>'waste_percent' ~ '^[-+]?[0-9]+(\.[0-9]*)?$' then (p_data->>'waste_percent')::numeric<>0
  else true end)
  then raise exception 'fastener_quantity_exact' using errcode='22023'; end if;$q$;
 old_payload constant text:=$q$payload:=(p_data-array['quantity_mode','fastener_kind','diameter_mm','length_mm'])||jsonb_build_object('required_quantity',n::text,'unit','pcs','basis',v_basis);$q$;
 new_payload constant text:=$q$payload:=(p_data-array['quantity_mode','fastener_kind','diameter_mm','length_mm','waste_percent'])||jsonb_build_object('required_quantity',n::text,'unit','pcs','basis',v_basis,'waste_percent','0');$q$;
begin
 def:=pg_get_functiondef(fn);
 if position(old_check in def)=0 or (length(def)-length(replace(def,old_check,'')))/length(old_check)<>1 then raise exception 'exact_fastener_needs_check_changed'; end if;
 if position(old_payload in def)=0 or (length(def)-length(replace(def,old_payload,'')))/length(old_payload)<>1 then raise exception 'exact_fastener_needs_payload_changed'; end if;
 execute replace(replace(def,old_check,new_check),old_payload,new_payload);
end $$;

do $$
declare fn regprocedure:='bob_private.fastener_consequence(text,uuid,integer,uuid,integer,jsonb,text)'::regprocedure; def text;
 old_waste constant text:=$q$'waste_percent',q.waste_percent::text,$q$;
 new_waste constant text:=$q$'waste_percent','0',$q$;
begin
 def:=pg_get_functiondef(fn);
 if position(old_waste in def)=0 or (length(def)-length(replace(def,old_waste,'')))/length(old_waste)<>1 then raise exception 'exact_fastener_needs_consequence_changed'; end if;
 execute replace(def,old_waste,new_waste);
end $$;

commit;
