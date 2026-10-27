import {test} from 'node:test'
import assert from 'node:assert/strict'
import {constructionFormFixture} from './support/construction-form-fixture.ts'
import {manufacturePolicy} from './support/construction-instance-policy-fixture.ts'
import {checkConstructionEvidence,constructionEvidenceReuse,type RequirementProbe} from '../supabase/functions/_shared/construction-evidence.ts'
import {createConstructionTools,checkedConstructionForDrawing} from '../supabase/functions/_shared/construction-draft.ts'
import {createConstructionViews} from '../supabase/functions/_shared/construction-views.ts'
import {countSerializedTokens} from '../supabase/functions/_shared/bob-token-budget.ts'

const artifact='11111111-1111-4111-8111-111111111111',material='22222222-2222-4222-8222-222222222222',today='2026-10-27'
function fixture(){
 const {intent,recipe,refinement}=constructionFormFixture()
 const draft:any={projectId:'p_fixture',status:'ok',artifact_id:artifact,revision:1,current_revision:1,target_revision:1,
  solution_id:'33333333-3333-4333-8333-333333333333',solution_revision:1,archived:false,source_state:'current',
  design_intent:intent,recipe,form_refinement:refinement,instance_policy:manufacturePolicy(recipe),joints:[],open_questions:[],
  materials:[{definition_id:'rail',material_id:material,material_revision:1,part_id:null,part_revision:null}]}
 const record={id:material,revision:1,current_revision:1,kind:'material',source_kind:'design_choice',profile_code:'sheet_stock',categories:['wood.plywood','sheet'],properties:{thickness:{value:'18',unit:'mm',truth:'provided_spec',parameter:null}}}
 return {draft,record,catalog:new Map([[material+'@1',record]])}
}
const span:RequirementProbe={id:'span',feature_id:'frame',kind:'minimum_span',component_id:'frame',axis:'x',minimum_node:'frame_s0'}
test('feature labels and selected property passes never prove functional fidelity or whole delivery',()=>{
 const {draft,catalog}=fixture()
 draft.design_intent.features[0].description='A working drawer under the bed'
 const unchecked=checkConstructionEvidence(draft,catalog,today,['frame'],[])
 assert.equal(unchecked.form_evidence.requirements[0].status,'not_checked')
 const checked=checkConstructionEvidence(draft,catalog,today,['frame'],[span])
 assert.equal(checked.form_evidence.property_checks[0].status,'passed')
 assert.equal(checked.form_evidence.requirements[0].status,'properties_passed')
 assert.equal(checked.form_evidence.requirements[0].functional_fidelity,'unverified')
 assert.equal(checked.form_evidence.requirements[1].status,'not_checked')
 assert.deepEqual(checked.form_evidence.scope.pending_component_ids,['drawer'])
 assert.equal(checked.concept_ready,false);assert.equal(checked.fabrication_ready,false);assert.equal(checked.form_evidence.whole_delivery_ready,false)
 assert(checked.issues.some(i=>i.code==='requirement_interpretation_unverified'))
 assert.throws(()=>checkConstructionEvidence(draft,catalog,today,[],[{...span,feature_id:'absent'}]),/invalid_requirement_probe/)
 assert.throws(()=>checkConstructionEvidence(draft,catalog,today,['absent'],[]),/invalid_requirement_probe/)
 assert.throws(()=>checkConstructionEvidence(draft,catalog,today,[],[span,span]),/invalid_requirement_probe/)
 const unknown=checkConstructionEvidence(draft,catalog,today,[],[{...span,minimum_node:'missing'}])
 assert.equal(unknown.form_evidence.property_checks[0].status,'unknown')
 const priorPolicy=draft.instance_policy;draft.instance_policy=null
 assert.equal(checkConstructionEvidence(draft,catalog,today,[],[span]).form_evidence.property_checks[0].status,'unknown')
 draft.instance_policy=priorPolicy
 draft.recipe.instances[1].placement.x=500
 assert.equal(checkConstructionEvidence(draft,catalog,today,[],[span]).form_evidence.property_checks[0].status,'failed')
})
test('clear space checks actual occupancy, preserves reference geometry and rejects unsupported approximation',()=>{
 const {draft,catalog}=fixture(),model=draft.design_intent.model
 const space=structuredClone(model.components[0]);space.id='clear';space.kind='space';space.size=['clear_w','frame_s1','frame_s2'];space.position=['clear_x','frame_p1','frame_p2']
 model.components.push(space);model.nodes.push({id:'clear_w',role:'decision',value:564,unit:'mm',reason:'Design space'},{id:'clear_x',role:'decision',value:18,unit:'mm',reason:'Design offset'})
 const probe:RequirementProbe={id:'free',feature_id:'frame',kind:'clear_space',component_id:'clear'}
 const check=()=>checkConstructionEvidence(draft,catalog,today,['frame'],[probe]).form_evidence.property_checks[0]
 assert.equal(check().status,'passed','touching boundaries do not occupy the interior')
 draft.recipe.instances[1].placement.x=500
 assert.equal(check().status,'failed');assert.deepEqual((check() as any).obstructing_instance_ids,['right'])
 draft.instance_policy.instances[1].role='reference'
 draft.instance_policy.instances[1].quantity_policy='exclude'
 assert.equal(check().status,'passed')
 draft.recipe.instances[1].placement.rx=17
 assert.equal(check().status,'unsupported','nonorthogonal shapes cannot pass by bounding-box approximation')
 assert.equal(checkConstructionEvidence(draft,catalog,today,[],[{...probe,component_id:'frame'}]).form_evidence.property_checks[0].code,'space_component_required')
})
test('local checks include neighboring interfaces and require valid declared connection paths',()=>{
 const {draft,catalog}=fixture(),model=draft.design_intent.model
 draft.recipe.definitions=[{id:'rail',primitive:'box',material_ref:null,x_mm:600,y_mm:400,z_mm:18},{id:'small',primitive:'box',material_ref:null,x_mm:100,y_mm:100,z_mm:18}]
 draft.recipe.instances=[{id:'left',definition_id:'rail',placement:{x:0,y:0,z:0,rx:0,ry:0,rz:0}},{id:'right',definition_id:'small',placement:{x:600,y:0,z:0,rx:0,ry:0,rz:0}}]
 draft.materials.push({...draft.materials[0],definition_id:'small'})
 draft.form_refinement.mappings=[{component_id:'frame',instance_ids:['left']},{component_id:'drawer',instance_ids:['right']}]
 model.nodes.find((n:any)=>n.id==='drawer_p0').value=600
 model.components[1].features.push('frame')
 draft.joints=[{id:'interface',method:'screwed_butt',first:{instance_id:'left',face:'x_min'},second:{instance_id:'right',face:'x_min'},reason:'Proposed joint'}]
 const probe:RequirementProbe={id:'connected',kind:'connected',feature_id:'frame',component_ids:['frame','drawer']}
 const check=()=>checkConstructionEvidence(draft,catalog,today,['frame'],[probe])
 const wrong=check()
 assert.deepEqual(wrong.form_evidence.scope.evaluated_instance_ids,['left','right'])
 assert.equal(wrong.form_evidence.local_geometry.status,'failed');assert(wrong.form_evidence.local_geometry.issues.some(i=>i.code==='joint_faces_do_not_meet'))
 assert.equal(wrong.form_evidence.property_checks[0].status,'failed')
 draft.joints[0].first.face='x_max'
 assert.equal(check().form_evidence.property_checks[0].status,'passed')
 assert.equal(check().form_evidence.local_geometry.status,'passed')
 draft.joints[0].method='unresolved'
 assert.equal(check().form_evidence.property_checks[0].status,'unsupported')
})
test('unsupported out-of-scope shapes cannot silently disappear from neighbor coverage',()=>{
 const {draft,catalog}=fixture()
 draft.recipe.definitions.push({id:'odd',primitive:'box',material_ref:null,x_mm:100,y_mm:100,z_mm:18})
 draft.recipe.instances.push({id:'other',definition_id:'odd',placement:{x:800,y:0,z:0,rx:17,ry:0,rz:0}})
 draft.materials.push({...draft.materials[0],definition_id:'odd'});draft.instance_policy=manufacturePolicy(draft.recipe)
 draft.form_refinement.mappings.push({component_id:'drawer',instance_ids:['other']})
 const result=checkConstructionEvidence(draft,catalog,today,['frame'],[])
 assert.equal(result.form_evidence.local_geometry.status,'unsupported')
 assert(result.form_evidence.local_geometry.issues.some(i=>i.code==='unsupported_neighbor_geometry'))
})
test('saved result reads cross new tool sessions, retain exact sections and never recompute or silently renew evidence',async()=>{
 const {draft,record}=fixture(),stored=new Map<string,any>();let source='current',catalogReads=0,allowed=true
 const opts={projectId:draft.projectId,message:'Continue',constructionViews:true,formEvidence:true,unlimitedWork:true,now:()=>new Date(today),
  hasAccess:async()=>allowed,read:async()=>structuredClone(draft),readCurrent:async()=>draft,readSources:async()=>({project:new Map(),physical:new Map()}),
  readCatalog:async()=>{catalogReads++;return {projectId:draft.projectId,status:'ok',record}},
  saveObservation:async(o:any)=>{stored.set(o.id,structuredClone(o));return o},
  readObservations:async(_id:string,_rev:number,result:string|null)=>({status:'ok',projectId:draft.projectId,artifact_id:artifact,revision:1,current_revision:1,source_state:source,archived:false,
   observation:result?stored.get(result):null,results:[...stored.values()].map(o=>({result_id:o.id,kind:o.kind,observed_at:o.observed_at})),next_after:null})}
 const checked=await createConstructionTools(opts).execute('check_construction_draft',{artifact_id:artifact,revision:1,component_ids:['frame'],requirement_checks:[span]})
 assert.equal(checked.status,'checked');assert.equal(checked.persistence,'saved');assert(countSerializedTokens(checked)<2000)
 const reads=catalogReads,newTurn=createConstructionTools(opts)
 const query={artifact_id:artifact,revision:1,view:'results',ids:[],result_id:null,section:null,after:null}
 const history=await newTurn.execute('read_construction_draft',query)
 assert.equal(history.items[0].value.result_id,checked.result.result_id)
 const detail=await newTurn.execute('read_construction_draft',{...history.items[0].value.read,section:'form_evidence.property_checks'})
 assert.equal(detail.reuse_status,'current_for_analysis');assert.equal(detail.items[0].value.status,'passed')
 assert.equal(catalogReads,reads)
 const many=await createConstructionTools(opts).execute('check_construction_draft',{artifact_id:artifact,revision:1,component_ids:['frame'],requirement_checks:Array.from({length:48},(_,n)=>({...span,id:'probe'+n}))})
 let pageQuery={...many.result.read,section:'form_evidence.property_checks'},rows:any[]=[]
 while(pageQuery){
  const page=await createConstructionTools(opts).execute('read_construction_draft',pageQuery)
  assert.equal(page.status,'ok');assert(countSerializedTokens(page)<=2000,'reuse metadata is included in the page budget')
  rows.push(...page.items);pageQuery=page.next_read
 }
 assert.equal(rows.length,48);assert.equal(rows.at(-1).value.id,'probe47')
 source='changed'
 assert.equal((await createConstructionTools(opts).execute('read_construction_draft',checked.result.read)).reuse_status,'source_changed')
 const observation=stored.get(checked.result.result_id)
 assert.equal(constructionEvidenceReuse(observation,draft,'2099-01-01'),'checker_changed')
 const tampered=structuredClone(observation);tampered.output.concept_ready=true
 await assert.rejects(createConstructionViews(draft.projectId).importObservation(tampered),/observation_mismatch/)
 allowed=false
 assert.equal((await newTurn.execute('read_construction_draft',checked.result.read)).status,'denied');allowed=true
 assert.equal((await createConstructionTools({...opts,readObservations:async()=>{throw Error('cache read down')}}).execute('read_construction_draft',checked.result.read)).status,'unavailable')
 assert.equal((await createConstructionTools({...opts,saveObservation:async()=>{throw Error('storage down')}}).execute('check_construction_draft',{artifact_id:artifact,revision:1,component_ids:[],requirement_checks:[]})).status,'unavailable')
 const gated=await checkedConstructionForDrawing(opts,artifact,1)
 assert.equal(gated.status,'needs_data');assert(gated.checked.issues.some((i:any)=>i.code==='form_refinement_unverified'))
})
