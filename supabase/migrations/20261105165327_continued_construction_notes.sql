begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Old two-field text packets retain their shape. The optional questions list
-- is a delta on narrative only; all existing source/geometry/write fences stay.
create or replace function bob_private.valid_construction_text(t jsonb) returns boolean
language sql immutable set search_path='' as $$
 select jsonb_typeof(t)='object' and t-array['title','description','open_questions']='{}'::jsonb
  and t ?& array['title','description']
  and jsonb_typeof(t->'title')='string' and char_length(btrim(t->>'title')) between 1 and 200
  and jsonb_typeof(t->'description')='string' and char_length(btrim(t->>'description')) between 1 and 5500
  and (not t?'open_questions' or t->'open_questions'='null' or jsonb_typeof(t->'open_questions')='array' and jsonb_array_length(t->'open_questions')<=40
   and not exists(select 1 from jsonb_array_elements(t->'open_questions') q where jsonb_typeof(q)<>'string' or char_length(btrim(q#>>'{}')) not between 1 and 1000))
$$;
revoke all on function bob_private.valid_construction_text(jsonb) from public,anon,authenticated,service_role;
do $construction_notes$
declare target text; definition text; old text:=$anchor$'open_questions',draft->'open_questions'$anchor$;
 replacement text:=$anchor$'open_questions',coalesce(nullif(d#>'{text,open_questions}','null'::jsonb),draft->'open_questions')$anchor$;
begin
 foreach target in array array['bob_private.bob_project_write_before_legacy_transition(text,uuid,uuid,bigint,jsonb)','bob_private.bob_project_write_v16(text,uuid,uuid,bigint,jsonb)'] loop
  definition:=pg_get_functiondef(target::regprocedure);
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'construction_notes_anchor_mismatch';end if;
  execute replace(definition,old,replacement);
 end loop;
end $construction_notes$;
-- A narrative-only repair is legitimate work; unchanged geometry is not an empty edit.
do $construction_notes_only$
declare definition text; old text:='if count_changes=0 or next_data=original_data then';
 replacement text:=$anchor$if (count_changes=0 or next_data=original_data) and not (
  coalesce(d#>'{text,title}',draft->'title') is distinct from draft->'title'
  or coalesce(d#>'{text,description}',draft->'description') is distinct from draft->'description'
  or coalesce(nullif(d#>'{text,open_questions}','null'::jsonb),draft->'open_questions') is distinct from draft->'open_questions') then$anchor$;
begin
 definition:=pg_get_functiondef('bob.prepare_construction_edit(text,uuid,uuid,bigint,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'construction_notes_only_anchor_mismatch';end if;
 execute replace(definition,old,replacement);
end $construction_notes_only$;
notify pgrst,'reload schema';
commit;
