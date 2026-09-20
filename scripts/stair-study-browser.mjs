import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
// Synthetic HTTP/provider replies. Production viewer/data adapter remains real;
// the mathematical tool and SQL integration have separate tests.
export function createStairFixture(timestamp,artifacts,multifloor){
 const details=new Map(),messages=[],thread=randomUUID()
 let active=false,mode='create',stairId=null,sourceId=null
 const fixture={details,sourceChanged:false,unavailable:false,get stairId(){return stairId},setMode(m){mode=m},activate(){
  active=true
  // Reuse the prior synthetic multi-floor geometry under a fresh current source
  // identity; that earlier test intentionally ends with unknown floor heights.
  sourceId=randomUUID()
  const src=structuredClone(multifloor.details.get(`${multifloor.planId}:1`));src.artifact_id=sourceId
  multifloor.details.set(`${sourceId}:1`,src);multifloor.unavailable=false;multifloor.sourcesChanged=false
  const original=artifacts.histories.get(multifloor.planId)[0]
  const row={...original,id:sourceId,artifact_id:sourceId,title:'Stair source coordinates'}
  artifacts.records.set(sourceId,row);artifacts.histories.set(sourceId,[structuredClone(row)])
 },async handle(req,url,respond){
  if(!active)return false
  const table=url.pathname.split('/').at(-1),eq=k=>url.searchParams.get(k)?.replace(/^eq\./,'')
  const reply=async json=>{await respond({json});return true}
  if(table==='bob_threads')return reply(eq('project_id')==='A'?{id:thread,next_seq:messages.length+1}:null)
  if(table==='bob_messages')return reply(eq('thread_id')===thread?messages:[])
  if(table==='artifact_stair_details'){
   const d=details.get(`${eq('artifact_id')}:${eq('artifact_revision')}`)
   return reply(d&&eq('project_id')==='A'&&!fixture.unavailable?{...d,sources_changed:fixture.sourceChanged}:null)
  }
  if(url.pathname!=='/functions/v1/ask-bob')return false
  const body=req.postDataJSON();assert.equal(body.action,'send');assert.equal(body.projectId,'A')
  if(mode==='inspect'){
   assert.equal(body.message,'Jämför en rak trappa och en kvartssväng utan att spara.')
   assert.equal(stairId,null)
   const summary='Jämförelsen är beräknad utan att spara. Kvartssvängens utlopp: x 4910 / y 3610 mm åt öster. Inte en byggsäkerhetskontroll.'
   const seq=messages.length+1;messages.push({role:'user',text:body.message,delivery_state:'completed',seq,turn_id:body.clientTurnId},{role:'assistant',text:summary,delivery_state:'completed',seq:seq+1,turn_id:body.clientTurnId,evidence:{kind:'ai_assessment',sources:[],partial:false}})
   return reply({ok:true,status:'completed',projectId:'A',summary,evidence:{kind:'ai_assessment',sources:[],partial:false}})
  }
  let row,d
  if(mode==='create'){
   assert.equal(body.message,'Rita och spara kvartssvängen med vilplan.')
   stairId=randomUUID();const parent=artifacts.records.get(sourceId),src=multifloor.details.get(`${sourceId}:1`)
   const recipe={generator:'stair_study_v1',version:1,from_level_id:src.recipe.levels[0].level_id,to_level_id:src.recipe.levels[1].level_id,start_x_mm:2500,start_y_mm:1200,
    heading:'north',turn:'right',risers:16,first_flight_risers:8,width_mm:900,going_mm:280,landing_depth_mm:900,opening:{x_mm:2050,y_mm:2040,width_mm:2860,depth_mm:2020},
    required_headroom_mm:2000,upper_ceiling_above_floor_mm:2400,basis:'estimated',source:'Synthetic test, not the user house.'}
   row={...parent,id:stairId,artifact_id:stairId,title:'Calculated stair',description:'Quarter-turn study with square landing',assumptions:'Synthetic geometry only',has_multifloor_plan:false,has_stair_study:true,revision:1,recorded_at:timestamp()}
   d={project_id:'A',artifact_id:stairId,artifact_revision:1,building_id:src.building_id,plan_id:sourceId,plan_revision:1,recipe,sources_changed:false,plan:structuredClone(src)}
  }else{
   const old=artifacts.records.get(stairId);row={...old,revision:old.revision+1,recorded_at:timestamp()};d=structuredClone(details.get(`${stairId}:${old.revision}`));d.artifact_revision=row.revision
   if(mode==='move'){
    assert.equal(body.message,'Flytta trappan 500 mm åt öster, behåll resten.')
    d.recipe.start_x_mm+=500;d.recipe.opening.x_mm+=500
   }else if(mode==='opening'){
    assert.equal(body.message,'Pröva trapphålet 100 mm smalare på västra sidan.')
    d.recipe.opening.x_mm+=100;d.recipe.opening.width_mm-=100
   }else if(mode==='ceiling'){
    assert.equal(body.message,'Markera takhöjden ovanför trappan som okänd.')
    d.recipe.upper_ceiling_above_floor_mm=null
   }else throw new Error('Unexpected stair mode')
  }
  artifacts.records.set(stairId,row);artifacts.histories.set(stairId,[...(artifacts.histories.get(stairId)??[]),structuredClone(row)]);details.set(`${stairId}:${row.revision}`,d)
  const evidence={kind:'ai_assessment',sources:[],partial:false,writes:[{projectId:'A',dataset:'artifacts',recordId:stairId,label:row.title,operation:row.revision===1?'created':'updated',savedAt:timestamp(),revision:row.revision,areaId:'areaA'}]}
  const seq=messages.length+1,summary='Trappstudien är sparad. Se ritningens beräknade utlopp och begränsade kontroller.'
  messages.push({role:'user',text:body.message,delivery_state:'completed',seq,turn_id:body.clientTurnId},{role:'assistant',text:summary,evidence,delivery_state:'completed',seq:seq+1,turn_id:body.clientTurnId})
  return reply({ok:true,status:'completed',projectId:'A',summary,evidence})
 }}
 return fixture
}
export async function verifyStairBrowser(page,base,fixture,artifacts,width){
 fixture.activate()
 await page.goto(base+'#/artifacts?area=areaA')
 const ask=async(message,revision=null)=>{
  await page.getByRole('button',{name:'Ask bob',exact:true}).click()
  const chat=page.getByRole('complementary',{name:'Ask bob for Porch A',exact:true})
  await page.waitForFunction(()=>!document.querySelector('.bob-toolbar button')?.disabled)
  const links=chat.getByRole('link',{name:/^Open drawing/}),count=await links.count()
  await chat.getByLabel('Question for bob',{exact:true}).fill(message);await chat.getByRole('button',{name:'Send',exact:true}).click()
  if(revision===null){await chat.getByText(/Jämförelsen är beräknad utan att spara/).waitFor();assert.equal(await links.count(),count);await chat.getByRole('button',{name:'Close Ask bob',exact:true}).click();return null}
  await links.nth(count).waitFor();await links.nth(count).click();await chat.waitFor({state:'hidden'})
  const d=page.getByRole('dialog',{name:`Calculated stair · Version ${revision}`,exact:true});await d.getByRole('region',{name:'Stair study',exact:true}).waitFor();return d
 }
 fixture.setMode('inspect');const before=artifacts.records.size;await ask('Jämför en rak trappa och en kvartssväng utan att spara.')
 assert.equal(artifacts.records.size,before,'Read-only comparison cannot save a study')
 fixture.setMode('create');let d=await ask('Rita och spara kvartssvängen med vilplan.',1)
 await d.getByText('4910 / 3610 mm · east',{exact:true}).waitFor();await d.getByText('2800 mm / 16 × 175 mm',{exact:true}).waitFor()
 await d.getByText('Landing (contains landing)',{exact:false}).waitFor()
 for(const label of ['Lower plan','Upper plan','Walking section']){await d.getByRole('button',{name:label,exact:true}).click();await d.locator('svg').waitFor()}
 await d.getByRole('button',{name:'Upper plan',exact:true}).click()
 const viewport=d.getByLabel('Stair drawing viewport',{exact:true})
 assert(await viewport.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
 await d.getByRole('button',{name:'Zoom stair in',exact:true}).click();assert(await viewport.evaluate(el=>el.scrollWidth>el.clientWidth))
 await d.getByRole('button',{name:'Fit stair',exact:true}).click()
 for(const button of await d.locator('.box-drawing').getByRole('button').all()){
  const b=await button.boundingBox();assert(!b||b.width>=44&&b.height>=44)
 }
 const download=page.waitForEvent('download');await d.getByRole('button',{name:'Save stair SVG',exact:true}).click()
 const file=await download;assert(file.suggestedFilename().includes('-r1-stair-upper.svg'))
 const svg=await readFile(await file.path(),'utf8');assert.match(svg,/4910 \/ 3610/);assert.match(svg,/NOT TO SCALE/)
 await page.screenshot({path:`test-results/stair-study-${width}.png`})
 await d.getByRole('button',{name:'Walking section',exact:true}).click();await page.screenshot({path:`test-results/stair-section-${width}.png`})
 await d.getByRole('button',{name:'Close',exact:true}).click()
 const original=structuredClone(fixture.details.get(`${fixture.stairId}:1`))
 fixture.setMode('move');d=await ask('Flytta trappan 500 mm åt öster, behåll resten.',2)
 await d.getByText('5410 / 3610 mm · east',{exact:true}).waitFor();assert.deepEqual(fixture.details.get(`${fixture.stairId}:2`).plan,original.plan)
 await d.getByRole('button',{name:'Close',exact:true}).click()
 fixture.setMode('opening');d=await ask('Pröva trapphålet 100 mm smalare på västra sidan.',3)
 await d.getByRole('status',{name:'Stair check results'}).getByText(/modelled headroom below requested/).waitFor()
 await d.getByRole('button',{name:'Close',exact:true}).click()
 fixture.setMode('ceiling');d=await ask('Markera takhöjden ovanför trappan som okänd.',4)
 await d.getByText('Unknown / needs review: upper ceiling',{exact:true}).waitFor();await d.getByRole('button',{name:'Close',exact:true}).click()
 await page.goto(base+`#/artifacts?area=areaA&drawing=${fixture.stairId}&revision=1`);await page.reload()
 d=page.getByRole('dialog',{name:'Calculated stair · Version 1',exact:true});await d.getByText('4910 / 3610 mm · east',{exact:true}).waitFor()
 assert.deepEqual(fixture.details.get(`${fixture.stairId}:1`),original)
 fixture.sourceChanged=true;await page.reload();await d.getByText(/Source plan changed\. This drawing retains/).waitFor()
 fixture.unavailable=true;await page.reload();await d.getByRole('alert').getByText(/Cannot display stair study/).waitFor();assert.equal(await d.locator('svg').count(),0)
 await d.getByRole('button',{name:'Close',exact:true}).click()
 await page.getByRole('article',{name:'Calculated stair',exact:true}).getByText('Stair study',{exact:true}).waitFor()
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
 console.log(`Stair comparison/chat/save/move/whole-tread-headroom/unknown/history/SVG/source-denial passed at ${width}px; HTTP/provider fixtures.`)
}
