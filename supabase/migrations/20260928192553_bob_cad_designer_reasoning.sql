-- Keep the construction model and output ceiling; reduce pre-output reasoning.
-- Source collection and independent review keep their separate governed roles.
begin;
do $$ begin
 update shared.ai_settings set reasoning_effort='medium',updated_at=clock_timestamp()
 where app='bob' and coworker_id='bob' and function_name='cad-designer' and module_id='cad';
 if not found then raise exception 'bob_cad_designer_settings_missing'; end if;
end $$;
commit;
