// Stored drawing source freshness (owner decision A, 2026-10-22). Reads use a
// stored row only while its project's change counter is unchanged; anything
// else runs the live assessment, so answers never differ from the live check.
import {designIntent} from './support/design-intent-fixture.ts'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {sourceAssessmentInputs} from './support/source-status-inputs.ts'
import {assertSourceAssessmentEquivalent} from './support/source-assessment-equivalence.ts'

// Shared physical-model tables. A project that references any of them is
// never stored, so their writes need no change signal.
const PHYSICAL=['bob.building_elements','bob.building_levels','bob.building_revisions','bob.building_spaces','bob.buildings',
 'bob.element_revisions','bob.level_revisions','bob.space_measurements','bob.space_revisions']

async function fixture() {
 const pg=await projectSchema()
 const owner=randomUUID(),outsider=randomUUID()
 const call=async(uid:string|null,name:string,args:unknown[],role='authenticated'):Promise<any>=>
  (await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'status-owner@example.test',outsider,'status-other@example.test'])
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Stored status fixture'})])).id
 const other=(await call(outsider,'bob.create_project',[JSON.stringify({name:'Other status fixture'})])).id
 const measurement=randomUUID(),solution=randomUUID(),pinned=randomUUID(),plain=randomUUID()
 const fact={subject:'Shelf width',value:'0.900',unit:'m',truth:'measured',source:'Tape',required:true}
 await call(owner,'bob.evidence_command',[project,'measurement','create',measurement,0,JSON.stringify(fact)])
 await call(owner,'bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Shelf',description:'Concept',assumptions:'Fit unverified',tradeoffs:'Simple',measurements:[],design_intent:designIntent()})])
 await call(owner,'bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Use design'})])
 const drawing=(id:string,title:string,measurements:unknown[])=>call(owner,'bob.artifact_command',[project,'create',id,0,JSON.stringify({
  area_id:null,title,description:'Work drawing',kind:'detail',status:'concept',assumptions:'Fit remains unverified',measurements,target_revision:1,source_media_id:null})])
 await drawing(pinned,'Pinned shelf',[{id:measurement,revision:1}])
 await drawing(plain,'Plain shelf',[])
 const live=async(uid=owner)=>(await asProjectUser(pg,uid,`select r.artifact_id,r.revision,a.source_state,a.source_reasons from bob.artifact_revisions r
  cross join lateral bob_private.artifact_source_assessment(r.project_id,r.artifact_id,r.revision) a where r.project_id=$1 order by 1,2`,[project])).rows
 const view=async(uid=owner)=>(await asProjectUser(pg,uid,`select artifact_id,revision,source_state,source_reasons from bob.artifact_source_status where project_id=$1 order by 1,2`,[project])).rows
 const fresh=async()=>Number((await pg.query<{n:number}>(`select count(*)::int n from bob.artifact_source_states s join bob.artifact_source_epochs e
  on e.project_id=s.project_id and e.seq=s.computed_seq where s.project_id=$1`,[project])).rows[0].n)
 const revisions=async()=>Number((await pg.query<{n:number}>('select count(*)::int n from bob.artifact_revisions where project_id=$1',[project])).rows[0].n)
 const drain=async()=>(await pg.query<{n:number}>('select bob_private.drain_artifact_source_states() n')).rows[0].n
 // Number of live assessments a read performs, from its executed plan.
 const assessments=async(relation='artifact_source_status')=>{
  const plan=(await asProjectUser(pg,owner,`explain (analyze, costs off, timing off, summary off) select * from bob.${relation} where project_id=$1`,[project])).rows
   .map((r:any)=>r['QUERY PLAN']).join('\n')
  const scans=plan.split('\n').filter(line=>line.includes('Function Scan on artifact_source_assessment'))
  assert(scans.length,plan)
  return scans.reduce((sum,scan)=>sum+(scan.includes('never executed')?0:Number(/loops=(\d+)/.exec(scan)?.[1]??NaN)),0)
 }
 return {pg,owner,outsider,project,other,measurement,fact,pinned,plain,call,live,view,fresh,revisions,drain,assessments}
}

