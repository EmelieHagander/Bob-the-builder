import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {projectSchema} from './support/project-schema.ts'
import {catalogFixture,preToolPickerCatalogFixture} from './support/ai-catalog-fixture.ts'
import {createMediaAdapter,imageDescriptionText,AUTO_DESCRIBE_BATCH,type MediaRow,type MediaTransport} from '../supabase/functions/_shared/project-context/media.ts'
import {createProjectContext,type ContextAdapter,type Item} from '../supabase/functions/_shared/project-context/dispatcher.ts'
import {BobContinuation} from '../supabase/functions/_shared/bob-job-journal.ts'

// Owner decision 2026-11-06: Bob sees a short description first, opens only what
// he needs, and the description stays after the pixels leave. Dimensions only
// when written in the image (choice C). Smallest vision tier.

test('the describer is a small read-only Haiku-tier role whose contract allows only written dimensions',()=>{
 const catalog=catalogFixture(),role=catalog.role('image-describer')
 // Production binds the nano tier to Claude Haiku; the fixture keeps its own model rows.
 assert.equal(catalog.definition('profile.image-describer').definition.tier,'nano');assert.equal(role.tier,'nano')
 assert.equal(role.model.model_name,catalog.definition('tier.nano').definition.model_name)
 assert.equal(role.maxOutputTokens,300);assert.equal(role.reasoningEffort,'low');assert.equal(role.timeoutMs,30000)
 assert.equal(role.definition.definition.tool_keys.length,0)
 assert.equal(catalog.definition('agent-contract.image-describer').definition.writes,'none')
 const contract=catalog.text('image-describer.contract')
 assert.match(contract,/only when it is written in the image itself/);assert.match(contract,/Never estimate sizes/);assert.match(contract,/never identify people/)
 assert.deepEqual((catalog.definition('schema.bob_image_description').definition as any).required,['description'])
 assert.equal(preToolPickerCatalogFixture().manifest().definitions.some(row=>row.prompt_key==='role.image-describer'),false)
})

test('the publication only adds the describer, keeps every prior version and refuses a second run',async t=>{
 const migration='20261106180000_bob_image_describer_catalog.sql';let prior:any[]=[]
 const read=async(pg:any)=>(await pg.query("select p.prompt_key,v.id,v.version from shared.ai_prompts p join shared.ai_prompt_versions v on v.id=p.active_version_id where p.app='bob' order by p.prompt_key")).rows
 const pg=await projectSchema(async(db,name)=>{if(name===migration)prior=await read(db)},migration);t.after(()=>pg.close())
 const current=await read(pg)
 assert.deepEqual(current.filter((r:any)=>!prior.some(p=>p.prompt_key===r.prompt_key&&p.id===r.id)).map((r:any)=>r.prompt_key).sort(),
  ['agent-contract.image-describer','image-describer.contract','image-describer.persona','profile.image-describer','role.image-describer','schema.bob_image_description'])
 assert.equal((await pg.query("select count(*)::int n from shared.ai_settings where app='bob' and function_name='image-describer'")).rows[0].n,1)
 await assert.rejects(pg.exec(readFileSync('supabase/migrations/'+migration,'utf8')),/image_describer_already_published/)
})

test('only a short, structured description is accepted',()=>{
 assert.equal(imageDescriptionText({success:true,data:{description:'  Entré  framifrån\ninnan påbyggnad '}}),'Entré framifrån innan påbyggnad')
 assert.equal(imageDescriptionText({success:true,data:'{"description":"Ritning, fönster 42 × 117 cm"}'}),'Ritning, fönster 42 × 117 cm')
 for(const data of [{description:''},{description:'x'.repeat(161)},{other:'a'},'not json',null])assert.equal(imageDescriptionText({success:true,data}),null)
 assert.equal(imageDescriptionText({success:false,data:{description:'Entré'}}),null)
})

