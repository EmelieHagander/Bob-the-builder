import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {FORM_SCENARIOS,type FormReader} from '../scripts/form-acceptance-scenarios.ts'
import {projectSchema} from './support/project-schema.ts'
import {drawingCatalogConfiguration} from '../supabase/functions/_shared/drawing-runtime.ts'
import {targetedReviewEnabled} from '../supabase/functions/_shared/cad-targeted-review.ts'

type Row=Record<string,any>
/** Replays one scenario against scripted drafts; checkConstruction is stubbed per draft. */
async function replay(id:'box'|'bunk-bed',drafts:Row[],drawings:Row[]=[{id:'d',revision:1,current_revision:1,archived:false,source_state:'current',source:{artifact_id:'a',revision:3}}]){
 const scenario=FORM_SCENARIOS.find(s=>s.id===id)!,state:Row={},checks:Row[]=[],observations:Row[]=[]
 let index=0
 const reader:FormReader={constructions:async()=>[{id:drafts[index].artifact_id}],construction:async()=>drafts[index],catalogRecord:async()=>({}),drawings:async()=>drawings}
 for(const step of scenario.steps){
  await step.after({reader,state,checker:((draft:Row)=>draft.checked) as any,check:(name,passed,detail)=>checks.push({step:step.label,name,passed,detail}),observe:(name,value)=>observations.push({step:step.label,name,value})})
  index=Math.min(index+1,drafts.length-1)
 }
 return {checks,observations,failed:checks.filter(c=>!c.passed).map(c=>c.step+':'+c.name)}
}
const checked=(size:number[],parts=5,min=[0,0,0])=>({concept_ready:true,part_count:parts,joint_count:6,bounds_mm:{min,size},issues:[]})
const draft=(revision:number,size:number[],instances:Row[]=[])=>({artifact_id:'a',revision,materials:[],recipe:{instances},checked:checked(size)})

test('box scenario passes only for the requested width change on the same construction',async()=>{
 const good=await replay('box',[draft(1,[400,300,250]),draft(2,[500,300,250]),draft(3,[500,300,250])])
 assert.deepEqual(good.failed,[])
 assert.equal(good.checks.length,16)
 const unchanged=await replay('box',[draft(1,[400,300,250]),draft(2,[400,300,250]),draft(3,[400,300,250])])
 assert.deepEqual(unchanged.failed,['width_change:changed_size','final_drawing:changed_size'])
 const noDrawing=await replay('box',[draft(1,[400,300,250]),draft(2,[500,300,250]),draft(3,[500,300,250])],[])
 assert.deepEqual(noDrawing.failed,['final_drawing:drawing_saved_for_latest_revision'])
})

test('bunk-bed scenario requires the ladder on the opposite gable and records other changes',async()=>{
 const frame=(x:number)=>[{id:'post_a',placement:{x:0}},{id:'ladder_rail',placement:{x}}]
 const ok=await replay('bunk-bed',[draft(1,[2000,950,1550],frame(100)),draft(2,[2000,950,1550],frame(1900)),draft(3,[2000,950,1550],frame(1900))])
 assert.deepEqual(ok.failed,[])
 assert.deepEqual(ok.observations.find(o=>o.name==='non_ladder_parts_changed')!.value,[])
 const same=await replay('bunk-bed',[draft(1,[2000,950,1550],frame(100)),draft(2,[2000,950,1550],frame(120)),draft(3,[2000,950,1550],frame(120))])
 assert.deepEqual(same.failed,['move_ladder:ladder_moved_to_opposite_gable','drawing:ladder_moved_to_opposite_gable'])
 const tall=await replay('bunk-bed',[draft(1,[2000,950,1700],frame(100)),draft(2,[2000,950,1700],frame(1900)),draft(3,[2000,950,1700],frame(1900))])
 assert(tall.failed.includes('concept:height_limit'))
})

test('the paid runner refuses to start without scenario, approval and a first attempt',()=>{
 for(const env of [{},{BOB_FORM_SCENARIO:'box',BOB_FORM_CONFIG:'baseline'},{BOB_FORM_SCENARIO:'box',BOB_FORM_CONFIG:'baseline',BOB_FORM_LIVE_CONFIRM:'paid-acceptance-approved',GITHUB_RUN_ATTEMPT:'2'}]){
  const run=spawnSync(process.execPath,['--import','tsx','scripts/run-live-form-acceptance.ts'],{env:{PATH:process.env.PATH,...env},encoding:'utf8',timeout:60000})
  assert.notEqual(run.status,0);assert.doesNotMatch(run.stdout,/BOB_FORM_PROJECT_ID/,'no project is created')
 }
 const workflow=readFileSync('.github/workflows/live-form-acceptance.yml','utf8')
 assert.match(workflow,/workflow_dispatch/);assert.doesNotMatch(workflow,/^\s*(push|pull_request|schedule):/m)
 assert.match(workflow,/github.run_attempt == 1/)
 assert.match(workflow,/Retain the content-free run report\s+if: \$\{\{ always\(\) \}\}/)
 assert.match(workflow,/run: exec node --import tsx scripts\/run-live-form-acceptance.ts/,'signals reach the Node process directly')
})