test('stored status equals the live assessment, is used only while fresh, and every change falls back to live at once',async t=>{
 const f=await fixture();t.after(()=>f.pg.close())
 assert.equal(await f.fresh(),0,'nothing is stored before the drain runs')
 assert.deepEqual(await f.view(),await f.live(),'unstored rows are answered live, unchanged')
 assert.equal(await f.drain(),1,'only a project with drawing inputs has a counter to refresh')
 assert.equal(await f.fresh(),await f.revisions(),'every revision is stored')
 assert.deepEqual(await f.view(),await f.live())
 for (const relation of ['artifact_source_status','current_drawing_overview','current_drawing_steps'])
  assert.equal(await f.assessments(relation),0,`fresh ${relation} reads never run the assessment`)
 assert.equal(await f.drain(),0,'an unchanged project is not recomputed')

 // A source change: the stored row is stale immediately and the answer is live.
 await f.call(f.owner,'bob.evidence_command',[f.project,'measurement','revise',f.measurement,1,JSON.stringify({...f.fact,value:'0.905',change_note:'Remeasured'})])
 assert.equal(await f.fresh(),0,'the change counter makes every stored row of the project stale')
 const changed=await f.view()
 assert.deepEqual(changed,await f.live())
 assert.equal(changed.find((r:any)=>r.artifact_id===f.pinned)?.source_state,'changed')
 const slim=await assertSourceAssessmentEquivalent(f.pg,'remeasured')
 assert.equal(slim.slim,slim.revisions,'plain drawings take the slim assessment')
 assert.deepEqual(slim.states,['changed:measurements_changed','current:'])
 assert(await f.assessments()>0,'stale rows are assessed live')
 await f.drain()
 assert.equal(await f.fresh(),await f.revisions())
 assert.deepEqual(await f.view(),await f.live(),'the refreshed rows carry the new answer')
 assert.equal(await f.assessments(),0)

 // New revisions and lifecycle copies are answered live until stored.
 await f.call(f.owner,'bob.artifact_command',[f.project,'archive',f.plain,1,'{}'])
 await f.call(f.owner,'bob.artifact_command',[f.project,'restore',f.plain,2,'{}'])
 assert.equal((await assertSourceAssessmentEquivalent(f.pg,'archive and restore')).revisions,await f.revisions())
 assert.equal(await f.fresh(),0)
 assert.deepEqual(await f.view(),await f.live())
 await f.drain()
 assert.equal(await f.fresh(),await f.revisions())
 assert.deepEqual(await f.view(),await f.live())

 // Other projects' counters and rows are untouched by this project's writes.
 const otherEpoch=(await f.pg.query<{seq:string}>('select seq from bob.artifact_source_epochs where project_id=$1',[f.other])).rows[0]
 await f.call(f.owner,'bob.evidence_command',[f.project,'measurement','revise',f.measurement,2,JSON.stringify({...f.fact,value:'0.910',change_note:'Again'})])
 assert.deepEqual((await f.pg.query('select seq from bob.artifact_source_epochs where project_id=$1',[f.other])).rows[0],otherEpoch)
})

test('projects whose answer can depend on a member’s building or catalog access are never stored',async t=>{
 const f=await fixture();t.after(()=>f.pg.close())
 await f.drain()
 assert.equal(await f.fresh(),await f.revisions())
 const storable=async()=>(await f.pg.query<{ok:boolean}>('select bob_private.artifact_source_states_storable($1) ok',[f.project])).rows[0].ok
 assert.equal(await storable(),true)
 // A multifloor/stair flag goes through the normal change signal.
 await f.pg.query('update bob.artifacts set has_multifloor_plan=true where id=$1',[f.plain])
 assert.equal(await storable(),false)
 await f.drain()
 assert.equal(Number((await f.pg.query('select count(*)::int n from bob.artifact_source_states where project_id=$1',[f.project])).rows[0].n),0)
 assert.deepEqual((await f.pg.query('select storable from bob_private.artifact_source_refreshes where project_id=$1',[f.project])).rows,[{storable:false}])
 assert.deepEqual(await f.view(),await f.live(),'an unstorable project is answered live')
 await f.pg.query('update bob.artifacts set has_multifloor_plan=false where id=$1',[f.plain])
 await f.drain()
 assert.equal(await f.fresh(),await f.revisions(),'it is stored again once the reference is gone')

 // Physical pins in any JSON shape, and another project's private catalog
 // item, each make the project unstorable. Rows are inserted without their
 // write-path triggers to reach exactly these shapes.
 const otherItem=randomUUID(),ownItem=randomUUID()
 await f.pg.exec('set session_replication_role=replica')
 await f.pg.query(`insert into bob.catalog_items(id,project_id,kind,current_revision) values($1,$2,'material',1),($3,$4,'material',1)`,[otherItem,f.other,ownItem,f.project])
 await f.pg.exec('set session_replication_role=origin')
 const construction=async(parameters:unknown,materials:unknown)=>{
  await f.pg.exec('set session_replication_role=replica')
  try {
   await f.pg.query('delete from bob.artifact_construction_revisions where artifact_id=$1',[f.plain])
   await f.pg.query(`insert into bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision,recipe,parameters,materials,joints,open_questions)
    values($1,$2,1,'{}',$3,$4,'[]','[]')`,[f.project,f.plain,JSON.stringify(parameters),JSON.stringify(materials)])
  } finally { await f.pg.exec('set session_replication_role=origin') }
 }
 await construction({nodes:[]},[{material_id:ownItem,material_revision:1}])
 assert.equal(await storable(),true,'own and missing catalog items are seen identically by every member')
 await construction({nodes:[]},[{material_id:otherItem,material_revision:1}])
 assert.equal(await storable(),false,'another project’s private item is visible only to some members')
 await construction({nodes:[]},[{material_id:ownItem,material_revision:1,part_id:otherItem,part_revision:1}])
 assert.equal(await storable(),false)
 await construction({nodes:[{role:'source',source:{kind:'space_measurement',id:randomUUID()}}]},[])
 assert.equal(await storable(),false,'physical pins depend on building access')
})

