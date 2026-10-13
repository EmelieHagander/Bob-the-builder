/** Explicit catalog injection for domain tests. Provider-wire tests use the
 * same database seed and catalog binder before the real provider adapter. */
import {catalogFixture,catalogCall,DRAWING_REVIEW_INSTRUCTION} from './ai-catalog-fixture.ts'
import type {AiCatalogSession} from '../../supabase/functions/_shared/ai-catalog.ts'
import {createCadAssistant as cad} from '../../supabase/functions/_shared/cad-assistant.ts'
import {collectCadResearch as research} from '../../supabase/functions/_shared/cad-research.ts'
import {createPlanAssistant as plan} from '../../supabase/functions/_shared/plan-assistant.ts'
import {prepareWorkingContext as context} from '../../supabase/functions/_shared/bob-working-context.ts'
import {createDeliveryLanguage as language} from '../../supabase/functions/_shared/delivery-language.ts'
import {drawingResumeReply as resume} from '../../supabase/functions/_shared/drawing-resume-reply.ts'
import {createProjectContext as images} from '../../supabase/functions/_shared/project-context/dispatcher.ts'
import type {DesignReadiness} from '../../supabase/functions/_shared/project-design-intent.ts'
export * from '../../supabase/functions/_shared/plan-assistant.ts'
export * from '../../supabase/functions/_shared/bob-working-context.ts'
export * from '../../supabase/functions/_shared/delivery-language.ts'
export * from '../../supabase/functions/_shared/drawing-resume-reply.ts'
export * from '../../supabase/functions/_shared/project-context/dispatcher.ts'
export * from '../../supabase/functions/_shared/drawing-review.ts'
export {DRAWING_REVIEW_INSTRUCTION}
/** Unrelated geometry fixtures supply explicit synthetic decisions. Production
 * never manufactures readiness for a missing selected Solution packet. */
export function fixtureDesignReadiness(project_id:string,solution_id:string,target_revision=1,area_id:string|null=null,purpose:'illustration'|'concept'|'construction'='concept'):DesignReadiness{
 const pin={version:1 as const,project_id,area_id,target_revision,solution_id,solution_revision:1,purpose}
 return {status:'ready',project_id,area_id,target_revision,solution_id,solution_revision:1,purpose,design_intent:{version:1,purpose,summary:'Synthetic fixture scope already discussed',references:[],features:[],choices:[],alignment:{status:'aligned',basis:'Explicit synthetic fixture instruction'}},issues:[],deferred_choice_ids:[],pin}
}
export function createCadAssistant(opts:Omit<Parameters<typeof cad>[0],'aiCatalog'>&{aiCatalog?:AiCatalogSession}){
 const session=opts.aiCatalog??catalogFixture()
 const makeLookup=()=>{
  const source=opts.makeLookup()
  return {...source,get remaining(){return source.remaining},get partial(){return source.partial},search:async(input:unknown)=>{
   const result=await source.search(input)
   if(result.dataset!=='target')return result
   return {...result,records:result.records.map(row=>({...row,solution_id:typeof row.solution_id==='string'&&!/^[0-9a-f-]{36}$/i.test(row.solution_id)?'44444444-4444-4444-8444-444444444444':row.solution_id}))}
  }}
 }
 return cad({...opts,makeLookup,aiCatalog:session,readDesignReadiness:opts.readDesignReadiness??(async(targetRevision,purpose,areaId)=>{
  const lookup=makeLookup(),input={dataset:'target' as const,query:null,status:null,area_id:areaId??null,record_id:areaId==null?'project':null,after_id:null}
  let target=await lookup.search(input)
  if(target.status==='empty'&&areaId!=null)target=await lookup.search({...input,area_id:null,record_id:'project'})
  const row=target.records[0]
  return fixtureDesignReadiness(opts.projectId,String(row?.solution_id??'synthetic-solution'),targetRevision,areaId??null,purpose??'concept')
 }),callModel:catalogCall(opts.callModel,session)})
}
export function collectCadResearch(opts:Omit<Parameters<typeof research>[0],'aiCatalog'>&{aiCatalog?:AiCatalogSession}){const session=opts.aiCatalog??catalogFixture();return research({...opts,aiCatalog:session,callModel:catalogCall(opts.callModel,session)})}
export function createPlanAssistant(opts:Omit<Parameters<typeof plan>[0],'aiCatalog'>&{aiCatalog?:AiCatalogSession}){const session=opts.aiCatalog??catalogFixture();return plan({...opts,aiCatalog:session,callModel:catalogCall(opts.callModel,session)})}
export function prepareWorkingContext(opts:Parameters<typeof context>[0]){return context({...opts,get deadline(){return opts.deadline},callModel:catalogCall(opts.callModel)})}
export function createDeliveryLanguage(opts:Parameters<typeof language>[0]&{aiCatalog?:AiCatalogSession}){return language({...opts,callModel:catalogCall(opts.callModel,opts.aiCatalog??catalogFixture())})}
export function drawingResumeReply(opts:Parameters<typeof resume>[0]){return resume({...opts,callModel:catalogCall(opts.callModel)})}
export function createProjectContext(opts:Parameters<typeof images>[0]){return images({...opts,reviewInstruction:opts.reviewInstruction??DRAWING_REVIEW_INSTRUCTION,imageEvidenceInstruction:opts.imageEvidenceInstruction??catalogFixture().text('images.evidence-intro'),reviewLabel:opts.reviewLabel??catalogFixture().text('images.review-label')})}
