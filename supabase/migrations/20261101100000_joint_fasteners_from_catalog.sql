-- Joint fasteners chosen from the catalog (owner decision 2026-11-01).
--
-- A joint said "screwed" or "glued" and a fixed rule picked the screw, so a
-- plywood box came out glue-only or screws-only by chance. The owner decided
-- that the structural designer chooses what holds each joint from the catalog,
-- in any mix (glue and screws, nails, ...), and that code checks plain facts.
--
-- 1. bob.material_types.fastener_kind says what a material type is as a
--    fastener: screw, nail, bolt or glue. Set here for the seeded screw and
--    nail types. Other types, and project materials without a type, are not
--    fasteners.
-- 2. bob_private.joint_fastener_item(item, revision) gives one catalog item
--    revision's kind and nominal size (diameter and length in mm; glue has
--    none). It reads catalog tables, so it is SECURITY DEFINER and returns
--    only these three facts.
-- 3. bob_private.valid_joint_fasteners(project, list) validates a joint's
--    chosen list: up to 8 distinct items of the shared catalog or this
--    project, each {material_id, material_revision, count, spacing_mm};
--    count and spacing are for screws, nails and bolts and may be null.
-- 4. bob_private.check_construction accepts method 'butt' with a fasteners
--    list, and only then (guarded replace of its installed body); a list that
--    fails (3) raises joint_fasteners_not_in_catalog. Earlier joints are
--    unchanged.
-- 5. bob_private.construction_fastener_schedule: a 'butt' joint gives one row
--    per chosen item (source 'chosen', with material_id and
--    material_revision). A missing count is spread by the existing rule.
--    Fact gaps: does_not_reach (not longer than the board it goes through),
--    passes_through (tip within 5 mm of the far face or beyond),
--    short_penetration (shorter than 2.5 x that board, the existing rule of
--    thumb), short_contact, narrow_contact, count_unknown, fastener_unknown,
--    no_fastener_chosen. Rows for earlier joints are unchanged. The function
--    now reads the catalog through (2), so it is STABLE.
-- Nothing stored changes. Saved constructions and drawings stay valid.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

alter table bob.material_types add column fastener_kind text
 check (fastener_kind in ('screw','nail','bolt','glue'));
comment on column bob.material_types.fastener_kind is
 'What this material type is as a joint fastener (owner decision 2026-11-01). Null: not a fastener.';
update bob.material_types set fastener_kind='screw' where seed_key in ('wood_screw_zinc','outdoor_screw','stainless_screw','drywall_screw');
update bob.material_types set fastener_kind='nail' where seed_key in ('wire_nail_zinc','anchor_nail');
do $$ begin
 if (select count(*) from bob.material_types where fastener_kind is not null)<>6 then raise exception 'joint_fasteners_seed_types_changed'; end if;
end $$;

create function bob_private.joint_fastener_item(p_item uuid, p_revision integer) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('kind',t.fastener_kind,'project_id',i.project_id,
  'diameter_mm',case when t.fastener_kind<>'glue' and r.properties->'diameter'->>'unit'='mm' and r.properties->'diameter'->>'value'~'^[0-9]{1,4}(\.[0-9]{1,3})?$'
   then (r.properties->'diameter'->>'value')::numeric end,
  'length_mm',case when t.fastener_kind<>'glue' and r.properties->'length'->>'unit'='mm' and r.properties->'length'->>'value'~'^[0-9]{1,4}(\.[0-9]{1,3})?$'
   then (r.properties->'length'->>'value')::numeric end)
 from bob.catalog_item_revisions r
 join bob.catalog_items i on i.id=r.item_id and i.kind='material'
 join bob.material_types t on t.id=i.material_type_id and t.fastener_kind is not null
 where r.item_id=p_item and r.revision=p_revision
$$;
revoke all on function bob_private.joint_fastener_item(uuid,integer) from public,anon,authenticated,service_role;
-- The fastener schedule runs as the reading user and needs these three facts.
grant execute on function bob_private.joint_fastener_item(uuid,integer) to authenticated;