test('a final drawing cannot hide a replacement construction or a reverted width/part count',async()=>{
 const initial=draft(1,[400,300,250]),corrected=draft(2,[500,300,250])
 const replacement=await replay('box',[initial,corrected,{...draft(1,[500,300,250]),artifact_id:'replacement'}],
  [{id:'d',revision:1,current_revision:1,archived:false,source_state:'current',source:{artifact_id:'replacement',revision:1}}])
 assert(replacement.failed.includes('final_drawing:same_construction_artifact'))
 const reverted=draft(3,[400,300,250]);reverted.checked.part_count=4
 const result=await replay('box',[initial,corrected,reverted])
 assert(result.failed.includes('final_drawing:changed_size'));assert(result.failed.includes('final_drawing:five_parts'))
})

test('only a current unarchived drawing pinned to the final construction revision counts as saved',async t=>{
 const drafts=[draft(1,[400,300,250]),draft(2,[500,300,250]),draft(3,[500,300,250])]
 const drawing={id:'d',revision:1,current_revision:1,archived:false,source_state:'current',source:{artifact_id:'a',revision:3}}
 for(const [name,patch] of Object.entries({old_pin:{source:{artifact_id:'a',revision:2}},wrong_identity:{source:{artifact_id:'other',revision:3}},historical:{current_revision:2},archived:{archived:true},stale:{source_state:'changed'},index_only:{source_state:'not_checked'}})){
  await t.test(name,async()=>{const r=await replay('box',drafts,[{...drawing,...patch}]);assert.deepEqual(r.failed,['final_drawing:drawing_saved_for_latest_revision'])})
 }
})

test('drawing stage retains the ladder correction and height; added non-ladder parts are observed',async()=>{
 const frame=(x:number)=>[{id:'post_a',placement:{x:0}},{id:'ladder_rail',placement:{x}}]
 const result=await replay('bunk-bed',[draft(1,[2000,950,1550],frame(100)),draft(2,[2000,950,1550],[...frame(1900),{id:'new_post',placement:{x:100}}]),draft(3,[2000,950,1700],frame(100))])
 assert.deepEqual(result.failed,['drawing:ladder_moved_to_opposite_gable','drawing:height_limit'])
 assert.deepEqual(result.observations.find(o=>o.name==='non_ladder_parts_changed')!.value,['new_post'])
})

test('enablement turns all three parts on, is idempotent, and rollback turns them off',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const manifest=async()=>(await pg.query<any>("select shared.resolve_ai_catalog('bob') m")).rows[0].m
 const policies=async()=>(await pg.query<any>("select name,active from bob.tool_catalog where name in ('read_task_sources','read_source_findings') order by name")).rows
 const state=async()=>{const m=await manifest(),role=(k:string)=>m.definitions.find((d:any)=>d.prompt_key===k).definition.enabled
  const box=m.definitions.find((d:any)=>d.prompt_key==='bob.tools').definition.catalog.filter((p:any)=>['read_task_sources','read_source_findings'].includes(p.name)).map((p:any)=>p.active)
  return {targeted:role('role.cad-targeted-reviewer'),reader:role('role.source-reader'),table:(await policies()).map((p:any)=>p.active),box,id:m.manifest_id,m}}
 const before=await state()
 assert.deepEqual([before.targeted,before.reader,before.table,before.box],[false,false,[false,false],[false,false]])
 await pg.exec(readFileSync('scripts/form-package3-enable.sql','utf8'))
 const on=await state()
 assert.deepEqual([on.targeted,on.reader,on.table,on.box],[true,true,[true,true],[true,true]])
 assert(targetedReviewEnabled(on.m));assert(drawingCatalogConfiguration(on.m).definitions.some((d:any)=>d.key==='role.cad-targeted-reviewer'))
 await pg.exec(readFileSync('scripts/form-package3-enable.sql','utf8'))
 assert.equal((await state()).id,on.id,'a second enablement publishes nothing new')
 await pg.exec(readFileSync('scripts/form-package3-rollback.sql','utf8'))
 const off=await state()
 assert.deepEqual([off.targeted,off.reader,off.table,off.box],[false,false,[false,false],[false,false]])
 assert(!drawingCatalogConfiguration(off.m).definitions.some((d:any)=>d.key==='role.cad-targeted-reviewer'))
})
