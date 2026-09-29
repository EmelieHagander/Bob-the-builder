/** Real multi-connection test. Only an empty, disposable local PostgreSQL DB. */
import assert from 'node:assert/strict'
import {parameterPacket} from '../tests/support/cad-parameter-fixture.ts'
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
console.log(`${cases} PostgreSQL races passed; synthetic database may now be discarded.`)
