import {readFileSync} from 'node:fs'

/** Old publications keep their instruction wording. The task-budget release
 * replaces that one field in a new immutable version; schema checks still
 * compare every structural field against today's executable declaration. */
const parameterPublication=readFileSync(new URL('../supabase/migrations/20261010222920_ai_construction_parameter_catalog.sql',import.meta.url),'utf8')
export const historicalDrawingResumeDescription=JSON.parse(parameterPublication.match(/\$parameter_contracts\$([\s\S]+?)\$parameter_contracts\$/)![1]).find((c:any)=>c.name==='design_project_cad').parameters.properties.request_id.description as string
const taskPublication=readFileSync(new URL('../supabase/migrations/20261012090928_ai_task_budget_catalog.sql',import.meta.url),'utf8')
export const historicalTaskResumeDescription=JSON.parse(taskPublication.match(/\$task_budget_tool\$([\s\S]+?)\$task_budget_tool\$/)![1]).request_id_description as string
