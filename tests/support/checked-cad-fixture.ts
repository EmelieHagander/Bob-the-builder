/** Explicit synthetic saved source checked by real K2 for review/transport tests.
 * Multi-part joints, actual SQL/catalog ownership and revocation have their own fixtures. */
import {checkConstruction} from '../../supabase/functions/_shared/construction-checks.ts'
import {parameterPacket} from './cad-parameter-fixture.ts'
import type {CadAssemblyRequest} from '../../supabase/functions/_shared/cad-adapter.ts'
export const fixtureConstructionId='77777777-7777-4777-8777-777777777777'
export function checkedCadFixture(projectId:string,recipe:CadAssemblyRequest,extra:Record<string,any>={}){
 const materials=recipe.definitions.map((d,i)=>({definition_id:d.id,material_id:'77777777-7777-4777-8777-'+String(i+1).padStart(12,'0'),material_revision:1,part_id:null,part_revision:null}))
 const catalog=new Map(materials.map((m,i)=>[m.material_id+'@1',{id:m.material_id,revision:1,current_revision:1,kind:'material',profile_code:'sheet_stock',categories:['wood.plywood'],properties:{thickness:{value:String(Math.min(...['x_mm','y_mm','z_mm'].map(k=>Number((recipe.definitions[i] as any)[k])))),unit:'mm',truth:'provided_spec',parameter:null}}}]))
 const draft:any={status:'ok',projectId,source_kind:'construction',artifact_id:fixtureConstructionId,revision:1,current_revision:1,target_revision:1,area_id:null,archived:false,source_state:'current',title:'Saved fixture construction',description:'Explicit synthetic source',recipe:structuredClone(recipe),parameters:parameterPacket(projectId,recipe),materials,joints:[],open_questions:['Synthetic concept only'],...extra}
 const checked=checkConstruction(draft,catalog,'2026-10-14')
 if(!checked.concept_ready)throw new Error('Invalid checked CAD fixture: '+JSON.stringify(checked.issues))
 return {draft,checked,
  readArtifact:async()=>structuredClone(draft),
  checkConstruction:async()=>({status:'ready',draft:structuredClone(draft),checked:structuredClone(checked)}),
  packet:(r:CadAssemblyRequest,packet:any={})=>({...packet,recipe:r,manifest:{...packet.manifest,drawing_source:{artifact_id:draft.artifact_id,revision:draft.revision},bounding_box_mm:checked.bounds_mm,checks:{collisions:{status:'complete',overlaps:[]}},annotations:{version:1,coverage:'complete'}},files:packet.files??{front:'Zml4dHVyZQ=='},previews:packet.previews??Object.fromEntries(r.views.map(v=>[v,'Zml4dHVyZQ==']))})}
}
