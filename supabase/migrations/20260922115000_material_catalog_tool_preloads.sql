-- Material catalog tools are one workflow. Preload search/read/save together
-- in active design/build phases so ordinary material requests do not waste model
-- rounds discovering schemas that are routinely needed together.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare changed integer;
begin
  update bob.tool_catalog
  set preload_phases = array['concept','design','planning','build']::text[]
  where name in ('search_material_catalog','read_material_catalog','save_catalog_definition')
    and schema_version = 1
    and active = true;
  get diagnostics changed = row_count;
  if changed <> 3 then
    raise exception 'material_catalog_tool_contract_changed';
  end if;
end $$;

commit;
