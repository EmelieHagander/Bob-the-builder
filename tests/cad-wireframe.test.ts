import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { InstancedBufferGeometry, LineSegments } from 'three'
import { cadViewerSourceHash, parseCadWireframe, parseCadViewerPin, type CadWireframe } from '../supabase/functions/_shared/cad-wireframe.ts'
import { parseCadAssemblyRequest } from '../supabase/functions/_shared/cad-adapter.ts'
import { createWireframeObjects, createWireframeOverview } from '../src/lib/wireframeObjects.ts'
import { placementMatrix, shellMatrix, multiply, transformPoint } from '../src/lib/shell3d.ts'
import type { ShellComponent } from '../src/lib/cadShell.ts'
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/cad-wireframes.json',import.meta.url),'utf8'))
const near = (a: number[],b: number[]) => a.forEach((n,i)=>assert(Math.abs(n-b[i])<.0001, `${a} != ${b}`))

test('real kernel packets validate against exact recipes and a cross-runtime canonical hash',async()=>{
 for(const {recipe,geometry} of Object.values(fixtures) as any[]) {
  const parsed=parseCadAssemblyRequest(recipe); assert(parsed)
  assert.equal(await cadViewerSourceHash(parsed),geometry.source_hash)
  assert(parseCadWireframe(geometry,parsed,geometry.source_hash))
  const reordered=Object.fromEntries(Object.entries(recipe).reverse())
  assert.equal(await cadViewerSourceHash(reordered as any),geometry.source_hash)
 }
})
test('view contract rejects malformed, excessive or mismatched output',()=>{
 const {recipe,geometry}=fixtures.machined
 for(const change of [ {engine:'other'}, {source_hash:'x'}, {units:'m'}, {bounds:{min:[NaN,0,0],max:[1,1,1]}},
  {instances:[{...geometry.instances[0],placement:{...geometry.instances[0].placement,x:999}}]},
  {definitions:[{id:'block',positions:[0,0,0]}]}, {definitions:[{id:'block',positions:Array(60001*6).fill(0)}]},
  {definitions:[{id:'block',positions:[0,0,0,Infinity,0,0]}]} ])
  assert.equal(parseCadWireframe({...geometry,...change},recipe,geometry.source_hash),null)
 assert.equal(parseCadWireframe(geometry,recipe,'b'.repeat(64)),null)
 assert.equal(parseCadViewerPin({project_id:'../other',artifact_id:'00000000-0000-4000-8000-000000000001',revision:1}),null)
})
test('repeated edge geometry batches into one instanced draw with bounded GPU buffers and no lights',()=>{
 const value:CadWireframe=structuredClone(fixtures.room.geometry)
 value.instances=Array.from({length:512},(_,i)=>({id:`stud${i}`,definition_id:value.definitions[0].id,placement:{x:i*600,y:0,z:0,rx:0,ry:0,rz:0}}))
 value.definitions=value.definitions.slice(0,1)
 const objects=createWireframeObjects(value,'#123456')
 assert.equal(objects.drawCalls,1); assert.equal(objects.segments,512*12)
 const line=objects.group.children[0] as LineSegments<InstancedBufferGeometry>
 assert(line.geometry instanceof InstancedBufferGeometry)
 assert.equal(line.geometry.instanceCount,512)
 assert.equal(line.geometry.getAttribute('position').count,24,'one shared set of 12 edges')
 assert.equal(objects.group.children.filter(c=>(c as any).isLight).length,0)
 let disposed=0; line.geometry.addEventListener('dispose',()=>disposed++)
 objects.dispose(); assert.equal(disposed,1)
})
test('rebased instance and shell transforms preserve the CAD coordinate system',()=>{
 const value:CadWireframe=fixtures.machined.geometry
 const outer=shellMatrix({x_mm:1000000,y_mm:2000,z_mm:5,rz:90})
 const objects=createWireframeObjects(value,'#123456',outer)
 const geometry=(objects.group.children[0] as LineSegments<InstancedBufferGeometry>).geometry
 const columns=Array.from({length:4},(_,i)=>Array.from(geometry.getAttribute('m'+i).array))
 const local=value.definitions[0].positions.slice(0,3)
 const world=transformPoint(multiply(outer,placementMatrix(value.instances[0].placement)),local)
 const transformed=transformPoint(columns.flat(),local)
 const expectedCenter=transformPoint(outer,value.bounds.min.map((n,i)=>(n+value.bounds.max[i])/2))
 near(transformed,world.map((n,i)=>n-expectedCenter[i]))
 assert(Math.abs(columns[3][0])<100,'million-mm world offset is removed before Float32 conversion')
 objects.dispose()
})
test('whole-house overview needs at most two line batches and no detailed recipes',()=>{
 const rows:ShellComponent[]=Array.from({length:64},(_,i)=>({component_key:`part${i}`,child_artifact_id:'00000000-0000-4000-8000-000000000001',child_revision:1,
  x_mm:(i%8)*4000,y_mm:Math.floor(i/8)*3000,z_mm:0,rz:0,placement_basis:'shared_origin',reason:'Fixture',child_title:`part${i}`,child_current_revision:1,
  bounding_box_mm:{min:[0,0,0],max:[4000,3000,2400],size:[4000,3000,2400]},status:i%5===0?'newer_revision':'current'}))
 const objects=createWireframeOverview(rows,'#123456','#654321');assert(objects)
 assert.equal(objects.drawCalls,2);assert.equal(objects.segments,768)
 objects.dispose()
 assert.equal(createWireframeOverview(rows.map(c=>({...c,status:'unavailable'})),'#123456','#654321'),null)
})
test('oversized piece fails before buffer creation; one selected part stays available',()=>{
 const value:CadWireframe=structuredClone(fixtures.room.geometry)
 value.definitions=value.definitions.slice(0,1);value.definitions[0].positions=Array(1000*6).fill(0)
 value.instances=Array.from({length:512},(_,i)=>({id:`stud${i}`,definition_id:value.definitions[0].id,placement:{x:i*600,y:0,z:0,rx:0,ry:0,rz:0}}))
 assert.throws(()=>createWireframeObjects(value,'#123456'),/too many edges/)
 const one=createWireframeObjects(value,'#123456',undefined,'stud1');assert.equal(one.segments,1000);one.dispose()
})
