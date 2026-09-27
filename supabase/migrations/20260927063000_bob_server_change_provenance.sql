-- Change provenance is server-owned. Bob no longer sees or supplies a request
-- quote: the tool session records the owner message of the turn on every write,
-- and every writer still checks it against that claimed turn's message. Guides
-- stop telling Bob to quote the owner. Each edit must match exactly once.
begin;
set local lock_timeout='5s';
do $guides$
declare r record; n integer;
begin
  for r in select * from (values
  ('create_project_room_layout','Every write needs the current request and a successful receipt.','A change is saved only with a successful receipt.'),
  ('edit_project_room_layout','Every write needs the current request and a successful receipt.','A change is saved only with a successful receipt.'),
  ('save_building_context','Every write needs the current request and a successful receipt.','A change is saved only with a successful receipt.'),
  ('save_project_building_plan','Every write needs the current request and a successful receipt.','A change is saved only with a successful receipt.'),
  ('save_project_drawing','Every write needs the current request and a successful receipt.','A change is saved only with a successful receipt.'),
  ('save_project_stair','Every write needs the current request and a successful receipt.','A change is saved only with a successful receipt.'),
  ('save_project_description','Every write needs an exact quote from the current user request and a successful receipt. Loading is not write permission.','A change is saved only with a successful receipt.'),
  ('save_project_measurement','Every write needs the current request and a successful receipt; loading is not write permission.','A change is saved only with a successful receipt.'),
  ('propose_project_plan','Load this only when an authorised manual proposal genuinely cannot originate from the compiler. It still requires the exact current revision, full strict Step/Requirement schema and exact request_quote.','Use this only when a manual proposal genuinely cannot come from the compiler. It still requires the exact current revision and the full strict Step/Requirement schema.'),
  ('save_cad_design','Use the current request quote. ',''),
  ('save_compiled_project_plan','Pass only the current request_quote. ','It takes no arguments. '),
  ('save_catalog_definition','Current request_quote authorizes the write; source_quote/source_seq retain a real user message','source_quote/source_seq retain a real user message')
  ) as t(name,old,new) loop
    update bob.tool_catalog set how_to=replace(how_to,r.old,r.new) where name=r.name and strpos(how_to,r.old)>0;
    get diagnostics n=row_count;
    if n<>1 then raise exception 'Unexpected Bob tool guide for %',r.name; end if;
  end loop;
end
$guides$;
notify pgrst,'reload schema';
commit;
