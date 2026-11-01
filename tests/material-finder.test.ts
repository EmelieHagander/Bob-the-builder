// Material finder (owner decision 2026-11-01): the structural designer names
// needs in words, a small model answers with IDs from the project's material
// list only, and code returns each item's own catalog values.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {CATALOG_FIND_TOOL,createMaterialCatalogReader,materialFindResult,parseMaterialShortlist,shortlistLine,type MaterialShortlistRow} from '../supabase/functions/_shared/material-catalog.ts'
import {projectSchema,asProjectUser} from './support/project-schema.ts'

const ply='00000000-0000-4000-8000-0000000000b1',screw='00000000-0000-4000-8000-0000000000b2'
const rows:MaterialShortlistRow[]=[
 {id:ply,revision:2,name:'Plywood, björk 12 × 1220 × 2440',profile:'sheet_stock',fastener:null,counting:null,own:false,sizes:{thickness:'12 mm'}},
 {id:screw,revision:1,name:'Träskruv, förzinkad (inomhus) 3,5 × 30',profile:'fastener',fastener:'screw',counting:'along_contact',own:false,sizes:{diameter:'3.5 mm',length:'30 mm'}},
]

test('code returns the catalog values of the references the model named; anything else never passes',()=>{
 const list={rows,complete:true}
 const out:any=materialFindResult(['12 mm plywood','screws about 3.5 x 30','wood glue'],list,{needs:[
  {index:0,match:'exact',item_refs:['m1']},{index:1,match:'close',item_refs:['m2','m9']},{index:2,match:'exact',item_refs:[ply]}]})
 assert.equal(out.status,'ok');assert.equal('list_complete' in out,false)
 assert.deepEqual(out.needs[0],{need:'12 mm plywood',match:'exact',items:[{material_id:ply,material_revision:2,name:rows[0].name,profile:'sheet_stock',fastener:null,sizes:{thickness:'12 mm'},project_own:false}]})
 assert.equal(out.needs[1].match,'close');assert.deepEqual(out.needs[1].items.map((i:any)=>[i.material_id,i.counting]),[[screw,'along_contact']])
 assert.deepEqual(out.needs[2],{need:'wood glue',match:'none',items:[]},'a reference not on the list, or a raw ID, is no match')
 assert.equal((materialFindResult(['x'],list,'not json') as any).status,'unavailable')
 assert.equal((materialFindResult(['x'],{rows,complete:false},{needs:[]}) as any).list_complete,false,'a cut list says so')
})

test('the model sees short references, names, profiles, fastener kinds and sizes, never IDs, revisions or prices',()=>{
 assert.deepEqual(shortlistLine(rows[1],1),{ref:'m2',name:rows[1].name,profile:'fastener',fastener:'screw',sizes:{diameter:'3.5 mm',length:'30 mm'}})
 assert.equal(parseMaterialShortlist({items:[{...rows[0],revision:'2'}],complete:true}),null)
 assert.equal(parseMaterialShortlist(rows),null)
 assert.deepEqual(parseMaterialShortlist({items:rows,complete:true}),{rows,complete:true})
})

test('the reader offers the finder only when it is wired, validates input and keeps the read budget',async()=>{
 const none=createMaterialCatalogReader('p',async()=>({data:null,error:null}),async()=>true,[])
 assert(!none.tools.some(t=>t.function.name==='find_catalog_materials'))
 let asked:string[]=[]
 const reader=createMaterialCatalogReader('p',async()=>({data:null,error:null}),async()=>true,[],undefined,{find:async needs=>{asked=needs;return {status:'ok',needs:[]}}})
 assert(reader.tools.includes(CATALOG_FIND_TOOL))
 assert.equal((await reader.read('find_catalog_materials',{needs:[]})).status,'invalid')
 assert.deepEqual(await reader.read('find_catalog_materials',{needs:['12 mm plywood']}),{status:'ok',needs:[]})
 assert.deepEqual(asked,['12 mm plywood']);assert.equal(reader.remaining,10)
 const failing=createMaterialCatalogReader('p',async()=>({data:null,error:null}),async()=>true,[],undefined,{find:async()=>{throw new Error('down')}})
 assert.equal((await failing.read('find_catalog_materials',{needs:['x']})).status,'unavailable')
 const denied=createMaterialCatalogReader('p',async()=>({data:null,error:null}),async()=>false,[],undefined,{find:async()=>({status:'ok'})})
 assert.equal((await denied.read('find_catalog_materials',{needs:['x']})).status,'denied')
})

test('the material list holds shared and own materials at their current revision, for project members only',async t=>{
 const pg=await projectSchema();t.after(()=>pg.close())
 const owner=randomUUID(),outsider=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[owner,'finder-owner@example.test',outsider,'finder-outsider@example.test'])
 const call=async(uid:string,name:string,args:unknown[])=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).rows[0].r
 const project=(await call(owner,'bob.create_project',[JSON.stringify({name:'Finder fixture'})])).id
 const {rows:list,complete}=parseMaterialShortlist(await call(owner,'bob.read_material_shortlist',[project]))!
 assert(list.length>=40);assert.equal(complete,true)
 const screw=list.find(r=>r.name==='Träskruv, förzinkad (inomhus) 3,5 × 30')!
 assert.deepEqual({fastener:screw.fastener,counting:screw.counting,sizes:screw.sizes,own:screw.own},{fastener:'screw',counting:'along_contact',sizes:{diameter:'3.5 mm',length:'30 mm'},own:false})
 assert.equal(list.find(r=>r.name.startsWith('Plywood, björk 12'))?.sizes.thickness,'12 mm')
 assert.deepEqual(list.find(r=>r.name==='Trälim, utomhus (D3)')&&{f:list.find(r=>r.name==='Trälim, utomhus (D3)')!.fastener,g:list.find(r=>r.name==='Trälim, utomhus (D3)')!.sizes.grade},{f:'glue',g:'D3'})
 await assert.rejects(call(outsider,'bob.read_material_shortlist',[project]),/project_denied/)
})
