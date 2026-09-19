import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

/** HTTP fixtures only; real SQL + tool-loop integration lives in room-layout-db.test.ts. */
export function createRoomLayoutFixture(timestamp, artifacts, solutions) {
  const layouts = new Map(), messages = [], thread = randomUUID()
  const physicalId = n => '65000000-0000-4000-8000-' + String(n).padStart(12,'0')
  let planId = null, request = 'create', furnitureId = null
  const fixture = { layouts, messages, sourcesChanged:false, unavailable:false,
    setRequest(value) { request=value },
    get planId() { return planId },
    async handle(req,url,respond) {
      const name=url.pathname.split('/').at(-1),eq=k=>url.searchParams.get(k)?.replace(/^eq\./,'')
      const reply=async json=>{await respond({json});return true}
      if(name==='bob_threads') return reply(eq('project_id')==='A'?{id:thread,next_seq:messages.length+1}:null)
      if(name==='bob_messages') return reply(eq('thread_id')===thread?messages:[])
      if(name==='artifact_room_layout_details') {
        const d=layouts.get(`${eq('artifact_id')}:${eq('artifact_revision')}`)
        return reply(d && eq('project_id')==='A' && !fixture.unavailable ? {...d,
          current_furniture_revision:d.furniture_revision+(fixture.sourcesChanged?1:0)}:null)
      }
      if(url.pathname!=='/functions/v1/ask-bob') return false
      const body=req.postDataJSON()
      assert.equal(body.action,'send');assert.equal(body.projectId,'A');assert(body.clientTurnId)
      let row,detail
      const decision=solutions.decisions.at(-1)
      const selected=solutions.histories.get(decision.solution_id)?.find(r=>r.revision===decision.solution_revision)
      assert(selected)
      if(request==='create') {
        assert.equal(body.message,'Rita de två rummen med lådan.')
        const furniture=[...artifacts.records.values()].find(r=>r.title==='Test storage box')
        assert(furniture);furnitureId=furniture.id
        const recipe=artifacts.parametric.get(`${furniture.id}:${furniture.revision}`).recipe
        planId=randomUUID()
        row={id:planId,artifact_id:planId,project_id:'A',area_id:'areaA',revision:1,kind:'plan',title:'Linked room plan',description:'Two rooms sharing one wall, one furniture instance.',
          status:'concept',assumptions:'Proposed fixture dimensions, not measured site conditions.',source_media_id:null,source_media_title:'',
          target_revision:decision.revision,solution_id:decision.solution_id,solution_revision:decision.solution_revision,solution_title:selected.title,
          archived:false,change_note:'Bob created the requested plan',actor_label:'Bob fixture',recorded_at:timestamp(),measurements:[],generator:null,generator_version:null,has_room_layout:true}
        detail={project_id:'A',artifact_id:planId,artifact_revision:1,building_id:physicalId(1),left_space_id:physicalId(2),left_space_revision:1,right_space_id:physicalId(3),right_space_revision:1,
          wall_element_id:physicalId(4),wall_element_revision:1,furniture_artifact_id:furniture.id,furniture_revision:furniture.revision,instance_id:randomUUID(),
          parameters:{generator:'room_pair_v1',version:1,span_mm:6120,depth_mm:4000,wall_thickness_mm:120,left_width_mm:3400,furniture_room:'left',anchor:'shared_wall',gap_mm:50,offset_mm:200,rotation:0},
          furniture_recipe:structuredClone(recipe),left_name:'Children room',right_name:'Office',wall_name:'Shared wall',furniture_title:furniture.title,furniture_area_id:'areaA',
          current_left_revision:1,current_right_revision:1,current_wall_revision:1,current_furniture_revision:furniture.revision,furniture_archived:false,physical_archived:false,physical_pending:false,context_available:true}
      } else {
        assert(planId)
        const old=artifacts.records.get(planId),previous=layouts.get(`${planId}:${old.revision}`)
        row={...old,revision:old.revision+1,recorded_at:timestamp(),change_note:request==='wall'?'Move shared wall':'Move furniture only'}
        detail={...structuredClone(previous),artifact_revision:row.revision}
        if(request==='wall') {assert.equal(body.message,'Gör barnrummet 200 mm smalare.');detail.parameters.left_width_mm-=200}
        else {assert.equal(body.message,'Ställ lådan vid motsatt vägg.');detail.parameters.anchor='outer_wall'}
      }
      artifacts.records.set(planId,row);artifacts.histories.set(planId,[...(artifacts.histories.get(planId)??[]),structuredClone(row)])
      layouts.set(`${planId}:${row.revision}`,detail)
      assert.equal(artifacts.records.get(furnitureId).revision,detail.furniture_revision,'A layout edit never revises furniture')
      const evidence={kind:'ai_assessment',sources:[],partial:false,writes:[{projectId:'A',dataset:'artifacts',recordId:planId,label:row.title,operation:row.revision===1?'created':'updated',savedAt:timestamp(),revision:row.revision,areaId:'areaA'}]}
      const summary='Rumsritningen är sparad. Möbelns konstruktion är oförändrad.'
      messages.push({role:'user',text:body.message,delivery_state:'completed',seq:messages.length+1,turn_id:body.clientTurnId},
        {role:'assistant',text:summary,evidence,delivery_state:'completed',seq:messages.length+2,turn_id:body.clientTurnId})
      return reply({ok:true,status:'completed',projectId:'A',summary,evidence})
    },
  }
  return fixture
}

