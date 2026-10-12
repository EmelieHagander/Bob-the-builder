import {readFileSync} from 'node:fs'
import {DESIGN_CAD_TOOL} from '../supabase/functions/_shared/cad-assistant.ts'

/** Old publications keep their instruction wording. The task-budget release
 * replaces that one field in a new immutable version; schema checks still
 * compare every structural field against today's executable declaration. */
const seed=JSON.parse(readFileSync(new URL('../supabase/migrations/20261009150000_seed_bob_ai_catalog.sql',import.meta.url),'utf8').match(/\$ai_catalog_seed\$([\s\S]+?)\$ai_catalog_seed\$/)![1])
const old:string=seed.find((r:any)=>r.key==='tools.design_project_cad').definition.parameters.properties.request_id.description
const budgetClause=/the owner's new message [^.]+\./
export const historicalDrawingResumeDescription=DESIGN_CAD_TOOL.function.parameters.properties.request_id.description.replace(budgetClause,old.match(budgetClause)![0])
