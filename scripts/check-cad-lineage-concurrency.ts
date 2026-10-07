/** Real multi-connection test. Only an empty, disposable local PostgreSQL DB. */
import assert from 'node:assert/strict'
import {parameterPacket} from '../tests/support/cad-parameter-fixture.ts'
import {constructionLists} from '../supabase/functions/_shared/construction-lists.ts'
import {constructionCutFit} from '../supabase/functions/_shared/construction-cut-fit.ts'
import {drawingCandidateCommitment} from '../supabase/functions/_shared/drawing-request-recovery.ts'
import {spawn} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {installProjectSchema} from '../tests/support/project-schema.ts'

assert.equal(process.env.BOB_DISPOSABLE_POSTGRES, '1', 'Explicit disposable-database opt-in required')
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST ?? ''), 'Local database only')
assert.equal(process.env.PGDATABASE, 'bob_lineage_concurrency', 'Dedicated test database required')
const literal=(v:unknown)=>"'"+String(v).replaceAll("'","''")+"'"
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
function start(sql:string, app='cad-race-'+randomUUID()) {
  const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'], {
    env:{...process.env,PGAPPNAME:app},stdio:['pipe','pipe','pipe'],
  })
  let stdout='',stderr=''
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b)
  const done=new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
    child.on('error',reject);child.on('close',code=>resolve({code,stdout:stdout.trim(),stderr}))
  })
  child.stdin.end(sql)
  return {app,done}
}
async function query(sql:string) {
  const result=await start(sql).done
  assert.equal(result.code,0,result.stderr)
  return result.stdout
}
async function json(sql:string) {return JSON.parse(await query(sql))}
async function waiting(app:string, blocker:number) {
  const until=Date.now()+15000
  while(Date.now()<until){
    const row=await json(`select coalesce((select jsonb_build_object('pid',pid,'blocked',${blocker}=any(pg_blocking_pids(pid))) from pg_stat_activity where application_name=${literal(app)}),'null')`)
    if(row?.blocked)return row.pid as number
    await delay(50)
  }
  assert.fail(`No observed blocking dependency for ${app}`)
}
async function gate(key:number){
  const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env:{...process.env,PGAPPNAME:'cad-race-gate'},stdio:['pipe','pipe','pipe']})
  let output='',errors=''
  const closed=new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(errors)))})
  child.stderr.on('data',b=>errors+=b)
  const ready=new Promise<number>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Gate did not start')),10000)
    child.on('error',e=>{clearTimeout(timer);reject(e)})
    child.stdout.on('data',b=>{output+=b;const match=output.match(/READY:(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]))}})
  })
  child.stdin.write(`select pg_advisory_lock(${key}); select 'READY:'||pg_backend_pid();\n`)
  const pid=await ready
  return {pid,close:async()=>{child.stdin.end('\\q\n');await closed}}
}