export async function verifyRoomLayoutBrowser(page,base,fixture,artifacts,width) {
  const source=[...artifacts.records.values()].find(r=>r.title==='Test storage box')
  const sourceBefore=structuredClone(source),recipeBefore=structuredClone(artifacts.parametric.get(`${source.id}:${source.revision}`))
  const ask=async(message,revision)=>{
    await page.getByRole('button',{name:'Ask bob',exact:true}).click()
    const chat=page.getByRole('complementary',{name:'Ask bob for Porch A',exact:true})
    await chat.getByLabel('Question for bob',{exact:true}).fill(message)
    await chat.getByRole('button',{name:'Send',exact:true}).click()
    await chat.getByRole('link',{name:`Open drawing · v${revision}`,exact:true}).last().click()
    await chat.waitFor({state:'hidden'})
    const dialog=page.getByRole('dialog',{name:`Linked room plan · Version ${revision}`,exact:true})
    await dialog.getByRole('region',{name:'Linked room plan',exact:true}).waitFor()
    return dialog
  }
  await page.goto(base+'#/artifacts?area=areaA')
  let dialog=await ask('Rita de två rummen med lådan.',1)
  const dimensions=()=>dialog.locator('.box-dimensions').first()
  await dimensions().getByText('3400 mm',{exact:true}).waitFor();await dimensions().getByText('2600 mm',{exact:true}).waitFor()
  assert.equal(await page.getByRole('dialog',{name:'Draw a storage box',exact:true}).count(),0,'No drawing form in the chat-created room workflow')
  for(const name of ['Children room','Office','Both rooms']) {
    await dialog.getByRole('button',{name,exact:true}).click()
    await dialog.locator('svg').waitFor()
  }
  const viewport=dialog.getByLabel('Linked plan viewport',{exact:true})
  assert(await viewport.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  await dialog.getByRole('button',{name:'Zoom linked plan in',exact:true}).click()
  assert(await viewport.evaluate(el=>el.scrollWidth>el.clientWidth))
  await dialog.getByRole('button',{name:'Fit plan',exact:true}).click()
  for(const b of await dialog.getByRole('region',{name:'Linked room plan',exact:true}).getByRole('button').all()) {
    const box=await b.boundingBox();assert(!box||(box.width>=44&&box.height>=44))
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  const download=page.waitForEvent('download')
  await dialog.getByRole('button',{name:'Save plan SVG',exact:true}).click()
  const file=await download,text=await readFile(await file.path(),'utf8')
  assert.match(text,/revision 1/);assert.match(text,/3400 mm/);assert.match(text,/NOT TO SCALE/)
  await dialog.getByRole('button',{name:'Furniture construction',exact:true}).click()
  const partsBefore=await dialog.locator('.box-parts').innerText()
  await dialog.getByRole('button',{name:'Close',exact:true}).click()
  fixture.setRequest('wall')
  dialog=await ask('Gör barnrummet 200 mm smalare.',2)
  await dimensions().getByText('3200 mm',{exact:true}).waitFor();await dimensions().getByText('2800 mm',{exact:true}).waitFor()
  await dimensions().getByText('2350 / 200 mm',{exact:true}).waitFor()
  await dialog.getByRole('button',{name:'Furniture construction',exact:true}).click()
  assert.equal(await dialog.locator('.box-parts').innerText(),partsBefore)
  assert.deepEqual(artifacts.records.get(source.id),sourceBefore);assert.deepEqual(artifacts.parametric.get(`${source.id}:${source.revision}`),recipeBefore)
  await dialog.getByRole('button',{name:'Close',exact:true}).click()
  fixture.setRequest('place')
  dialog=await ask('Ställ lådan vid motsatt vägg.',3)
  await dimensions().getByText('50 / 200 mm',{exact:true}).waitFor()
  await dimensions().getByText('3200 mm',{exact:true}).waitFor()
  await dialog.getByRole('button',{name:'Both rooms',exact:true}).click()
  await dialog.getByLabel('Linked plan viewport',{exact:true}).scrollIntoViewIfNeeded()
  await page.screenshot({path:`test-results/linked-room-plan-${width}.png`})
  await dialog.getByRole('button',{name:'Close',exact:true}).click()
  await page.goto(base+`#/artifacts?area=areaA&drawing=${fixture.planId}&revision=1`)
  dialog=page.getByRole('dialog',{name:'Linked room plan · Version 1',exact:true})
  await dimensions().getByText('3400 mm',{exact:true}).waitFor()
  await page.reload();await dimensions().getByText('3400 mm',{exact:true}).waitFor()
  fixture.sourcesChanged=true
  await page.reload();await dialog.getByText(/Sources changed after this plan was saved/).waitFor()
  await dimensions().getByText('3400 mm',{exact:true}).waitFor()
  fixture.unavailable=true
  await page.reload();await dialog.getByRole('alert').getByText(/Cannot display linked room layout/).waitFor()
  fixture.sourcesChanged=false;fixture.unavailable=false
  await page.reload();await dimensions().getByText('3400 mm',{exact:true}).waitFor()
  await dialog.getByRole('link',{name:`Open furniture drawing · v${source.revision}`,exact:true}).click()
  await page.getByRole('dialog',{name:`Test storage box · Version ${source.revision}`,exact:true}).waitFor()
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
  assert.deepEqual(artifacts.records.get(source.id),sourceBefore)
  console.log(`Linked room plan ${width}px: chat create → wall move → furniture placement → unchanged construction → exact old versions, source warnings, unavailable sources and export. HTTP/provider fixtures, not live AI.`)
}
