/** Legacy designer tests script the designer. Independent-review and handoff
 * regressions import the production assistant directly in cad-review.test.ts. */
import { createCadAssistant as production } from '../../supabase/functions/_shared/cad-assistant.ts'
import type { DesignHandoff } from '../../supabase/functions/_shared/cad-review.ts'
export const handoff:DesignHandoff={deliverable:'Synthetic concept',requirements:[{id:'shape',requirement:'Preserve the requested concept dimensions',basis:'user_request',source_ref:null}],coordinates:{origin:null,positive_x:null,positive_y:null,positive_z:'up'},views:['front','top'],unresolved:['Physical site fit']}
export const reviewReply=(h:DesignHandoff=handoff)=>({success:true,data:JSON.stringify({verdict:'pass',summary:'Independent fixture review passed.',requirements:h.requirements.map(r=>({id:r.id,status:'met',evidence:'Synthetic geometry fixture'})),issues:[]}),responseId:'review-response',model:'review-fixture',usage:{input_tokens:1,output_tokens:1,total_tokens:2}})
export function createCadAssistant(opts:Parameters<typeof production>[0]){
  return production({...opts,
    callModel:async o=>o.schemaName==='bob_cad_review'?reviewReply():opts.callModel(o),
    render:async r=>{const packet=await opts.render(r);return {...packet,previews:{...Object.fromEntries(r.views.map(v=>[v,'Zml4dHVyZQ=='])),...packet.previews}}},
  })
}
