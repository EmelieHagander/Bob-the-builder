import type { BuildingPlanRecipe } from '../../src/lib/buildingPlan.ts'
export const planId=(n:number)=>'70000000-0000-4000-8000-'+String(n).padStart(12,'0')
export const rect=(x:number,y:number,w:number,d:number)=>({x_mm:x,y_mm:y,width_mm:w,depth_mm:d})
export function makePlan():BuildingPlanRecipe{return {
 generator:'multifloor_v1',version:1,building_id:planId(200),building_revision:1,frame:'east_north_up',
 origin:'Synthetic SW outside corner; z=ground finished floor. Same datum for both levels.',
 levels:[{level_id:planId(201),level_revision:1,bounds:rect(0,0,9000,5000),wall_mm:300,floor_z_mm:0,slab_mm:null,basis:'estimated',source:'Synthetic test dimensions'},
 {level_id:planId(206),level_revision:1,bounds:rect(0,0,9000,5000),wall_mm:300,floor_z_mm:2800,slab_mm:250,basis:'estimated',source:'Synthetic test dimensions'}],
 spaces:[{space_id:planId(202),space_revision:1,level_id:planId(201),bounds:rect(300,300,4000,4400),basis:'estimated',source:'Synthetic layout'},
 {space_id:planId(203),space_revision:1,level_id:planId(201),bounds:rect(4420,300,4280,4400),basis:'estimated',source:'Synthetic layout'},
 {space_id:planId(207),space_revision:1,level_id:planId(206),bounds:rect(300,300,4000,4400),basis:'estimated',source:'Synthetic layout'},
 {space_id:planId(208),space_revision:1,level_id:planId(206),bounds:rect(4420,300,4280,4400),basis:'estimated',source:'Synthetic layout'}],
 probes:[{key:'study',label:'Possible stair area — not a stair design',from_level_id:planId(201),to_level_id:planId(206),bounds:rect(5000,1000,1000,2000)}]
}}
