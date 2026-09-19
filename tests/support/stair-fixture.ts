import {makePlan,planId,rect} from './multifloor-fixture.ts'
import type {StairSpec,StairDetails} from '../../src/lib/stairStudy.ts'
export function makeStair():StairSpec{return {generator:'stair_study_v1',version:1,from_level_id:planId(201),to_level_id:planId(206),
 start_x_mm:2500,start_y_mm:1200,heading:'north',turn:'right',risers:16,first_flight_risers:8,width_mm:900,going_mm:280,landing_depth_mm:900,
 opening:rect(2050,2040,2860,2020),required_headroom_mm:2000,upper_ceiling_above_floor_mm:2400,basis:'estimated',source:'Synthetic design test; not the user house.'}}
export function makeStairDetails():StairDetails{
 const recipe=makePlan(),names=Object.fromEntries([recipe.building_id,...recipe.levels.map(l=>l.level_id),...recipe.spaces.map(s=>s.space_id)].map(id=>[id,id]))
 names[planId(201)]='Ground floor';names[planId(206)]='Upper floor';names[planId(208)]='Landing';names[planId(207)]='Bedroom'
 return {project_id:'A',artifact_id:planId(500),artifact_revision:1,building_id:planId(200),plan_id:planId(400),plan_revision:1,
 recipe:makeStair(),sources_changed:false,plan:{project_id:'A',artifact_id:planId(400),artifact_revision:1,building_id:planId(200),recipe,names,sources_changed:false,physical_pending:false}}
}