const project='p'
const row=(n:number):MediaRow=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,project_id:project,title:'Bild '+n,purpose:'reference',content_type:'image/jpeg',
 byte_size:10,width:100,height:100,state:'ready',updated_at:'2026-11-06T00:00:00Z',created_at:'2026-11-06T00:00:00Z',bucket_id:'bob-project-media',
 object_path:`${project}/00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,source_kind:'owner_upload',media_links:[]})
const transport=(rows:MediaRow[],cached:Map<string,string>):MediaTransport=>({
 count:async()=>rows.length,list:async()=>rows,read:async id=>rows.find(r=>r.id===id)??null,download:async()=>assert.fail('deferred pixels are never downloaded'),
 descriptions:async ids=>ids.filter(id=>cached.has(id)).map(id=>({media_id:id,description:cached.get(id)!,source_version:JSON.stringify(['2026-11-06T00:00:00Z','image/jpeg',10,100,100,rows.find(r=>r.id===id)!.title,'reference','owner_upload',[]])})),
})

test('missing descriptions are made for at most one batch per listing; failures stay undescribed and continuations propagate',async()=>{
 const rows=Array.from({length:9},(_,i)=>row(i+1)),cached=new Map([[rows[0].id,'Entré framifrån innan påbyggnad']]),asked:string[]=[]
 const adapter=createMediaAdapter(project,transport(rows,cached),true,async item=>{asked.push(item.ref);return item.ref.endsWith('3')?null:item.ref.endsWith('4')?(()=>{throw Error('model down')})():'Beskriven '+item.title})
 const listed=await adapter.list({category:'images',query:null,area_id:null,after_id:null},AbortSignal.timeout(1000))
 assert.equal(listed.items[0].description&&(listed.items[0].description as any).text,'Entré framifrån innan påbyggnad')
 const items=await adapter.describeMissing!(listed.items,AbortSignal.timeout(1000))
 assert.equal(asked.length,AUTO_DESCRIBE_BATCH);assert(!asked.includes(listed.items[0].ref),'an existing description is reused')
 assert.equal((items[1].description as any).text,'Beskriven Bild 2');assert.equal((items[1].description as any).verified,false)
 assert.equal(items[2].description,undefined);assert.equal(items[3].description,undefined);assert.equal(items[8].description,undefined,'the rest wait for a later listing')
 const stop=createMediaAdapter(project,transport(rows,new Map()),true,async()=>{throw new BobContinuation('yield')})
 await assert.rejects(stop.describeMissing!(listed.items,AbortSignal.timeout(1000)),(e:unknown)=>e instanceof BobContinuation)
 assert.equal(createMediaAdapter(project,transport(rows,cached),true).describeMissing,undefined,'jobs without the pin describe nothing')
 // An opened image carries its description, so it remains after the pixels leave.
 const opened=await adapter.open(listed.items[0].ref,AbortSignal.timeout(1000))
 assert.equal((opened.item.description as any).text,'Entré framifrån innan påbyggnad');assert.match(opened.image.image_url,/^private-image:/)
})

const fake=(describe:(items:Item[])=>Promise<Item[]>):ContextAdapter=>({category:'images',prefix:'image',checkpointed:false,
 count:async()=>1,list:async()=>({items:[{ref:'image:a',title:'Foto'}],next_cursor:null}),describeMissing:describe,
 open:async ref=>({item:{ref,title:'Foto',description:{text:'Entré framifrån',source:'ai_visual_observation',verified:false}},bytes:1,version:'v',
  image:{type:'image_url',image_url:'private-image:a/v'},source:{projectId:project,dataset:'image_pixels',recordId:'a',label:'Bild',retrievedAt:'t',updatedAt:'t',truth:'unknown'} as any}),
 current:async()=>true})
const context=(adapter:ContextAdapter)=>createProjectContext({unlimitedWork:true,adapters:[adapter],hasAccess:async()=>true,sources:[],imageEvidenceInstruction:'Bilder.'} as any)

test('listing describes after the metadata read and stays usable when describing fails; the opened text carries the description',async()=>{
 const ok=context(fake(async items=>items.map(i=>({...i,description:{text:'Entré framifrån'}}))))
 const listed:any=await ok.execute('list_project_category',{category:'images',query:null,area_id:null,after_id:null})
 assert.equal(listed.status,'ok');assert.equal(listed.items[0].description.text,'Entré framifrån')
 const failing:any=await context(fake(async()=>{throw Error('down')})).execute('list_project_category',{category:'images',query:null,area_id:null,after_id:null})
 assert.equal(failing.status,'ok');assert.equal(failing.items[0].description,undefined)
 await ok.execute('open_project_item',{refs:['image:a']})
 const text=JSON.stringify(ok.carrier())
 assert.match(text,/Entré framifrån/);assert.match(text,/private-image:a\/v/)
})
