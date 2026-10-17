import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readHistoryWindow,refreshHistoryPage,prependHistoryPage} from '../src/data/bobHistory.ts'
import {readBobTranscript,type TranscriptRow} from '../src/data/bobTranscript.ts'

const rows=(first:number,last:number):TranscriptRow[]=>Array.from({length:last-first+1},(_,i)=>({seq:first+i,role:i%2?'assistant':'user',text:`message ${first+i}`,delivery_state:'completed'}))
const page=(first:number,last:number,threadId='one',hasMore=first>1)=>({threadId,oldestSeq:first,hasMore,messages:readBobTranscript(rows(first,last),'A',new Map()).messages})

test('initial history contains the five newest rows in conversation order and a stable older cursor',()=>{
 const window=readHistoryWindow(rows(1,39))
 assert.deepEqual(window.rows.map(row=>row.seq),[35,36,37,38,39])
 assert.equal(window.oldestSeq,35);assert.equal(window.hasMore,true)
 assert.equal(readHistoryWindow(rows(1,5)).hasMore,false)
})
test('tail refresh preserves explicitly opened history and replaces changed pending rows',()=>{
 const older=prependHistoryPage(page(6,10),page(1,5))
 const latest=page(8,12);latest.messages[0].text='fresh state'
 const merged=refreshHistoryPage(older,latest)
 assert.deepEqual(merged.messages.map(m=>m.seq),Array.from({length:12},(_,i)=>i+1))
 assert.equal(merged.messages[7].text,'fresh state');assert.equal(merged.hasMore,false);assert.equal(merged.oldestSeq,1)
})
test('new/reset threads replace old pages and a late older page cannot cross threads',()=>{
 const latest=page(1,2,'two',false)
 assert.deepEqual(refreshHistoryPage(page(1,12),latest),latest)
 assert.deepEqual(prependHistoryPage(latest,page(1,5)),latest)
 assert.deepEqual(refreshHistoryPage(page(1,12),{messages:[]}),{messages:[]})
})
test('an older-page overlap cannot duplicate a message or a delegation notice',()=>{
 const current=page(4,8)
 const earlier=page(1,5)
 earlier.messages.splice(1,0,{seq:1,from:'bob',text:'Delegated'})
 const merged=prependHistoryPage(current,earlier)
 assert.deepEqual(merged.messages.map(m=>m.seq),[1,1,2,3,4,5,6,7,8])
 assert.equal(merged.messages.filter(m=>m.text==='Delegated').length,1)
})
