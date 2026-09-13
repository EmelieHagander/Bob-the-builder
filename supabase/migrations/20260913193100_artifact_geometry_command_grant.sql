-- The public security-invoker wrapper calls the guarded private command using
-- the same pattern as the existing artifact/solution commands. The private
-- command still enforces project and physical-context authority itself.
begin;
grant execute on function bob_private.artifact_geometry_command(text,text,uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
