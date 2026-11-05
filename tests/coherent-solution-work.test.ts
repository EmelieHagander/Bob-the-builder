import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createProjectEdits,applyProjectDelta,componentRef,measurementRef,type EditSnapshot} from '../supabase/functions/_shared/project-edits.ts'
import {conceptFixture} from './support/solution-concept-fixtures.ts'
import {evaluateConcept,parseConceptModel} from '../supabase/functions/_shared/solution-concept.ts'
import {countSerializedTokens} from '../supabase/functions/_shared/bob-token-budget.ts'
const id='10000000-0000-4000-8000-000000000001'
function snapshot():EditSnapshot{return{project_id:'p',key:'solution',resource:'solutions',scope_label:'Project',measurements:[{id,revision:1}],measurement_evidence:[{id,revision:1,value:209,unit:'cm',truth:'measured',subject:'Door height',source:'Threshold underside to trim top',notes:'',property:null,side:null,reference:null}],target:null,record:{id:'10000000-0000-4000-8000-000000000002',revision:1,title:'Entry',description:'Synthetic concept',assumptions:'Unverified endpoints',tradeoffs:'',design_intent:conceptFixture('barn')}}}
const read={resource:'solutions',query:null,next_ref:null}
test('compact read and semantic pages stay small, exact and restorable without another DB read',async()=>{
 const s=snapshot();s.record.description='r'.repeat(5000);let reads=0
 const make=()=>createProjectEdits({projectId:'p',coherent:true,read:async()=>{reads++;return{data:[s],error:null}},hasAccess:async()=>true})
 const e=make(),result=await e.execute('read_project_edit_context',read),ref=result.entries[0].edit_ref
 assert(countSerializedTokens(result)<700);assert(!JSON.stringify(result).includes('Threshold underside'))
 const restored=make();restored.restoreState(JSON.parse(JSON.stringify(e.exportState())))
 let next=ref,all:any[]=[]
 do{const page=await restored.execute('read_project_edit_context',{resource:'section',query:'model.components',next_ref:next});assert.equal(page.edit_ref,ref);assert(countSerializedTokens(page)<3000);all.push(...page.items);next=page.next_ref}while(next)
 assert.deepEqual(all.map(i=>i.content),s.record.design_intent.model.components);assert(all.every(i=>i.component_ref.startsWith('component_')));assert.equal(reads,1)
 const complete=await restored.execute('read_project_edit_context',{resource:'section',query:'complete',next_ref:ref});assert.equal(complete.content.description,s.record.description)
 assert.equal((await restored.execute('read_project_edit_context',{resource:'section',query:'choices',next_ref:'forged'})).status,'invalid')
})
test('one atomic choice save links server identity; retains alignment basis and rejects stale or foreign component refs',async()=>{
 const s=snapshot(),before=s.record.design_intent.alignment.basis
 const choice={...s.record.design_intent.choices[0]};delete choice.id
 // fixture may have no choices; use a complete synthetic open choice
 const c={question:'Wall placement',alternatives:['inside','outside'],recommendation:'',basis:'',consequences:'',geometry_dependency:true,status:'open',selected_direction:null,decision_authority:'bob',decision_basis:'',deferral:null}
 const component=s.record.design_intent.model.components.find((c:any)=>c.active)
 const change={op:'add_choice_for_components',choice:c,components:[await componentRef(s,component.id)]}
 const saved=await applyProjectDelta(s,[change],'Add placement choice',{coherent:true}),assigned=saved.design_intent.choices.at(-1).id
 assert(saved.design_intent.model.components.find((c:any)=>c.id===component.id).choices.includes(assigned));assert.equal(saved.design_intent.alignment.basis,before);assert.equal(saved.design_intent.alignment.status,'draft')
 assert.deepEqual(saved,await applyProjectDelta(s,[change],'Add placement choice',{coherent:true}))
 await assert.rejects(applyProjectDelta({...s,record:{...s.record,revision:2}},[change],'Stale',{coherent:true}),/component_ref/)
 await assert.rejects(applyProjectDelta({...s,project_id:'foreign'},[change],'Foreign',{coherent:true}),/component_ref/)
 assert(!s.record.design_intent.choices.some((c:any)=>c.id===assigned))
})
test('measurement binding keeps 209 cm and exact source revision, unresolved endpoints stay visible and block construction',async()=>{
 const s=snapshot(),model=s.record.design_intent.model,index=model.nodes.findIndex((n:any)=>n.role==='decision'||n.role==='estimate')
 const ref=await measurementRef(s,0),change={op:'bind_concept_measurement',index,measurement_ref:ref,required_reference:'frame outer height'}
 const saved=await applyProjectDelta(s,[change],'Use the linked measurement',{coherent:true}),m=saved.design_intent.model
 assert.equal(m.version,2);assert.equal(m.nodes[index].value,2090);assert.equal(m.source_bindings[0].value,209);assert.equal(m.source_bindings[0].measurement_revision,1);assert.equal(m.source_bindings[0].reference_status,'unresolved');assert(parseConceptModel(m));assert(evaluateConcept(saved.design_intent).issues.some(i=>i.code==='measurement_reference_unresolved'))
 const tampered=structuredClone(m);tampered.source_bindings[0].reference_status='confirmed';assert.equal(parseConceptModel(tampered),null)
 const mismatched=structuredClone(m);mismatched.nodes[index].value=2050;assert.equal(parseConceptModel(mismatched),null)
 await assert.rejects(applyProjectDelta({...s,record:{...s.record,revision:2}},[change],'Stale',{coherent:true}),/measurement_ref/)
 assert.equal(s.measurement_evidence![0].value,209)
})