assert.equal(await query("select count(*) from pg_namespace where nspname in ('bob','auth','shared','storage')"),'0','Refusing to alter a non-empty database')
await installProjectSchema({exec:async(sql:string)=>{await query(sql);return []}})
const fixture=await readFile(new URL('./cad-lineage-concurrency-fixture.sql',import.meta.url),'utf8')
const mutations={
  image:(f:any)=>`select bob.media_command(${literal(f.project)},'begin_delete',${literal(f.image)},'{}')`,
  measurement:(f:any)=>`select bob.evidence_command(${literal(f.project)},'measurement','revise',${literal(f.project_measure)},1,'{"subject":"Panel depth","value":"31.000","unit":"cm","truth":"provided_spec","source":"Concurrent fixture","required":true,"change_note":"Concurrent revision"}')`,
  space:(f:any)=>`select bob.physical_node_command(${literal(f.building)},'space','revise',${literal(f.space)},1,${literal(JSON.stringify({name:'Changed room',kind:'room',truth:'measured',source:'Concurrent fixture',measurements:[{id:f.physical_measure,revision:1}],change_note:'Concurrent accepted revision'}))})`,
  scope:(f:any)=>`select bob.physical_scope_command(${literal(f.project)},'project','unlink',${literal(f.scope)},'{}')`,
  building:(f:any)=>`select bob.physical_building_command('archive',${literal(f.building)},1,'{}')`,
}
let cases=0
for(const [kind,mutation] of Object.entries(mutations))for(const first of ['source','save']) {
  await query('drop table if exists public.cad_race_fixture;'+fixture)
  const f=await json('select data from public.cad_race_fixture')
  const auth=`select set_config('request.jwt.claims',${literal(JSON.stringify({sub:f.actor}))},true);set local role authenticated;`
  const save=(payload:any)=>`select bob.bob_project_write_v11(${literal(f.project)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(JSON.stringify(payload))})`
  const transaction=(sql:string,tail='')=>`begin;set local statement_timeout='30s';set local lock_timeout='20s';${auth}${sql};${tail}commit;`
  const baseline=JSON.parse((await query(transaction(save(f.payload)))).split('\n').at(-1)!)
  const control=structuredClone(f.payload)
  control.data.title='Independent panel';control.data.measurements=[];control.data.packet.manifest.bob_lineage.bindings=[]
  control.data.packet.manifest.bob_parameters=parameterPacket(f.project,control.data.packet.recipe)
  const independent=JSON.parse((await query(transaction(save(control)))).split('\n').at(-1)!)
  const next=structuredClone(f.payload);next.data.title='Racing save'
  const key=770000+cases, barrier=await gate(key)
  const leader=start(transaction(first==='source'?mutation(f):save(next),`select pg_advisory_xact_lock(${key});`))
  let follower:ReturnType<typeof start>|undefined
  try{
    const leaderPid=await waiting(leader.app,barrier.pid)
    follower=start(transaction(first==='source'?save(next):mutation(f)))
    await waiting(follower.app,leaderPid)
  }finally{await barrier.close()}
  const leadResult=await leader.done,followResult=await follower!.done
  assert.equal(leadResult.code,0,leadResult.stderr)
  if(first==='source'){
    assert.notEqual(followResult.code,0,'A save with an obsolete source/scope must fail')
    assert.match(followResult.stderr,['scope','building'].includes(kind)?/physical_source_unavailable/:/source_changed|image_changed|measurement.*(changed|revision)|stale_measurement/)
  }else assert.equal(followResult.code,0,followResult.stderr)
  const result=JSON.parse((await query(transaction(`select jsonb_build_object(
    'count',(select count(*) from bob.artifact_cad_revisions where project_id=${literal(f.project)}),
    'state',(select source_state from bob.artifact_source_status where artifact_id=${literal(baseline.recordId)} and revision=1),
    'independent',(select source_state from bob.artifact_source_status where artifact_id=${literal(independent.recordId)} and revision=1),
    'lineage',bob.read_cad_artifact(${literal(f.project)},${literal(baseline.recordId)},1)->'lineage')`))).split('\n').at(-1)!)
  assert.equal(result.count,first==='source'?2:3,'Failed saves must leave no CAD revision')
  assert.equal(result.state,kind==='scope'?'unavailable':'changed')
  assert.equal(result.independent,'current','Unrelated delivery must remain current')
  assert.deepEqual(result.lineage,f.payload.data.packet.manifest.bob_lineage,'History must remain exact')
  console.log(`PASS ${kind}, ${first} first: observed real lock wait, checked commit/readback/history`)
  cases++
}
for(const kind of ['duplicate','request-first','save-first','source-first','save-before-source']) {
  await query('drop table if exists public.cad_race_fixture;'+fixture)
  const f=await json('select data from public.cad_race_fixture')
  const auth=`select set_config('request.jwt.claims',${literal(JSON.stringify({sub:f.actor}))},true);set local role authenticated;`
  const transaction=(sql:string,tail='',service=false)=>`begin;set local statement_timeout='30s';set local lock_timeout='20s';${service?'set local role service_role;':auth}${sql};${tail}commit;`
  const working={brief:{brief:f.payload.request_quote},owner_request:f.payload.request_quote,reference_refs:[],reviewed_candidate:drawingCandidateCommitment(f.payload.data)}
  const requestCall=(op:string,id:string|null=null,revision=0,status:string|null=null,payload:unknown=null)=>`select bob.bob_drawing_request(${literal(f.project)},${literal(f.actor)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(op)},${id?literal(id):'null'},${revision},${status?literal(status):'null'},${payload?literal(JSON.stringify(payload)):'null'},${literal(randomUUID())})`
  const request=JSON.parse((await query(transaction(requestCall('save',null,0,'reviewed',working),'',true))).split('\n').at(-1)!)
  const payload={...f.payload,data:{...f.payload.data,drawing_request:{id:request.id,revision:request.revision}}}
  const save=`select bob.bob_project_write_v12(${literal(f.project)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(JSON.stringify(payload))})`
  const update=requestCall('save',request.id,request.revision,'collecting',working)
  const first=kind==='request-first'?update:kind==='source-first'?mutations.measurement(f):save
  const second=kind==='save-first'?update:kind==='save-before-source'?mutations.measurement(f):save
  const key=770000+cases,barrier=await gate(key)
  const leader=start(transaction(first,`select pg_advisory_xact_lock(${key});`,kind==='request-first'))
  let follower:ReturnType<typeof start>|undefined
  try{
    const leaderPid=await waiting(leader.app,barrier.pid)
    follower=start(transaction(second,'',kind==='save-first'))
    await waiting(follower.app,leaderPid)
  }finally{await barrier.close()}
  const lead=await leader.done,follow=await follower!.done
  assert.equal(lead.code,0,lead.stderr)
  if(['request-first','save-first','source-first'].includes(kind)){
    assert.notEqual(follow.code,0,'The losing conflicting operation must fail')
    assert.match(follow.stderr,kind==='request-first'?/drawing_request_changed/:kind==='save-first'?/drawing_request_complete/:/source_changed|stale_measurement|measurement.*(changed|revision)/)
  }else assert.equal(follow.code,0,follow.stderr)
  const state=JSON.parse((await query(transaction(requestCall('load',request.id),'',true))).split('\n').at(-1)!)
  const saved=!['request-first','source-first'].includes(kind)
  assert.equal(state.status,saved?'saved':kind==='request-first'?'collecting':'reviewed')
  assert.equal(await query(`select count(*) from bob.artifact_cad_revisions where project_id=${literal(f.project)}`),saved?'1':'0')
  if(saved){
    assert.ok(state.receipt?.recordId)
    assert.equal(state.receipt.revision,1)
    const source=JSON.parse((await query(transaction(`select to_jsonb(source_state) from bob.artifact_source_status where artifact_id=${literal(state.receipt.recordId)} and revision=1`))).split('\n').at(-1)!)
    assert.equal(source,kind==='save-before-source'?'changed':'current')
    if(kind==='duplicate'){
      const receipt=(output:string)=>JSON.parse(output.split('\n').find(line=>line.startsWith('{')&&line.includes('"recordId"'))!)
      assert.deepEqual(receipt(lead.stdout),receipt(follow.stdout),'both racing callers read the same durable receipt')
    }
  }else assert.equal(state.receipt,null)
  console.log(`PASS request ${kind}: observed real lock wait, checked one-or-zero Artifact and atomic request receipt`)
  cases++
}
for(const kind of ['cancel-first','save-before-cancel','project-duplicate','project-request-first']) {
  await query('drop table if exists public.cad_race_fixture;'+fixture)
  const f=await json('select data from public.cad_race_fixture'),id=randomUUID()
  const auth=`select set_config('request.jwt.claims',${literal(JSON.stringify({sub:f.actor}))},true);set local role authenticated;`
  const transaction=(sql:string,tail='',service=false)=>`begin;set local statement_timeout='30s';set local lock_timeout='20s';${service?'set local role service_role;':auth}${sql};${tail}commit;`
  const scope=Object.fromEntries(['area_id','component_id','step_id','artifact_id'].map(k=>[k,f.payload.data[k]??null]))
  await query(transaction(`select bob.create_drawing_request(${literal(f.project)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(id)},${literal(JSON.stringify(scope))})`))
  const working={brief:{...scope,brief:f.payload.request_quote},owner_request:f.payload.request_quote,reference_refs:[],reviewed_candidate:drawingCandidateCommitment(f.payload.data)}
  const requestCall=(op:string,revision=0,status:string|null=null)=>`select bob.bob_drawing_request(${literal(f.project)},${literal(f.actor)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(op)},${literal(id)},${revision},${status?literal(status):'null'},${literal(JSON.stringify(working))},${literal(randomUUID())})`
  const request=JSON.parse((await query(transaction(requestCall('save',0,'reviewed'),'',true))).split('\n').at(-1)!)
  const payload={...f.payload,data:{...f.payload.data,drawing_request:{id,revision:request.revision}}}
  const save=`select bob.bob_project_write_v12(${literal(f.project)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(JSON.stringify(payload))})`
  const cancel=`select bob.cancel_drawing_request(${literal(f.project)},${literal(id)},${request.revision})`
  const update=requestCall('save',request.revision,'collecting')
  const first=kind==='cancel-first'?cancel:kind==='project-request-first'?update:save
  const second=kind==='save-before-cancel'?cancel:save
  const key=770000+cases,barrier=await gate(key)
  const leader=start(transaction(first,`select pg_advisory_xact_lock(${key});`,kind==='project-request-first'))
  let follower:ReturnType<typeof start>|undefined
  try{
    const leaderPid=await waiting(leader.app,barrier.pid)
    follower=start(transaction(second));await waiting(follower.app,leaderPid)
  }finally{await barrier.close()}
  const lead=await leader.done,follow=await follower!.done
  assert.equal(lead.code,0,lead.stderr)
  if(kind==='project-duplicate')assert.equal(follow.code,0,follow.stderr)
  else{
    assert.notEqual(follow.code,0,'A cancelled, completed or advanced request fences the losing operation')
    assert.match(follow.stderr,kind==='cancel-first'?/drawing_request_cancelled/:kind==='save-before-cancel'?/drawing_request_complete/:/drawing_request_changed/)
  }
  const state=JSON.parse((await query(transaction(requestCall('load'),'',true))).split('\n').at(-1)!)
  const saved=['save-before-cancel','project-duplicate'].includes(kind)
  assert.equal(state.status,saved?'saved':kind==='cancel-first'?'cancelled':'collecting')
  assert.equal(await query(`select count(*) from bob.artifact_cad_revisions where project_id=${literal(f.project)}`),saved?'1':'0')
  const projection=JSON.parse((await query(transaction(`select bob.project_drawing_requests(${literal(f.project)},${literal(id)},null)`))).split('\n').at(-1)!).requests[0]
  assert.equal(projection.status,state.status);assert.equal(projection.revision,state.revision)
  if(saved)assert.equal(projection.artifact_id,state.receipt.recordId)
  if(kind==='project-duplicate'){
    const receipt=(output:string)=>JSON.parse(output.split('\n').find(line=>line.startsWith('{')&&line.includes('"recordId"'))!)
    assert.deepEqual(receipt(lead.stdout),receipt(follow.stdout))
  }
  console.log(`PASS project request ${kind}: observed real lock wait, stable identity and fenced completion`)
  cases++
}

