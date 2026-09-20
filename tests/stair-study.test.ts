import {test} from 'node:test'
import assert from 'node:assert/strict'
import {stairSpec,stairGeometry,checkedStairStudy,stairSummary} from '../src/lib/stairStudy.ts'
import {stairStudySvg} from '../src/lib/stairStudySvg.ts'
import {makeStair,makeStairDetails} from './support/stair-fixture.ts'
import {makePlan,planId,rect} from './support/multifloor-fixture.ts'
import {parseStairInspection} from '../supabase/functions/_shared/project-stair.ts'
import {parseProjectWrite} from '../supabase/functions/_shared/project-write.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'

test('quarter-turn geometry derives the actual terminal riser, elevations and landing from one source plan',()=>{
 const p=makePlan(),s=makeStair(),old=structuredClone({p,s}),g=stairGeometry(p,s)
 assert.equal(g.rise_total_mm,2800);assert.equal(g.rise_mm,175);assert.equal(g.tread_count,14)
 assert.equal(g.step_formula_mm,630);assert.deepEqual(g.exit,{x_mm:4910,y_mm:3610});assert.equal(g.exit_heading,'east')
 assert.deepEqual(g.exit_landing,rect(4910,3160,900,900));assert.deepEqual(g.opening_suggestion,s.opening)
 assert.equal(g.surfaces.find(t=>t.kind==='turn_landing')!.z_mm,1400)
 assert.equal(g.surfaces.at(-1)!.z_mm,2800);assert.equal(g.state,'modelled_checks_only')
 assert.deepEqual(g.exit_spaces,[{space_id:planId(208),contains_area:true}]);assert.deepEqual({p,s},old)
})
test('straight flight has N rises and N-1 treads; no imaginary tread at the upper floor',()=>{
 const s={...makeStair(),turn:'straight' as const,first_flight_risers:null},g=stairGeometry(makePlan(),s)
 assert.equal(g.tread_count,15);assert.deepEqual(g.exit,{x_mm:2500,y_mm:5400});assert.equal(g.exit_heading,'north')
 assert.equal(g.path_length_mm,4200);assert(g.conflicts.some(c=>c.code==='exit_landing_outside_upper_envelope'))
})
test('all headings and both turning directions rotate/reflect the same stair without changing heights',()=>{
 const rotations=[[2410,2410,'east'],[2410,-2410,'south'],[-2410,-2410,'west'],[-2410,2410,'north']] as const
 for(const [i,heading]of (['north','east','south','west']as const).entries()){
  const g=stairGeometry(makePlan(),{...makeStair(),heading})
  assert.deepEqual(g.exit,{x_mm:2500+rotations[i][0],y_mm:1200+rotations[i][1]});assert.equal(g.exit_heading,rotations[i][2])
 }
 const left=stairGeometry(makePlan(),{...makeStair(),turn:'left'})
 assert.deepEqual(left.exit,{x_mm:90,y_mm:3610});assert.equal(left.exit_heading,'west')
})
test('source floor-height change alters rise and headroom, not x/y footprint; translation does not accumulate rounding',()=>{
 const old=stairGeometry(makePlan(),makeStair()),p=makePlan();p.levels[1].floor_z_mm=3000
 const after=stairGeometry(p,makeStair());assert.equal(after.rise_mm,187.5);assert.deepEqual(old.exit,after.exit)
 for(let i=1;i<=1000;i++){
  const s=makeStair();s.start_x_mm=i/1000;s.start_y_mm=-i/1000
  const g=stairGeometry(makePlan(),s)
  assert.equal(Math.round(g.exit.x_mm*1000),2410000+i);assert.equal(Math.round(g.exit.y_mm*1000),2410000-i)
 }
})
test('unknown/reversed/nonadjacent floors never fabricate a stair height',()=>{
 const p=makePlan();p.levels[1].floor_z_mm=null;assert.throws(()=>stairGeometry(p,makeStair()),/unknown/)
 p.levels[1].floor_z_mm=-100;assert.throws(()=>stairGeometry(p,makeStair()),/higher/)
 p.levels[1].floor_z_mm=2800;p.levels.push({...p.levels[0],level_id:planId(900),floor_z_mm:1500})
 assert.throws(()=>stairGeometry(p,makeStair()),/intermediate/)
 p.levels[2].floor_z_mm=null;assert.throws(()=>stairGeometry(p,makeStair()),/unlocated/)
})
test('complete walking rectangles catch a partially covered tread even when its centre lies in the opening',()=>{
 const s=makeStair();s.opening=rect(2050.001,2040,2859.999,2020)
 const g=stairGeometry(makePlan(),s)
 assert(g.conflicts.some(c=>c.code==='modelled_headroom_below_requested'&&c.parts.includes('step_4')))
 assert(g.clearance.find(c=>c.key==='step_4')!.minimum_mm!<2000)
 s.opening=rect(2050,2040.001,2860,2019.999)
 assert(stairGeometry(makePlan(),s).conflicts.some(c=>c.parts.includes('step_4')))
})
test('headroom equality is accepted in the limited model, threshold exceedance is not',()=>{
 const s=makeStair();s.required_headroom_mm=2025
 assert(!stairGeometry(makePlan(),s).conflicts.some(c=>c.code==='modelled_headroom_below_requested'))
 s.required_headroom_mm=2026
 assert(stairGeometry(makePlan(),s).conflicts.some(c=>c.parts.includes('step_3')))
})
test('opening cannot consume upper exit landing; an omitted opening is unknown, not a pass',()=>{
 const s=makeStair();s.opening!.width_mm+=1
 assert(stairGeometry(makePlan(),s).conflicts.some(c=>c.code==='exit_landing_over_floor_void'))
 s.opening=null;const g=stairGeometry(makePlan(),s)
 assert(g.unknown.includes('floor_opening'));assert(g.conflicts.some(c=>c.code==='opening_needed_for_headroom'));assert(g.opening_suggestion)
})
test('unknown ceiling/slab and missing room coverage are explicit, never safe or clear-route results',()=>{
 const s=makeStair();s.upper_ceiling_above_floor_mm=null
 const p=makePlan();p.levels[1].slab_mm=null;p.spaces=[]
 const g=stairGeometry(p,s)
 for(const v of ['upper_ceiling','upper_slab_thickness','exit_landing_room_coverage','approach_room_coverage'])assert(g.unknown.includes(v))
 assert.equal(g.opening_suggestion,null);assert.equal(g.state,'incomplete')
 assert.match(g.limits,/No doors/)
 s.upper_ceiling_above_floor_mm=1900;assert(stairGeometry(makePlan(),s).conflicts.some(c=>c.parts.includes('exit_landing')))
})
test('strict recipe rejects extra geometry/authority, unsafe numerics and silent winder substitution',()=>{
 for(const change of [{generator:'winder'}, {version:2},{turn:'spiral'},{risers:2},{risers:16.1},{first_flight_risers:15},{first_flight_risers:null},
 {width_mm:900.01},{going_mm:NaN},{start_x_mm:Infinity},{start_y_mm:1e-5},{opening:{x_mm:1}},{from_level_id:planId(206)},
 {basis:'measured'},{source:''},{safe:true},{height_mm:2800}])assert.throws(()=>stairSpec({...makeStair(),...change}))
})
test('all views escape untrusted text and identify exact parent and stair versions',()=>{
 const d=makeStairDetails();d.artifact_revision=7;d.plan_revision=3
 for(const view of ['lower','upper','section']as const){
  const svg=stairStudySvg(d,view,'<script>bad</script>')
  assert.doesNotMatch(svg,/<script>|NaN|Infinity/);assert.match(svg,/&lt;script&gt;/);assert.match(svg,/NOT TO SCALE/)
  assert.match(svg,/4910 \/ 3610/);assert.match(svg,/v7/);assert.match(svg,/v3/)
  assert.equal(svg,stairStudySvg(d,view,'<script>bad</script>'))
 }
 assert.throws(()=>checkedStairStudy(d,'B',d.artifact_id,7),/identity/)
 assert.throws(()=>checkedStairStudy(d,'A',d.artifact_id,7),/source state mismatch|identity|mismatch/i)
})
const writeArgs=()=>({record_id:null,expected_revision:0,action:'create',plan_id:planId(400),plan_revision:1,title:'Stair study',description:'A quarter turn',assumptions:'Test estimate.',recipe:makeStair(),change_note:'User request',request_quote:'Rita trappan'})
test('only a current quoted save request enters the writer; inspections have separate read-only schema',()=>{
 const a=writeArgs();assert.equal(parseProjectWrite('save_project_stair',a,'A','Rita trappan')!.kind,'stair')
 for(const change of [{project_id:'B'},{status:'build_ready'},{plan_revision:0},{expected_revision:1},{action:'revise'}, {request_quote:'Old request'}, {recipe:{...makeStair(),turn:'rounded'}}])assert.equal(parseProjectWrite('save_project_stair',{...a,...change},'A','Rita trappan'),null)
 assert(parseStairInspection({plan_id:a.plan_id,plan_revision:1,candidates:[{label:'A',recipe:a.recipe}]}))
 assert.equal(parseStairInspection({plan_id:a.plan_id,plan_revision:1,candidates:Array(5).fill({label:'A',recipe:a.recipe})}),null)
})
test('read-only comparison fetches exact caller-bound plan once, compares alternatives and refuses stale or denied sources',async()=>{
 const d=makeStairDetails();let calls=0,stale=false,denied=false
 const lookup=createProjectLookup('A',async(project)=>{assert.equal(project,'A');calls++;return denied?{data:null,error:{code:'42501'}}:{data:{records:[{id:d.plan_id,revision:1,multifloor_plan:{...d.plan,sources_changed:stale}}],related:[],truncated:false},error:null}},10000,4)
 const args={plan_id:d.plan_id,plan_revision:1,candidates:[{label:'Right',recipe:makeStair()},{label:'Left',recipe:{...makeStair(),turn:'left'}}]}
 const r=await lookup.inspectStairs(args);assert.equal(r.status,'ok');assert.equal(r.saved,false);assert.equal(calls,1)
 assert.equal((r as any).candidates[0].result.exit.x_mm,4910);assert.equal((r as any).candidates[1].result.state,'conflict')
 stale=true;assert.equal((await lookup.inspectStairs(args)).status,'conflict');stale=false;denied=true
 assert.equal((await lookup.inspectStairs(args)).status,'denied')
})
test('stair research retains bounded recipe plus derived result; unknown sources cannot be inferred from marker',async()=>{
 const d=makeStairDetails()
 const lookup=createProjectLookup('A',async()=>({data:{records:[{id:d.artifact_id,revision:1,stair_study:d,has_stair_study:true}],related:[],truncated:false},error:null}))
 const r=await lookup.search({dataset:'artifacts',query:null,status:null,record_id:d.artifact_id,area_id:null})
 assert.equal(r.status,'ok');assert.equal((r.records[0].derived_stair as any).rise_mm,175)
 assert(new TextEncoder().encode(JSON.stringify(r)).length<32768)
 assert.equal(stairSummary(d.plan.recipe,d.recipe).exit.x_mm,4910)
})
