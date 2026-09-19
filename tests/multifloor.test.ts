import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildingPlanGeometry,buildingPlanRecipe,rectContains,rectIntersection,checkedBuildingPlan,withDerivedBuildingPlan} from '../src/lib/buildingPlan.ts'
import {buildingPlanSvg} from '../src/lib/buildingPlanSvg.ts'
import {makePlan,planId as id,rect} from './support/multifloor-fixture.ts'
import {parseProjectWrite} from '../supabase/functions/_shared/project-write.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
const names=Object.fromEntries([200,201,202,203,206,207,208].map(n=>[id(n),`Name ${n}`]))
const detail=()=>({project_id:'A',artifact_id:id(400),artifact_revision:1,building_id:id(200),recipe:makePlan(),names,sources_changed:false,physical_pending:false})
const args=()=>({record_id:null,action:'create',expected_revision:0,create_area_id:'areaA',target_revision:1,title:'Two floors',description:'Coordinate study',assumptions:'Test dimensions only',recipe:makePlan(),measurements:[],change_note:'Requested',request_quote:'Rita huset'})
test('one frame derives inner dimensions and the same study rectangle on both floors',()=>{
 const p=makePlan(),before=structuredClone(p),g=buildingPlanGeometry(p)
 assert.deepEqual(g.levels[0].inside,rect(300,300,8400,4400))
 assert.equal(g.probes[0].floor_delta_mm,2800);assert.equal(g.probes[0].lower_floor_to_upper_slab_mm,2550)
 assert.deepEqual(g.probes[0].to_spaces.map(s=>s.space_id),[id(208)])
 assert(g.probes[0].to_spaces[0].contains_study_area)
 assert.deepEqual(p,before);g.recipe.levels[0].bounds.x_mm=100;assert.equal(p.levels[0].bounds.x_mm,0)
})
test('a probe move changes projections, not room identities or floor sizes; touching is not overlap',()=>{
 const p=makePlan();p.probes[0].bounds=rect(3500,1000,2000,2000)
 const g=buildingPlanGeometry(p)
 assert.deepEqual(g.probes[0].to_spaces.map(s=>s.space_id),[id(207),id(208)])
 assert(g.probes[0].to_spaces.every(s=>!s.contains_study_area))
 assert.equal(rectIntersection(rect(0,0,1000,1000),rect(1000,0,1000,1000)),null)
 assert.deepEqual(g.recipe.spaces,makePlan().spaces)
})
test('unknown floor heights and room footprints do not become zero, empty space or an invented upstairs location',()=>{
 const p=makePlan();p.levels[1].floor_z_mm=null;p.spaces[3].bounds=null
 const g=buildingPlanGeometry(p)
 assert.equal(g.probes[0].floor_delta_mm,null);assert.equal(g.probes[0].lower_floor_to_upper_slab_mm,null)
 assert.equal(g.probes[0].vertical_state,'unknown_floor_height');assert.deepEqual(g.probes[0].to_spaces,[])
 assert.deepEqual(g.unplaced_spaces,[id(208)])
 p.levels[1].floor_z_mm=2800;p.levels[1].slab_mm=null
 assert.equal(buildingPlanGeometry(p).probes[0].lower_floor_to_upper_slab_mm,null)
})
test('offset floors use shared coordinates, not automatically recentered outlines',()=>{
 const p=makePlan();p.levels[1].bounds.x_mm=7000
 const g=buildingPlanGeometry(p)
 assert.equal(g.probes[0].within_to_outline,false)
 assert.deepEqual(g.probes[0].bounds,p.probes[0].bounds)
 assert(g.conflicts.some(c=>c.kind==='study_area_outside_inside_envelope'))
})
test('signed basement elevations and downward projections retain direction',()=>{
 const p=makePlan();p.levels[0].floor_z_mm=-2400;p.levels[1].floor_z_mm=0
 assert.equal(buildingPlanGeometry(p).probes[0].floor_delta_mm,2400)
 p.probes[0].from_level_id=id(206);p.probes[0].to_level_id=id(201)
 const g=buildingPlanGeometry(p)
 assert.equal(g.probes[0].floor_delta_mm,-2400);assert.equal(g.probes[0].lower_floor_to_upper_slab_mm,null)
})
test('duplicate identities, invalid versions, excess precision, false measured claims and impossible envelopes fail closed',()=>{
 const changes=[(p:any)=>p.version=2,(p:any)=>p.frame='independent_origins',(p:any)=>p.unknown_field=true,
 (p:any)=>p.levels[0].wall_mm=2500,(p:any)=>p.levels[1].floor_z_mm=0,(p:any)=>p.levels[0].bounds.width_mm=0,
 (p:any)=>p.levels[0].bounds.x_mm=1.0001,(p:any)=>p.levels[0].bounds.x_mm=NaN,(p:any)=>p.levels[0].floor_z_mm=undefined,
 (p:any)=>p.spaces[0].basis='measured',(p:any)=>p.levels.push(structuredClone(p.levels[0])),
 (p:any)=>p.spaces.push({...p.spaces[0],space_id:p.spaces[0].space_id.toUpperCase()}),
 (p:any)=>p.probes[0].to_level_id=id(999),(p:any)=>p.spaces[0].level_id=id(999)]
 for(const change of changes){const p=makePlan();change(p);assert.throws(()=>buildingPlanRecipe(p))}
})
test('2000 fractional translated fixtures preserve intersections and floor deltas exactly',()=>{
 for(let i=0;i<2000;i++){
  const p=makePlan(),dx=(i*137-100000)/1000,dy=(i*53-50000)/1000
  for(const l of p.levels){l.bounds.x_mm=dx;l.bounds.y_mm=dy}
  for(const s of p.spaces){s.bounds!.x_mm=Math.round((s.bounds!.x_mm+dx)*1000)/1000;s.bounds!.y_mm=Math.round((s.bounds!.y_mm+dy)*1000)/1000}
  p.probes[0].bounds.x_mm=Math.round((5000+dx)*1000)/1000;p.probes[0].bounds.y_mm=Math.round((1000+dy)*1000)/1000
  p.levels[1].floor_z_mm=(2800000+i)/1000;p.levels[1].slab_mm=(250000+i)/1000
  const g=buildingPlanGeometry(p)
  assert.equal(g.probes[0].lower_floor_to_upper_slab_mm,2550)
  assert.deepEqual(g.probes[0].to_spaces.map(h=>h.space_id),[id(208)])
  assert(rectContains(g.levels[0].inside,p.probes[0].bounds))
 }
})
test('SVG views share dimensions, source/revision stamps, explicit limits and escaped labels',()=>{
 const d=detail();d.names[id(201)]='<script>oops</script>'
 for(const view of [id(201),id(206),'heights']){
  const svg=buildingPlanSvg(d,view,'A </text><script>bad</script>')
  assert.doesNotMatch(svg,/<script|NaN|Infinity/);assert.match(svg,/&lt;script&gt;/)
  assert.match(svg,/revision 1/);assert.match(svg,/NOT TO SCALE/);assert.match(svg,/stair/)
  assert.equal(svg,buildingPlanSvg(JSON.parse(JSON.stringify(d)),view,'A </text><script>bad</script>'))
 }
 assert.match(buildingPlanSvg(d,id(201),'Plan'),/Inside E–W 8400 mm/)
 assert.throws(()=>buildingPlanSvg(d,'unknown','Plan'))
})
test('strict chat tool parses a coordinate study, never project authority, arbitrary SVG or approval',()=>{
 assert.equal(parseProjectWrite('save_project_building_plan',args(),'A','Rita huset')!.kind,'multifloor')
 for(const change of [{status:'build_ready'},{projectId:'B'},{expected_revision:1},{request_quote:'some older request'},{recipe:{...makePlan(),frame:'pixels'}},{measurements:[{id:id(30),revision:0}]}])
  assert.equal(parseProjectWrite('save_project_building_plan',{...args(),...change},'A','Rita huset'),null)
 assert.throws(()=>checkedBuildingPlan(detail(),'B',id(400),1))
 assert.match(String(withDerivedBuildingPlan({id:id(400),revision:1,has_multifloor_plan:true},'A').drawing_error),/unavailable/)
})
test('read-only projection fetches the current caller-scoped plan; stale revisions and denied sources are not replaced from memory',async()=>{
 const row={id:id(400),revision:1,has_multifloor_plan:true,multifloor_plan:detail()}
 const lookup=createProjectLookup('A',async(project,input)=>{assert.equal(project,'A');assert.equal(input.record_id,id(400));return {data:{records:[row],related:[],truncated:false},error:null}},1000,10)
 const input={record_id:id(400),expected_revision:1,from_level_id:id(201),to_level_id:id(206),bounds:rect(5000,1000,1000,2000)}
 const r:any=await lookup.inspectProjection(input)
 assert.equal(r.status,'ok');assert.equal(r.saved,false);assert.equal(r.projection.floor_delta_mm,2800);assert.equal(lookup.remaining,9)
 assert.equal((await lookup.inspectProjection({...input,expected_revision:2})).status,'conflict')
 assert.equal((await lookup.inspectProjection({...input,record_id:'bad'})).status,'invalid')
 const denied=createProjectLookup('A',async()=>({data:null,error:{code:'42501'}}))
 assert.equal((await denied.inspectProjection(input)).status,'denied')
 assert.equal(lookup.sources[0].recordId,id(400))
})
test('large overlap studies keep exact research and read-only results bounded without dropping the recipe',async()=>{
 const d=detail();d.names={...d.names}
 d.recipe.spaces=Array.from({length:32},(_,i)=>({space_id:id(800+i),space_revision:1,level_id:id(206),bounds:rect(300,300,8400,4400),basis:'estimated' as const,source:'Explicitly overlapping test zones, not partition walls.'}))
 for(const s of d.recipe.spaces)d.names[s.space_id]='Synthetic overlapping zone '+s.space_id
 d.recipe.probes=Array.from({length:4},(_,i)=>({...d.recipe.probes[0],key:`area${i}`}))
 assert(Buffer.byteLength(JSON.stringify(d.recipe))+Buffer.byteLength(JSON.stringify(d.names))<16000)
 const row={id:id(400),revision:1,title:'Large test study',description:'x'.repeat(6000),assumptions:'y'.repeat(3500),has_multifloor_plan:true,multifloor_plan:d}
 const lookup=createProjectLookup('A',async()=>({data:{records:[row],related:[],truncated:false},error:null}),1000,2)
 const read=await lookup.search({dataset:'artifacts',query:null,status:null,area_id:null,record_id:id(400),after_id:null})
 assert.equal(read.records.length,1);assert.equal(read.truncated,false);assert(Buffer.byteLength(JSON.stringify(read))<32768)
 const r:any=await lookup.inspectProjection({record_id:id(400),expected_revision:1,from_level_id:id(201),to_level_id:id(206),bounds:rect(5000,1000,1000,2000)})
 assert.equal(r.status,'ok');assert.equal(r.projection.to_spaces.length,32);assert.equal(r.conflicts.length,12);assert.equal(r.conflicts_total,496)
 assert(Buffer.byteLength(JSON.stringify(r))<32768)
 assert.equal((await lookup.inspectProjection(null)).status,'budget_exhausted')
})
