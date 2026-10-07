import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {projectSchema,asProjectUser} from './support/project-schema.ts'
import {parseOperationalWrite} from '../supabase/functions/_shared/project-operations.ts'

const message='Buy screws for both shelves as whole packs. Use the supplier page I gave you.'
async function fixture(t:any){
 const pg=await projectSchema();t.after(()=>pg.close())
 const user=randomUUID(),other=randomUUID()
 await pg.query('insert into auth.users values($1,$2,now()),($3,$4,now())',[user,'packs@test.example',other,'outsider@test.example'])
 const rpc=async(name:string,args:any[],uid:string|null=user,role='authenticated'):Promise<any>=>(await asProjectUser(pg,uid,`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args,role)).rows[0].result
 const project=(await rpc('bob.create_project',[JSON.stringify({name:'Pack purchase fixture'})])).id,solution=randomUUID()
 await rpc('bob.solution_command',[project,'create',solution,0,JSON.stringify({area_id:null,title:'Two shelves',description:'Fixture',assumptions:'Screw suitability unknown',tradeoffs:'Synthetic',measurements:[]})])
 await rpc('bob.solution_command',[project,'select',solution,0,JSON.stringify({solution_revision:1,reason:'Fixture'})])
 const turn=randomUUID(),claim=await rpc('bob.bob_claim_turn',[project,user,turn,message],null,'service_role')
 const write=(p:any,uid=user)=>rpc('bob.bob_project_write_v16',[project,claim.thread_id,turn,claim.generation,JSON.stringify(p)],uid)
 const base={record_id:null,expected_revision:0,expected_updated_at:null,request_quote:'Buy screws for both shelves'}
 const screw=await write({...base,kind:'catalog',data:{action:'ensure',key:'screw',kind:'material',name:'Wood screw 5×50',aliases:[],profile_code:'fastener',profile_revision:1,categories:['metal','fastener'],properties:{diameter:{value:'5',unit:'mm',truth:'provided_spec',parameter:null,note:''},length:{value:'50',unit:'mm',truth:'provided_spec',parameter:null,note:''}},material_id:null,material_revision:null,notes:'Generic definition, no SKU',source_kind:'user_statement',source_quote:'Buy screws',source_seq:null}})
 const stockId=randomUUID()
 await rpc('bob.stock_command',[project,'create',stockId,0,JSON.stringify({name:'Leftover screws 5×50',specification:'Counted box',quantity:'30',unit:'pcs',status:'available',area_id:null,notes:'Declared by member',change_note:'Fixture'})])
 const need=async(name:string,qty='60',stock:any[]=[],unit='pcs')=>{
  const id=randomUUID()
  await rpc('bob.material_requirement_command',[project,'create',id,0,JSON.stringify({name,category:'Fasteners & glue',area_id:null,task_id:null,unit,required_quantity:qty,waste_percent:'0',purchase_increment:'1',basis:'Synthetic screw count',assumptions:'Joint suitability not assessed',artifact_id:null,artifact_revision:null,target_revision:1,stock_allocations:stock,component_allocations:[],change_note:'Fixture'})])
  return id
 }
 const a=await need('Screws shelf A','60',[{id:stockId,revision:1,quantity:'30'}]),b=await need('Screws shelf B')
 const fields=(patch:any={})=>({catalog_item_id:screw.recordId,catalog_item_revision:1,title:'Wood screw 5×50 Torx',supplier:'Fixture supplier',manufacturer:'Fixture maker',article_number:'WS-550',variant:'Zinc',source_url:'https://supplier.test.example/ws-550',source_document:'',source_version:'2026-10',source_date:'2026-10-01',supported_fields:['title','article_number','purchase_unit','content_per_purchase_unit','content_unit'],purchase_unit:'pack',content_per_purchase_unit:'100',content_unit:'pcs',notes:'Synthetic test article, not a real product',change_note:'Bind source',...patch})
 const article=(patch:any={})=>write({...base,kind:'supplier_article',data:{action:'create',fields:fields({...patch,title:patch.title??'Wood screw 5×50 Torx '+randomUUID().slice(0,4)})}})
 const needs=(...ids:string[])=>ids.map(id=>({id,revision:1}))
 const purchase=(aid:string,action='publish',rev=0,list:any[]=needs(a,b),articleRevision=1)=>({...base,kind:'pack_purchase',record_id:aid,expected_revision:articleRevision,data:{action,purchase_revision:rev,needs:list,change_note:'Explicit pack purchase'}})
 const command=(aid:string,action='publish',rev=0,list:any[]=needs(a,b),articleRevision=1,uid=user)=>rpc('bob.pack_purchase_command',[project,action,aid,articleRevision,rev,JSON.stringify(list),'Explicit pack purchase'],uid)
 const quote=(aid:string,list:any[]=needs(a,b),articleRevision=1)=>rpc('bob.pack_purchase_quote',[project,aid,articleRevision,JSON.stringify(list)])
 const requirementRows=async()=>(await pg.query('select to_jsonb(r) row from bob.material_requirement_revisions r where project_id=$1 order by requirement_id,revision',[project])).rows
 return {pg,rpc,project,user,other,write,base,screw,stockId,need,a,b,fields,article,needs,purchase,command,quote,requirementRows}
}

test('AC-14: aggregate before rounding, subtract held stock once, one pack with visible surplus',async t=>{
 const f=await fixture(t),art=await f.article()
 assert.equal(art.dataset,'catalog');assert.equal(art.record.product_bound,true);assert.equal(art.record.suitability_verified,false);assert.equal(art.record.physical_verified,false)
 const q=await f.quote(art.recordId)
 assert.equal(Number(q.total_quantity),90);assert.equal(Number(q.stock_quantity),30);assert.equal(q.purchase_count,1);assert.equal(Number(q.surplus_quantity),10)
 assert.equal(q.pack_state,'known');assert.equal(q.purchase_recorded,false);assert.equal(q.needs.length,2)
 const before=await f.requirementRows()
 const receipt=await f.write(f.purchase(art.recordId))
 assert.equal(receipt.dataset,'materials');assert.equal(receipt.recordId,art.recordId);assert.equal(receipt.record.purchase_count,1)
 assert.equal(Number(receipt.record.surplus_quantity),10);assert.equal(receipt.record.shopping_ready,true);assert.equal(receipt.record.source_state,'current')
 assert.deepEqual(receipt.record.needs.map((n:any)=>Number(n.quantity)).sort(),[30,60])
 assert.deepEqual(await f.write(f.purchase(art.recordId)),receipt,'replay returns the same receipt without a second purchase')
 await assert.rejects(f.write({...f.purchase(art.recordId),data:{...f.purchase(art.recordId).data,change_note:'Changed replay'}}),/operation_reused/)
 const rows=(await f.pg.query('select * from bob.materials where project_id=$1',[f.project])).rows
 assert.equal(rows.length,1);assert.equal(rows[0].qty,'1 pack');assert.equal(rows[0].supplier,'Fixture supplier');assert.match(rows[0].name,/WS-550/);assert.match(rows[0].name,/100 pcs\/pack/)
 const shopping=await f.rpc('bob.read_project_work',[f.project,JSON.stringify({resource:'shopping',record_id:rows[0].id,after_id:null})])
 assert.equal(shopping.records[0].pack_source.article_id,art.recordId);assert.equal(shopping.records[0].pack_source.purchase_count,1)
 const products=await f.rpc('bob.read_project_work',[f.project,JSON.stringify({resource:'product',record_id:null,after_id:null})])
 assert.equal(products.records[0].id,art.recordId);assert.equal(products.records[0].pack_known,true)
 const purchases=await f.rpc('bob.read_project_work',[f.project,JSON.stringify({resource:'pack_purchase',record_id:art.recordId,after_id:null})])
 assert.equal(purchases.records[0].purchase_count,1)
 assert.deepEqual(await f.requirementRows(),before,'needs and stock allocations are not rewritten')
 await assert.rejects(f.rpc('bob.material_requirement_command',[f.project,'publish',f.a,1,'{}']),/pack_requirement_claimed/)
 await f.command(art.recordId,'withdraw',1,[])
 assert.equal((await f.pg.query('select qty from bob.materials where id=$1',[rows[0].id])).rows[0].qty,'0 pack')
 assert.equal((await f.rpc('bob.read_pack_purchase',[f.project,art.recordId,1])).purchase_count,1,'history stays readable')
})

test('unknown pack size stays unresolved and cannot publish; unsupported pack claims are rejected',async t=>{
 const f=await fixture(t),art=await f.article({content_per_purchase_unit:null,supported_fields:['title','article_number']})
 const q=await f.quote(art.recordId)
 assert.equal(q.pack_state,'unknown');assert.equal(q.purchase_count,null);assert.equal(q.surplus_quantity,null);assert.equal(Number(q.total_quantity),90)
 await assert.rejects(f.write(f.purchase(art.recordId)),/pack_size_unknown/)
 await assert.rejects(f.article({supported_fields:['title']}),/check constraint|violates/)
 await assert.rejects(f.article({source_url:null,source_document:''}),/check constraint|violates/)
 await assert.rejects(f.article({content_per_purchase_unit:'12.5'}),/check constraint|violates/)
 await assert.rejects(f.article({catalog_item_id:randomUUID()}),/catalog_unavailable/)
 assert.equal((await f.pg.query('select count(*)::int n from bob.materials')).rows[0].n,0)
})

test('incompatible units, competing articles and legacy Shopping routes cannot double count a need',async t=>{
 const f=await fixture(t),art=await f.article(),rival=await f.article({article_number:'WS-550-B',variant:'Stainless'})
 const metres=await f.need('Edge banding','3',[],'m')
 await assert.rejects(f.quote(art.recordId,f.needs(f.a,metres)),/pack_unit_mismatch/)
 await assert.rejects(f.quote(art.recordId,[{id:f.a,revision:1},{id:f.a,revision:1}]),/pack_purchase_invalid/)
 await f.command(art.recordId)
 await assert.rejects(f.command(rival.recordId,'publish',0,f.needs(f.b)),/pack_requirement_claimed/)
 const legacy=await f.need('Screws shelf C')
 await f.rpc('bob.material_requirement_command',[f.project,'publish',legacy,1,'{}'])
 await assert.rejects(f.command(rival.recordId,'publish',0,f.needs(legacy)),/pack_requirement_in_shopping/)
 await f.command(art.recordId,'withdraw',1,[])
 const free=await f.command(rival.recordId,'publish',0,f.needs(f.b))
 assert.equal(free.purchase_count,1);assert.equal(Number(free.surplus_quantity),40)
})

test('changed evidence, needs, manual edits and ordered rows never silently rewrite a purchase',async t=>{
 const f=await fixture(t),art=await f.article(),first=await f.command(art.recordId)
 await assert.rejects(f.command(art.recordId,'publish',0),/pack_purchase_changed/)
 await f.rpc('bob.supplier_article_command',[f.project,'revise',art.recordId,1,JSON.stringify(f.fields({title:art.record.title,content_per_purchase_unit:'50',change_note:'Supplier now sells 50-packs'}))])
 assert.equal((await f.rpc('bob.read_pack_purchase',[f.project,art.recordId,null])).source_state,'changed')
 assert.equal((await f.rpc('bob.read_pack_purchase',[f.project,art.recordId,null])).shopping_ready,false)
 await assert.rejects(f.command(art.recordId,'publish',1),/supplier_article_changed/)
 await f.pg.query("update bob.materials set status='ordered' where id=$1",[first.material_id])
 await assert.rejects(f.command(art.recordId,'publish',1,f.needs(f.a,f.b),2),/pack_purchase_shopping_committed/)
 assert.equal((await f.pg.query('select qty from bob.materials where id=$1',[first.material_id])).rows[0].qty,'1 pack')
 await f.pg.query("update bob.materials set status='needed',qty='3 pack' where id=$1",[first.material_id])
 await assert.rejects(f.command(art.recordId,'publish',1,f.needs(f.a,f.b),2),/pack_purchase_shopping_edited/)
 await f.pg.query("update bob.materials set qty='1 pack' where id=$1",[first.material_id])
 const republished=await f.command(art.recordId,'publish',1,f.needs(f.a,f.b),2)
 assert.equal(republished.purchase_count,2);assert.equal(Number(republished.surplus_quantity),10);assert.equal(republished.source_state,'current')
 await f.rpc('bob.material_requirement_command',[f.project,'revise',f.b,1,JSON.stringify({name:'Screws shelf B',category:'Fasteners & glue',area_id:null,task_id:null,unit:'pcs',required_quantity:'80',waste_percent:'0',purchase_increment:'1',basis:'Recounted',assumptions:'',artifact_id:null,artifact_revision:null,target_revision:1,stock_allocations:[],component_allocations:[],change_note:'Recount'})])
 assert.equal((await f.rpc('bob.read_pack_purchase',[f.project,art.recordId,null])).source_state,'changed')
 await assert.rejects(f.command(art.recordId,'publish',2,f.needs(f.a,f.b),2),/pack_requirement_changed/)
 await f.pg.query('delete from bob.materials where id=$1',[first.material_id])
 await assert.rejects(f.command(art.recordId,'publish',2,[{id:f.a,revision:1},{id:f.b,revision:2}],2),/pack_purchase_shopping_missing/)
 await f.rpc('bob.supplier_article_command',[f.project,'withdraw',art.recordId,2,JSON.stringify({change_note:'Article discontinued'})])
 assert.equal((await f.rpc('bob.read_supplier_article',[f.project,art.recordId,null])).source_state,'withdrawn')
 await assert.rejects(f.command(art.recordId,'publish',2,[{id:f.a,revision:1},{id:f.b,revision:2}],3),/supplier_article_withdrawn/)
})

test('outsiders, anonymous callers and direct table writes are denied',async t=>{
 const f=await fixture(t),art=await f.article()
 await f.command(art.recordId)
 await assert.rejects(f.command(art.recordId,'withdraw',1,[],1,f.other),/project_denied/)
 await assert.rejects(f.rpc('bob.read_pack_purchase',[f.project,art.recordId,null],f.other),/project_denied/)
 await assert.rejects(f.quote(art.recordId).then(()=>f.rpc('bob.pack_purchase_quote',[f.project,art.recordId,1,JSON.stringify(f.needs(f.a))],f.other)),/project_denied/)
 await assert.rejects(f.rpc('bob.read_supplier_article',[f.project,art.recordId,null],null,'anon'),/permission denied/)
 await assert.rejects(f.write(f.purchase(art.recordId,'withdraw',1,[]),f.other),/project_denied|turn_not_claimed/)
 for(const table of ['supplier_articles','supplier_article_revisions','pack_purchases','pack_purchase_revisions','pack_purchase_needs']){
  assert.equal((await asProjectUser(f.pg,f.other,`select * from bob.${table}`)).rows.length,0)
  await assert.rejects(asProjectUser(f.pg,f.user,`delete from bob.${table}`),/permission denied/)
 }
})

test('Bob tool parser routes product and pack_purchase commands with exact keys only',()=>{
 const aid=randomUUID(),common={request_quote:'Buy screws',expected_updated_at:null}
 const pub=parseOperationalWrite('manage_project_material',{...common,resource:'pack_purchase',action:'publish',record_id:aid,expected_revision:1,data:{purchase_revision:0,needs:[{id:aid,revision:1}],change_note:'x'}})
 assert.equal(pub?.kind,'pack_purchase');assert.deepEqual(pub?.data,{action:'publish',purchase_revision:0,needs:[{id:aid,revision:1}],change_note:'x'})
 assert.equal(parseOperationalWrite('manage_project_material',{...common,resource:'pack_purchase',action:'publish',record_id:aid,expected_revision:1,data:{purchase_revision:0,needs:[],change_note:'x',quantity:5}}),null)
 const created=parseOperationalWrite('manage_project_material',{...common,resource:'product',action:'create',record_id:null,expected_revision:0,data:{title:'x'}})
 assert.equal(created?.kind,'supplier_article');assert.deepEqual(created?.data,{action:'create',fields:{title:'x'}})
 assert.equal(parseOperationalWrite('manage_project_material',{...common,resource:'product',action:'publish',record_id:aid,expected_revision:1,data:{}}),null)
})
