// Ordinary-member K3 probe. Reuse a caller-owned synthetic K2 project, never
// seed parts/tool calls or submit a paid retry after a failed/uncertain turn.
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {mkdir,writeFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {createClient} from '@supabase/supabase-js'
import {planTestConfig,requirePlanTestMember} from './check-live-plan-assistant.mjs'
import {checkConstruction} from '../supabase/functions/_shared/construction-checks.ts'
import {parseCadAssemblyResult} from '../supabase/functions/_shared/cad-adapter.ts'

const {url,key,token,memberId}=planTestConfig({...process.env,BOB_PLAN_LIVE_CONFIRM:process.env.BOB_K3_LIVE_CONFIRM})
const projectId=process.env.BOB_K3_PROJECT_ID
assert(projectId&&/^p_[a-f0-9]{32}$/.test(projectId),'Exact synthetic project required')
const client=createClient(url,key,{db:{schema:'bob'},global:{headers:{Authorization:'Bearer '+token},fetch:(input,init={})=>fetch(input,{...init,signal:AbortSignal.timeout(30000)})},auth:{persistSession:false,autoRefreshToken:false}})
const checked=(r:any)=>{assert(!r.error,'Caller operation failed; inspect scoped diagnostics without exposing credentials');return r.data}
await requirePlanTestMember(client,token,memberId)
const project=checked(await client.from('projects').select('id,name,type').eq('id',projectId).single())
assert(project.type==='Verification'&&project.name.startsWith('K2 model acceptance '),'Only the existing synthetic K2 fixture is permitted')
const listed=checked(await client.rpc('read_construction_draft',{p_project:projectId}));assert.equal(listed.items.length,1)
const original=checked(await client.rpc('read_construction_draft',{p_project:projectId,p_artifact:listed.items[0].id}))
const catalog=new Map<string,any>()
for(const binding of original.materials)for(const kind of ['material','part'])if(binding[kind+'_id']){
 const id=binding[kind+'_id'],revision=binding[kind+'_revision']
 catalog.set(id+'@'+revision,checked(await client.rpc('catalog_read',{p_project:projectId,p_input:{action:'read',id,revision,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}}})).record)
}
assert(checkConstruction(original,catalog,new Date().toISOString().slice(0,10)).concept_ready)
const report:any={projectId,sourceArtifact:original.artifact_id,sourceRevision:original.revision,startedAt:new Date().toISOString(),notProven:['fabrication','strength/stability','purchasing','browser login','another named participant/mobile acceptance']}
const reportPath=process.env.BOB_K3_REPORT??'test-results/live-construction-drawing.json'
try{
 const turn=randomUUID(),message='Gör och spara nu en måttsatt konceptritning av samma nuvarande sparade hyllkonstruktion. Behåll exakt dess delar, material, förband och mått; bygg inte en andra konstruktion. Visa front, höger, ovanifrån och isometrisk vy med mått och delbeteckningar. Koppla ritningen till ett lämpligt arbetssteg och återläs den sparade versionen. Du får skapa och godkänna en kort arbetsplan för detta syntetiska projekt om ingen plan finns. Produktval, skruvdata, belastning och tippsäkring är fortfarande öppna kontroller, så ritningen ska uttryckligen vara ett koncept.'
 const accepted=checked(await client.functions.invoke('ask-bob',{body:{action:'send',projectId,clientTurnId:turn,message,background:true}}))
 assert.equal(accepted.status,'accepted');assert(accepted.jobId)
 report.turn=turn;report.jobId=accepted.jobId;report.message=message
 console.log(JSON.stringify({projectId,turn,jobId:accepted.jobId,status:'accepted'}))
 const until=Math.min(Date.now()+12*60000,Date.parse(accepted.expiresAt)-30000)
 let completed=false,nextProgress=Date.now()+30000
 while(Date.now()<until){
  const job=checked(await client.rpc('bob_job_status',{p_project:projectId,p_turn:turn}))
  report.jobStatus=job.status
  if(job.status==='failed')throw Error('The same live job failed; inspect it before any paid retry')
  if(job.status==='completed'){completed=true;break}
  if(Date.now()>nextProgress){console.log(JSON.stringify({turn,status:job.status}));nextProgress=Date.now()+30000}
  await delay(5000)
 }
 assert(completed,'Waiting timed out; inspect this same job, never submit a duplicate')
 const rows=checked(await client.from('artifact_cad_revisions').select('artifact_id,artifact_revision,recipe,manifest,files').eq('project_id',projectId))
 const drawings=rows.filter((r:any)=>r.manifest.bob_construction?.artifact_id===original.artifact_id&&r.manifest.bob_construction?.revision===original.revision)
 assert.equal(drawings.length,1,'Exactly one drawing of the checked checkpoint must be saved')
 const drawing=drawings[0],recipe={...original.recipe,views:['front','right','top','isometric']}
 assert.deepEqual({...drawing.recipe,views:recipe.views},recipe)
 assert.deepEqual([...drawing.recipe.views].sort(),[...recipe.views].sort())
 assert(parseCadAssemblyResult(drawing.manifest,drawing.recipe),'Saved engine/annotation contract required')
 assert.equal(drawing.manifest.annotations.coverage,'complete');assert.equal(drawing.manifest.bob_construction.check.fabrication_ready,false)
 const fileHashes:Record<string,string>={}
 await mkdir(dirname(reportPath),{recursive:true})
 for(const [view,encoded] of Object.entries(drawing.files)){
  const bytes=Buffer.from(encoded as string,'base64');fileHashes[view]=createHash('sha256').update(bytes).digest('hex')
  assert.equal(fileHashes[view],drawing.manifest.exports[view].sha256)
  if(view!=='step')await writeFile(join(dirname(reportPath),'k3-'+view+'.svg'),bytes)
 }
 const links=checked(await client.from('current_drawing_steps').select('step_id,artifact_revision').eq('project_id',projectId).eq('artifact_id',drawing.artifact_id))
 assert(links.length>0,'Saved drawing must be linked to actual current work')
 assert(links.every((l:any)=>l.artifact_revision===drawing.artifact_revision))
 const reopened=checked(await client.rpc('read_cad_artifact',{p_project:projectId,p_artifact:drawing.artifact_id,p_revision:drawing.artifact_revision}))
 assert.deepEqual(reopened.recipe,drawing.recipe);assert.deepEqual(reopened.manifest.bob_construction,drawing.manifest.bob_construction)
 const sourceAgain=checked(await client.rpc('read_construction_draft',{p_project:projectId,p_artifact:original.artifact_id,p_revision:original.revision}))
 assert.equal(sourceAgain.current_revision,original.revision);assert.deepEqual(sourceAgain.recipe,original.recipe);assert.deepEqual(sourceAgain.joints,original.joints)
 const requests=checked(await client.rpc('project_drawing_requests',{p_project:projectId,p_id:null,p_after:null}))
 const receipt=requests.requests.find((r:any)=>r.artifact_id===drawing.artifact_id&&r.artifact_revision===drawing.artifact_revision)
 assert.equal(receipt?.status,'saved','Drawing request must have verified delivery receipt')
 report.drawing={artifactId:drawing.artifact_id,revision:drawing.artifact_revision,recipe:drawing.recipe,manifest:drawing.manifest,fileHashes,links,request:receipt};report.passed=true
}catch(error){report.passed=false;report.error=error instanceof Error?error.message:'K3 acceptance failed';process.exitCode=1}
finally{
 report.finishedAt=new Date().toISOString();await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify({projectId,turn:report.turn,status:report.jobStatus,passed:report.passed}))
}