test('every assessment input either signals a change or makes its project unstorable',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const inputs=await sourceAssessmentInputs(pg)
 const triggered=(await pg.query<{t:string}>(`select distinct n.nspname||'.'||c.relname t from pg_trigger g join pg_class c on c.oid=g.tgrelid
  join pg_namespace n on n.oid=c.relnamespace where g.tgname='mark_artifact_source_changed' order by 1`)).rows.map(r=>r.t)
 assert.deepEqual(inputs.filter(t=>!triggered.includes(t)),PHYSICAL,'a new assessment input needs the change trigger, or must be physical and gated')
 assert.deepEqual(triggered.filter(t=>!inputs.includes(t)),[],'no trigger on a table the assessment does not read')
 assert(inputs.length>=27,inputs.join(','))
})

test('a shared catalog change marks every project with a construction; deleting a project still works',async t=>{
 const f=await fixture();t.after(()=>f.pg.close())
 await f.pg.exec('set session_replication_role=replica')
 await f.pg.query(`insert into bob.artifact_construction_revisions(project_id,artifact_id,artifact_revision,recipe,parameters,materials,joints,open_questions)
  values($1,$2,1,'{}','{}','[]','[]','[]')`,[f.project,f.plain])
 await f.pg.exec('set session_replication_role=origin')
 const seq=async(p:string)=>(await f.pg.query<{seq:string}>('select seq from bob.artifact_source_epochs where project_id=$1',[p])).rows[0]?.seq
 const before=[await seq(f.project),await seq(f.other)]
 // The item's revision row is deferred to commit; observe the signal inside the transaction.
 await f.pg.exec('begin')
 await f.pg.query(`insert into bob.catalog_items(project_id,kind,current_revision) values(null,'material',1)`)
 const after=[await seq(f.project),await seq(f.other)]
 await f.pg.exec('rollback')
 assert.equal(BigInt(after[0]),BigInt(before[0])+1n)
 assert.equal(after[1],before[1],'a project without constructions cannot pin a catalog item')
 await f.pg.query('delete from bob.projects where id=$1',[f.project])
 assert.equal((await f.pg.query('select * from bob.artifact_source_epochs where project_id=$1',[f.project])).rows.length,0)
})

test('members read only their project’s stored rows; the machinery is not callable by clients',async t=>{
 const f=await fixture();t.after(()=>f.pg.close())
 await f.drain()
 for (const table of ['artifact_source_states','artifact_source_epochs']) {
  assert((await asProjectUser(f.pg,f.owner,`select * from bob.${table} where project_id=$1`,[f.project])).rows.length>0)
  assert.deepEqual((await asProjectUser(f.pg,f.outsider,`select * from bob.${table} where project_id=$1`,[f.project])).rows,[])
  await assert.rejects(asProjectUser(f.pg,null,`select * from bob.${table}`,[],'anon'),/permission denied/)
  await assert.rejects(asProjectUser(f.pg,f.owner,`delete from bob.${table} where project_id=$1`,[f.project]),/permission denied/)
 }
 assert.deepEqual(await f.view(f.outsider),[])
 for (const fn of ['bob_private.drain_artifact_source_states()','bob_private.refresh_artifact_source_states($1)','bob_private.artifact_source_states_storable($1)','bob_private.bump_artifact_source_epoch($1)']) {
  const args=fn.includes('$1')?[f.project]:[]
  for (const role of ['authenticated','service_role']) await assert.rejects(asProjectUser(f.pg,f.owner,`select ${fn}`,args,role),/permission denied/)
 }
})

test('the rollback-only release proof compares stored and live as a member and leaves nothing behind',async t=>{
 const f=await fixture();t.after(()=>f.pg.close())
 const script=await readFile(new URL('../scripts/check-stored-source-status.sql',import.meta.url),'utf8')
 await f.pg.exec(script)
 assert.equal(Number((await f.pg.query('select count(*)::int n from bob.artifact_source_states')).rows[0].n),0,'the proof rolled back')
 assert.equal(Number((await f.pg.query('select count(*)::int n from bob_private.artifact_source_refreshes')).rows[0].n),0)
 // A stored row that disagrees with live is reported.
 await f.drain()
 await f.pg.query(`update bob.artifact_source_states set source_state='changed',source_reasons='{forged}' where artifact_id=$1`,[f.plain])
 await assert.rejects(f.pg.exec(script.replace("select bob_private.drain_artifact_source_states(1000, interval '100 seconds') as refreshed;",'')),/stored_source_status_mismatch/)
 await f.pg.exec('rollback').catch(()=>{})
})
