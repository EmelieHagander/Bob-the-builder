import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseCadShellWrite,parseCadShellStepsWrite,shellFootprint,COMPOSE_CAD_SHELL_TOOL,LINK_CAD_SHELL_STEPS_TOOL} from '../supabase/functions/_shared/cad-shell.ts'
import {parseProjectWrite} from '../supabase/functions/_shared/project-write.ts'
import {shellBuildOrder,shellQuantity} from '../src/lib/cadShell.ts'

const id='0b6f4f9e-6a51-4c39-9a52-2f1d9d6f2b11',shell='5d1c7a2e-3b44-4f61-8e0a-9c2b7d3e4f55'
const place={x_mm:1200,y_mm:0,z_mm:0,rz:90,placement_basis:'owner_placed',reason:'By the window'}
const blank={record_id:shell,expected_revision:2,action:'place',title:null,description:null,assumptions:null,area_id:null,components:null,component_key:null,placement:null,component:null,request_quote:'move the bed'}

test('compose_cad_shell parses each action into the one writer command',()=>{
 const create=parseCadShellWrite({...blank,record_id:null,expected_revision:0,action:'create',title:'Cabin',description:'Whole cabin',assumptions:'Concept',
  components:[{component_key:'bed',child_artifact_id:id,child_revision:null,...place}]})
 assert.deepEqual(create?.data,{action:'create',fields:{title:'Cabin',description:'Whole cabin',assumptions:'Concept',area_id:null,components:[{component_key:'bed',child_artifact_id:id,child_revision:null,...place}]}})
 assert.deepEqual(parseCadShellWrite({...blank,component_key:'bed',placement:place})?.data,{action:'place',fields:{component_key:'bed',...place}})
 assert.deepEqual(parseCadShellWrite({...blank,action:'adopt',component_key:'bed'})?.data,{action:'adopt',fields:{component_key:'bed'}})
 assert.equal(parseCadShellWrite({...blank,component_key:'bed',placement:{...place,rz:45}}),null,'only quarter turns')
 assert.equal(parseCadShellWrite({...blank,component_key:'bed',placement:{...place,placement_basis:'measured'}}),null,'a placement is never measured')
 assert.equal(parseCadShellWrite({...blank,component_key:'bed',placement:place,title:'Sneaky rename'}),null)
 assert.equal(parseCadShellWrite({...blank,record_id:null,action:'place',component_key:'bed',placement:place}),null)
 const dup={component_key:'bed',child_artifact_id:id,child_revision:1,...place}
 assert.equal(parseCadShellWrite({...blank,record_id:null,expected_revision:0,action:'create',title:'C',description:'D',assumptions:'A',components:[dup,dup]}),null)
 assert.equal(parseProjectWrite('compose_cad_shell',{...blank,component_key:'bed',placement:place},'p','Please move the bed by the window')?.kind,'cad_shell')
 assert.deepEqual(COMPOSE_CAD_SHELL_TOOL.function.parameters.required.sort(),Object.keys(blank).sort())
})

test('shell footprint rotates the piece bounding box about its origin',()=>{
 const box={min:[0,0,0],max:[2000,900,1600],size:[2000,900,1600]}
 assert.deepEqual(shellFootprint({x_mm:100,y_mm:200,rz:0,bounding_box_mm:box}),{x:100,y:200,width:2000,depth:900})
 assert.deepEqual(shellFootprint({x_mm:0,y_mm:0,rz:90,bounding_box_mm:box}),{x:-900,y:0,width:900,depth:2000})
 assert.equal(shellFootprint({x_mm:0,y_mm:0,rz:0,bounding_box_mm:null}),null)
})

test('link_cad_shell_steps parses into one writer payload and pieces sort into build order',()=>{
 const step='7e2b8c1d-4a5f-4b6c-9d7e-1f2a3b4c5d6e'
 const call={shell_id:shell,expected_revision:3,links:[{component_key:'bed',step_id:step.toUpperCase(),action:'link'}],request_quote:'put it in the plan'}
 assert.deepEqual(parseCadShellStepsWrite(call),{kind:'cad_shell_steps',record_id:shell,expected_updated_at:null,expected_revision:3,request_quote:'put it in the plan',data:{links:[{component_key:'bed',step_id:step,action:'link'}]}})
 assert.equal(parseCadShellStepsWrite({...call,links:[]}),null)
 assert.equal(parseCadShellStepsWrite({...call,links:[call.links[0],{...call.links[0],step_id:step}]}),null,'one link per piece and Step')
 assert.equal(parseCadShellStepsWrite({...call,links:[{...call.links[0],action:'move'}]}),null)
 assert.equal(parseCadShellStepsWrite({...call,expected_revision:0}),null)
 assert.equal(parseProjectWrite('link_cad_shell_steps',call,'p','Please put it in the plan')?.kind,'cad_shell_steps')
 assert.deepEqual([...LINK_CAD_SHELL_STEPS_TOOL.function.parameters.required].sort(),Object.keys(call).sort())
 const s=(position:number)=>({id:String(position),title:'S',position,state:'planned'})
 assert.deepEqual(shellBuildOrder([{k:'shelf',steps:[]},{k:'bed',steps:[s(2)]},{k:'old',steps:undefined},{k:'room',steps:[s(3),s(1)]}]).map(c=>c.k),['room','bed','shelf','old'])
 assert.deepEqual(['12.5000','14.0000','3'].map(shellQuantity),['12.5','14','3'])
})
