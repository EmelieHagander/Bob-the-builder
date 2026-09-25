import test from 'node:test'
import assert from 'node:assert/strict'
import {createCadAdapter,parseCadAssemblyRequest,type CadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'
import {cadParts,cadCutListCsv} from '../src/data/cadParts.ts'
const req=():CadAssemblyRequest=>({contract_version:1,units:'mm',assembly_id:'assembly.test',
  definitions:[{id:'post',primitive:'box',material_ref:'mat.45x70',x_mm:45,y_mm:70,z_mm:1600},{id:'tube',primitive:'tube',material_ref:'mat.pvc',outside_diameter_mm:32,wall_thickness_mm:2,length_mm:500}],
  instances:[{id:'left',definition_id:'post',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}},{id:'right',definition_id:'post',placement:{x:955,y:0,z:0,rx:0,ry:0,rz:0}}],views:['front','top']})
const hash='a'.repeat(64)
const result=(r=req())=>({contract_version:1,engine:{name:'build123d',version:'0.13.0',units:'mm'},assembly_id:r.assembly_id,
  bounding_box_mm:{min:[0,0,0],max:[1000,70,1600],size:[1000,70,1600]},definitions:r.definitions,
  instances:r.instances.map(i=>({id:i.id,definition_id:i.definition_id,bounding_box_mm:{min:[0,0,0],max:[1,1,1],size:[1,1,1]}})),
  exports:{step:{file:'assembly.step',sha256:hash},front:{file:'front.svg',sha256:hash},top:{file:'top.svg',sha256:hash}}})
test('reusable definitions can drive multiple placed instances',()=>{const p=parseCadAssemblyRequest(req());assert(p);assert.equal(p.instances.filter(i=>i.definition_id==='post').length,2)})
test('arbitrary code and unsupported primitives are rejected',()=>{assert.equal(parseCadAssemblyRequest({...req(),python:'x'}),null);const b:any=req();b.definitions[0]={id:'p',primitive:'python',material_ref:null,source:'x'};assert.equal(parseCadAssemblyRequest(b),null)})
test('impossible tube and missing definition are rejected',()=>{const a:any=req();a.definitions[1].wall_thickness_mm=16;assert.equal(parseCadAssemblyRequest(a),null);const b:any=req();b.instances[0].definition_id='missing';assert.equal(parseCadAssemblyRequest(b),null)})
test('result must match engine and assembly identity',async()=>{assert.equal((await createCadAdapter(async r=>result(r)).render(req())).status,'ok');assert.equal((await createCadAdapter(async r=>({...result(r),assembly_id:'other'})).render(req())).status,'unavailable')})
test('transport errors are unavailable, never empty geometry',async()=>{assert.equal((await createCadAdapter(async()=>{throw new Error('offline')}).render(req())).status,'unavailable')})
test('saved JSON property order does not invalidate a matching CAD manifest',async()=>{
 const sorted=(v:any):any=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v
 assert.equal((await createCadAdapter(async r=>sorted(result(r))).render(req())).status,'ok')
})
test('bounded local cuts and explicit clearance/motion checks validate without executable geometry',()=>{
 const r=req();r.definitions[0].cuts=[{primitive:'cylinder',diameter_mm:8,length_mm:80,placement:{x:20,y:-5,z:50,rx:90,ry:0,rz:0}}]
 r.clearances=[{id:'gap',first_id:'left',second_id:'right',min_mm:10}]
 r.motions=[{id:'travel',moving_ids:['left'],obstacle_ids:['right'],delta:{x:200,y:0,z:0}}]
 assert(parseCadAssemblyRequest(r));r.motions[0].obstacle_ids=['left'];assert.equal(parseCadAssemblyRequest(r),null)
 delete r.motions;r.definitions[0].cuts=Array(17).fill(r.definitions[0].cuts![0]);assert.equal(parseCadAssemblyRequest(r),null)
})
test('cut list counts actual instances, omits unused definitions and retains original blank dimensions',()=>{
 const r=req();r.definitions[0].cuts=[{primitive:'box',x_mm:5,y_mm:5,z_mm:5,placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}}]
 const parts=cadParts(r);assert.equal(parts.length,1);assert.equal(parts[0].quantity,2);assert.equal(parts[0].dimensions,'45 × 70 × 1600');assert.equal(parts[0].cuts,1)
 assert.match(cadCutListCsv(r),/"post","mat.45x70","2"/)
 assert.match(cadCutListCsv({...r,definitions:[{...r.definitions[0],material_ref:'=SUM(1)'}]}),/'=SUM\(1\)/)
})
test('requested geometry checks cannot disappear or claim a different clearance',async()=>{
 const r=req();r.clearances=[{id:'gap',first_id:'left',second_id:'right',min_mm:20}]
 assert.equal((await createCadAdapter(async q=>result(q)).render(r)).status,'unavailable')
 const checks={collisions:{status:'complete',tested_pairs:0,skipped_pairs:0,overlaps:[]},clearances:[{...r.clearances[0],distance_mm:10,status:'clear'}],motions:[]}
 assert.equal((await createCadAdapter(async q=>({...result(q),checks})).render(r)).status,'unavailable')
 checks.clearances[0].status='insufficient'
 assert.equal((await createCadAdapter(async q=>({...result(q),checks})).render(r)).status,'ok')
})
