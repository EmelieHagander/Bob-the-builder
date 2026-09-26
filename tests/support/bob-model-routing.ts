/** Existing tool/domain unit tests script the executing model, not the two
 * read-only routing calls. Keep that fixture explicit. End-to-end autonomy and
 * delivery tests import the production loop directly and script every call. */
import { runProjectAnswer as answer, type ModelCall } from '../../supabase/functions/_shared/project-answer.ts'
import { runClaimedProjectTurn as turn } from '../../supabase/functions/_shared/project-turn.ts'
export { seedToolPolicy, buildBobSystemMessage, BOB_SYSTEM_SECTIONS, BOB_TRUTH_RULES } from '../../supabase/functions/_shared/project-answer.ts'
export type { ModelCall, ProjectAnswer } from '../../supabase/functions/_shared/project-answer.ts'
function routing(call:ModelCall):ModelCall{return async options=>{
 if(options.schemaName==='bob_delivery_language')return {success:false,data:null,model:'language-fixture',usage:{input_tokens:0,output_tokens:0,total_tokens:0}}
 if(options.schemaName==='bob_work_delivery')return {success:true,data:JSON.stringify({goals:[],request_quote:null}),model:'routing-fixture',responseId:'route',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
 if(options.schemaName==='bob_capability_search'){
  const {query,catalog}=JSON.parse(String(options.messages![0].content))
  const names=catalog.filter((r:any)=>(r.name+' '+r.description).toLowerCase().includes(query.toLowerCase())).map((r:any)=>r.name)
  return {success:true,data:JSON.stringify({names}),model:'routing-fixture',responseId:'search',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
 }
 return call(options)
}}
export const runProjectAnswer=(options:Parameters<typeof answer>[0])=>answer({...options,callModel:routing(options.callModel)})
export const runClaimedProjectTurn=(options:Parameters<typeof turn>[0])=>turn({...options,callModel:routing(options.callModel)})
