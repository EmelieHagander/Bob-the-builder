import {test} from 'node:test'
import assert from 'node:assert/strict'
import {applyCadRevision} from '../supabase/functions/_shared/cad-revise.ts'
import {createCadAssistant} from './support/colleague-catalog-fixture.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {parameterPlan} from './support/cad-parameter-fixture.ts'
import {shapeId,handoff,reviewReply} from './support/cad-review-fixture.ts'

const place={x:0,y:0,z:0,rx:0,ry:0,rz:0}
function base(){
 const recipe:any={contract_version:1,units:'mm',assembly_id:'shelf',definitions:[{id:'side',primitive:'box',material_ref:null,x_mm:18,y_mm:300,z_mm:900},{id:'board',primitive:'box',material_ref:null,x_mm:600,y_mm:300,z_mm:18}],
  instances:[{id:'left',definition_id:'side',placement:place},{id:'right',definition_id:'side',placement:{...place,x:618}},{id:'shelf1',definition_id:'board',placement:{...place,x:18,z:400}}],views:[...handoff.views]}
 return {recipe,parameter_plan:parameterPlan(recipe),dimension_bindings:[],title:'Shelf',description:'Synthetic',assumptions:'None',target_revision:1,measurements:[],source_artifact_id:null,source_revision:null,part_ids:[]}
}
const empty=()=>({definitions:[],instances:[],arrays:[],clearances:[],motions:[],nodes:[],bindings:[]})
const change=(c:any={})=>({upsert:{...empty(),...c.upsert},remove:{...empty(),...c.remove},dimension_bindings:null,views:null,title:null,description:null,assumptions:null,...c.top})

test('a change set touches only what it names and keeps everything else exactly',()=>{
 const last=base(),{args,dropped_nodes}=applyCadRevision(last,change({upsert:{nodes:[{id:'lift',role:'decision',value:450,unit:'mm',reason:'Raised shelf'}],bindings:[{path:'instances/shelf1/placement/z',node:'lift'}]}}))
 assert.equal(args.recipe.instances.length,3);assert.deepEqual(args.recipe.definitions,last.recipe.definitions)
 assert.equal(args.parameter_plan.bindings.find((b:any)=>b.path==='instances/shelf1/placement/z').node,'lift')
 assert.equal(args.parameter_plan.bindings.length,last.parameter_plan.bindings.length,'binding replaced by path, not duplicated')
 assert.equal(dropped_nodes.length,1,'the old z decision is no longer reachable');assert.notEqual(dropped_nodes[0],'lift')
 assert.equal(last.parameter_plan.nodes.length,args.parameter_plan.nodes.length,'the input is not mutated (one dropped, one added)')
 assert.equal(args.title,'Shelf')
})
test('removing an instance takes its bindings and orphaned nodes with it',()=>{
 const {args,dropped_nodes}=applyCadRevision(base(),change({remove:{instances:['shelf1']},top:{title:'Shelf without board'}}))
 assert.deepEqual(args.recipe.instances.map((i:any)=>i.id),['left','right'])
 assert(!args.parameter_plan.bindings.some((b:any)=>b.path.startsWith('instances/shelf1/')))
 assert.equal(dropped_nodes.length,6);assert.equal(args.title,'Shelf without board')
})
test('unknown ids, a missing base and malformed change sets are corrections, not silent no-ops',()=>{
 assert.throws(()=>applyCadRevision(base(),change({remove:{instances:['ghost']}})),/revision_unknown_ids:instances\/ghost/)
 assert.throws(()=>applyCadRevision(null,change()),/no_render_to_revise/)
 assert.throws(()=>applyCadRevision(base(),{upsert:{},remove:{}}),/invalid_revision/)
})
test('dimension source pins can be replaced, retained by legacy tools, and removed with deleted definitions',()=>{
 const last=base(),pin={definition_id:'board',dimension:'x_mm',measurement_id:'80000000-0000-4000-8000-000000000001',revision:1}
 last.dimension_bindings=[pin] as any
 assert.deepEqual(applyCadRevision(last,change()).args.dimension_bindings,[pin])
 const legacy=change();delete legacy.dimension_bindings
 assert.deepEqual(applyCadRevision(last,legacy).args.dimension_bindings,[pin])
 const rotated={...pin,dimension:'y_mm'}
 assert.deepEqual(applyCadRevision(last,change({top:{dimension_bindings:[rotated]}})).args.dimension_bindings,[rotated])
 assert.deepEqual(last.dimension_bindings,[pin],'replacement does not mutate the rendered base')
 assert.deepEqual(applyCadRevision(last,change({remove:{definitions:['board']}})).args.dimension_bindings,[])
 assert.deepEqual(applyCadRevision(last,change({remove:{definitions:['board']},upsert:{definitions:[last.recipe.definitions[1]]}})).args.dimension_bindings,[pin])
 assert.throws(()=>applyCadRevision(last,change({top:{dimension_bindings:{}}})),/invalid_dimension_bindings/)
 assert.throws(()=>applyCadRevision(last,change({top:{dimension_bindings:[pin,pin]}})),/duplicate_dimension_binding/)
})
