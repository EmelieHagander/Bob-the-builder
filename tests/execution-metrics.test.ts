import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createExecutionMetrics,type ExecutionEvent} from '../supabase/functions/_shared/execution-metrics.ts'
import {createBobJournal,type JournalEntry} from '../supabase/functions/_shared/bob-job-journal.ts'
import {projectSchema} from './support/project-schema.ts'
const reply={success:true,data:'PRIVATE ANSWER',model:'fixture',usage:{input_tokens:12,output_tokens:8,total_tokens:20},estimatedCostUsd:0.01}
test('actual provider calls are counted once across journal replay; delivery records the end reason, saves, candidate and partial work',async()=>{
 const events=new Map<string,ExecutionEvent>(),entries:JournalEntry[]=[]
 const metrics=createExecutionMetrics({runId:'run',turnId:'turn',startedAt:0,now:()=>500,write:async e=>{events.set(e.event_key,e)}})
 const run=async()=>{const journal=createBobJournal({entries,save:async e=>{entries.push(e)}},10000,()=>0);await journal.run('model',{},async()=>{await metrics.model({aiFunction:'cad-reviewer',prompt:'PRIVATE REQUEST'} as any,reply,100);return reply})}
 await run();await run();assert.equal(events.size,1)
 metrics.observe({steps:3,tool_calls:4,deferred_calls:0,completion_checks:1,nudges:0,end:'answered'})
 await metrics.finish({ok:true,writes:1,cad:{consultations:1,renders:2,input_corrections:0,reviews:2,review_rejections:1,review_unavailable:0,review_passed:true}})
 assert.equal(events.get('delivery')!.status,'saved');assert.equal(events.get('delivery')!.counts.cad_review_rejections,1)
 assert.equal(events.get('delivery')!.counts.end_reason,'answered');assert.equal(events.get('delivery')!.counts.completion_checks,1)
 metrics.tool({name:'save_project_task',status:'saved',step:2,index:0,ms:30});metrics.tool({name:'save_project_task',status:'saved',step:2,index:0,ms:30})
 await new Promise(r=>setTimeout(r,0))
 const tool=events.get('tool:2:0')!;assert.equal(tool.kind,'tool');assert.equal(tool.counts.tool,'save_project_task');assert.equal(tool.status,'saved')
 metrics.tool({name:'Robert"; drop table',status:'Not A Code!',step:3,index:1,ms:1});await new Promise(r=>setTimeout(r,0))
 assert.equal(events.get('tool:3:1')!.counts.tool,'invalid_name');assert.equal(events.get('tool:3:1')!.status,'returned','free text never enters diagnostics')
 metrics.observe({steps:24,tool_calls:30,deferred_calls:0,completion_checks:0,nudges:0,end:'step_budget'})
 await metrics.finish({ok:true,writes:0});assert.equal(events.get('delivery')!.status,'step_budget')
 metrics.observe({steps:2,tool_calls:1,deferred_calls:0,completion_checks:0,nudges:0,end:'answered'})
 await metrics.finish({ok:true,partial:true,writes:0});assert.equal(events.get('delivery')!.status,'partial')
 await metrics.finish({ok:false,error:'turn_timeout',writes:0});assert.equal(events.get('delivery')!.status,'failed');assert.equal(events.get('delivery')!.counts.end_reason,'turn_timeout')
 assert.equal([...events.keys()].filter(k=>k.startsWith('model:')).length,1)
 assert(!JSON.stringify([...events.values()]).includes('PRIVATE'))
})
test('metrics failures cannot abort a delivered result and provider success cannot substitute for delivery',async()=>{
 const metrics=createExecutionMetrics({runId:'run',turnId:'turn',startedAt:0,write:async()=>{throw new Error('down')}})
 await metrics.model({aiFunction:'ask-bob'} as any,reply,100)
 await metrics.finish({ok:false,writes:0})
})
test('model diagnostics distinguish tool-free aborts from returned tools without retaining private input',async()=>{
 const events:ExecutionEvent[]=[]
 const metrics=createExecutionMetrics({runId:'run',turnId:'turn',startedAt:0,write:async e=>{events.push(e)}})
 await metrics.model({aiFunction:'cad-designer',timeoutMs:100000,tools:[],prompt:'PRIVATE request'} as any,
  {...reply,success:false,error:'Network error: The signal has been aborted PRIVATE'},100100)
 assert.equal(events[0].counts.offered_tool_count,0);assert.equal(events[0].counts.failure_kind,'request_aborted')
 assert.equal(events[0].counts.timeout_ms,100000)
 await metrics.model({aiFunction:'cad-designer',timeoutMs:82000,tools:[{function:{name:'render_cad_candidate',description:'PRIVATE brief'}}]} as any,
  {...reply,toolCalls:[{id:'PRIVATE call id',type:'function',function:{name:'render_cad_candidate',arguments:'PRIVATE geometry'}}]},25)
 assert.deepEqual(events[1].counts.offered_tools,['render_cad_candidate'])
 assert.deepEqual(events[1].counts.returned_tools,['render_cad_candidate'])
 assert.equal(events[1].counts.failure_kind,null)
 assert(!JSON.stringify(events).includes('PRIVATE'))
 await metrics.model({aiFunction:'cad-designer',tools:Array(100).fill({function:{name:'x'.repeat(40)}})} as any,
  {...reply,toolCalls:Array(100).fill({function:{name:'x'.repeat(40)}})},1)
 assert.equal(events[2].counts.offered_tool_count,100)
 assert.equal((events[2].counts.offered_tools as string[]).length,32)
 assert(Buffer.byteLength(JSON.stringify(events[2].counts))<4000,'bounded by the existing DB contract')
})
test('diagnostics stay service-only even when a normal user belongs to a project',async()=>{
 const pg=await projectSchema()
 try{
  for(const role of ['anon','authenticated']){
   const {rows}=await pg.query(`select has_table_privilege('${role}','bob.execution_events','select') as read,has_table_privilege('${role}','bob.execution_events','insert') as write`)
   assert.equal(rows[0].read,false);assert.equal(rows[0].write,false)
  }
  const {rows}=await pg.query(`select relrowsecurity from pg_class where oid='bob.execution_events'::regclass`);assert.equal(rows[0].relrowsecurity,true)
 }finally{await pg.close()}
})

