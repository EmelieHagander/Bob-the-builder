import type {DesignIntent,DesignIntentPin,DesignPurpose} from '../../supabase/functions/_shared/project-design-intent.ts'

/** Explicit synthetic choices, not a migration backfill or product approval. */
export function designIntent(purpose:DesignPurpose='construction'):DesignIntent{
 return {version:1,purpose,summary:'Synthetic isolated construction with the fixture dimensions and selected material.',references:[],
  features:[{id:'fixture_form',description:'Preserve the fixture assembly, dimensions and parts.',basis:'project_record',source_ref:null}],
  choices:[{id:'fixture_design',question:'Which direction should this synthetic output develop?',alternatives:['The explicitly described fixture assembly'],
   recommendation:'Develop the fixture assembly.',basis:'The isolated test fixture specifies its dimensions and material.',
   consequences:'The output is a synthetic concept; joints, products and fabrication still require applicable checks.',geometry_dependency:true,
   status:'resolved',selected_direction:'The explicitly described fixture assembly',decision_authority:'bob',
   decision_basis:'The test delegates the reversible fixture design to Bob.',deferral:null}],
  alignment:{status:'aligned',basis:'The isolated test explicitly selects this fixture direction and output purpose.'}}
}
export function designIntentPin(projectId:string,solutionId:string,solutionRevision=1,targetRevision=1,areaId:string|null=null,purpose:DesignPurpose='construction'):DesignIntentPin{
 return {version:1,project_id:projectId,area_id:areaId,target_revision:targetRevision,solution_id:solutionId,solution_revision:solutionRevision,purpose}
}
export function designManifest(projectId:string,solutionId:string,solutionRevision=1,targetRevision=1,areaId:string|null=null,purpose:DesignPurpose='construction'){
 return {bob_design_intent:designIntentPin(projectId,solutionId,solutionRevision,targetRevision,areaId,purpose),bob_design_images:[]}
}
