// Real Bob acceptance with an existing named-member session, never a guest,
// minted token or service-key write. No fixture supplies parts or tool calls.
// Existing plan test config owns credential validation. Keep secrets in runner env.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {mkdir,writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {createClient} from '@supabase/supabase-js'
import {planTestConfig,requirePlanTestMember} from './check-live-plan-assistant.mjs'
import {checkConstruction} from '../supabase/functions/_shared/construction-checks.ts'

const {url,key,token,memberId}=planTestConfig({...process.env,BOB_PLAN_LIVE_CONFIRM:process.env.BOB_K2_LIVE_CONFIRM})
const client=createClient(url,key,{db:{schema:'bob'},global:{headers:{Authorization:'Bearer '+token},fetch:(input,init={})=>fetch(input,{...init,signal:AbortSignal.timeout(30000)})},auth:{persistSession:false,autoRefreshToken:false}})
const checked=(r:any)=>{assert(!r.error,'Caller operation failed; inspect scoped logs without printing request credentials.');return r.data}
await requirePlanTestMember(client,token,memberId)
const project=checked(await client.rpc('create_project',{p_input:{name:'K2 model acceptance '+randomUUID(),description:'Disposable synthetic construction test, no real project data.',type:'Verification'}}))
console.log('BOB_K2_SMOKE_PROJECT_ID='+project.id)
const report:any={projectId:project.id,startedAt:new Date().toISOString(),turns:[],notProven:['manufacturing','strength','annotated rendering','purchasing','named participant/mobile acceptance']}
try{
 async function send(message:string){
  const turn=randomUUID(),accepted=checked(await client.functions.invoke('ask-bob',{body:{action:'send',projectId:project.id,clientTurnId:turn,message,background:true}}))
  assert(accepted.status==='accepted'&&accepted.jobId,'Durable member turn required')
  report.turns.push({turn,jobId:accepted.jobId,message,status:'waiting'})
  const deadline=Math.min(Date.now()+12*60000,Date.parse(accepted.expiresAt)-30000)
  while(Date.now()<deadline){
   const job=checked(await client.rpc('bob_job_status',{p_project:project.id,p_turn:turn}))
   if(job.status==='failed')throw Error('Model turn failed; retain fixture and inspect budget/job diagnostics. No paid retry submitted.')
   if(job.status==='completed'){report.turns.at(-1).status='completed';return}
   await delay(5000)
  }
  throw Error('Timed out waiting; inspect the same job instead of submitting a duplicate turn.')
 }
 async function inspect(){
  const listed=checked(await client.rpc('read_construction_draft',{p_project:project.id}))
  assert.equal(listed.items.length,1,'Bob must save one construction without injected parts/tool calls')
  const draft=checked(await client.rpc('read_construction_draft',{p_project:project.id,p_artifact:listed.items[0].id}))
  const catalog=new Map<string,any>()
  for(const binding of draft.materials)for(const kind of ['material','part'])if(binding[kind+'_id']){
   const id=binding[kind+'_id'],revision=binding[kind+'_revision'],key=id+'@'+revision
   if(!catalog.has(key))catalog.set(key,checked(await client.rpc('catalog_read',{p_project:project.id,p_input:{action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}}})).record)
  }
  const result=checkConstruction(draft,catalog,new Date().toISOString().slice(0,10))
  assert(result.concept_ready,JSON.stringify(result.issues));assert.equal(result.fabrication_ready,false)
  assert.equal(result.part_count,5);assert.equal(result.joint_count,6)
  return {draft,result}
 }
 await send('Ta fram och spara ett konstruktionskoncept för en fristående hylla, 600 mm bred, 800 mm hög och 300 mm djup som yttermått. Välj plywood 18 mm som arbetsmaterial, två hela gavlar samt botten, topp och ett hyllplan mitt emellan, alla tre mellan gavlarna. Välj skruvade stumförband för detta syntetiska koncept och kontrollera att delarna passar. Välj och spara den lösningen; du får själv bestämma vanliga konstruktionsdetaljer. Produktval, belastning och tippsäkring är ännu inte verifierade. Ingen bild, ritning eller inköpsorder behövs nu.')
 const first=await inspect();assert.deepEqual(first.result.bounds_mm.size,[600,300,800]);report.initial=first
 await send('Ändra samma konstruktion till 700 mm ytterbredd. Behåll höjd, djup, material och byggsätt, räkna om de beroende måtten och kontrollera igen.')
 const wide=await inspect();assert.equal(wide.draft.artifact_id,first.draft.artifact_id);assert.deepEqual(wide.result.bounds_mm.size,[700,300,800]);report.widthChange=wide
 await send('Byt nu till 21 mm plywood som arbetsmaterial i samma konstruktion. Behåll alla yttermått och byggsätt. Uppdatera materialbindningar, beroende mått och kontrollera igen.')
 const thick=await inspect();assert.equal(thick.draft.artifact_id,first.draft.artifact_id);assert.deepEqual(thick.result.bounds_mm.size,[700,300,800]);report.thicknessChange=thick
 const ids=(d:any)=>d.recipe.instances.map((i:any)=>i.id).sort()
 assert.deepEqual(ids(thick.draft),ids(first.draft));assert.deepEqual(ids(wide.draft),ids(first.draft))
 const historical=checked(await client.rpc('read_construction_draft',{p_project:project.id,p_artifact:first.draft.artifact_id,p_revision:first.draft.revision}))
 assert.deepEqual(historical.recipe,first.draft.recipe);assert.deepEqual(historical.joints,first.draft.joints)
 report.passed=true
}catch(error){report.passed=false;report.error=error instanceof Error?error.message:'Acceptance failed';process.exitCode=1}
finally{
 // Synthetic fixture only; never serialize tokens, request objects or user rows.
 const reportPath=process.env.BOB_K2_REPORT??'test-results/live-construction.json'
 await mkdir(dirname(reportPath),{recursive:true})
 await writeFile(reportPath,JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify({projectId:project.id,passed:report.passed,turns:report.turns.map((t:any)=>({turn:t.turn,status:t.status}))}))
}
