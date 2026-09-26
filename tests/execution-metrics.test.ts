import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createExecutionMetrics,type ExecutionEvent} from '../supabase/functions/_shared/execution-metrics.ts'
import {createBobJournal,type JournalEntry} from '../supabase/functions/_shared/bob-job-journal.ts'
import {projectSchema} from './support/project-schema.ts'
const reply={success:true,data:'PRIVATE ANSWER',model:'fixture',usage:{input_tokens:12,output_tokens:8,total_tokens:20},estimatedCostUsd:0.01}
test('actual provider calls are counted once across journal replay; delivery distinguishes receipts, candidate and incomplete work',async()=>{
 const events=new Map<string,ExecutionEvent>(),entries:JournalEntry[]=[]
 const metrics=createExecutionMetrics({runId:'run',turnId:'turn',startedAt:0,now:()=>500,write:async e=>{events.set(e.event_key,e)}})
 const run=async()=>{const journal=createBobJournal({entries,save:async e=>{entries.push(e)}},10000,()=>0);await journal.run('model',{},async()=>{await metrics.model({aiFunction:'cad-reviewer',prompt:'PRIVATE REQUEST'} as any,reply,100);return reply})}
 await run();await run();assert.equal(events.size,1)
 metrics.observe({requested:1,missing:0,rounds:3,continuations:1,intent_available:true,kinds:['drawing']})
 await metrics.finish({ok:true,writes:1,cad:{consultations:1,renders:2,input_corrections:0,reviews:2,review_rejections:1,review_unavailable:0,review_passed:true}})
 assert.equal(events.get('delivery')!.status,'receipt_matched');assert.equal(events.get('delivery')!.counts.cad_review_rejections,1)
 await metrics.finish({ok:true,partial:true,writes:0});assert.equal(events.size,2);assert.equal(events.get('delivery')!.status,'partial')
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
