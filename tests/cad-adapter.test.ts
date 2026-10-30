import test from 'node:test'
import assert from 'node:assert/strict'
import {createCadAdapter,parseCadAssemblyRequest,parseCadAssemblyResult,CAD_VIEW_NAMES,CAD_MAX_VIEWS,type CadAssemblyRequest} from '../supabase/functions/_shared/cad-adapter.ts'
import {fastenerSchedule} from './support/fastener-schedule-fixture.ts'
import {cadParts,cadCutListCsv,cadPartMarkers,cadPartSize} from '../src/data/cadParts.ts'
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
test('annotation metadata must name exact parts and dimensions, never fabricated labels or sizes',async()=>{
 const r=req(),p:any=result(r)
 const parts=r.instances.map((i,index)=>({number:'P'+(index+1),instance_id:i.id,definition_id:i.definition_id,blank_mm:{x_mm:45,y_mm:70,z_mm:1600}}))
 p.annotations={version:1,coverage:'complete',views:{front:{coverage:'complete',dimensions:[{axis:'x',mm:1000},{axis:'z',mm:1600}],parts},top:{coverage:'complete',dimensions:[{axis:'x',mm:1000},{axis:'y',mm:70}],parts}}}
 assert.equal((await createCadAdapter(async()=>p).render(r)).status,'ok')
 for(const mutate of [(v:any)=>v.annotations.views.front.dimensions[0].mm=999,(v:any)=>v.annotations.views.top.parts[0].instance_id='invented',(v:any)=>v.annotations.coverage='partial']){
  const wrong=structuredClone(p);mutate(wrong);assert.equal((await createCadAdapter(async()=>wrong).render(r)).status,'unavailable')
 }
})
test('drawings carry no fasteners: annotations are version 1 only and a version 2 schedule is refused',async()=>{
 // Owner decision 2026-10-26: fasteners live in Bob's construction lists and the
 // material list. The worker can still answer version 2 (dormant); the edge refuses it.
 const r=req(),p:any=result(r),schedule=fastenerSchedule()
 const parts=r.instances.map((i,index)=>({number:'P'+(index+1),instance_id:i.id,definition_id:i.definition_id,blank_mm:{x_mm:45,y_mm:70,z_mm:1600}}))
 const views={front:{coverage:'complete',dimensions:[{axis:'x',mm:1000},{axis:'z',mm:1600}],parts},top:{coverage:'complete',dimensions:[{axis:'x',mm:1000},{axis:'y',mm:70}],parts}}
 const v1={...p,annotations:{version:1,coverage:'complete',views}},v2={...p,annotations:{version:2,coverage:'complete',views,fasteners:schedule}}
 assert(parseCadAssemblyResult(v1,r))
 assert.equal(parseCadAssemblyResult(v2,r),null,'a rendered or saved version 2 manifest is refused')
 assert.equal(parseCadAssemblyResult({...v1,annotations:{...v1.annotations,fasteners:schedule}},r),null,'version 1 cannot carry a schedule')
 assert.equal(parseCadAssemblyResult({...v2,annotations:{version:2,coverage:'complete',views}},r),null)
 assert.equal(parseCadAssemblyResult({...v2,annotations:{...v2.annotations,version:3}},r),null)
 assert.equal((await createCadAdapter(async()=>v1).render(r)).status,'ok')
 assert.equal((await createCadAdapter(async()=>v2).render(r)).status,'unavailable')
})
test('transport errors are unavailable, never empty geometry',async()=>{assert.equal((await createCadAdapter(async()=>{throw new Error('offline')}).render(req())).status,'unavailable')})
test('large annotated models preserve every instance through the 512-part recipe boundary',async()=>{
 for(const count of [25,128,512]){
  const r=req();r.instances=Array.from({length:count},(_,i)=>({...structuredClone(r.instances[0]),id:'part'+i.toString().padStart(3,'0')}))
  const p:any=result(r),parts=r.instances.map((i,index)=>({number:'P'+(index+1),instance_id:i.id,definition_id:i.definition_id,blank_mm:{x_mm:45,y_mm:70,z_mm:1600}}))
  p.annotations={version:1,coverage:'complete',views:{front:{coverage:'complete',dimensions:[{axis:'x',mm:1000},{axis:'z',mm:1600}],parts},top:{coverage:'complete',dimensions:[{axis:'x',mm:1000},{axis:'y',mm:70}],parts}}}
  assert.equal((await createCadAdapter(async()=>p).render(r)).status,'ok')
  p.annotations.views.front.parts=parts.slice(0,-1)
  assert.equal((await createCadAdapter(async()=>p).render(r)).status,'unavailable','dropping a late part never passes as complete')
  if(count===512)assert.equal(parseCadAssemblyRequest({...r,instances:[...r.instances,{...r.instances[0],id:'oneTooMany'}]}),null)
 }
})
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
test('parts read in plain words like the drawing sheets: name without sizes, length named, P-numbers grouped',()=>{
 const r=req();const part=cadParts(r)[0]
 assert.equal(part.name,'Post');assert.equal(part.size,'45 × 70 mm, length 1600 mm')
 assert.equal(cadParts({...r,definitions:[{...r.definitions[0],id:'leg_45x45x430'}],instances:r.instances.map((i:any)=>({...i,definition_id:'leg_45x45x430'}))})[0].name,'Leg')
 assert.equal(cadPartSize({primitive:'tube',outside_diameter_mm:42.4,wall_thickness_mm:2.6,length_mm:900}),'Tube, diameter 42.4 mm, wall 2.6 mm, length 900 mm')
 assert.equal(cadPartSize({primitive:'cylinder',diameter_mm:8,length_mm:40}),'Round, diameter 8 mm, length 40 mm')
 const parts=[1,2,3,5].map(n=>({number:'P'+n,instance_id:'i'+n,definition_id:'leg'})).concat([{number:'P4',instance_id:'i4',definition_id:'rail'}])
 const markers=cadPartMarkers({annotations:{version:1,coverage:'complete',views:{front:{dimensions:[],parts,coverage:'complete'}}}})
 assert.equal(markers.get('leg'),'P1–P3, P5');assert.equal(markers.get('rail'),'P4')
 assert.equal(cadPartMarkers({}).size,0,'older drawings without notes show no P-number column')
})
test('requested geometry checks cannot disappear or claim a different clearance',async()=>{
 const r=req();r.clearances=[{id:'gap',first_id:'left',second_id:'right',min_mm:20}]
 assert.equal((await createCadAdapter(async q=>result(q)).render(r)).status,'unavailable')
 const checks={collisions:{status:'complete',tested_pairs:0,skipped_pairs:0,overlaps:[]},clearances:[{...r.clearances[0],distance_mm:10,status:'clear'}],motions:[]}
 assert.equal((await createCadAdapter(async q=>({...result(q),checks})).render(r)).status,'unavailable')
 checks.clearances[0].status='insufficient'
 assert.equal((await createCadAdapter(async q=>({...result(q),checks})).render(r)).status,'ok')
})

test('every side and upper corner is a view; at most six per drawing',()=>{
 assert.deepEqual([...CAD_VIEW_NAMES],['front','back','left','right','top','bottom','isometric','isometric_front_left','isometric_back_left','isometric_back_right'])
 assert.equal(CAD_MAX_VIEWS,6)
 const six:any={...req(),views:['front','back','left','right','top','bottom']}
 assert.deepEqual(parseCadAssemblyRequest(six)?.views,six.views)
 assert.equal(parseCadAssemblyRequest({...req(),views:[...CAD_VIEW_NAMES].slice(0,7)} as any),null)
 assert.equal(parseCadAssemblyRequest({...req(),views:['side']} as any),null)
 assert.equal(parseCadAssemblyRequest({...req(),views:['left','left']} as any),null)
})
