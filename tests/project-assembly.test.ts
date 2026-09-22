import test from 'node:test'
import assert from 'node:assert/strict'
import { ASSEMBLY_TOOL, assemblyToCad, parseAssemblyWrite } from '../supabase/functions/_shared/project-assembly.ts'
import { parseCadConstruction } from '../supabase/functions/_shared/cad-adapter.ts'

const uid=(n:number)=>'90000000-0000-4000-8000-'+String(n).padStart(12,'0')
const base=()=>({
  record_id:null,create_area_id:null,expected_revision:0,target_revision:1,title:'Generic frame',description:'Reusable parts',assumptions:'Design proposal',
  definitions:[
    {key:'P-POST',part_id:uid(1),part_revision:2,shape:{kind:'box',size_mm:[45,70,1600]}},
    {key:'P-RAIL',part_id:uid(2),part_revision:1,shape:{kind:'box',size_mm:[45,70,910]}},
  ],
  instances:[
    {key:'I-L',definition_key:'P-POST',position_mm:[0,0,800],rotation_deg:[0,0,0]},
    {key:'I-R',definition_key:'P-POST',position_mm:[1000,0,800],rotation_deg:[0,0,0]},
    {key:'I-T',definition_key:'P-RAIL',position_mm:[500,0,1555],rotation_deg:[0,90,0]},
  ],
  views:['front','right','top'],measurements:[],change_note:'Create frame',request_quote:'bygg ramen',
})

test('generic assembly parser accepts reusable parts and no object type',()=>{
  const parsed=parseAssemblyWrite(base());assert(parsed)
  assert.equal(parsed.kind,'assembly');assert.equal(parsed.data.recipe.definitions[0].part_revision,2)
  assert.equal(ASSEMBLY_TOOL.function.name,'save_project_assembly')
  assert.doesNotMatch(JSON.stringify(ASSEMBLY_TOOL),/bunk_bed_v1|shelf_v1|cabinet_v1/)
})

test('placement revision does not mutate a part definition',()=>{
  const first=parseAssemblyWrite(base())!
  const changed=base() as any;changed.record_id=uid(9);changed.create_area_id=null;changed.expected_revision=1
  changed.instances[2].position_mm=[500,100,1555]
  const second=parseAssemblyWrite(changed)!
  assert.deepEqual(second.data.recipe.definitions,first.data.recipe.definitions)
  assert.notDeepEqual(second.data.recipe.instances,first.data.recipe.instances)
})

test('assembly converts to the same strict CAD contract',()=>{
  const parsed=parseAssemblyWrite(base())!
  const cad=assemblyToCad('artifact.rev1',parsed.data.recipe)
  assert(parseCadConstruction(cad));assert.equal(cad.definitions[0].catalog_part_id,uid(1))
  assert.equal(cad.instances.length,3)
})

test('assembly rejects unknown geometry, missing part pins and dangling instances',()=>{
  for(const mutate of [
    (v:any)=>{v.definitions[0].shape={kind:'bed',width:1000}},
    (v:any)=>{delete v.definitions[0].part_revision},
    (v:any)=>{v.instances[0].definition_key='missing'},
    (v:any)=>{v.units='in'},
  ]){const value:any=base();mutate(value);assert.equal(parseAssemblyWrite(value),null)}
})
