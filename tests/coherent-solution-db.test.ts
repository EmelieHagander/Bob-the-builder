import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {conceptFixture} from './support/solution-concept-fixtures.ts'
import {applyProjectDelta,measurementRef,type EditSnapshot} from '../supabase/functions/_shared/project-edits.ts'
let pg:any,owner:string,outsider:string,project:string,other:string,solution:string,measurement:string
const call=async(user:string|null,name:string,args:any[],role='authenticated')=>(await asProjectUser(pg,user,`select bob.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
before(async()=>{
 pg=await projectSchema();owner=randomUUID();outsider=randomUUID();solution=randomUUID();measurement=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'coherent-owner@test.invalid',outsider,'coherent-outsider@test.invalid'])
 project=(await call(owner,'create_project',[{name:'Coherent fixture'}])).id;other=(await call(owner,'create_project',[{name:'Other fixture'}])).id
 await call(owner,'evidence_command',[project,'measurement','create',measurement,0,{subject:'Door height',value:'209',unit:'cm',truth:'measured',source:'Underside threshold to top of trim',notes:'Synthetic ambiguous endpoints',required:false}])
 await call(owner,'solution_command',[project,'create',solution,0,{title:'Entry concept',description:'Synthetic source binding',assumptions:'Endpoints unresolved',tradeoffs:'',measurements:[{id:measurement,revision:1}],design_intent:conceptFixture('barn')}])
})
after(()=>pg?.close())
test('saved Solution views are exact, read-only, caller/project/view bounded, with hash-consistent payloads',async()=>{
 const list=await call(owner,'list_saved_solution_views',[project,null,null,null]);assert.equal(list.total,1);assert.equal(list.records[0].id,solution);assert(!JSON.stringify(list).includes('nodes'))
 const meta=await call(owner,'read_saved_solution_view',[project,solution,1,'profile',false]);assert.equal(meta.status,'ready');assert.equal(meta.solution_id,solution);assert(!('model_json' in meta))
 const full=await call(owner,'read_saved_solution_view',[project,solution,1,'profile',true]);assert.equal(full.source_sha256,createHash('sha256').update(full.model_json).digest('hex'));assert.equal(full.view,'profile')
 assert.equal((await call(owner,'read_saved_solution_view',[other,solution,1,'profile',true])).status,'not_found')
 assert.equal((await call(owner,'read_saved_solution_view',[project,solution,99,'profile',true])).status,'not_found')
 assert.equal((await call(owner,'read_saved_solution_view',[project,solution,1,'unlisted',true])).status,'not_found')
 await assert.rejects(call(outsider,'read_saved_solution_view',[project,solution,1,'profile',true]),/project_denied/)
 for(const role of ['anon','service_role'])await assert.rejects(call(null,'read_saved_solution_view',[project,solution,1,'profile',false],role),/permission denied/)
})
test('SQL source validator rejects foreign, fabricated or unlinked measurements; unresolved endpoints are not construction ready',async()=>{
 const [snapshot]=await call(owner,'read_bob_edit_context',[project,'solutions',null,null]) as EditSnapshot[]
 assert.equal(snapshot.measurement_evidence![0].id,measurement);assert.equal(snapshot.measurement_evidence![0].reference,null)
 const index=snapshot.record.design_intent.model.nodes.findIndex((n:any)=>n.role==='decision'||n.role==='estimate')
 const next=await applyProjectDelta(snapshot,[{op:'bind_concept_measurement',index,measurement_ref:await measurementRef(snapshot,0),required_reference:'frame outer height'}],'Attach saved source',{coherent:true})
 const data={title:next.title,description:next.description,assumptions:next.assumptions,tradeoffs:next.tradeoffs,design_intent:next.design_intent,measurements:snapshot.measurements,change_note:'Attach saved source'}
 await call(owner,'solution_command',[project,'revise',solution,1,data])
 const result=(await asProjectUser(pg,owner,'select bob_private.solution_concept_result($1) result',[data.design_intent])).rows[0].result
 assert(result.issues.some((i:any)=>i.code==='measurement_reference_unresolved'))
 const fake=structuredClone(data);fake.design_intent.model.source_bindings[0].value=208;fake.design_intent.model.nodes[index].value=2080
 await assert.rejects(call(owner,'solution_command',[project,'revise',solution,2,fake]),/source_mismatch/)
 const unlinked={...data,measurements:[]};await assert.rejects(call(owner,'solution_command',[project,'revise',solution,2,unlinked]),/link_missing/)
 const foreign=structuredClone(data);foreign.design_intent.model.source_bindings[0].measurement_id=randomUUID();await assert.rejects(call(owner,'solution_command',[project,'revise',solution,2,foreign]),/source_mismatch/)
 const reading=await call(owner,'read_saved_solution_view',[project,solution,1,'profile',false]);assert.equal(reading.revision,1);assert.equal(reading.current_revision,2)
 const value=(await pg.query('select value from bob.measurement_revisions where measurement_id=$1 and revision=1',[measurement])).rows[0].value;assert.equal(Number(value),209)
})