create function bob_private.valid_joint_fasteners(p_project text, f jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare e jsonb; item jsonb; seen text[]:='{}';
begin
 if jsonb_typeof(f) is distinct from 'array' or jsonb_array_length(f)>8 then return false; end if;
 for e in select value from jsonb_array_elements(f) loop
  if jsonb_typeof(e) is distinct from 'object' or e-array['material_id','material_revision','count','spacing_mm']<>'{}'::jsonb
   or (select count(*) from jsonb_object_keys(e))<>4
   or coalesce(e->>'material_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(e->'material_revision') is distinct from 'number' or coalesce(e->>'material_revision','')!~'^[1-9][0-9]{0,8}$'
   or jsonb_typeof(e->'count') not in ('null','number') or jsonb_typeof(e->'spacing_mm') not in ('null','number')
   or (e->>'material_id')=any(seen) then return false; end if;
  if jsonb_typeof(e->'count')='number' and (coalesce(e->>'count','')!~'^[1-9][0-9]{0,3}$' and e->>'count'<>'10000') then return false; end if;
  if jsonb_typeof(e->'spacing_mm')='number' and not ((e->>'spacing_mm')::numeric>0 and (e->>'spacing_mm')::numeric<=2000) then return false; end if;
  seen:=seen||(e->>'material_id');
  item:=bob_private.joint_fastener_item((e->>'material_id')::uuid,(e->>'material_revision')::integer);
  if item is null or (item->>'project_id' is not null and item->>'project_id'<>p_project) then return false; end if;
  if item->>'kind'='glue' and (jsonb_typeof(e->'count')<>'null' or jsonb_typeof(e->'spacing_mm')<>'null') then return false; end if;
  if item->>'kind'<>'glue' and (jsonb_typeof(item->'diameter_mm')<>'number' or jsonb_typeof(item->'length_mm')<>'number') then return false; end if;
 end loop;
 return true;
end $$;
revoke all on function bob_private.valid_joint_fasteners(text,jsonb) from public,anon,authenticated,service_role;

do $$
declare fn regprocedure:='bob_private.check_construction(text,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure; def text;
 old_keys constant text:=$q$j-array['id','method','first','second','reason','fastener']<>'{}' or (select count(*) from jsonb_object_keys(j)) not in (5,6)
   or (j ? 'fastener' and jsonb_typeof(j->'fastener')<>'null' and not bob_private.valid_joint_fastener(j->'fastener'))$q$;
 new_keys constant text:=$q$j-array['id','method','first','second','reason','fastener','fasteners']<>'{}' or (select count(*) from jsonb_object_keys(j)) not in (5,6)
   or (j ? 'fastener' and jsonb_typeof(j->'fastener')<>'null' and not bob_private.valid_joint_fastener(j->'fastener'))
   or (coalesce(j->>'method','')='butt')<>(j ? 'fasteners')$q$;
 old_raise constant text:=$q$then raise exception 'invalid_joint' using errcode='22023'; end if;$q$;
 new_raise constant text:=$q$then raise exception 'invalid_joint' using errcode='22023'; end if;
  if j ? 'fasteners' and not bob_private.valid_joint_fasteners(p_project,j->'fasteners') then raise exception 'joint_fasteners_not_in_catalog' using errcode='22023'; end if;$q$;
 old_methods constant text:=$q$coalesce(j->>'method','') not in ('screwed_butt','glued_butt','dowel','bolted','unresolved')$q$;
 new_methods constant text:=$q$coalesce(j->>'method','') not in ('screwed_butt','glued_butt','dowel','bolted','unresolved','butt')$q$;
begin
 def:=pg_get_functiondef(fn);
 if position(old_keys in def)=0 or position(old_methods in def)=0
  or (length(def)-length(replace(def,old_raise,'')))/length(old_raise)<>1 then raise exception 'joint_fasteners_check_construction_changed'; end if;
 execute replace(replace(replace(def,old_keys,new_keys),old_methods,new_methods),old_raise,new_raise);
end $$;

create or replace function bob_private.construction_fastener_schedule(p_recipe jsonb, p_joints jsonb, p_policy jsonb default null)
returns jsonb
language plpgsql
stable
set search_path=''
as $function$
declare
 standard constant numeric[]:=array[16,20,25,30,35,40,45,50,55,60,70,80,90,100,120,140,160,180,200];
 boxes jsonb:='{}'; defs jsonb:='{}'; inst jsonb; def jsonb; p jsonb; j jsonb; o jsonb;
 a jsonb; b jsonb; fa jsonb; fb jsonb; ang integer[]; c integer[]; s integer[]; r integer[];
 basis integer[]; mn numeric[]; mx numeric[]; dims numeric[]; faces jsonb; origin numeric[];
 w integer; k integer; sgn integer; local integer; others integer[];
 ta numeric; tb numeric; t numeric; embed numeric; through text; ov numeric[]; lc numeric; wc numeric;
 d numeric; len numeric; lmax numeric; e numeric; n integer; spacing numeric; gaps text[];
 kind text; source text; proposal jsonb; rows jsonb:='[]'; mech jsonb; glue integer:=0; complete boolean:=true;
 method text; passes integer; existing text[]:='{}'; pair boolean;
 chosen jsonb; item jsonb; own text[];
begin
 existing:=array(select x->>'instance_id' from jsonb_array_elements(case when jsonb_typeof(p_policy->'instances')='array' then p_policy->'instances' else '[]' end) x where x->>'role'='existing_part');
 for def in select value from jsonb_array_elements(coalesce(p_recipe->'definitions','[]')) loop
  defs:=defs||jsonb_build_object(def->>'id',def);
 end loop;
 -- World boxes exactly as the CAD frame convention (intrinsic xyz, minimum
 -- corner origin); only uncut boxes at right-angle rotations.
 for inst in select value from jsonb_array_elements(coalesce(p_recipe->'instances','[]')) loop
  def:=defs->(inst->>'definition_id'); p:=inst->'placement';
  if def is null or def->>'primitive' is distinct from 'box' or coalesce(jsonb_array_length(def->'cuts'),0)>0
   or (p->>'rx')::numeric%90<>0 or (p->>'ry')::numeric%90<>0 or (p->>'rz')::numeric%90<>0 then continue; end if;
  ang:=array[(((p->>'rx')::numeric/90)::integer%4+4)%4,(((p->>'ry')::numeric/90)::integer%4+4)%4,(((p->>'rz')::numeric/90)::integer%4+4)%4];
  c:=array[(array[1,0,-1,0])[ang[1]+1],(array[1,0,-1,0])[ang[2]+1],(array[1,0,-1,0])[ang[3]+1]];
  s:=array[(array[0,1,0,-1])[ang[1]+1],(array[0,1,0,-1])[ang[2]+1],(array[0,1,0,-1])[ang[3]+1]];
  -- rows of R = Rx*Ry*Rz; column i is local axis i in world coordinates.
  r:=array[c[2]*c[3],-c[2]*s[3],s[2],
           c[1]*s[3]+s[1]*s[2]*c[3],c[1]*c[3]-s[1]*s[2]*s[3],-s[1]*c[2],
           s[1]*s[3]-c[1]*s[2]*c[3],s[1]*c[3]+c[1]*s[2]*s[3],c[1]*c[2]];
  origin:=array[(p->>'x')::numeric,(p->>'y')::numeric,(p->>'z')::numeric];
  dims:=array[(def->>'x_mm')::numeric,(def->>'y_mm')::numeric,(def->>'z_mm')::numeric];
  mn:=origin; mx:=origin; faces:='{}';
  for local in 1..3 loop
   w:=null;
   for k in 1..3 loop if abs(r[(k-1)*3+local])=1 then w:=k; sgn:=r[(k-1)*3+local]; end if; end loop;
   mn[w]:=mn[w]+least(0,sgn*dims[local]); mx[w]:=mx[w]+greatest(0,sgn*dims[local]);
   faces:=faces||jsonb_build_object((array['x','y','z'])[local]||'_min',jsonb_build_object('axis',w,'sign',-sgn,'plane',origin[w]),
     (array['x','y','z'])[local]||'_max',jsonb_build_object('axis',w,'sign',sgn,'plane',origin[w]+sgn*dims[local]));
  end loop;
  boxes:=boxes||jsonb_build_object(inst->>'id',jsonb_build_object('min',to_jsonb(mn),'max',to_jsonb(mx),'faces',faces));
 end loop;

 for j in select value from jsonb_array_elements(coalesce(p_joints,'[]')) loop
  method:=j->>'method'; gaps:='{}'; proposal:=null; through:=null; t:=null; embed:=null; lc:=null; wc:=null;
  a:=boxes->(j->'first'->>'instance_id'); b:=boxes->(j->'second'->>'instance_id');
  fa:=a->'faces'->(j->'first'->>'face'); fb:=b->'faces'->(j->'second'->>'face');
  if fa is null or fb is null then gaps:=gaps||'geometry_unsupported'::text;
  elsif (fa->>'axis')<>(fb->>'axis') or (fa->>'sign')::integer<>-(fb->>'sign')::integer
   or abs((fa->>'plane')::numeric-(fb->>'plane')::numeric)>0.000001 then gaps:=gaps||'faces_do_not_meet'::text;
  else
   w:=(fa->>'axis')::integer; others:=array(select x from generate_series(1,3) x where x<>w);
   ta:=(a->'max'->>(w-1))::numeric-(a->'min'->>(w-1))::numeric;
   tb:=(b->'max'->>(w-1))::numeric-(b->'min'->>(w-1))::numeric;
   ov:=array(select least((a->'max'->>(x-1))::numeric,(b->'max'->>(x-1))::numeric)-greatest((a->'min'->>(x-1))::numeric,(b->'min'->>(x-1))::numeric) from unnest(others) x);
   if least(ov[1],ov[2])<=0.000001 then gaps:=gaps||'faces_do_not_meet'::text;
   else
    lc:=greatest(ov[1],ov[2]); wc:=least(ov[1],ov[2]);
    if tb<ta then through:=j->'second'->>'instance_id'; t:=tb; embed:=ta; else through:=j->'first'->>'instance_id'; t:=ta; embed:=tb; end if;
   end if;
  end if;
  pair:=(j->'first'->>'instance_id')=any(existing) and (j->'second'->>'instance_id')=any(existing);

  -- A joint held by catalog items the designer chose (2026-11-01): one row per item.
  if j ? 'fasteners' then
   if jsonb_array_length(j->'fasteners')=0 then
    if not pair then complete:=false; end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('joint_id',j->>'id','method',method,'source',case when pair then 'existing' else 'none' end,'kind',null,
     'diameter_mm',null,'length_mm',null,'count',null,'spacing_mm',null,'through_instance_id',case when pair then null else through end,'through_mm',case when pair then null else t end,
     'embed_mm',case when pair then null else embed end,'contact_length_mm',lc,'contact_width_mm',wc,'proposal',null,
     'gaps',case when pair then '[]'::jsonb else to_jsonb(gaps||'no_fastener_chosen'::text) end,'material_id',null,'material_revision',null));
    continue;
   end if;
   for chosen in select value from jsonb_array_elements(j->'fasteners') loop
    own:=gaps; item:=bob_private.joint_fastener_item((chosen->>'material_id')::uuid,(chosen->>'material_revision')::integer);
    kind:=item->>'kind'; d:=(item->>'diameter_mm')::numeric; len:=(item->>'length_mm')::numeric;
    n:=(chosen->>'count')::integer; spacing:=(chosen->>'spacing_mm')::numeric;
    if item is null then own:=own||'fastener_unknown'::text; complete:=false;
    elsif kind in ('screw','nail','bolt') then
     -- Count and spacing along the longer side of the contact (the existing rule).
     if n is null and d is not null and lc is not null then
      e:=greatest(15,5*d);
      if lc-2*e>=30 then n:=greatest(2,ceil((lc-2*e)/150)::integer+1); spacing:=round((lc-2*e)/(n-1));
      else n:=1; spacing:=null; own:=own||'short_contact'::text; end if;
     end if;
     if n is null then own:=own||'count_unknown'::text; complete:=false; end if;
     if t is not null and len is not null then
      if len<=t then own:=own||'does_not_reach'::text;
      elsif len>t+embed-5 then own:=own||'passes_through'::text;
      elsif len<2.5*t then own:=own||'short_penetration'::text; end if;
     end if;
     if wc is not null and d is not null and wc<5*d then own:=own||'narrow_contact'::text; end if;
    elsif kind='glue' then glue:=1;
    end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('joint_id',j->>'id','method',method,'source','chosen','kind',kind,
     'diameter_mm',d,'length_mm',len,'count',n,'spacing_mm',spacing,'through_instance_id',through,'through_mm',t,'embed_mm',embed,
     'contact_length_mm',lc,'contact_width_mm',wc,'proposal',null,'gaps',to_jsonb(own),
     'material_id',chosen->'material_id','material_revision',chosen->'material_revision'));
   end loop;
   continue;
  end if;

  kind:=null; d:=null; len:=null; n:=null; spacing:=null;
  if method='screwed_butt' and t is not null then
   kind:='screw';
   d:=case when t<=15 then 3.5 when t<=22 then 4.0 when t<=30 then 4.5 when t<=45 then 5.0 when t<=70 then 6.0 end;
   if d is null then gaps:=gaps||'thickness_outside_rule'::text;
   else
    lmax:=t+embed-5;
    select min(x) into len from unnest(standard) x where x>=2.5*t and x<=lmax;
    if len is null then
     select max(x) into len from unnest(standard) x where x>t+10 and x<=lmax;
     gaps:=gaps||case when len is null then 'no_fitting_length' else 'short_penetration' end;
    end if;
   end if;
  elsif method='glued_butt' then kind:='glue';
  elsif method<>'screwed_butt' then gaps:=gaps||'no_rule_for_method'::text;
  end if;
  o:=j->'fastener';
  -- Two existing parts are already joined: no new fastener unless chosen.
  if pair and jsonb_typeof(o) is distinct from 'object' then
   rows:=rows||jsonb_build_array(jsonb_build_object('joint_id',j->>'id','method',method,'source','existing','kind',null,
    'diameter_mm',null,'length_mm',null,'count',null,'spacing_mm',null,'through_instance_id',null,'through_mm',null,'embed_mm',null,
    'contact_length_mm',lc,'contact_width_mm',wc,'proposal',null,'gaps','[]'::jsonb));
   continue;
  end if;
  source:=case when jsonb_typeof(o)='object' then 'override' when kind is not null then 'rule' else 'no_rule' end;
  -- The rule's own answer stays visible next to an override.
  passes:=case when source='override' then 2 else 1 end;
  for pass in 1..passes loop
   if pass=2 then
    proposal:=case when kind is null then null else jsonb_build_object('kind',kind,'diameter_mm',d,'length_mm',len,'count',n,'spacing_mm',spacing) end;
    kind:=o->>'kind'; d:=(o->>'diameter_mm')::numeric; len:=(o->>'length_mm')::numeric;
    n:=(o->>'count')::integer; spacing:=(o->>'spacing_mm')::numeric;
   end if;
   -- Count and spacing along the longer side of the contact.
   if kind in ('screw','nail','bolt') and n is null and d is not null and lc is not null then
    e:=greatest(15,5*d);
    if lc-2*e>=30 then n:=greatest(2,ceil((lc-2*e)/150)::integer+1); spacing:=round((lc-2*e)/(n-1));
    else n:=1; spacing:=null; if pass=passes then gaps:=gaps||'short_contact'::text; end if; end if;
   end if;
  end loop;
  if kind in ('screw','nail','bolt') and n is null then gaps:=gaps||'count_unknown'::text; end if;
  if kind in ('screw','nail','bolt') and wc is not null and d is not null and wc<5*d then gaps:=gaps||'narrow_contact'::text; end if;
  if kind='glue' then glue:=1; end if;
  if source='no_rule' or (kind in ('screw','nail','bolt') and (n is null or d is null or len is null)) then complete:=false; end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('joint_id',j->>'id','method',method,'source',source,'kind',kind,
   'diameter_mm',d,'length_mm',len,'count',n,'spacing_mm',spacing,'through_instance_id',through,'through_mm',t,'embed_mm',embed,
   'contact_length_mm',lc,'contact_width_mm',wc,'proposal',case when source='override' then proposal end,'gaps',to_jsonb(gaps)));
 end loop;

 select coalesce(jsonb_agg(jsonb_build_object('kind',x.kind,'diameter_mm',x.d,'length_mm',x.l,'count',x.n,'joint_ids',x.ids) order by x.kind,x.d,x.l),'[]')
 into mech from (
  select jr->>'kind' kind,(jr->>'diameter_mm')::numeric d,(jr->>'length_mm')::numeric l,sum((jr->>'count')::integer) n,
   jsonb_agg(jr->>'joint_id' order by jr->>'joint_id') ids
  from jsonb_array_elements(rows) jr
  where jr->>'kind' in ('screw','nail','bolt') and jsonb_typeof(jr->'count')='number' and jsonb_typeof(jr->'diameter_mm')='number' and jsonb_typeof(jr->'length_mm')='number'
  group by 1,2,3) x;
 return jsonb_build_object('rule_version','fastener-rules-v1','complete',complete,'joints',rows,'totals',mech,'glue_packages',glue);
end $function$;

commit;
