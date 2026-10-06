-- Add a read-only assessment to the existing toolbox. No stock/Shopping guard
-- or requirement history is changed. CLI migration creation is unavailable in
-- this executor (the installed CLI crashes even on --help; see K4 verification).
begin;
insert into bob.tool_catalog(name,description,how_to,schema_version,always_load,preload_phases,active) values
 ('check_construction_cut_fit','Check rectangular blank placement against explicit candidate sheets with kerf, trim and grain.',
 'Read the exact current construction and material pins. Supply candidate sheet dimensions/count, kerf, trim per edge and sheet grain with an honest specification/design-choice basis and note. Name each used definition once with its local in-plane grain axis; null remains unknown and none is an explicit no-grain constraint. Code derives ALL actual instance blanks and returns placements, executable guillotine cuts and offcuts. Feasible is geometric evidence for these inputs only, not verified physical stock, product suitability, an optimal purchase count or a saved plan. no_layout_found/search_limit are not general impossibility proofs. Keep existing requirement IDs/history. Allocation and Shopping stay blocked until a persisted cut plan is bound to current real stock/product capacity.',
 1,false,array['planning','build'],true);
commit;
