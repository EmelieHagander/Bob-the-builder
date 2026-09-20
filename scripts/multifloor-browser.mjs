import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
// Browser/provider fixtures only. Real SQL and tool orchestration are independently tested.
export function createMultifloorFixture(timestamp,artifacts,solutions){
 const details=new Map(),messages=[],thread=randomUUID(),id=n=>'75000000-0000-4000-8000-'+String(n).padStart(12,'0')
 const rect=(x,y,w,d)=>({x_mm:x,y_mm:y,width_mm:w,depth_mm:d})
 let active=false,mode='create',planId=null
 const fixture={details,sourcesChanged:false,unavailable:false,id,get planId(){return planId},activate(){active=true},setMode(v){mode=v},
 async handle(req,url,respond){
  if(!active)return false
  const table=url.pathname.split('/').at(-1),eq=k=>url.searchParams.get(k)?.replace(/^eq\./,'')
  const reply=async json=>{await respond({json});return true}
  if(table==='bob_threads')return reply(eq('project_id')==='A'?{id:thread,next_seq:messages.length+1}:null)
  if(table==='bob_messages')return reply(eq('thread_id')===thread?messages:[])
  if(table==='artifact_multifloor_details'){
   const d=details.get(`${eq('artifact_id')}:${eq('artifact_revision')}`)
   return reply(d&&eq('project_id')==='A'&&!fixture.unavailable?{...d,sources_changed:fixture.sourcesChanged}:null)
  }
  if(url.pathname!=='/functions/v1/ask-bob')return false
  const body=req.postDataJSON();assert.equal(body.action,'send');assert.equal(body.projectId,'A');assert(body.clientTurnId)
  const t=solutions.decisions.at(-1),s=solutions.histories.get(t.solution_id)?.find(r=>r.revision===t.solution_revision)
  let row,d
  if(mode==='create'){
   assert.equal(body.message,'Rita testhusets två våningar med gemensamma koordinater.')
   planId=randomUUID()
   row={id:planId,artifact_id:planId,project_id:'A',area_id:'areaA',revision:1,kind:'plan',title:'Shared floor coordinates',description:'Two floors from the same datum.',status:'concept',
    assumptions:'Synthetic coordinates, not the user’s house.',source_media_id:null,source_media_title:'',target_revision:t.revision,solution_id:t.solution_id,solution_revision:t.solution_revision,solution_title:s.title,
    archived:false,change_note:'Bob created coordinate study',actor_label:'Bob fixture',recorded_at:timestamp(),measurements:[],generator:null,generator_version:null,has_multifloor_plan:true}
   const recipe={generator:'multifloor_v1',version:1,building_id:id(1),building_revision:1,frame:'east_north_up',origin:'Synthetic SW corner, z=ground finished floor; same datum for both floors.',
    levels:[{level_id:id(2),level_revision:1,bounds:rect(0,0,9000,5000),wall_mm:300,floor_z_mm:0,slab_mm:null,basis:'estimated',source:'Test dimensions'},
     {level_id:id(3),level_revision:1,bounds:rect(0,0,9000,5000),wall_mm:300,floor_z_mm:2800,slab_mm:250,basis:'estimated',source:'Test dimensions'}],
    spaces:[{space_id:id(4),space_revision:1,level_id:id(2),bounds:rect(300,300,4000,4400),basis:'estimated',source:'Test layout'},
     {space_id:id(5),space_revision:1,level_id:id(2),bounds:rect(4420,300,4280,4400),basis:'estimated',source:'Test layout'},
     {space_id:id(6),space_revision:1,level_id:id(3),bounds:rect(300,300,4000,4400),basis:'estimated',source:'Test layout'},
     {space_id:id(7),space_revision:1,level_id:id(3),bounds:rect(4420,300,4280,4400),basis:'estimated',source:'Test layout'}],
    probes:[{key:'study',label:'Study area · not a stair design',from_level_id:id(2),to_level_id:id(3),bounds:rect(5000,1000,1000,2000)}]}
   d={project_id:'A',artifact_id:planId,artifact_revision:1,building_id:id(1),recipe,
    names:{[id(1)]:'Test house',[id(2)]:'Ground floor',[id(3)]:'Upper floor',[id(4)]:'Living zone',[id(5)]:'Kitchen zone',[id(6)]:'Bedroom',[id(7)]:'Landing'},sources_changed:false,physical_pending:false}
  }else{
   const old=artifacts.records.get(planId);row={...old,revision:old.revision+1,recorded_at:timestamp()};d=structuredClone(details.get(`${planId}:${old.revision}`));d.artifact_revision=row.revision
   if(mode==='height'){assert.equal(body.message,'Sätt övervåningens golvhöjd till 2900 mm.');d.recipe.levels[1].floor_z_mm=2900}
   else if(mode==='unknown'){assert.equal(body.message,'Golvhöjden uppe är inte känd, lämna den okänd i testet.');d.recipe.levels[1].floor_z_mm=null}
   else{assert.equal(body.message,'Flytta undersökningsytan västerut till x 3500 och gör den 2000 mm bred.');d.recipe.probes[0].bounds.x_mm=3500;d.recipe.probes[0].bounds.width_mm=2000}
  }
  artifacts.records.set(planId,row);artifacts.histories.set(planId,[...(artifacts.histories.get(planId)??[]),structuredClone(row)]);details.set(`${planId}:${row.revision}`,d)
  const evidence={kind:'ai_assessment',sources:[],partial:false,writes:[{projectId:'A',dataset:'artifacts',recordId:planId,label:row.title,operation:row.revision===1?'created':'updated',savedAt:timestamp(),revision:row.revision,areaId:'areaA'}]}
  const summary='Koordinatstudien är sparad. Projektionen är inte en beräknad trappa.'
  const seq=messages.length+1;messages.push({role:'user',text:body.message,delivery_state:'completed',seq,turn_id:body.clientTurnId},{role:'assistant',text:summary,evidence,delivery_state:'completed',seq:seq+1,turn_id:body.clientTurnId})
  return reply({ok:true,status:'completed',projectId:'A',summary,evidence})
 }}
 return fixture
}
export async function verifyMultifloorBrowser(page,base,fixture,width){
 fixture.activate()
 const ask=async(message,revision)=>{
  await page.getByRole('button',{name:'Ask bob',exact:true}).click()
  const chat=page.getByRole('complementary',{name:'Ask bob for Porch A',exact:true})
  await page.waitForFunction(()=>!document.querySelector('.bob-toolbar button')?.disabled)
  await chat.getByLabel('Question for bob',{exact:true}).fill(message)
  await chat.getByRole('button',{name:'Send',exact:true}).click()
  await chat.getByRole('link',{name:`Open drawing · v${revision}`,exact:true}).last().click();await chat.waitFor({state:'hidden'})
  const dialog=page.getByRole('dialog',{name:`Shared floor coordinates · Version ${revision}`,exact:true})
  await dialog.getByRole('region',{name:'Multi-floor coordinate plan',exact:true}).waitFor()
  return dialog
 }
 await page.goto(base+'#/artifacts?area=areaA')
 let dialog=await ask('Rita testhusets två våningar med gemensamma koordinater.',1)
 const original=structuredClone(fixture.details.get(`${fixture.planId}:1`).recipe)
 await dialog.getByText('8400 × 4400 mm',{exact:true}).waitFor()
 const projection=()=>dialog.getByLabel('Projection study',{exact:true})
 await projection().getByText('Target mapped footprints: Landing (contains study area)',{exact:true}).waitFor()
 for(const name of ['Ground floor','Upper floor','Height comparison']){
  await dialog.getByRole('button',{name,exact:true}).click();await dialog.locator('svg').waitFor()
 }
 await dialog.getByRole('button',{name:'Upper floor',exact:true}).click()
 const viewport=dialog.getByLabel('Coordinate plan viewport',{exact:true})
 assert(await viewport.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Full coordinate overview fits phone')
 await dialog.getByRole('button',{name:'Zoom coordinate plan in',exact:true}).click()
 assert(await viewport.evaluate(el=>el.scrollWidth>el.clientWidth),'Details scroll only inside drawing')
 await dialog.getByRole('button',{name:'Fit plan',exact:true}).click()
 for(const button of await dialog.locator('.box-drawing').getByRole('button').all()){
  const b=await button.boundingBox();assert(!b||b.width>=44&&b.height>=44)
 }
 const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Save coordinate SVG',exact:true}).click()
 const file=await download;assert(file.suggestedFilename().includes('-r1-'))
 const svg=await readFile(await file.path(),'utf8');assert.match(svg,/Inside E–W 8400/);assert.match(svg,/NOT TO SCALE/)
 await page.screenshot({path:`test-results/multifloor-${width}.png`})
 await dialog.getByRole('button',{name:'Close',exact:true}).click()
 fixture.setMode('height');dialog=await ask('Sätt övervåningens golvhöjd till 2900 mm.',2)
 await projection().getByText('Floor-height difference: 2900 mm. Lower floor to upper slab underside: 2650 mm.',{exact:true}).waitFor()
 assert.deepEqual(fixture.details.get(`${fixture.planId}:2`).recipe.spaces,original.spaces)
 await dialog.getByRole('button',{name:'Close',exact:true}).click()
 fixture.setMode('move');dialog=await ask('Flytta undersökningsytan västerut till x 3500 och gör den 2000 mm bred.',3)
 await projection().getByText('Target mapped footprints: Bedroom (partial overlap), Landing (partial overlap)',{exact:true}).waitFor()
 assert.deepEqual(fixture.details.get(`${fixture.planId}:1`).recipe,original)
 await dialog.getByRole('button',{name:'Close',exact:true}).click()
 fixture.setMode('unknown');dialog=await ask('Golvhöjden uppe är inte känd, lämna den okänd i testet.',4)
 await projection().getByText('Floor-height difference: Unknown. Lower floor to upper slab underside: Unknown.',{exact:true}).waitFor()
 await dialog.getByRole('button',{name:'Close',exact:true}).click()
 await page.goto(base+`#/artifacts?area=areaA&drawing=${fixture.planId}&revision=1`);await page.reload()
 dialog=page.getByRole('dialog',{name:'Shared floor coordinates · Version 1',exact:true})
 await projection().getByText('Floor-height difference: 2800 mm. Lower floor to upper slab underside: 2550 mm.',{exact:true}).waitFor()
 fixture.sourcesChanged=true;await page.reload();await dialog.getByText(/Sources changed\. These are the saved coordinates/).waitFor()
 fixture.unavailable=true;await page.reload();await dialog.getByRole('alert').getByText(/Cannot display coordinate plan/).waitFor()
 assert.equal(await dialog.locator('svg').count(),0)
 await dialog.getByRole('button',{name:'Close',exact:true}).click()
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow')
 console.log(`Multi-floor chat/create/height/projection/unknown/reload/history/SVG/source denial passed at ${width}px; HTTP/provider fixtures.`)
}
