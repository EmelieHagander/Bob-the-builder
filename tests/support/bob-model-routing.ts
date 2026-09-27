/** Tool/domain unit tests script the executing model. The only non-executing call
 * left in a turn is on-demand localisation of a server notice; keep it explicit.
 * End-to-end autonomy and delivery tests import the production loop directly. */
import { runProjectAnswer as answer, type ModelCall } from '../../supabase/functions/_shared/project-answer.ts'
import { runClaimedProjectTurn as turn } from '../../supabase/functions/_shared/project-turn.ts'
export { seedToolPolicy, buildBobSystemMessage, BOB_SYSTEM_SECTIONS, BOB_TRUTH_RULES } from '../../supabase/functions/_shared/project-answer.ts'
export type { ModelCall, ProjectAnswer } from '../../supabase/functions/_shared/project-answer.ts'
function routing(call:ModelCall):ModelCall{return async options=>{
 if(options.schemaName==='bob_delivery_language')return {success:false,data:null,model:'language-fixture',usage:{input_tokens:0,output_tokens:0,total_tokens:0}}
 return call(options)
}}
export const runProjectAnswer=(options:Parameters<typeof answer>[0])=>answer({...options,callModel:routing(options.callModel)})
export const runClaimedProjectTurn=(options:Parameters<typeof turn>[0])=>turn({...options,callModel:routing(options.callModel)})
