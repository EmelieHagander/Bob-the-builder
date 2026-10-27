import { checkConstruction, constructionBox, constructionKnowledge, CONSTRUCTION_CHECK_VERSION, CONSTRUCTION_ROLE_CHECK_VERSION, type ConstructionBox } from './construction-checks.ts'
import { constructionFormDependencies } from './construction-form.ts'
import { evaluateConcept } from './solution-concept.ts'
import { constructionInstancePolicy } from './construction-instance-policy.ts'
import { parseCadAssemblyRequest } from './cad-adapter.ts'
import { schemaIssues } from './schema-issues.ts'
import { stableJsonValue } from './bob-job-journal.ts'
import type { ConstructionObservation } from './construction-views.ts'

type Row=Record<string,any>
type ProbeBase={id:string;feature_id:string}
export type RequirementProbe=ProbeBase & ({kind:'clear_space';component_id:string}
 | {kind:'minimum_span';component_id:string;axis:'x'|'y'|'z';minimum_node:string}
 | {kind:'connected';component_ids:string[]})
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)})
const id={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,31}$'}
const base={id,feature_id:{type:'string',pattern:'^[A-Za-z0-9_-]{1,32}$'}}
export const REQUIREMENT_PROBES_SCHEMA={type:'array',maxItems:48,items:{anyOf:[
 object({...base,kind:{type:'string',enum:['clear_space']},component_id:id}),
 object({...base,kind:{type:'string',enum:['minimum_span']},component_id:id,axis:{type:'string',enum:['x','y','z']},minimum_node:id}),
 object({...base,kind:{type:'string',enum:['connected']},component_ids:{type:'array',minItems:2,maxItems:12,uniqueItems:true,items:id}}),
]}}
export const EVIDENCE_COMPONENTS_SCHEMA={type:'array',maxItems:48,uniqueItems:true,items:id}
export const CONSTRUCTION_EVIDENCE_VERSION='form-properties-v1'
const targets=(p:RequirementProbe)=>p.kind==='connected'?p.component_ids:[p.component_id]
const same=(a:unknown,b:unknown)=>JSON.stringify(stableJsonValue(a))===JSON.stringify(stableJsonValue(b))
const touches=(a:ConstructionBox,b:ConstructionBox)=>a.min.every((v,k)=>v<=b.max[k]+1e-6&&b.min[k]<=a.max[k]+1e-6)
export function constructionEvidenceContract(draft:Row,today:string){
 return {version:CONSTRUCTION_EVIDENCE_VERSION,geometry_checker:draft.instance_policy!=null?CONSTRUCTION_ROLE_CHECK_VERSION:CONSTRUCTION_CHECK_VERSION,
  knowledge:constructionKnowledge(today).map(c=>({id:c.id,version:c.version,content_sha256:c.content_sha256}))}
}
export function constructionEvidenceBinding(draft:Row){
 return {project_id:draft.projectId,artifact_id:draft.artifact_id,revision:draft.revision,target_revision:draft.target_revision,
  solution_id:draft.solution_id,solution_revision:draft.solution_revision}
}

/** Probes are an explicit interpretation to inspect, never a claim that an
 * arbitrary natural-language function has been proved by a geometry label. */
