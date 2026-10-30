/** Historical 20261014062144 publication. Current CAD descriptions are
 * versioned by later publications; rebuilding this one must retain its bytes. */
import {DESIGN_CAD_TOOL,SAVE_CAD_TOOL,withoutAssemblyOrder,withoutResumeViews} from '../supabase/functions/_shared/cad-assistant.ts'
import {PLAN_CAD_PIECES_TOOL} from '../supabase/functions/_shared/cad-pieces.ts'
// This publication predates the 2026-10-21 view contract.
import {withLegacyCadViews} from '../supabase/functions/_shared/cad-adapter.ts'

export const checkedConstructionContracts:{key:string;description:string;parameters:Record<string,any>}[]=[withoutResumeViews(withoutAssemblyOrder(DESIGN_CAD_TOOL)),SAVE_CAD_TOOL,PLAN_CAD_PIECES_TOOL].map(withLegacyCadViews).map(t=>({key:'tools.'+t.function.name,description:t.function.description,parameters:structuredClone(t.function.parameters)}))
const original=checkedConstructionContracts.find(t=>t.key==='tools.design_project_cad')!
original.parameters.properties.construction_revision={
 ...(original.parameters.properties.construction_revision as Record<string,unknown>),
 description:'Copy the exact saved/read construction revision. Required for every project drawing. The server checks this version and preserves it on resume; it cannot substitute a newer design.',
}
