import {test} from 'node:test'
import assert from 'node:assert/strict'
import {constructionFormFixture} from './support/construction-form-fixture.ts'
import {conceptOverlapRefusal} from '../supabase/functions/_shared/construction-draft.ts'

// Entré, 2026-11-10: the Solution's "supports" overlapped the "floor", so every
// joist lay in both and the builder tried construction edits in a circle. The
// refusal must name the Solution overlap so Bob fixes the concept.
function intentWith(second:{at:number[],size:number[]}){
 const {intent}=constructionFormFixture() as any
 const node=(id:string,value:number)=>({id,role:'decision',unit:'mm',reason:'Plats i konceptet.',value})
 const box=(id:string,at:number[],size:number[])=>({comp:{id,label:id,kind:'solid',active:true,features:[],choices:[],position:at.map((_,k)=>`${id}_p${k}`),size:size.map((_,k)=>`${id}_s${k}`)},
  nodes:[...at.map((v,k)=>node(`${id}_p${k}`,v)),...size.map((v,k)=>node(`${id}_s${k}`,v))]})
 const floor=box('floor',[0,0,130],[2000,1500,170]),supports=box('supports',second.at,second.size)
 intent.features=[];intent.choices=[]
 intent.model={...intent.model,nodes:[...floor.nodes,...supports.nodes],components:[floor.comp,supports.comp]}
 return intent
}
const ambiguous=[{code:'form_instance_ambiguous',ids:['joist_1','floor','supports'],message:'Several concept components hold this part; assign it to one.'}]

test('a part made ambiguous by overlapping Solution components is refused as a Solution fault',()=>{
 const r=conceptOverlapRefusal(intentWith({at:[0,0,0],size:[2000,1500,300]}),ambiguous,'changed')
 assert.equal(r?.reason,'solution_concept_overlap')
 assert.deepEqual(r?.overlapping,[['floor','supports']])
 assert.match(r!.message,/hand it back to Bob/)
})

test('touching components leave the ordinary mapping refusal in place',()=>{
 assert.equal(conceptOverlapRefusal(intentWith({at:[0,0,0],size:[2000,1500,130]}),ambiguous,'changed'),null)
})
