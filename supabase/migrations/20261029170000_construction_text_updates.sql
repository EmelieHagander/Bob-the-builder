-- Owner decision 2026-10-29: a parameter change or part edit must not leave a
-- stale size in the Construction's title or description (paid box run: the
-- title kept "400x300x250" after the width became 500, and the drawing copied
-- it). Both change commands now accept an optional data.text with the complete
-- corrected title and description. Absent or null keeps the saved text, so
-- older runtimes and their receipts are unchanged. The server never writes
-- prose of its own; the runtime rejects a change that would leave a stated
-- overall size wrong before it reaches this boundary.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function bob_private.valid_construction_text(t jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(t)='object' and t-array['title','description']='{}'::jsonb
  and (select count(*) from jsonb_object_keys(t))=2
  and jsonb_typeof(t->'title')='string' and char_length(btrim(t->>'title')) between 1 and 200
  and jsonb_typeof(t->'description')='string' and char_length(btrim(t->>'description')) between 1 and 5500
$$;
revoke all on function bob_private.valid_construction_text(jsonb) from public,anon,authenticated,service_role;

-- Patch the live definitions in place, as earlier construction releases did:
-- every anchor must exist exactly once or the migration stops.
do $construction_text$
declare
 target text; definition text; anchor_from text; anchor_to text; patch jsonb;
 key_check_old constant text:=$k$d-array['key','change_note','changes','computed','target_revision']<>'{}'$k$;
 key_check_new constant text:=$k$d-array['key','change_note','changes','computed','target_revision','text']<>'{}'$k$;
 count_old constant text:=$k$(select count(*) from jsonb_object_keys(d))<>4+(case when d?'target_revision' then 1 else 0 end)$k$;
 count_new constant text:=$k$(select count(*) from jsonb_object_keys(d))<>4+(case when d?'target_revision' then 1 else 0 end)+(case when d?'text' then 1 else 0 end)
  or (d?'text' and d->'text'<>'null'::jsonb and not bob_private.valid_construction_text(d->'text'))$k$;
 text_old constant text:=$k$'title',draft->'title','description',draft->'description'$k$;
 text_new constant text:=$k$'title',coalesce(nullif(d->'text','null'::jsonb)->'title',draft->'title'),'description',coalesce(nullif(d->'text','null'::jsonb)->'description',draft->'description')$k$;
begin
 for patch in select value from jsonb_array_elements(jsonb_build_array(
   jsonb_build_object('fn','bob.prepare_construction_parameter_change(text,uuid,uuid,bigint,jsonb)','edits',jsonb_build_array(jsonb_build_array(key_check_old,key_check_new),jsonb_build_array(count_old,count_new))),
   jsonb_build_object('fn','bob.prepare_construction_edit(text,uuid,uuid,bigint,jsonb)','edits',jsonb_build_array(jsonb_build_array(key_check_old,key_check_new),jsonb_build_array(count_old,count_new))),
   jsonb_build_object('fn','bob_private.bob_project_write_before_legacy_transition(text,uuid,uuid,bigint,jsonb)','edits',jsonb_build_array(jsonb_build_array(text_old,text_new))),
   jsonb_build_object('fn','bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb)','edits',jsonb_build_array(jsonb_build_array(text_old,text_new)))
 )) loop
  target:=patch->>'fn';
  definition:=pg_get_functiondef(target::regprocedure);
  for anchor_from,anchor_to in select e->>0,e->>1 from jsonb_array_elements(patch->'edits') e loop
   if (char_length(definition)-char_length(replace(definition,anchor_from,'')))/char_length(anchor_from)<>1 then
    raise exception 'construction_text_anchor: % in %',left(anchor_from,40),target;
   end if;
   definition:=replace(definition,anchor_from,anchor_to);
  end loop;
  execute definition;
 end loop;
end $construction_text$;
notify pgrst,'reload schema';
commit;
