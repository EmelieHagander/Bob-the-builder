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