export function checkConstructionEvidence(draft:Row,catalog:Map<string,Row>,today:string,componentIds:string[],probes:RequirementProbe[]){
 if(schemaIssues(EVIDENCE_COMPONENTS_SCHEMA,componentIds).length||schemaIssues(REQUIREMENT_PROBES_SCHEMA,probes).length||new Set(probes.map(p=>p.id)).size!==probes.length)throw Error('invalid_requirement_probe')
 const whole=checkConstruction(draft,catalog,today,true) as ReturnType<typeof checkConstruction>&{joint_checks?:Row[]},intent=draft.design_intent,model=intent?.model
 const recipe=parseCadAssemblyRequest(draft.recipe)
 if(!recipe)throw Error('invalid_checkpoint')
 const components:Row[]=model?.components.filter((c:Row)=>c.active)??[],features:Row[]=intent?.features??[]
 if(componentIds.some(id=>!components.some(c=>c.id===id))||probes.some(p=>!features.some(f=>f.id===p.feature_id)))throw Error('invalid_requirement_probe')
 const concept=model?evaluateConcept(intent):null
 const policy=constructionInstancePolicy(recipe,draft.instance_policy)
 const references=new Set(policy.instances.filter(i=>i.role==='reference').map(i=>i.instance_id))
 const unknownRoles=new Set(policy.instances.filter(i=>i.role==='unknown').map(i=>i.instance_id))
 const mappings:Row[]=draft.form_refinement?.mappings??components.map(c=>({component_id:c.id,instance_ids:recipe.instances.some(i=>i.id===c.id)?[c.id]:[]}))
 const mapped=(id:string):string[]=>mappings.find(m=>m.component_id===id)?.instance_ids??[]
 const boxes=recipe.instances.map(i=>constructionBox(i,recipe.definitions.find(d=>d.id===i.definition_id)!)).filter((b):b is ConstructionBox=>b!==null)
 const physical=boxes.filter(b=>!references.has(b.id)),unsupported=recipe.instances.filter(i=>!boxes.some(b=>b.id===i.id)).map(i=>i.id)
 const seeds=componentIds.length?Array.from(new Set([...componentIds,...probes.flatMap(targets).filter(id=>components.some(c=>c.id===id))])):components.map(c=>c.id)
 const evaluatedComponents=new Set<string>(model?constructionFormDependencies(intent,seeds):[])
 const evaluatedInstances=new Set<string>(componentIds.length?[...evaluatedComponents].flatMap(mapped):recipe.instances.map(i=>i.id))
 let changed=true
 while(changed){
  const before=evaluatedComponents.size+evaluatedInstances.size
  for(const joint of draft.joints)if(evaluatedInstances.has(joint.first.instance_id)||evaluatedInstances.has(joint.second.instance_id)){
   evaluatedInstances.add(joint.first.instance_id);evaluatedInstances.add(joint.second.instance_id)
  }
  for(const box of boxes)if(boxes.some(b=>evaluatedInstances.has(b.id)&&touches(box,b)))evaluatedInstances.add(box.id)
  for(const m of mappings)if(m.instance_ids.some((id:string)=>evaluatedInstances.has(id)))evaluatedComponents.add(m.component_id)
  if(model)for(const id of constructionFormDependencies(intent,[...evaluatedComponents]))evaluatedComponents.add(id)
  for(const id of [...evaluatedComponents].flatMap(mapped))evaluatedInstances.add(id)
  changed=before!==evaluatedComponents.size+evaluatedInstances.size
 }
 const missingComponents=[...evaluatedComponents].filter(id=>components.some(c=>c.id===id&&c.kind==='solid')&&!mapped(id).length)
 const localInstances=recipe.instances.filter(i=>evaluatedInstances.has(i.id)),localDefinitions=new Set(localInstances.map(i=>i.definition_id))
 const local=checkConstruction({...draft,design_intent:null,form_refinement:null,
  recipe:{...recipe,definitions:recipe.definitions.filter(d=>localDefinitions.has(d.id)),instances:localInstances},
  materials:draft.materials.filter((m:Row)=>localDefinitions.has(m.definition_id)),
  joints:draft.joints.filter((j:Row)=>evaluatedInstances.has(j.first.instance_id)||evaluatedInstances.has(j.second.instance_id)),
  instance_policy:draft.instance_policy==null?null:{...draft.instance_policy,instances:policy.instances.filter(i=>evaluatedInstances.has(i.instance_id))},
 },catalog,today,true) as ReturnType<typeof checkConstruction>&{joint_checks?:Row[]}
 // An unsupported external shape may touch this scope. Do not certify that
 // omitted interface using an approximate bounding box.
 const unlocated=unsupported.filter(id=>!evaluatedInstances.has(id))
 if(unlocated.length){local.issues.push({code:'unsupported_neighbor_geometry',ids:unlocated,message:'Neighbor coverage cannot be established for unsupported geometry outside the requested scope.'});local.issue_count++}
 const propertyChecks=probes.map(probe=>{
  const ids=targets(probe),parts=ids.flatMap(mapped),linked=ids.map(id=>components.find(c=>c.id===id))
  const answer=(status:'passed'|'failed'|'unknown'|'unsupported',code:string,facts:Row={})=>({...probe,status,code,basis:'model_geometry',instance_ids:parts,...facts})
  if(linked.some(c=>!c||!c.features.includes(probe.feature_id)))return answer('unknown','requirement_target_missing')
  if(probe.kind==='clear_space'){
   const region=concept?.boxes.find(b=>b.id===probe.component_id)
   if(linked[0]!.kind==='solid')return answer('unsupported','space_component_required')
   if(!region)return answer('unknown','space_dimensions_unknown')
   if(unknownRoles.size)return answer('unknown','space_roles_unknown',{unknown_instance_ids:[...unknownRoles]})
   if(unsupported.length)return answer('unsupported','space_geometry_unsupported',{unsupported_instance_ids:unsupported})
   const collisions=physical.filter(b=>b.min.every((v,k)=>Math.min(b.max[k],region.min[k]+region.size_mm[k])-Math.max(v,region.min[k])>1e-6)).map(b=>b.id)
   return answer(collisions.length?'failed':'passed',collisions.length?'space_obstructed':'space_clear',{region:{min:region.min,size_mm:region.size_mm},obstructing_instance_ids:collisions})
  }
  if(ids.some(id=>!mapped(id).length))return answer('unknown','component_not_refined')
  if(parts.some(id=>references.has(id)))return answer('unsupported','physical_components_required')
  if(parts.some(id=>unknownRoles.has(id)))return answer('unknown','physical_roles_unknown')
  if(parts.some(id=>!physical.some(b=>b.id===id)))return answer('unsupported','property_geometry_unsupported')
  if(probe.kind==='minimum_span'){
   const minimum=concept?.values.get(probe.minimum_node),axis=['x','y','z'].indexOf(probe.axis)
   if(!minimum||minimum.unit!=='mm'||minimum.value<=0)return answer('unknown','positive_canonical_dimension_required')
   const selected=physical.filter(b=>parts.includes(b.id)),actual=Math.max(...selected.map(b=>b.max[axis]))-Math.min(...selected.map(b=>b.min[axis]))
   return answer(actual+1e-6>=minimum.value?'passed':'failed',actual+1e-6>=minimum.value?'span_sufficient':'span_too_small',{actual_mm:actual,minimum_mm:minimum.value})
  }
  const graph=new Map(physical.map(b=>[b.id,new Set<string>()]))
  for(const joint of draft.joints){
   if(!whole.joint_checks?.some((j:Row)=>j.id===joint.id&&j.fit)||whole.issues.some(i=>i.ids.includes(joint.id)))continue
   graph.get(joint.first.instance_id)?.add(joint.second.instance_id);graph.get(joint.second.instance_id)?.add(joint.first.instance_id)
  }
  const reached=new Set<string>(),pending=[parts[0]]
  while(pending.length){const id=pending.pop()!;if(reached.has(id))continue;reached.add(id);pending.push(...(graph.get(id)??[]))}
  const absent=parts.filter(id=>!reached.has(id))
  const unsupportedJoints=whole.issues.filter(i=>['unsupported_joint_method','joint_knowledge_unavailable','joint_material_not_supported'].includes(i.code)&&i.ids.some(id=>parts.includes(id)))
  return answer(unsupportedJoints.length?'unsupported':absent.length?'failed':'passed',unsupportedJoints.length?'connection_evidence_unsupported':absent.length?'connection_path_missing':'connected_by_declared_joints',{unconnected_instance_ids:absent})
 })
 const requirements=features.map(f=>{
  const checks=propertyChecks.filter(c=>c.feature_id===f.id)
  return {feature_id:f.id,requirement:f.description,property_check_ids:checks.map(c=>c.id),
   status:checks.some(c=>c.status==='failed')?'failed':checks.some(c=>c.status==='unsupported')?'unsupported':!checks.length?'not_checked':checks.some(c=>c.status==='unknown')?'unknown':'properties_passed',
   functional_fidelity:'unverified'}
 })
 const gaps=[{code:'requirement_interpretation_unverified',ids:features.map(f=>f.id),message:'These probes check selected geometric properties. Functional meaning and original requirement coverage remain unverified; a feature label is not proof.'}]
 return {...whole,concept_ready:false,issues:[...whole.issues,...gaps],issue_count:whole.issue_count+gaps.length,
  form_evidence:{version:1,purpose:'construction_development',contract:constructionEvidenceContract(draft,today),source_binding:constructionEvidenceBinding(draft),
   scope:{requested_component_ids:componentIds,evaluated_component_ids:[...evaluatedComponents],evaluated_instance_ids:[...evaluatedInstances],pending_component_ids:components.filter(c=>!mapped(c.id).length).map(c=>c.id)},
   local_geometry:{status:missingComponents.length||!localInstances.length?'unknown':local.issues.some(i=>i.code.startsWith('unsupported'))?'unsupported':local.issue_count?'failed':'passed',
    missing_component_ids:missingComponents,issues:local.issues,issue_count:local.issue_count,joint_checks:local.joint_checks??[],fabrication_gaps:local.fabrication_gaps},
   whole_geometry:{concept_ready:whole.concept_ready,issue_count:whole.issue_count},property_checks:propertyChecks,requirements,
   whole_delivery_ready:false,fabrication_ready:false}}
}

/** Every use is a fresh authority/source check by the reader. This describes
 * reuse for analysis only; exporters keep their independent live gates. */
export function constructionEvidenceReuse(observation:ConstructionObservation,draft:Row,today:string){
 const evidence=observation.output.form_evidence
 if(!evidence||evidence.version!==1||evidence.purpose!=='construction_development')return 'historical_only'
 if(draft.archived||draft.revision!==draft.current_revision||draft.source_state!=='current')return 'source_changed'
 if(!same(evidence.source_binding,constructionEvidenceBinding(draft)))return 'source_changed'
 if(!same(evidence.contract,constructionEvidenceContract(draft,today)))return 'checker_changed'
 return 'current_for_analysis'
}
