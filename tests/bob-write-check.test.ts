import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createProjectWriter,type WritePayload} from '../supabase/functions/_shared/project-write.ts'
import {createProjectEdits,withWriteCheck,COHERENT_EDIT_TOOLS,type EditSnapshot} from '../supabase/functions/_shared/project-edits.ts'
import {conceptFixture} from './support/solution-concept-fixtures.ts'
import {catalogFixture} from './support/ai-catalog-fixture.ts'

// Owner decision 2026-11-07 (sketchbook, design A): a write is checked by the
// database first and nothing is saved. Entry turn the same morning: five
// compact_design_intent_required refusals in a row, each a failed live save.
const message='Lägg in mina beslut om verandan.'
const writerWith=(check:(p:WritePayload)=>Promise<{data:unknown;error:{code?:string;message?:string}|null}>)=>{
 const committed:WritePayload[]=[],checked:WritePayload[]=[]
 const writer=createProjectWriter('p',message,async p=>{committed.push(p);return {data:null,error:{code:'22023',message:'unexpected_commit'}}},
  async()=>({data:[],error:null}),async()=>({data:{generation:1,receipts:[]},error:null}),{checkTransport:async p=>{checked.push(p);return check(p)}})
 return {writer,committed,checked}
}
const payload=(kind='bound_solution'):WritePayload=>({kind,record_id:'s1',expected_revision:1,expected_updated_at:null,request_quote:message,data:{}})

test('a check answers checked without a receipt, a write budget or uncertainty; a refusal is told like a refused save, with the 30 kB limit',async()=>{
 const ok=writerWith(async()=>({data:{status:'checked'},error:null}))
 assert.equal((await ok.writer.check(payload())).status,'checked')
 assert.equal(ok.writer.receipts.length,0); assert.equal(ok.writer.uncertain,false); assert.equal(ok.committed.length,0)
 const compact=writerWith(async()=>({data:{status:'refused',code:'22023',message:'compact_design_intent_required: private detail'},error:null}))
 for(const kind of ['bound_solution','bound_solution_create','bound_solution_target','solution']){
  const r=await compact.writer.check(payload(kind))
  assert.equal(r.status,'invalid'); assert.equal(r.reason,'compact_design_intent_required')
  assert.match(r.message??'',/30,000 bytes/); assert.doesNotMatch(JSON.stringify(r),/private detail/)
 }
 const unknownCode=writerWith(async()=>({data:{status:'refused',code:'P0001',message:'some_new_rule'},error:null}))
 assert.equal((await unknownCode.writer.check(payload('construction'))).status,'invalid')
 const broken=writerWith(async()=>{throw new Error('network')})
 assert.equal((await broken.writer.check(payload())).status,'unavailable'); assert.equal(broken.writer.uncertain,false,'a failed check never makes a write uncertain')
 const none=createProjectWriter('p',message,async()=>({data:null,error:null}),async()=>({data:[],error:null}),async()=>({data:{generation:1,receipts:[]},error:null}))
 assert.equal((await none.check(payload())).status,'unavailable')
 assert.equal((await ok.writer.check({...payload(),request_quote:'not in the message'})).status,'invalid')
})

const snapshot=():EditSnapshot=>({project_id:'p',key:'solution',resource:'solutions',scope_label:'Project',measurements:[],measurement_evidence:[],target:null,
 record:{id:'10000000-0000-4000-8000-000000000002',revision:1,title:'Entry',description:'Synthetic concept',assumptions:'Unverified endpoints',tradeoffs:'',design_intent:conceptFixture('barn')}} as any)

test('edit_project_record with mode check runs the same prepared write as a check, keeps the edit_ref, and mode save commits once',async()=>{
 const {writer,committed,checked}=writerWith(async()=>({data:{status:'checked'},error:null}))
 const edits=createProjectEdits({projectId:'p',coherent:true,writeCheck:true,writer,hasAccess:async()=>true,read:async()=>({data:[snapshot()],error:null})})
 const ref=(await edits.execute('read_project_edit_context',{resource:'solutions',query:null,next_ref:null})).entries[0].edit_ref
 const change={edit_ref:ref,changes:[{op:'set',path:'/tradeoffs',value_json:JSON.stringify('Kortare väg för regnvatten.')}],reason:'Ägarens beslut',request_quote:message}
 const check=await edits.execute('edit_project_record',{...change,mode:'check'})
 assert.equal(check.status,'checked'); assert.equal(check.saved,false)
 assert.equal(checked.length,1); assert.equal(checked[0].kind,'bound_solution'); assert.equal(committed.length,0)
 assert.equal((checked[0].data as any).solution.tradeoffs,'Kortare väg för regnvatten.')
 // The same edit_ref still works for the real save.
 await edits.execute('edit_project_record',{...change,mode:'save'})
 assert.equal(committed.length,1); assert.deepEqual(committed[0].data,checked[0].data,'the save sends exactly what was checked')
 assert.equal((await edits.execute('edit_project_record',{...change,mode:'later'})).status,'invalid')
 // Without the pin the tool keeps its exact old shape: a mode field is refused.
 const plain=createProjectEdits({projectId:'p',coherent:true,writer,hasAccess:async()=>true,read:async()=>({data:[snapshot()],error:null})})
 const plainRef=(await plain.execute('read_project_edit_context',{resource:'solutions',query:null,next_ref:null})).entries[0].edit_ref
 assert.equal((await plain.execute('edit_project_record',{...change,edit_ref:plainRef,mode:'check'})).status,'invalid')
 assert.equal(plain.tools.find(t=>t.function.name==='edit_project_record')!.function.parameters.properties.mode,undefined)
})

test('the catalog publishes mode on edit_project_record and the write-check pin; the code schema matches the published one',()=>{
 const fixture=catalogFixture()
 assert.equal(fixture.definition('agent-contract.ask-bob','agent_contract').metadata.write_check_version,1)
 const published=fixture.definition('tools.edit_project_record','tool_contract').definition as any
 const code=withWriteCheck(COHERENT_EDIT_TOOLS).find(t=>t.function.name==='edit_project_record')!.function as any
 assert.deepEqual(published.parameters.properties.mode,{type:'string',enum:['check','save']})
 assert(published.parameters.required.includes('mode'))
 assert.deepEqual(code.parameters.properties.mode,published.parameters.properties.mode)
 assert(published.description.endsWith(code.description.slice(-60)),'the note is the same text')
})
