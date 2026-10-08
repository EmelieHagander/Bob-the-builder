import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseCadShellWrite,shellFootprint,COMPOSE_CAD_SHELL_TOOL} from '../supabase/functions/_shared/cad-shell.ts'
import {parseProjectWrite} from '../supabase/functions/_shared/project-write.ts'

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
