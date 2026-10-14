import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseDesignHandoff,parseCadReview,cadReviewSchema} from '../supabase/functions/_shared/cad-review.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {shapeId,handoff} from './support/cad-review-fixture.ts'
import {collectDrawingReviewEvidence} from './support/colleague-catalog-fixture.ts'
import {requirementId} from '../supabase/functions/_shared/cad-handoff.ts'
const saveLinkId=await requirementId({requirement:'Save and link the drawing to the work Step',basis:'user_request',source_ref:null})
test('handoff rejects unknown shape, duplicate requirement identities and fabricated coordinate types',()=>{
 assert(parseDesignHandoff(handoff));assert.equal(parseDesignHandoff({...handoff,requirements:[handoff.requirements[0],handoff.requirements[0]]}),null)
 assert.equal(parseDesignHandoff({...handoff,coordinates:{...handoff.coordinates,positive_x:42}}),null)
 assert.equal(parseCadReview({verdict:'pass',summary:'fine',requirements:[],issues:[]},handoff),null)
})
test('strict review keys cover the whole handoff; a plan-only pass cannot replace it',()=>{
 const full={...handoff,requirements:[...handoff.requirements,{id:'width',requirement:'Bind exact width',basis:'project_record' as const,source_ref:'measurement-id'}]}
 const schema=cadReviewSchema(full)
 const map=schema.properties.requirements as any
 assert.deepEqual(map.required,[shapeId,'width']);assert.equal(map.additionalProperties,false)
 const value={verdict:'pass',summary:'Reviewed exact candidate',requirements:{[shapeId]:{status:'met',evidence:'One panel'},width:{status:'met',evidence:'Measurement revision 2'}},issues:[]}
 assert.deepEqual(parseCadReview(value,full)?.requirements.map(r=>r.id),[shapeId,'width'])
 assert.equal(parseCadReview({...value,requirements:{'plan-uuid':value.requirements.shape}},full),null)
 assert.equal(parseCadReview({...value,requirements:{shape:value.requirements.shape}},full),null)
 assert.equal(parseCadReview({...value,requirements:{...value.requirements,width:{...value.requirements.width,id:'invented'}}},full),null)
 assert.equal(parseCadReview({...value,requirements:{...value.requirements,width:{status:'failed',evidence:'Wrong binding'}}},full)?.verdict,'revise')
})
test('required solution features cannot pass as unresolved while future delivery receipts may remain pending',()=>{
 const full={...handoff,requirements:[...handoff.requirements,{id:'intent_storage',requirement:'Include the selected integrated storage',basis:'project_record' as const,source_ref:'solution:fixture@2'},{id:saveLinkId,requirement:'Save and link the reviewed drawing',basis:'user_request' as const,source_ref:null}]}
 const value={verdict:'pass',summary:'Reviewed the concept',requirements:{[shapeId]:{status:'met',evidence:'Concept geometry'},intent_storage:{status:'unresolved',evidence:'The simplified geometry omits storage'},[saveLinkId]:{status:'unresolved',evidence:'pending_delivery: save after candidate review'}},issues:[]}
 assert.equal(parseCadReview(value,full,new Set(['intent_storage']))?.verdict,'revise')
 value.requirements.intent_storage={status:'met',evidence:'Storage modules are present in recipe and preview'}
 assert.equal(parseCadReview(value,full,new Set(['intent_storage']))?.verdict,'pass')
})

test('independent evidence flags truncated or failed reads and stops on denied access',async()=>{
 const lookup=(code:string|null)=>createProjectLookup('A',async(_p,q)=>({
  data:{records:[],related:[],truncated:q.dataset==='physical_spaces',next_cursor:null},
  error:q.dataset==='physical_elements'?{code:code!}:null,
 }),1000,40)
 const evidence=await collectDrawingReviewEvidence(lookup('backend_error'),false)
 assert(evidence.incomplete_datasets.includes('physical_spaces'))
 assert(evidence.incomplete_datasets.includes('physical_elements'))
 await assert.rejects(collectDrawingReviewEvidence(lookup('42501'),false),/project_denied/)
})
