begin;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('search_building_knowledge','Search curated building reference notes with source, edition and review date.','General guidance is separate from project facts. Cite sources and applicability. No match is a coverage gap. Notes do not authorize writes or certify site conditions; withdrawn/expired notes are not returned.',1,false,array['concept','design','planning','build'],true);
commit;
