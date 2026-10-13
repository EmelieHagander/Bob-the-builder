import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseDesignIntent,parseDesignReadiness,designIntentHandoff,type DesignIntent,type DesignReadiness} from '../supabase/functions/_shared/project-design-intent.ts'
import { shapeId,handoff} from './support/cad-review-fixture.ts'

const image='11111111-1111-4111-8111-111111111111',solution='22222222-2222-4222-8222-222222222222'
function intent():DesignIntent{return {
 version:1,purpose:'construction',summary:'The chosen modular cabinet, with support and access considered.',
 references:[{image_id:image,role:'appearance',note:'Preserve the front-facing storage; this is not measured site evidence.'}],
 features:[{id:'display',description:'Integrated front-facing display remains part of the cabinet.',basis:'user_request',source_ref:'Selected reference'}],
 choices:[{id:'support',question:'How will the shelf support work?',alternatives:['Fixed cleats','Adjustable brackets'],
  recommendation:'Fixed cleats',basis:'The recorded use calls for a fixed-height shelf.',
  consequences:'The selected support determines shelf height and access.',
  geometry_dependency:true,status:'resolved',selected_direction:'Fixed cleats',decision_authority:'bob',
  decision_basis:'Ordinary technical details delegated in the saved project brief.',deferral:null}],
 alignment:{status:'aligned',basis:'Prior owner use and appearance choices are preserved.'},
}}
function packet():DesignReadiness{
 const pin={version:1 as const,project_id:'p_advice',area_id:null,target_revision:4,solution_id:solution,solution_revision:2,purpose:'construction' as const}
 return {status:'ready',project_id:pin.project_id,area_id:null,target_revision:4,solution_id:solution,solution_revision:2,purpose:'construction',design_intent:intent(),issues:[],deferred_choice_ids:[],pin}
}
test('advisory drafts retain open questions while a complete canonical choice can become ready',()=>{
 const draft=intent();draft.alignment={status:'draft',basis:''}
 Object.assign(draft.choices[0],{status:'open',selected_direction:null,decision_basis:'',recommendation:'',basis:'',consequences:'',alternatives:[]})
 assert(parseDesignIntent(draft))
 assert(parseDesignReadiness(packet()))
 const wronglyReady=packet();wronglyReady.design_intent=draft
 assert.equal(parseDesignReadiness(wronglyReady),null)
})
test('delegation alone cannot replace an actual selected direction or supported recommendation',()=>{
 for(const field of ['selected_direction','recommendation','basis','consequences','decision_basis'] as const){
  const value=intent();(value.choices[0] as any)[field]=field==='selected_direction'?null:''
  assert.equal(parseDesignIntent(value),null,field)
 }
 const unselected=intent();Object.assign(unselected.choices[0],{status:'open',selected_direction:null})
 assert(parseDesignIntent(unselected),'an honestly open delegated choice can be saved')
 const ready=packet();ready.design_intent=unselected
 assert.equal(parseDesignReadiness(ready),null)
})
test('bounded exploratory deferrals do not become construction or a settled direction',()=>{
 const p=packet();p.purpose='illustration';p.pin!.purpose='illustration';p.design_intent!.purpose='illustration'
 Object.assign(p.design_intent!.choices[0],{status:'deferred',selected_direction:null,deferral:{scope:'illustration',reason:'This view explores appearance; support is a later design decision.'}})
 p.deferred_choice_ids=['support'];assert(parseDesignReadiness(p))
 p.deferred_choice_ids=['support','support'];assert.equal(parseDesignReadiness(p),null)
 p.deferred_choice_ids=['support']
 p.purpose='construction';p.pin!.purpose='construction';p.design_intent!.purpose='construction'
 assert.equal(parseDesignReadiness(p),null)
 const value=intent();Object.assign(value.choices[0],{status:'deferred',selected_direction:'Fixed cleats',deferral:{scope:'concept',reason:'Later'}})
 assert.equal(parseDesignIntent(value),null)
})
test('exact immutable revision and effective Area inheritance remain distinct',()=>{
 const inherited=packet();inherited.area_id='a_work'
 assert(parseDesignReadiness(inherited),'Project target can be inherited by the requested Area')
 inherited.pin!.area_id='a_other';assert.equal(parseDesignReadiness(inherited),null)
 for(const field of ['project_id','target_revision','solution_id','solution_revision'] as const){
  const p=packet();(p.pin as any)[field]=typeof p.pin![field]==='number'?99:'33333333-3333-4333-8333-333333333333'
  assert.equal(parseDesignReadiness(p),null,field)
 }
})
test('visual design references require explicit features and truthful schema fields',()=>{
 const p=packet();p.design_intent!.features=[];assert.equal(parseDesignReadiness(p),null)
 p.design_intent!.references[0].role='context';assert(parseDesignReadiness(p),'site context alone need not invent visual features')
 assert.equal(parseDesignIntent({...intent(),owner_approved:true}),null)
 const duplicate=intent();duplicate.references.push({...duplicate.references[0]});assert.equal(parseDesignIntent(duplicate),null)
 const choice=intent();choice.choices.push({...choice.choices[0]});assert.equal(parseDesignIntent(choice),null)
})
test('text bounds count Unicode characters and include leading whitespace',()=>{
 const value=intent();value.summary='🌲'.repeat(2000);assert(parseDesignIntent(value))
 value.summary=' '+value.summary;assert.equal(parseDesignIntent(value),null)
 value.summary='A compact supported direction';value.features[0].description=' '+ 'x'.repeat(1000)
 assert.equal(parseDesignIntent(value),null)
})
test('handoff obtains canonical required features and bounded deferrals from the chosen Solution',()=>{
 const p=packet(),i=p.design_intent!
 const result=designIntentHandoff(handoff,i,p.pin!)
 assert.deepEqual(result.requirements.find(r=>r.id==='intent_display'),{id:'intent_display',requirement:i.features[0].description,basis:'project_record',source_ref:solution})
 assert.deepEqual(handoff.requirements.map(r=>r.id),[shapeId],'caller handoff is not mutated')
 const full={...handoff,requirements:Array.from({length:24},(_,n)=>({...handoff.requirements[0],id:'r'+n}))}
 assert.throws(()=>designIntentHandoff(full,i,p.pin!),/design_intent_requirement_limit/)
})
