-- Fasteners on construction joints (owner decisions 2026-10-26).
--
-- A joint said only "screwed" or "glued". Drawings, Bob and the material list
-- now read one fastener schedule computed by fixed rules from the joined
-- parts' geometry, never by a model:
--  * screwed_butt -> screw. The part screwed through is the one with the
--    smaller extent along the joint normal (t). Diameter by t: <=15 -> 3.5,
--    <=22 -> 4.0, <=30 -> 4.5, <=45 -> 5.0, <=70 -> 6.0 mm, thicker: no rule.
--    Length: the shortest standard length >= 2.5 t that does not pass through
--    the other part (t + its extent - 5 mm). Count along the longer side of the
--    contact: max(2, ceil((L - 2e) / 150) + 1) with end distance
--    e = max(15, 5 d), spread evenly; a contact shorter than 2e + 30 gets one
--    fastener and a gap.
--  * glued_butt -> glue; one glue package per construction.
--  * dowel, bolted, unresolved -> no rule.
-- A joint may carry an optional "fastener" override chosen by Bob (for example
-- nails); a missing override count is spread by the same spacing rule.
-- A joint between two existing parts (instance role existing_part, e.g. two
-- walls of an already built room) gets no new fastener unless Bob chose one.
-- This is a concept proposal from rules of thumb, not a strength calculation.
--
-- 1. bob_private.valid_joint_fastener validates an override.
-- 2. bob_private.check_construction accepts 5-key joints and 6-key joints with
--    a valid fastener (recreated from its installed body).
-- 3. bob_private.construction_fastener_schedule(recipe, joints, policy) is the
--    pure rule; construction_fastener_schedule_for(revision row) adds the
--    revision's instance policy. Every reader, drawing check and material need
--    uses the latter.
-- 4. bob.read_construction_fasteners reads it for one saved revision.
-- Existing constructions and drawings stay valid; nothing is stored.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create function bob_private.valid_joint_fastener(f jsonb) returns boolean
language sql immutable set search_path='' as $$
 select f is not null and jsonb_typeof(f)='object'
  and f-array['kind','diameter_mm','length_mm','count','spacing_mm','reason']='{}'::jsonb
  and (select count(*) from jsonb_object_keys(f))=6
  and coalesce(f->>'kind','') in ('screw','nail','bolt','glue','none')
  and jsonb_typeof(f->'reason')='string' and char_length(btrim(f->>'reason')) between 1 and 500
  and (select bool_and(case when jsonb_typeof(f->k)='null' then true
     when jsonb_typeof(f->k)='number' then (f->>k)::numeric>0 and (f->>k)::numeric<=case k when 'count' then 10000 else 2000 end
      and (k<>'count' or (f->>k)::numeric=trunc((f->>k)::numeric))
     else false end) from unnest(array['diameter_mm','length_mm','count','spacing_mm']) k)
  and case when f->>'kind' in ('glue','none')
   then jsonb_typeof(f->'diameter_mm')='null' and jsonb_typeof(f->'length_mm')='null'
    and jsonb_typeof(f->'count')='null' and jsonb_typeof(f->'spacing_mm')='null'
   else jsonb_typeof(f->'diameter_mm')='number' and jsonb_typeof(f->'length_mm')='number' end
$$;
revoke all on function bob_private.valid_joint_fastener(jsonb) from public,anon,authenticated,service_role;

do $$
declare fn regprocedure:='bob_private.check_construction(text,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure; def text;
 old_check constant text:=$q$j-array['id','method','first','second','reason']<>'{}' or (select count(*) from jsonb_object_keys(j))<>5$q$;
 new_check constant text:=$q$j-array['id','method','first','second','reason','fastener']<>'{}' or (select count(*) from jsonb_object_keys(j)) not in (5,6)
   or (j ? 'fastener' and jsonb_typeof(j->'fastener')<>'null' and not bob_private.valid_joint_fastener(j->'fastener'))$q$;
begin
 def:=pg_get_functiondef(fn);
 if position(old_check in def)=0 then raise exception 'construction_fasteners_check_construction_changed'; end if;
 execute replace(def,old_check,new_check);
end $$;

-- Pure rule: the same answer for the same saved recipe and joints.
create function bob_private.construction_fastener_schedule(p_recipe jsonb,p_joints jsonb,p_policy jsonb default null) returns jsonb
language plpgsql immutable set search_path='' as $$
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
  pair:=(j->'first'->>'instance_id')=any(existing) and (j->'second'->>'instance_id')=any(existing);
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
end $$;
revoke all on function bob_private.construction_fastener_schedule(jsonb,jsonb,jsonb) from public,anon,service_role;
grant execute on function bob_private.construction_fastener_schedule(jsonb,jsonb,jsonb) to authenticated;

-- The schedule of one saved revision with its own instance policy.
create function bob_private.construction_fastener_schedule_for(c bob.artifact_construction_revisions) returns jsonb
language sql stable security invoker set search_path='' as $$
 select bob_private.construction_fastener_schedule(c.recipe,c.joints,(select p.policy from bob.artifact_construction_instance_policies p
  where p.project_id=c.project_id and p.artifact_id=c.artifact_id and p.artifact_revision=c.artifact_revision))
$$;
revoke all on function bob_private.construction_fastener_schedule_for(bob.artifact_construction_revisions) from public,anon,service_role;
grant execute on function bob_private.construction_fastener_schedule_for(bob.artifact_construction_revisions) to authenticated;

-- One saved construction revision; current revision when p_revision is null.
create function bob.read_construction_fasteners(p_project text,p_artifact uuid,p_revision integer default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c bob.artifact_construction_revisions;
begin
 if auth.uid() is null or not bob_private.has_project_access(p_project) then raise exception 'project_denied' using errcode='42501'; end if;
 select r.* into c from bob.artifact_construction_revisions r join bob.artifacts a on a.id=r.artifact_id and a.project_id=r.project_id
 where r.project_id=p_project and r.artifact_id=p_artifact and r.artifact_revision=coalesce(p_revision,a.current_revision);
 if not found then return jsonb_build_object('status','not_found'); end if;
 return jsonb_build_object('status','ok','project_id',p_project,'artifact_id',p_artifact,'revision',c.artifact_revision)
  ||bob_private.construction_fastener_schedule_for(c);
end $$;
revoke all on function bob.read_construction_fasteners(text,uuid,integer) from public,anon,service_role;
grant execute on function bob.read_construction_fasteners(text,uuid,integer) to authenticated;

commit;