test('CAD research retains its role, usage and journal replay boundary without admitting unknown role text',async()=>{
 const events:ExecutionEvent[]=[],entries:JournalEntry[]=[]
 const metrics=createExecutionMetrics({runId:'run',turnId:'turn',startedAt:0,write:async e=>{events.push(e)}})
 const run=async()=>{const journal=createBobJournal({entries,save:async e=>{entries.push(e)}},10000,()=>0)
  await journal.run('model',{role:'cad-research'},async()=>{await metrics.model({aiFunction:'cad-research',prompt:'PRIVATE source'} as any,reply,120);return reply})}
 await run();await run()
 assert.equal(events.length,1);assert.equal(events[0].role,'cad-research')
 assert.equal(events[0].input_tokens,12);assert.equal(events[0].output_tokens,8);assert.equal(events[0].cost_usd,0.01)
 await metrics.model({aiFunction:'PRIVATE unknown role'} as any,reply,1)
 assert.equal(events[1].role,'other');assert(!JSON.stringify(events).includes('PRIVATE'))
})

test('role migration preserves historical rows and service-only access while admitting new research events',async()=>{
 const legacy=['bob','tool','ask-bob','cad-designer','cad-reviewer','context-summary','plan-compiler','plan-reviewer','bob-tool-discovery','bob-work-intent','bob-delivery-language','other']
 const run='50000000-0000-4000-8000-000000000001',turn='50000000-0000-4000-8000-000000000002'
 const insert=`insert into bob.execution_events(run_id,turn_id,event_key,kind,role,status,duration_ms,counts) values($1,$2,$3,'model',$4,'ok',1,'{}')`
 const pg=await projectSchema(async(db,name)=>{
  if(name.endsWith('_cad_research_execution_role.sql')){
   await assert.rejects(db.query(insert,[run,turn,'before:research','cad-research']),(e:any)=>e.code==='23514')
   for(const role of legacy)await db.query(insert,[run,turn,'legacy:'+role,role])
  }
 })
 try{
  const before=await pg.query('select role,event_key from bob.execution_events order by role')
  assert.deepEqual(before.rows.map((r:any)=>r.role),legacy.slice().sort())
  await pg.exec('set role service_role')
  await pg.query(insert,[run,turn,'new:research','cad-research'])
  await assert.rejects(pg.query(insert,[run,turn,'unknown','unregistered-role']),(e:any)=>e.code==='23514')
  await pg.exec('reset role')
  const {rows}=await pg.query("select convalidated from pg_constraint where conrelid='bob.execution_events'::regclass and conname='execution_events_role_check'")
  assert.equal(rows[0].convalidated,true)
  assert.equal((await pg.query("select count(*)::integer as n from bob.execution_events where role='other'")).rows[0].n,1,'historical other cannot safely be relabelled')
  for(const role of ['anon','authenticated']){
   await pg.exec('set role '+role)
   await assert.rejects(pg.query('select * from bob.execution_events'),(e:any)=>e.code==='42501')
   await assert.rejects(pg.query(insert,[run,turn,'denied:'+role,'cad-research']),(e:any)=>e.code==='42501')
   await pg.exec('reset role')
  }
 }finally{await pg.close()}
})