// Restoration races use the real actor/request/plan locks and canonical writer.
for(const kind of ['restore-duplicate','cancel-before-restore','restore-before-cancel','plan-before-restore','plan-before-restored-save','restored-save-before-plan']) {
 await query('drop table if exists public.cad_race_fixture;'+fixture)
 const f=await json('select data from public.cad_race_fixture'),id=randomUUID()
 const auth=`select set_config('request.jwt.claims',${literal(JSON.stringify({sub:f.actor}))},true);set local role authenticated;`
 const transaction=(sql:string,tail='',role='authenticated')=>`begin;set local statement_timeout='30s';set local lock_timeout='20s';${auth}set local role ${role};${sql};${tail}commit;`
 const requirement={requirement_id:null,type:'drawing',title:'Synthetic concept',description:'Use current source-bound dimensions.',resolution:'open',responsible_kind:'bob',responsible_person_id:null,evidence_selector:{kind:'none',id:null,subject:null,area_id:null}}
 const step={step_id:null,title:'Concept',goal:'Source-bound drawing',state:'active',phase:'planning',area_id:null,responsible_kind:'bob',responsible_person_id:null,notes:'',requirements:[requirement]}
 const proposal={summary:'Synthetic plan',reason:'Concurrency fixture',steps:[step],task_links:[]}
 const propose=(expected:number)=>`select bob_private.project_plan_propose(${literal(f.project)},${expected},${literal(JSON.stringify(proposal))})`
 const decide=(expected:number,rev:number)=>`select bob_private.project_plan_decide(${literal(f.project)},${expected},${rev},'approve','Concurrency fixture')`
 await query(transaction(propose(0),'','postgres'))
 const plan=JSON.parse((await query(transaction(decide(0,1),'','postgres'))).split('\n').at(-1)!).record
 const scope={area_id:null,component_id:null,step_id:null,artifact_id:null}
 await query(transaction(`select bob.create_drawing_request(${literal(f.project)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(id)},${literal(JSON.stringify(scope))})`))
 const restore=`select bob.restore_drawing_request(${literal(f.project)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(id)},0,1,${literal(plan.steps[0].id)},${literal(f.payload.request_quote)})`
 const cancel=`select bob.cancel_drawing_request(${literal(f.project)},${literal(id)},0)`
 let save=''
 if(kind.includes('restored-save')){
  const restored=JSON.parse((await query(transaction(restore))).split('\n').at(-1)!)
  const working={...restored.payload,reviewed_candidate:drawingCandidateCommitment(f.payload.data)}
  const packet=JSON.parse((await query(transaction(`select bob.bob_drawing_request(${literal(f.project)},${literal(f.actor)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},'save',${literal(id)},1,'reviewed',${literal(JSON.stringify(working))},'reviewed')`,'','service_role'))).split('\n').at(-1)!)
  const payload={...f.payload,data:{...f.payload.data,drawing_request:{id,revision:packet.revision}}}
  save=`select bob.bob_project_write_v12(${literal(f.project)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(JSON.stringify(payload))})`
 }
 if(kind.includes('plan'))await query(transaction(propose(1),'','postgres'))
 const first=kind==='cancel-before-restore'?cancel:kind.startsWith('plan-before')?decide(1,2):kind==='restored-save-before-plan'?save:restore
 const second=kind==='restore-before-cancel'?cancel:kind==='restored-save-before-plan'?decide(1,2):kind==='plan-before-restored-save'?save:restore
 const key=770000+cases,barrier=await gate(key)
 const leader=start(transaction(first,`select pg_advisory_xact_lock(${key});`,kind.startsWith('plan-before')?'postgres':'authenticated'))
 let follower:ReturnType<typeof start>|undefined
 try{const pid=await waiting(leader.app,barrier.pid);follower=start(transaction(second,'',kind==='restored-save-before-plan'?'postgres':'authenticated'));await waiting(follower.app,pid)}finally{await barrier.close()}
 const lead=await leader.done,follow=await follower!.done;assert.equal(lead.code,0,lead.stderr)
 if(['restore-duplicate','restored-save-before-plan'].includes(kind))assert.equal(follow.code,0,follow.stderr)
 else {assert.notEqual(follow.code,0);assert.match(follow.stderr,kind==='cancel-before-restore'?/drawing_request_cancelled/:kind==='restore-before-cancel'?/drawing_request_changed/:/drawing_requirements_changed/)}
 const state=await json(`select jsonb_build_object('status',status,'revision',revision,'plan',recovery_plan_revision) from bob_private.project_drawing_requests where id=${literal(id)}`)
 assert.equal(state.status,kind==='cancel-before-restore'?'cancelled':kind==='plan-before-restore'?'paused':kind==='restored-save-before-plan'?'saved':kind==='plan-before-restored-save'?'reviewed':'collecting')
 assert.equal(await query(`select count(*) from bob.artifact_cad_revisions where project_id=${literal(f.project)}`),kind==='restored-save-before-plan'?'1':'0')
 if(kind==='restore-duplicate'){
  assert.equal(state.revision,1)
  const result=(out:string)=>JSON.parse(out.split('\n').find(line=>line.startsWith('{')&&line.includes('"payload"'))!)
  assert.deepEqual(result(lead.stdout),result(follow.stdout))
 }
 console.log(`PASS restoration ${kind}: observed lock wait; checked revision, terminal fence and Artifact count`);cases++
}
// Request identity and dispatch accounting must serialize across real connections.
for(const kind of ['identity-duplicate','budget-reservation','gap-link-conflict']){
 await query('drop table if exists public.cad_race_fixture;'+fixture)
 const f=await json('select data from public.cad_race_fixture'),id=randomUUID(),execution=randomUUID()
 const auth=`select set_config('request.jwt.claims',${literal(JSON.stringify({sub:f.actor}))},true);set local role authenticated;`
 const tx=(sql:string,tail='',service=false)=>`begin;set local statement_timeout='30s';set local lock_timeout='20s';${service?'set local role service_role;':auth}${sql};${tail}commit;`
 const scope={area_id:null,component_id:null,step_id:null,artifact_id:null}
 const resolve=(rid:string)=>`select bob.resolve_drawing_request(${literal(f.project)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(rid)},${literal(JSON.stringify(scope))},${literal('a'.repeat(64))})`
 let first=resolve(id),second=resolve(randomUUID())
 if(kind!=='identity-duplicate'){
  await query(tx(first))
  const packet={brief:{...scope},owner_request:'Fixture',reference_refs:[],assessment:{checks:[{id:'width',action:'measurement',blocking:true}],additional_needs:[]}}
  await query(tx(`select bob.bob_drawing_request(${literal(f.project)},${literal(f.actor)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},'save',${literal(id)},0,'needs_data',${literal(JSON.stringify(packet))},'fixture')`,'',true))
  if(kind==='budget-reservation'){
   first=`select bob.bob_drawing_budget(${literal(f.project)},${literal(f.actor)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(id)},${literal(execution)},${literal('b'.repeat(64))},'reserve',null)`
   second=first
  }else{
   const gap=await query(`select id from bob_private.drawing_gaps where request_id=${literal(id)}`)
   const one='t_'+randomUUID(),two='t_'+randomUUID()
   await query(`insert into bob.tasks(id,project_id,name,status) values(${literal(one)},${literal(f.project)},'Measure width','todo'),(${literal(two)},${literal(f.project)},'Other task','todo')`)
   const link=(task:string)=>`select bob.link_drawing_gap(${literal(f.project)},${literal(id)},1,${literal(gap)},${literal(task)},null)`
   first=link(one);second=link(two)
  }
 }
 const barrier=await gate(770000+cases),leader=start(tx(first,`select pg_advisory_xact_lock(${770000+cases});`,kind==='budget-reservation'))
 let follower:ReturnType<typeof start>|undefined
 try{const pid=await waiting(leader.app,barrier.pid);follower=start(tx(second,'',kind==='budget-reservation'));await waiting(follower.app,pid)}finally{await barrier.close()}
 const lead=await leader.done,follow=await follower!.done;assert.equal(lead.code,0,lead.stderr)
 if(kind==='gap-link-conflict'){assert.notEqual(follow.code,0);assert.match(follow.stderr,/drawing_gap_already_linked/)}
 else assert.equal(follow.code,0,follow.stderr)
 if(kind==='identity-duplicate')assert.equal(await query(`select count(*) from bob_private.project_drawing_requests where project_id=${literal(f.project)}`),'1')
 if(kind==='budget-reservation')assert.equal(await query(`select calls from bob_private.drawing_budgets where request_id=${literal(id)}`),'1')
 console.log(`PASS lifecycle ${kind}: observed real lock wait; one identity/reservation/link`);cases++
}
// K1: race the public claimed-turn checkpoint RPC, with the same source locks
// as CAD, but without renderer output or an artifact_cad_revisions insertion.
for(const kind of ['construction-duplicate','construction-revise','construction-source-first','construction-save-first']){
 await query('drop table if exists public.cad_race_fixture;'+fixture)
 const f=await json('select data from public.cad_race_fixture')
 const auth=`select set_config('request.jwt.claims',${literal(JSON.stringify({sub:f.actor}))},true);set local role authenticated;`
 const tx=(sql:string,tail='')=>`begin;set local statement_timeout='30s';set local lock_timeout='20s';${auth}${sql};${tail}commit;`
 const write=(p:any)=>`select bob.bob_project_write_v14(${literal(f.project)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(JSON.stringify(p))})`
 const materialPayload={kind:'catalog',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:f.payload.request_quote,data:{action:'ensure',key:'construction_material',kind:'material',name:'K1 race material',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'Synthetic race fixture',source_kind:'design_choice',source_quote:f.payload.request_quote,source_seq:null}}
 const material=JSON.parse((await query(tx(write(materialPayload)))).split('\n').at(-1)!)
 const recipe=structuredClone(f.payload.data.packet.recipe);recipe.definitions.forEach((d:any)=>d.material_ref=null)
 const p:any={kind:'construction',record_id:null,expected_updated_at:null,expected_revision:0,request_quote:f.payload.request_quote,data:{key:'checkpoint',title:'Race checkpoint',description:'Synthetic checkpoint',area_id:null,target_revision:f.payload.data.target_revision,change_note:'First checkpoint',recipe,parameters:f.payload.data.packet.manifest.bob_parameters,materials:recipe.definitions.map((d:any)=>({definition_id:d.id,material_id:material.recordId,material_revision:1,part_id:null,part_revision:null})),joints:[],open_questions:['Hardware and connections unchecked']}}
 let baseline:any=null
 if(kind!=='construction-duplicate')baseline=JSON.parse((await query(tx(write(p)))).split('\n').at(-1)!)
 if(kind==='construction-revise'){p.record_id=baseline.recordId;p.expected_revision=1;p.data.key='revisionA'}
 else if(baseline)p.data.key='secondCheckpoint'
 const other=structuredClone(p);if(kind==='construction-revise'){other.data.key='revisionB';other.data.description='Concurrent other edit'}
 const sourceFirst=kind==='construction-source-first',saveFirst=kind==='construction-save-first'
 const first=sourceFirst?mutations.measurement(f):write(p),second=saveFirst?mutations.measurement(f):write(other)
 const barrier=await gate(770000+cases),leader=start(tx(first,`select pg_advisory_xact_lock(${770000+cases});`))
 let follower:ReturnType<typeof start>|undefined
 try{const pid=await waiting(leader.app,barrier.pid);follower=start(tx(second));await waiting(follower.app,pid)}finally{await barrier.close()}
 const lead=await leader.done,follow=await follower!.done;assert.equal(lead.code,0,lead.stderr)
 if(sourceFirst||kind==='construction-revise'){assert.notEqual(follow.code,0);assert.match(follow.stderr,/construction_(measurement_)?changed/)}else assert.equal(follow.code,0,follow.stderr)
 assert.equal(await query(`select count(*) from bob.artifact_cad_revisions where project_id=${literal(f.project)}`),'0')
 assert.equal(await query(`select count(*) from bob.artifact_construction_revisions where project_id=${literal(f.project)}`),sourceFirst||kind==='construction-duplicate'?'1':'2')
 if(sourceFirst||saveFirst){const read=JSON.parse((await query(tx(`select bob.read_construction_draft(${literal(f.project)},${literal(baseline.recordId)},1,null)`))).split('\n').at(-1)!);assert.equal(read.source_state,'changed')}
 console.log(`PASS ${kind}: observed real lock wait; checkpoint CAS/replay/source freshness verified`);cases++
}
// K4: the same disposable PostgreSQL harness exercises shared sheet capacity.
for(const kind of ['cut-plan-competing','cut-plan-replay','cut-plan-manual-first','cut-plan-before-manual','cut-plan-stock-first','cut-plan-before-stock','cut-plan-source-first','cut-plan-before-source','cut-plan-release-first','shopping-competing','shopping-replay','shopping-edit-first','shopping-before-edit','shopping-source-first','shopping-before-source','shopping-withdraw-first','mixed-reserve-first','mixed-publish-first','mixed-release-publish','mixed-withdraw-reserve','mixed-competing','mixed-stock-first','mixed-before-stock']){
 await query('drop table if exists public.cad_race_fixture;'+fixture)
 const f=await json('select data from public.cad_race_fixture')
 const auth=`select set_config('request.jwt.claims',${literal(JSON.stringify({sub:f.actor}))},true);set local role authenticated;`
 const tx=(sql:string,tail='')=>`begin;set local statement_timeout='30s';set local lock_timeout='20s';${auth}${sql};${tail}commit;`
 const call=async(sql:string)=>JSON.parse((await query(tx(sql))).split('\n').at(-1)!)
 const write=(p:any)=>`select bob.bob_project_write_v16(${literal(f.project)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(JSON.stringify(p))})`
 const base={record_id:null,expected_updated_at:null,expected_revision:0,request_quote:f.payload.request_quote}
 const material=await call(write({...base,kind:'catalog',data:{action:'ensure',key:'reserve-material',kind:'material',name:'K4 race plywood',aliases:[],profile_code:'sheet_stock',profile_revision:1,categories:['wood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'Isolated race fixture',source_kind:'design_choice',source_quote:f.payload.request_quote,source_seq:null}}))
 const mixedCase=kind.startsWith('mixed-')
 const stock=randomUUID(),fmt={material_id:material.recordId,material_revision:1,length_mm:mixedCase?1000:2440,width_mm:mixedCase?320:1220,thickness_mm:18,grain:'length',basis:'provided_spec',note:'Isolated specified stock, not physical inspection'}
 const stockData={name:'Race sheet',specification:'Fixture',quantity:'1',unit:'pcs',status:'available',area_id:null,notes:'Fixture',change_note:'Initial',sheet_format:fmt}
 const stockCall=(action:string,revision:number,data:any)=>`select bob.stock_command(${literal(f.project)},${literal(action)},${literal(stock)},${revision},${literal(JSON.stringify(data))})`
 await call(stockCall('create',0,stockData))
 const shoppingCase=kind.startsWith('shopping-')
 const part=shoppingCase||mixedCase?await call(write({...base,kind:'catalog',data:{action:'ensure',key:'shopping-part',kind:'part',name:'K4 race raw panel',aliases:[],profile_code:'panel',profile_revision:1,categories:['wood','sheet'],properties:{length:{value:String(fmt.length_mm),unit:'mm',truth:'provided_spec',parameter:null,note:''},width:{value:String(fmt.width_mm),unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:material.recordId,material_revision:1,notes:'Isolated specified format',source_kind:'design_choice',source_quote:f.payload.request_quote,source_seq:null}})):null
 const plans:any[]=[]
 for(const key of ['first','second']){
  const recipe=structuredClone(f.payload.data.packet.recipe);recipe.definitions.forEach((d:any)=>d.material_ref=null)
  if(mixedCase)recipe.instances.push({...structuredClone(recipe.instances[0]),id:'second-panel',placement:{...recipe.instances[0].placement,x:1100}})
  const construction=await call(write({...base,kind:'construction',data:{key:'reserve-'+key,title:'Stock-bound race construction',description:'Isolated',area_id:null,target_revision:1,change_note:'Initial',recipe,parameters:mixedCase?parameterPacket(f.project,recipe):f.payload.data.packet.manifest.bob_parameters,materials:recipe.definitions.map((d:any)=>({definition_id:d.id,material_id:material.recordId,material_revision:1,part_id:null,part_revision:null})),joints:[],open_questions:['Hardware/access unknown']}}))
  const need=await call(write({...base,kind:'operational',data:{resource:'cad_requirement',action:'create',fields:{name:'Race blank '+key,category:'Timber',area_id:null,task_id:null,waste_percent:'0',purchase_increment:'1',assumptions:'Isolated',artifact_id:construction.recordId,artifact_revision:1,target_revision:1,definition_id:'panel',quantity_mode:'pieces',stock_allocations:[],component_allocations:[],change_note:'Initial'}}}))
  const draft=await call(`select bob.read_construction_draft(${literal(f.project)},${literal(construction.recordId)},1,null)`)
  const catalog=(await call(`select bob.catalog_read(${literal(f.project)},${literal(JSON.stringify({action:'read',id:material.recordId,revision:1,kind:null,query:null,after:null,profile_code:null,categories:[],properties:{}}))})`)).record
  const candidates=[{id:'sheet',...fmt,count:1,kerf_mm:3,trim_mm:5}],grains=[{definition_id:'panel',axis:'x'}]
  if(mixedCase)candidates.push({...candidates[0],id:'purchase'})
  const fit:any=constructionCutFit(constructionLists(draft,new Map([[material.recordId+'@1',catalog]]),[]),candidates,grains)
  assert.equal(fit.status,'feasible')
  const plan=await call(write({...base,kind:'cut_plan',data:{key:'plan-'+key,artifact_id:construction.recordId,artifact_revision:1,requirements:[{id:need.recordId,revision:1}],candidates,blank_grain:grains,candidate_sources:[{candidate_id:'sheet',kind:shoppingCase?'catalog_part':'stock',record_id:shoppingCase?part.recordId:stock,revision:1},...(mixedCase?[{candidate_id:'purchase',kind:'catalog_part',record_id:part.recordId,revision:1}]:[])],layout:Object.fromEntries(['placements','cuts','offcuts','used_sheets'].map(k=>[k,fit[k]])),change_note:'Checked race plan'}}))
  plans.push(plan)
 }
 if(mixedCase){
  const stockCommand=(action='reserve',revision=0,index=0)=>`select bob.material_cut_plan_stock_command(${literal(f.project)},${literal(action)},${literal(plans[index].recordId)},1,${revision},'Mixed stock commitment')`
  const purchase=(action='publish',revision=0)=>`select bob.material_cut_plan_shopping_command(${literal(f.project)},${literal(action)},${literal(plans[0].recordId)},1,${revision},'Mixed purchase commitment')`
  const change=stockCall('revise',1,{...stockData,notes:'Concurrent stock source change'})
  if(['mixed-release-publish','mixed-stock-first','mixed-before-stock'].includes(kind))await call(stockCommand())
  if(['mixed-release-publish','mixed-withdraw-reserve'].includes(kind))await call(purchase())
  const first=kind==='mixed-publish-first'?purchase():kind==='mixed-release-publish'?stockCommand('release',1):kind==='mixed-withdraw-reserve'?purchase('withdraw',1):kind==='mixed-stock-first'?change:kind==='mixed-before-stock'?purchase():stockCommand()
  const second=kind==='mixed-publish-first'||kind==='mixed-withdraw-reserve'?stockCommand():kind==='mixed-release-publish'?purchase('publish',1):kind==='mixed-competing'?stockCommand('reserve',0,1):kind==='mixed-before-stock'?change:purchase()
  const barrier=await gate(770000+cases),leader=start(tx(first,`select pg_advisory_xact_lock(${770000+cases});`))
  let follower:ReturnType<typeof start>|undefined
  try{const pid=await waiting(leader.app,barrier.pid);follower=start(tx(second));await waiting(follower.app,pid)}finally{await barrier.close()}
  const lead=await leader.done,follow=await follower!.done;assert.equal(lead.code,0,lead.stderr)
  if(['mixed-competing','mixed-stock-first'].includes(kind)){assert.notEqual(follow.code,0);assert.match(follow.stderr,/stock_capacity_changed|stock_changed/)}else assert.equal(follow.code,0,follow.stderr)
  const head=await call(`select bob.read_material_cut_plan(${literal(f.project)},${literal(plans[0].recordId)},1)`)
  assert.equal(head.supply.stock_sheets,1);assert.equal(head.supply.catalog_sheets,1);assert.equal(head.stock_reserved,false)
  assert.equal(head.supply.commitments_current,['mixed-reserve-first','mixed-publish-first'].includes(kind))
  const rows=await json(`select coalesce(jsonb_agg(qty),'[]') from bob.materials where project_id=${literal(f.project)}`)
  assert.deepEqual(rows,['mixed-competing','mixed-stock-first'].includes(kind)?[]:[kind==='mixed-withdraw-reserve'?'0 pcs':'1 pcs'])
  assert.equal(head.reservation.reserved,kind!=='mixed-release-publish')
  if(kind==='mixed-release-publish')assert.equal(head.supply.purchase_commitment_current,true)
  if(kind==='mixed-withdraw-reserve')assert.equal(head.supply.stock_commitment_current,true)
  if(kind==='mixed-before-stock'){assert.equal(head.source_state,'changed');assert.equal(head.shopping.published,true)}
  const held=await call(`select bob_private.read_stock_reservations(${literal(f.project)},${literal(stock)})`)
  assert.equal(held,kind==='mixed-release-publish'?0:1)
  console.log(`PASS ${kind}: observed lock wait; mixed portions, partial coverage and independent commitments checked`);cases++;continue
 }
 if(shoppingCase){
  const shoppingPayload={...base,kind:'cut_plan_shopping',record_id:plans[0].recordId,expected_revision:1,data:{action:'publish',shopping_revision:0,change_note:'Explicit catalog sheets'}}
  const publish=(index=0,revision=0)=>`select bob.material_cut_plan_shopping_command(${literal(f.project)},'publish',${literal(plans[index].recordId)},1,${revision},'Explicit catalog sheets')`
  const withdraw=`select bob.material_cut_plan_shopping_command(${literal(f.project)},'withdraw',${literal(plans[0].recordId)},1,1,'Withdraw only this contribution')`
  let materialId:string|undefined
  if(['shopping-edit-first','shopping-before-edit','shopping-withdraw-first'].includes(kind))materialId=(await call(publish())).shopping.contributions[0].material_id
  const edit=`update bob.materials set status='ordered' where project_id=${literal(f.project)} and id=${literal(materialId)}`
  const source=mutations.space(f)
  const first=kind==='shopping-edit-first'?edit:kind==='shopping-before-edit'||kind==='shopping-withdraw-first'?withdraw:kind==='shopping-source-first'?source:kind==='shopping-replay'?write(shoppingPayload):publish()
  const second=kind==='shopping-before-edit'?edit:kind==='shopping-edit-first'?withdraw:kind==='shopping-before-source'?source:kind==='shopping-source-first'?publish():kind==='shopping-replay'?write(shoppingPayload):publish(1)
  const barrier=await gate(770000+cases),leader=start(tx(first,`select pg_advisory_xact_lock(${770000+cases});`))
  let follower:ReturnType<typeof start>|undefined
  try{const pid=await waiting(leader.app,barrier.pid);follower=start(tx(second));await waiting(follower.app,pid)}finally{await barrier.close()}
  const lead=await leader.done,follow=await follower!.done;assert.equal(lead.code,0,lead.stderr)
  if(['shopping-edit-first','shopping-source-first'].includes(kind)){assert.notEqual(follow.code,0);assert.match(follow.stderr,/shopping_committed|sources_changed|physical_source_changed/)}else assert.equal(follow.code,0,follow.stderr)
  const head=await call(`select bob.read_material_cut_plan(${literal(f.project)},${literal(plans[0].recordId)},1)`)
  const rows=await json(`select coalesce(jsonb_agg(jsonb_build_object('qty',qty,'status',status)),'[]') from bob.materials where project_id=${literal(f.project)}`)
  if(kind==='shopping-source-first'){assert.equal(rows.length,0);assert.equal(head.shopping_revision,0)}
  else{
   assert.equal(rows.length,1);assert.equal(rows[0].qty,kind==='shopping-competing'?'2 pcs':kind==='shopping-before-edit'?'0 pcs':'1 pcs')
   if(kind==='shopping-before-source')assert.equal(head.shopping_ready,false)
   if(kind==='shopping-replay'){
    const receipt=(out:string)=>JSON.parse(out.split('\n').find(line=>line.startsWith('{')&&line.includes('"recordId"'))!)
    assert.deepEqual(receipt(lead.stdout),receipt(follow.stdout));assert.equal(head.shopping_revision,1)
   }
  }
  console.log(`PASS ${kind}: observed lock wait; aggregate, replay, purchase and source boundaries checked`);cases++;continue
 }
 const reservePayload=(index=0,action='reserve',revision=0)=>({...base,kind:'cut_plan_stock',record_id:plans[index].recordId,expected_revision:1,data:{action,reservation_revision:revision,change_note:'Explicit isolated shared-sheet commitment'}})
 const directReserve=(index:number)=>`select bob.material_cut_plan_stock_command(${literal(f.project)},'reserve',${literal(plans[index].recordId)},1,0,'Independent shared-sheet commitment')`
 const reserve=kind==='cut-plan-competing'?directReserve(0):write(reservePayload()),otherReserve=directReserve(1)
 const manual=`select bob.material_requirement_command(${literal(f.project)},'create',${literal(randomUUID())},0,${literal(JSON.stringify({name:'Manual race sheet need',category:'Timber',area_id:null,task_id:null,unit:'pcs',required_quantity:'1',waste_percent:'0',purchase_increment:'1',basis:'Isolated sheet count',assumptions:'Fixture',artifact_id:null,artifact_revision:null,target_revision:1,stock_allocations:[{id:stock,revision:1,quantity:'1'}],component_allocations:[],change_note:'Initial'}))})`
 const stockChange=stockCall('revise',1,{...stockData,notes:'Concurrent current-stock edit'})
 const sourceChange=mutations.space(f)
 if(kind==='cut-plan-release-first')await call(reserve)
 const first=kind==='cut-plan-manual-first'?manual:kind==='cut-plan-stock-first'?stockChange:kind==='cut-plan-source-first'?sourceChange:kind==='cut-plan-release-first'?write(reservePayload(0,'release',1)):reserve
 const second=kind==='cut-plan-competing'?otherReserve:kind==='cut-plan-before-manual'||kind==='cut-plan-release-first'?manual:kind==='cut-plan-before-stock'?stockChange:kind==='cut-plan-before-source'?sourceChange:reserve
 const barrier=await gate(770000+cases),leader=start(tx(first,`select pg_advisory_xact_lock(${770000+cases});`))
 let follower:ReturnType<typeof start>|undefined
 try{const pid=await waiting(leader.app,barrier.pid);follower=start(tx(second));await waiting(follower.app,pid)}finally{await barrier.close()}
 const lead=await leader.done,follow=await follower!.done;assert.equal(lead.code,0,lead.stderr)
 const failed=['cut-plan-competing','cut-plan-manual-first','cut-plan-before-manual','cut-plan-stock-first','cut-plan-source-first'].includes(kind)
 if(failed){assert.notEqual(follow.code,0);assert.match(follow.stderr,/capacity_changed|already reserved|stock_changed|physical_source_changed|sources_changed/)}else assert.equal(follow.code,0,follow.stderr)
 const head=await call(`select bob.read_material_cut_plan(${literal(f.project)},${literal(plans[0].recordId)},1)`)
 const counts=await call(`select jsonb_build_object('reserved',bob_private.read_stock_reservations(${literal(f.project)},${literal(stock)}),'history',(select count(*) from bob.material_cut_plan_reservation_revisions where project_id=${literal(f.project)}),'plans',(select count(*) from bob.material_cut_plan_revisions where project_id=${literal(f.project)}))`)
 assert.equal(counts.reserved,['cut-plan-stock-first','cut-plan-source-first'].includes(kind)?0:1);assert.equal(counts.plans,2)
 assert.equal(counts.history,['cut-plan-manual-first','cut-plan-stock-first','cut-plan-source-first'].includes(kind)?0:kind==='cut-plan-release-first'?2:1)
 if(['cut-plan-before-stock','cut-plan-before-source'].includes(kind)){assert.equal(head.stock_reserved,false);assert.equal(head.reservation.reserved,true)}
 if(kind==='cut-plan-replay'){
  const receipt=(output:string)=>JSON.parse(output.split('\n').find(line=>line.startsWith('{')&&line.includes('"recordId"'))!)
  assert.deepEqual(receipt(lead.stdout),receipt(follow.stdout))
 }
 console.log(`PASS ${kind}: observed real lock wait; shared sheet capacity/CAS/history checked`);cases++
}
// K4 pack purchases: the project lock serializes claims on the same needs and Shopping row.
for(const kind of ['pack-competing','pack-replay','pack-same-article','pack-legacy-first','pack-before-legacy','pack-revise-first','pack-edit-first']){
 await query('drop table if exists public.cad_race_fixture;'+fixture)
 const f=await json('select data from public.cad_race_fixture')
 const auth=`select set_config('request.jwt.claims',${literal(JSON.stringify({sub:f.actor}))},true);set local role authenticated;`
 const tx=(sql:string,tail='')=>`begin;set local statement_timeout='30s';set local lock_timeout='20s';${auth}${sql};${tail}commit;`
 const call=async(sql:string)=>JSON.parse((await query(tx(sql))).split('\n').at(-1)!)
 const write=(p:any)=>`select bob.bob_project_write_v16(${literal(f.project)},${literal(f.claim.thread_id)},${literal(f.turn_id)},${f.claim.generation},${literal(JSON.stringify(p))})`
 const base={record_id:null,expected_updated_at:null,expected_revision:0,request_quote:f.payload.request_quote}
 const screw=await call(write({...base,kind:'catalog',data:{action:'ensure',key:'pack-screw',kind:'material',name:'K4 race screw 5×50',aliases:[],profile_code:'fastener',profile_revision:1,categories:['metal','fastener'],properties:{diameter:{value:'5',unit:'mm',truth:'provided_spec',parameter:null,note:''},length:{value:'50',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'Isolated race fixture',source_kind:'design_choice',source_quote:f.payload.request_quote,source_seq:null}}))
 const article=async(number:string)=>(await call(`select bob.supplier_article_command(${literal(f.project)},'create',${literal(randomUUID())},0,${literal(JSON.stringify({catalog_item_id:screw.recordId,catalog_item_revision:1,title:'Race screw '+number,supplier:'Fixture supplier',manufacturer:'',article_number:number,variant:'',source_url:'https://supplier.test.example/'+number,source_document:'',source_version:'',source_date:null,supported_fields:['article_number','purchase_unit','content_per_purchase_unit'],purchase_unit:'pack',content_per_purchase_unit:'100',content_unit:'pcs',notes:'Synthetic',change_note:'Bind source'}))})`)).id
 const needData=(qty:string)=>({name:'Race screws',category:'Fasteners & glue',area_id:null,task_id:null,unit:'pcs',required_quantity:qty,waste_percent:'0',purchase_increment:'1',basis:'Isolated count',assumptions:'Fixture',artifact_id:null,artifact_revision:null,target_revision:1,stock_allocations:[],component_allocations:[],change_note:'Initial'})
 const need=randomUUID()
 await call(`select bob.material_requirement_command(${literal(f.project)},'create',${literal(need)},0,${literal(JSON.stringify(needData('60')))})`)
 const [a,b]=[await article('RACE-A'),await article('RACE-B')]
 const pack=(aid:string,action='publish',rev=0,articleRev=1)=>`select bob.pack_purchase_command(${literal(f.project)},${literal(action)},${literal(aid)},${articleRev},${rev},${literal(JSON.stringify(action==='withdraw'?[]:[{id:need,revision:1}]))},'Race pack')`
 const payload={...base,kind:'pack_purchase',record_id:a,expected_revision:1,data:{action:'publish',purchase_revision:0,needs:[{id:need,revision:1}],change_note:'Race pack'}}
 const legacy=`select bob.material_requirement_command(${literal(f.project)},'publish',${literal(need)},1,'{}')`
 const revise=`select bob.material_requirement_command(${literal(f.project)},'revise',${literal(need)},1,${literal(JSON.stringify({...needData('120'),change_note:'Recount'}))})`
 let materialId:string|undefined
 if(kind==='pack-edit-first'){
  materialId=(await call(pack(a))).material_id
  await call(`select bob.supplier_article_command(${literal(f.project)},'revise',${literal(a)},1,${literal(JSON.stringify({catalog_item_id:screw.recordId,catalog_item_revision:1,title:'Race screw RACE-A',supplier:'Fixture supplier',manufacturer:'',article_number:'RACE-A',variant:'',source_url:'https://supplier.test.example/RACE-A',source_document:'',source_version:'',source_date:null,supported_fields:['article_number','purchase_unit','content_per_purchase_unit'],purchase_unit:'pack',content_per_purchase_unit:'50',content_unit:'pcs',notes:'Synthetic',change_note:'Now 50-packs'}))})`)
 }
 const edit=`update bob.materials set status='ordered' where project_id=${literal(f.project)} and id=${literal(materialId)}`
 const first=kind==='pack-replay'?write(payload):kind==='pack-legacy-first'?legacy:kind==='pack-revise-first'?revise:kind==='pack-edit-first'?edit:pack(a)
 const second=kind==='pack-competing'?pack(b):kind==='pack-replay'?write(payload):kind==='pack-same-article'?pack(a):kind==='pack-before-legacy'?legacy:kind==='pack-edit-first'?pack(a,'publish',1,2):pack(a)
 const barrier=await gate(780000+cases),leader=start(tx(first,`select pg_advisory_xact_lock(${780000+cases});`))
 let follower:ReturnType<typeof start>|undefined
 try{const pid=await waiting(leader.app,barrier.pid);follower=start(tx(second));await waiting(follower.app,pid)}finally{await barrier.close()}
 const lead=await leader.done,follow=await follower!.done;assert.equal(lead.code,0,lead.stderr)
 const expected:Record<string,RegExp>={'pack-competing':/pack_requirement_claimed/,'pack-same-article':/pack_purchase_changed/,'pack-legacy-first':/pack_requirement_in_shopping/,'pack-before-legacy':/pack_requirement_claimed/,'pack-revise-first':/pack_requirement_changed/,'pack-edit-first':/pack_purchase_shopping_committed/}
 if(expected[kind]){assert.notEqual(follow.code,0);assert.match(follow.stderr,expected[kind])}else assert.equal(follow.code,0,follow.stderr)
 const rows=await json(`select coalesce(jsonb_agg(jsonb_build_object('qty',qty,'status',status) order by id),'[]') from bob.materials where project_id=${literal(f.project)}`)
 const revisions=Number(await query(`select count(*) from bob.pack_purchase_revisions p join bob.supplier_articles s on s.id=p.article_id where s.project_id=${literal(f.project)}`))
 if(kind==='pack-legacy-first'){assert.equal(revisions,0);assert.deepEqual(rows,[{qty:'60 pcs',status:'needed'}])}
 else if(kind==='pack-revise-first'){assert.equal(revisions,0);assert.deepEqual(rows,[])}
 else if(kind==='pack-edit-first'){assert.equal(revisions,1);assert.deepEqual(rows,[{qty:'1 pack',status:'ordered'}])}
 else{assert.equal(revisions,1,'exactly one pack purchase revision');assert.deepEqual(rows,[{qty:'1 pack',status:'needed'}])}
 if(kind==='pack-replay'){
  const receipt=(out:string)=>JSON.parse(out.split('\n').find(line=>line.startsWith('{')&&line.includes('"recordId"'))!)
  assert.deepEqual(receipt(lead.stdout),receipt(follow.stdout))
 }
 console.log(`PASS ${kind}: observed lock wait; one purchase route per need, CAS, replay and committed-row guard checked`);cases++
}
console.log(`${cases} PostgreSQL races passed; synthetic database may now be discarded.`)
