import {test} from 'node:test'
import assert from 'node:assert/strict'
import {bobChatViews} from '../src/lib/bobChatViews.ts'
const receipt=(revision:number,dataset='solutions'):any=>({projectId:'p',dataset,recordId:'same-model',revision,operation:'updated'})
const source=(revision:number,kind='concept',view='front'):any=>({projectId:'p',dataset:'image_pixels',recordId:'same-model',visual:{kind,revision,view,ref:`${kind}:same-model:${revision}:${view}`}})
test('opening the previous version does not hide the just-saved concept; an exact opened version avoids a duplicate default card',()=>{
 const old=source(20),current=receipt(21),inputs=structuredClone([old,current])
 const result=bobChatViews('p',[current],[old])
 assert.deepEqual(result.seen,[old]);assert.deepEqual(result.concepts,[current])
 assert.deepEqual([old,current],inputs,'source and receipt authority are immutable')
 assert.deepEqual(bobChatViews('p',[current],[source(21)]).concepts,[])
})
test('read-only exact views, distinct comparisons, latest writes, project boundaries and drawing revisions remain explicit',()=>{
 assert.equal(bobChatViews('p',[],[source(21)]).seen[0].visual!.revision,21)
 const compared=bobChatViews('p',[receipt(20),receipt(21),receipt(22)],[source(20),source(21),source(21),source(21,'concept','plan')])
 assert.equal(compared.seen.length,3);assert.equal(compared.concepts[0].revision,22)
 assert.deepEqual(bobChatViews('other',[receipt(21)],[source(21)]),{seen:[],concepts:[],drawings:[]})
 const drawing=bobChatViews('p',[receipt(20,'artifacts'),receipt(21,'artifacts')],[source(20,'drawing')])
 assert.equal(drawing.drawings[0].revision,21)
 assert.equal(bobChatViews('p',[{...receipt(21),operation:'deleted'}]).concepts.length,0)
})
