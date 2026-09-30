/** Real multi-connection test. Only an empty, disposable local PostgreSQL DB. */
import assert from 'node:assert/strict'
import {parameterPacket} from '../tests/support/cad-parameter-fixture.ts'
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
console.log(`${cases} PostgreSQL races passed; synthetic database may now be discarded.`)
