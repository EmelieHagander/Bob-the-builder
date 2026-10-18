import {readFileSync} from 'node:fs'

/** Immutable migration contracts reproduce their original wording and fields.
 * Current schemas are verified against the newest publication separately. */
const parameterPublication=readFileSync(new URL('../supabase/migrations/20261010222920_ai_construction_parameter_catalog.sql',import.meta.url),'utf8')
export const historicalDrawingResumeDescription=JSON.parse(parameterPublication.match(/\$parameter_contracts\$([\s\S]+?)\$parameter_contracts\$/)![1]).find((c:any)=>c.name==='design_project_cad').parameters.properties.request_id.description as string
const taskPublication=readFileSync(new URL('../supabase/migrations/20261012090928_ai_task_budget_catalog.sql',import.meta.url),'utf8')
export const historicalTaskResumeDescription=JSON.parse(taskPublication.match(/\$task_budget_tool\$([\s\S]+?)\$task_budget_tool\$/)![1]).request_id_description as string

const budgetStopPublication=readFileSync(new URL('../supabase/migrations/20261013060000_ai_budget_stop_catalog.sql',import.meta.url),'utf8')
export const historicalBudgetStopResumeDescription=JSON.parse(budgetStopPublication.match(/\$budget_stop_contracts\$([\s\S]+?)\$budget_stop_contracts\$/)![1]).find((c:any)=>c.key==='tools.design_project_cad').parameters.properties.request_id.description as string

// Mandatory construction inputs have a later publication. Reproduce complete
// historical contracts rather than projecting today's schema into old versions.
export const historicalBudgetStopContracts=JSON.parse(budgetStopPublication.match(/\$budget_stop_contracts\$([\s\S]+?)\$budget_stop_contracts\$/)![1])
export const historicalConstructionParameterContracts=JSON.parse(parameterPublication.match(/\$parameter_contracts\$([\s\S]+?)\$parameter_contracts\$/)![1])
const handoffPublication=readFileSync(new URL('../supabase/migrations/20261010063726_cad_handoff_server_ids.sql',import.meta.url),'utf8')
export const historicalCadHandoffContracts=JSON.parse(handoffPublication.match(/\$cad_handoff_contracts\$([\s\S]+?)\$cad_handoff_contracts\$/)![1])

// Retired CAD model paths retain only immutable publication evidence.
const intakePublication=readFileSync(new URL('../supabase/migrations/20261010120401_cad_intake_execution_recovery.sql',import.meta.url),'utf8')
export const historicalIntakeRecoveryContracts=JSON.parse(intakePublication.match(/\$cad_intake_recovery\$([\s\S]+?)\$cad_intake_recovery\$/)![1])
const revisionPublication=readFileSync(new URL('../supabase/migrations/20261010173130_cad_revision_dimension_bindings.sql',import.meta.url),'utf8')
export const historicalCadRevisionContracts=JSON.parse(revisionPublication.match(/\$cad_revision_contracts\$([\s\S]+?)\$cad_revision_contracts\$/)![1])
