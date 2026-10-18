import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createToolSession,type ToolGate,type ToolPolicy} from '../supabase/functions/_shared/project-tools/session.ts'
import {buildBobHands,bobColleagues} from '../supabase/functions/_shared/bob-prompt.ts'
import {catalogFixture,preContextStrategyCatalogFixture} from './support/ai-catalog-fixture.ts'
import {countContextTokens} from '../supabase/functions/_shared/bob-token-budget.ts'

function fixture(){
 const rows:ToolPolicy[]=['read_project','write_project'].map(name=>({name,description:'A short purpose.',how_to:'Exact long manual with important recovery instructions.',schema_version:1,always_load:true,preload_phases:[],active:true}))
 let gate:ToolGate='available',writes=0
 const session=createToolSession({toolInstructions:'lazy',message:'Please save this.',readPolicy:async()=>({phase:'design',tools:rows}),definitions:rows.map(row=>({version:1,spec:{type:'function',function:{name:row.name,description:'Specific implementation limits.',parameters:{type:'object',additionalProperties:false,properties:{value:{type:'integer'},request_quote:{type:'string'}},required:['value','request_quote']}}},gate:()=>row.name==='write_project'?gate:'available',execute:async args=>{writes++;return{status:'saved',args}}}))})
 return{session,rows,setGate:(value:ToolGate)=>{gate=value},get writes(){return writes}}
}
const names=(specs:{function:{name:string}}[])=>specs.map(spec=>spec.function.name)
test('lazy instructions expose compact cards, then exact schema on the following model step',async()=>{
 const f=fixture()
 assert.deepEqual(names(await f.session.prepare()),['describe_tool'])
 assert.equal(f.session.toolbox.find(entry=>entry.name==='write_project')?.description,'A short purpose.')
 assert.equal((await f.session.execute('write_project',{value:1})).status,'not_offered')
 const manual=await f.session.execute('describe_tool',{name:'write_project'})
 assert.equal(manual.status,'ok');assert.match(manual.manual,/Exact long manual/)
 assert.deepEqual(manual.parameters.required,['value'],'provenance is still server-owned')
 assert.equal(manual.callable_from_next_step,true)
 assert.equal((await f.session.execute('write_project',{value:1})).status,'not_offered','no same-batch schema guessing')
 assert(names(await f.session.prepare()).includes('write_project'))
 const saved=await f.session.execute('write_project',{value:1})
 assert.equal(saved.status,'saved');assert.equal(saved.args.request_quote,'Please save this.');assert.equal(f.writes,1)
})
test('loaded manuals never preserve revoked authority, waiting tools or closed surfaces',async()=>{
 const f=fixture();await f.session.prepare();await f.session.execute('describe_tool',{name:'write_project'});await f.session.prepare()
 f.setGate('not_allowed');assert.equal((await f.session.execute('write_project',{})).status,'not_allowed')
 assert.equal((await f.session.execute('describe_tool',{name:'write_project'})).status,'unavailable')
 await f.session.prepare();f.setGate('available')
 assert(!names(await f.session.prepare()).includes('write_project'),'revocation removed prior schema exposure')
 f.setGate('missing_context');await f.session.prepare()
 assert.equal((await f.session.execute('describe_tool',{name:'write_project'})).callable_from_next_step,false)
 f.setGate('available');await f.session.prepare();f.session.closeSurface()
 assert.equal((await f.session.execute('write_project',{})).status,'not_offered');assert.equal(f.writes,0)
})
test('context rollover releases schemas without resetting handler execution or giving new authority',async()=>{
 const f=fixture();await f.session.prepare();await f.session.execute('describe_tool',{name:'write_project'});await f.session.prepare()
 f.session.resetInstructions()
 assert.equal((await f.session.execute('write_project',{value:2})).status,'saved','the in-flight request retains its offered fence')
 assert.deepEqual(names(await f.session.prepare()),['describe_tool']);assert.equal(f.writes,1)
 f.rows[1].active=false
 assert.equal((await f.session.execute('describe_tool',{name:'write_project'})).status,'unavailable')
})
test('new base role and directory cards meet actual token caps and retain old pinned behavior',()=>{
 const current=catalogFixture(),old=preContextStrategyCatalogFixture()
 assert.equal(current.definition('agent-contract.ask-bob').metadata.context_strategy_version,1)
 assert.equal(old.definition('agent-contract.ask-bob').metadata.context_strategy_version,undefined)
 assert(countContextTokens(current.role('ask-bob').systemMessage)<=700)
 assert.equal(current.role('ask-bob').model.model_name,'gpt-5.4');assert.equal(current.role('ask-bob').reasoningEffort,'high')
 assert.match(old.role('ask-bob').systemMessage,/# Active delegated outcome/)
 for(const row of current.manifest().definitions.filter(d=>d.definition_kind==='tool_contract'&&typeof d.definition.card_description==='string')){
  assert(countContextTokens(String(row.definition.card_description))<=80,row.prompt_key)
 }
 assert.throws(()=>old.tool('search_project_data',{card:true}),/ai_contract_missing/,'no code-authored card fallback')
})
test('colleague cards and their handoffs are limited to actual visible delegation tools',()=>{
 const current=catalogFixture()
 assert.deepEqual(bobColleagues(current,['search_project_data']),[])
 assert.deepEqual(bobColleagues(current,['edit_project_plan']),[],'focused plan edits use deterministic validation')
 for(const tool of ['compile_project_plan','audit_project_plan'])assert.deepEqual(bobColleagues(current,[tool]).map(c=>c.name),['Plantus','Vera'])
 assert(bobColleagues(current,['compile_project_plan','audit_project_plan','edit_project_plan','design_project_cad','generate_project_image']).every(c=>!['Daisy','Kjell'].includes(c.name)))
 assert.deepEqual(bobColleagues(current,['design_project_cad']).map(c=>c.name),['Rita'])
 for(const c of bobColleagues(current,['design_project_cad','compile_project_plan','generate_project_image'])){
  assert(countContextTokens(`${c.name} ${c.title} ${c.purpose}`)<=80,c.name)
  assert(c.instructions.length>0)
 }
 const hands=buildBobHands(current,[current.tool('describe_tool')],[{name:'design_project_cad',group:'Drawings',state:'offered',description:current.tool('design_project_cad',{card:true}).function.description,instructionLoaded:false}])
 assert.match(hands,/Rita/);assert.match(hands,/describe_tool/);assert.doesNotMatch(hands,/Daisy|Kjell|Plantus|Statusspråk|Samtalsminnet/)
})
test('oversized catalog cards fail explicitly without truncating instructions',async()=>{
 const f=fixture();f.rows[0].description='detail '.repeat(90)
 await assert.rejects(f.session.prepare(),/tool_card_too_large/)
 const current=catalogFixture(m=>{m.definitions.find(d=>d.prompt_key==='role.cad-reviewer')!.definition.purpose='detail '.repeat(90)})
 assert.throws(()=>bobColleagues(current,['design_project_cad']),/colleague_card_too_large/)
})
