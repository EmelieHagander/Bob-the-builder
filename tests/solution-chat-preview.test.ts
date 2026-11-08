import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createSolutions} from '../src/data/solutions.ts'
import {conceptFixture} from './support/solution-concept-fixtures.ts'
function fixture(overrides:Record<string,any>={},guard=()=>{}){
 const reads:{table:string;columns:string;filters:Record<string,unknown>}[]=[]
 const rows:any={solution_revisions:{project_id:'A',solution_id:'solution',revision:10,title:'Entry sketch',design_intent:conceptFixture('box'),archived:false},current_solutions:{project_id:'A',solution_id:'solution',revision:10,archived:false},...overrides}
 const client={from:(table:string)=>{let columns='',filters:Record<string,unknown>={};const chain={select:(s:string)=>{columns=s;return chain},eq:(k:string,v:unknown)=>{filters[k]=v;return chain},maybeSingle:async()=>{reads.push({table,columns,filters});return rows[table]?.error?{data:null,error:rows[table].error}:{data:rows[table]??null,error:null}}};return chain}}
 return{adapter:createSolutions(client as any,()=>guard),reads,rows}
}
test('the entry-style solution receipt opens its exact saved 2D model through two narrow scoped reads',async()=>{
 const f=fixture(),r=await f.adapter.chatPreview('A','solution',10)
 assert.equal(r?.revision,10);assert.equal(r?.latestRevision,10);assert(r?.intent?.model);assert.equal(f.reads.length,2)
 for(const read of f.reads){assert.equal(read.filters.project_id,'A');assert.equal(read.filters.solution_id,'solution');assert(!read.columns.includes('*'));assert(!read.columns.includes('description'));assert(!read.columns.includes('source_media'))}
 assert.equal(f.reads[0].filters.revision,10)
})
test('an old concept stays at the receipt revision and preserves current archival/history notices',async()=>{
 const f=fixture({current_solutions:{project_id:'A',solution_id:'solution',revision:11,archived:true}}),r=await f.adapter.chatPreview('A','solution',10)
 assert.equal(r?.revision,10);assert.equal(r?.latestRevision,11);assert.equal(r?.currentlyArchived,true)
})
test('legacy text-only solutions stay text-only; malformed saved models have an explicit unavailable state',async()=>{
 const f=fixture();f.rows.solution_revisions.design_intent=null;assert.equal(await f.adapter.chatPreview('A','solution',10),null)
 f.rows.solution_revisions.design_intent={version:'broken'};assert.equal((await f.adapter.chatPreview('A','solution',10))?.intent,null)
 const text=conceptFixture('box');delete (text as any).model;f.rows.solution_revisions.design_intent=text;assert.equal(await f.adapter.chatPreview('A','solution',10),null)
})
test('missing, foreign, denied and mismatched solution/head reads never substitute another version',async()=>{
 for(const override of [{solution_revisions:null},{solution_revisions:{project_id:'B',solution_id:'solution',revision:10}},{solution_revisions:{project_id:'A',solution_id:'other',revision:10}},{solution_revisions:{project_id:'A',solution_id:'solution',revision:11}},{current_solutions:null},{current_solutions:{project_id:'B',solution_id:'solution',revision:10}},{current_solutions:{project_id:'A',solution_id:'other',revision:10}},{current_solutions:{project_id:'A',solution_id:'solution',revision:9}},{solution_revisions:{error:{message:'permission denied'}}}])await assert.rejects(fixture(override).adapter.chatPreview('A','solution',10))
 let calls=0;await assert.rejects(fixture({},()=>{if(++calls>1)throw Error('project_changed')}).adapter.chatPreview('A','solution',10),/project_changed/)
 for(const rev of [0,-1,NaN,Infinity,1.5])await assert.rejects(fixture().adapter.chatPreview('A','solution',rev))
})
