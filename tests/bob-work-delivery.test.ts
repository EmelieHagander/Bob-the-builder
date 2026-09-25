import {test} from 'node:test'
import assert from 'node:assert/strict'
import {runProjectAnswer, type ModelCall} from '../supabase/functions/_shared/project-answer.ts'
import {createProjectLookup} from '../supabase/functions/_shared/project-lookup.ts'
import {createProjectWriter, type WriteReadback} from '../supabase/functions/_shared/project-write.ts'
import {parseWorkIntent, missingWork} from '../supabase/functions/_shared/work-delivery.ts'
import {createToolSession} from '../supabase/functions/_shared/project-tools/session.ts'
const usage={input_tokens:1,output_tokens:1,total_tokens:2}
const reply=(data:unknown)=>({success:true,data:typeof data==='string'?data:JSON.stringify(data),responseId:'resp',model:'fixture',usage})
const call=(name:string,args:unknown)=>({...reply(''),toolCalls:[{id:'call',type:'function' as const,function:{name,arguments:JSON.stringify(args)}}]})
const message='Ordna nio arbetsuppgifter i området.'
const goal={kind:'task' as const,description:'Nio separata arbetsuppgifter',count:9,record_id:null}
function fixture(){const writes:WriteReadback[]=[];let attempts=0
 const lookup=createProjectLookup('A',async(_p,q)=>({data:{records:q.dataset==='project'?[{id:'A'}]:[],related:[],truncated:false},error:null}),1000,32)
 const writer=createProjectWriter('A',message,async p=>{attempts++;const receipt:WriteReadback={projectId:'A',dataset:'tasks',recordId:'task-'+attempts,label:String(p.data.name),operation:'created',savedAt:'2026-09-25T10:00:00Z',record:{id:'task-'+attempts}};writes.push(receipt);return {data:receipt,error:null}},async()=>({data:writes,error:null}),async()=>({data:{generation:2,receipts:writes},error:null}))
 return {writer,writes,run:(callModel:ModelCall)=>runProjectAnswer({projectId:'A',userId:'u',message,lookup,writer,hasAccess:async()=>true,callModel})}
}
const task=(i:number)=>({record_id:null,area_id:'area',step_id:null,name:'Task '+i,instructions:'Measure and record',expected_updated_at:null,request_quote:message})
test('ordinary-language work survives a future offer, nine independent writes and a final result review',async()=>{
 const f=fixture();let n=0
 const result=await f.run(async o=>{
  if(o.schemaName==='bob_work_delivery')return reply({goals:[goal],request_quote:message})
  if(++n===1)return reply('I can do that in the next reply.')
  if(n===2)assert.equal(o.tool_choice,'required')
  if(n<=10)return call('save_project_task',task(n-1))
  return reply('All nine tasks have been saved.')
 })
 assert(result.ok);assert.equal(result.evidence.partial,false);assert.equal(f.writes.length,9);assert.equal(n,12)
})
test('prerequisite or unrelated receipts cannot satisfy a requested result or hide missing count/target',()=>{
 const receipt={projectId:'A',dataset:'tasks',recordId:'one',record:{id:'one'}} as WriteReadback
 assert.equal(missingWork({goals:[goal],request_quote:message},[{name:'save_project_task',status:'saved',receipt}]).length,1)
 assert.equal(missingWork({goals:[{...goal,count:1,record_id:'other'}],request_quote:message},[{name:'save_project_task',status:'saved',receipt}]).length,1)
 assert.equal(missingWork({goals:[{...goal,kind:'drawing',count:1}],request_quote:message},[{name:'save_project_task',status:'saved',receipt}]).length,1)
})
test('repeated prose cannot silently complete an action request with no saved result',async()=>{
 const f=fixture();const result=await f.run(async o=>o.schemaName?reply({goals:[goal],request_quote:message}):reply('Done; I can create those tasks later.'))
 assert(result.ok);assert(result.evidence.partial);assert.equal(f.writes.length,0);assert(!result.answer.includes('Done;'))
})
test('intent failure does not make an informational turn unavailable or force writes',async()=>{
 const f=fixture();let executionCalls=0
 const result=await f.run(async o=>o.schemaName?{success:false,data:null,error:'temporary',model:'fixture',usage}: (executionCalls++,reply('The project explanation.')))
 assert(result.ok);assert.equal(result.answer,'The project explanation.');assert.equal(f.writes.length,0);assert.equal(executionCalls,2)
})
test('the same strict work intent accepts exact authorization in any language, not keyword routing',()=>{
 for(const message of ['Rita skåpet','Diseña el armario','キャビネットを設計して','صمّم الخزانة']){
  assert(parseWorkIntent({goals:[{kind:'drawing',description:message,count:1,record_id:null}],request_quote:message},message))
  assert.equal(parseWorkIntent({goals:[goal],request_quote:'unrelated'},message),null)
 }
})
test('semantic discovery uses actual contracts, caches pagination, and never expands policy gates',async()=>{
 const names=['design_project_cad','save_project_drawing','forbidden'],queries:string[]=[]
 const session=createToolSession({definitions:names.map(name=>({spec:{type:'function',function:{name,description:name,parameters:{type:'object'}}},version:1,gate:()=>name==='forbidden'?'not_allowed' as const:'available' as const,execute:async()=>({status:'ok'})})),
  readPolicy:async()=>({phase:null,tools:names.map(name=>({name,description:name==='save_project_drawing'?'Room outlines; cannot draw furniture':'Construct geometry',how_to:'Read current sources.',active:true,always_load:false,preload_phases:[],schema_version:1}))}),
  searchCapabilities:async(query,catalog)=>{queries.push(query);assert(!catalog.some(r=>r.name==='forbidden'));return ['design_project_cad']}})
 await session.prepare()
 for(let i=0;i<2;i++){const result=await session.execute('list_tools',{query:'キャビネットを設計',after_name:null});assert.deepEqual(result.items.map((r:any)=>r.name),['design_project_cad'])}
 assert.equal(queries.length,1);assert.equal((await session.execute('load_tool',{name:'forbidden'})).status,'not_allowed')
})
test('capability routing accepts the parsed structured object returned by the real Responses adapter',async()=>{
 const f=fixture();let calls=0
 const result=await f.run(async o=>{
  if(o.schemaName==='bob_work_delivery')return reply({goals:[],request_quote:null})
  if(o.schemaName==='bob_capability_search')return {...reply(''),data:{names:['save_project_task']}} as any
  if(++calls===1)return call('list_tools',{query:'作業を追加する',after_name:null})
  const output=JSON.parse(String(o.messages![0].content));assert.equal(output.search,'capability_match');assert.deepEqual(output.items.map((i:any)=>i.name),['save_project_task'])
  return reply('The available capability was found.')
 })
 assert(result.ok);assert.equal(calls,2);assert.equal(f.writes.length,0)
})
