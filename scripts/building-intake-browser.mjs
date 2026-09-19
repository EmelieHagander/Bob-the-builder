import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Browser/transport fixture, NOT a language-understanding or real-provider test.
// Actual parser + canonical SQL + write orchestration are tested independently.
export function createBuildingIntakeFixture(state, audit) {
  const thread=randomUUID(), messages=[], levels=[], elements=[], proposals=[]
  let buildingId=null, kitchenId=null
  const response=(respond,json)=>respond({json})
  return {get buildingId(){return buildingId},async handle(request,url,respond){
    const table=url.pathname.split('/').at(-1),eq=k=>url.searchParams.get(k)?.replace(/^eq\./,'')
    const reply=async json=>{await response(respond,json);return true}
    if(table==='bob_threads')return reply(eq('project_id')==='A'?{id:thread,next_seq:messages.length+1}:null)
    if(table==='bob_messages')return reply(eq('thread_id')===thread?messages:[])
    if(table==='current_levels')return reply(levels.filter(x=>x.building_id===eq('building_id')))
    if(table==='current_elements')return reply(elements.filter(x=>x.building_id===eq('building_id')))
    if(table==='latest_space_proposals')return reply(proposals.filter(x=>x.building_id===eq('building_id')&&x.project_id===eq('project_id')))
    if(table==='latest_element_proposals'||table==='latest_relationship_proposals')return reply([])
    if(url.pathname!=='/functions/v1/ask-bob')return false
    const body=request.postDataJSON();assert.equal(body.action,'send');assert.equal(body.projectId,'A');assert(body.clientTurnId)
    let summary
    if(!buildingId){
      assert.equal(body.message,'Spara en teststuga med två våningar, öppet kök och matplats, sovrum ovanför matplatsen och en avdelande bänk.')
      buildingId=randomUUID();kitchenId=randomUUID()
      const diningId=randomUUID(),bedroomId=randomUUID(),groundId=randomUUID(),upperId=randomUUID()
      state.buildings.push({...audit,id:buildingId,site_id:null,revision:1,name:'Teststuga',notes:'User-described layout; exact geometry is not established.'})
      state.scopes.push({id:randomUUID(),project_id:'A',building_id:buildingId})
      for(const [id,name,position]of[[groundId,'Bottenvåning',0],[upperId,'Övervåning',1]])levels.push({...audit,id,building_id:buildingId,revision:1,name,position,notes:''})
      for(const [id,name,kind,level_id]of[[kitchenId,'Kök','kitchen_zone',groundId],[diningId,'Matplats','dining_zone',groundId],[bedroomId,'Sovrum','bedroom',upperId]])state.spaces.push({...audit,id,building_id:buildingId,revision:1,latest_revision:1,project_id:null,source_project_id:null,level_id,name,kind,truth:'provided_spec',source:'User description',notes:'Qualitative layout, not a measured footprint.',has_proposal:false})
      elements.push({...audit,id:randomUUID(),building_id:buildingId,revision:1,space_id:diningId,kind:'bench',name:'Avdelande bänk',description:'Divider, not a wall.',truth:'provided_spec',source:'User description',has_proposal:false})
      for(const [subject_space_id,object_space_id,relation]of[[kitchenId,diningId,'connects_to'],[bedroomId,diningId,'above']])state.relationships.push({...audit,id:randomUUID(),building_id:buildingId,revision:1,subject_space_id,object_space_id,relation,truth:'provided_spec',source:'User description',notes:'',latest_revision:1,has_proposal:false})
      summary='Teststugan, våningarna och sambanden är sparade. Exakta mått och trappgeometri saknas fortfarande.'
    }else{
      assert.equal(body.message,'Föreslå att köket blir ett arbetsrum, men behåll nuläget.')
      const kitchen=state.spaces.find(s=>s.id===kitchenId)
      kitchen.latest_revision=2;kitchen.has_proposal=true
      proposals.push({...kitchen,revision:2,accepted_revision:1,project_id:'A',name:'Föreslaget arbetsrum',kind:'office',truth:'ai_assessment',notes:'Only a project proposal; the accepted Kitchen is unchanged.',source:'User description: Föreslå att köket blir ett arbetsrum'})
      summary='Förslaget är sparat separat. Köket är fortfarande kvar i nuläget.'
    }
    const evidence={kind:'ai_assessment',sources:[],partial:false,writes:[{projectId:'A',dataset:'building_context',recordId:buildingId,label:'Teststuga',operation:messages.length?'updated':'created',savedAt:audit.recorded_at}]}
    const first=messages.length+1
    messages.push({role:'user',text:body.message,delivery_state:'completed',seq:first,turn_id:body.clientTurnId},{role:'assistant',text:summary,evidence,delivery_state:'completed',seq:first+1,turn_id:body.clientTurnId})
    return reply({ok:true,status:'completed',projectId:'A',summary,evidence})
  }}
}

export async function verifyBuildingIntakeBrowser(page,base,fixture,state,width){
  const ask=async message=>{
    await page.getByRole('button',{name:'Ask bob',exact:true}).click()
    const chat=page.getByRole('complementary',{name:'Ask bob for Porch A',exact:true})
    await chat.getByLabel('Question for bob',{exact:true}).fill(message)
    await chat.getByRole('button',{name:'Send',exact:true}).click()
    await chat.getByRole('link',{name:'Open building context',exact:true}).last().click()
    await chat.waitFor({state:'hidden'})
    await page.getByRole('heading',{name:'Teststuga',exact:true}).waitFor()
  }
  const count=state.buildings.length
  await ask('Spara en teststuga med två våningar, öppet kök och matplats, sovrum ovanför matplatsen och en avdelande bänk.')
  assert.equal(state.buildings.length,count+1)
  assert.equal(await page.getByRole('dialog').count(),0,'Chat intake requires no manual building/room form')
  assert(page.url().includes(`building=${fixture.buildingId}`),'Receipt selects its Building, not the first available one')
  await page.getByText('kitchen_zone · Bottenvåning',{exact:true}).waitFor()
  await page.getByText('bedroom · Övervåning',{exact:true}).waitFor()
  await page.getByText(/Kök connects to Matplats/).waitFor()
  await page.getByText(/Sovrum above Matplats/).waitFor()
  await page.getByText('Avdelande bänk',{exact:true}).waitFor()
  await page.reload()
  await page.getByRole('heading',{name:'Teststuga',exact:true}).waitFor()
  await page.getByText(/Kök connects to Matplats/).waitFor()
  await ask('Föreslå att köket blir ett arbetsrum, men behåll nuläget.')
  const proposed=page.getByRole('region',{name:'Project proposals',exact:true})
  await proposed.getByText('Föreslaget arbetsrum',{exact:true}).waitFor()
  await page.locator('.building-context-editor').getByText('Kök',{exact:true}).first().waitFor()
  await proposed.scrollIntoViewIfNeeded()
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Intake details/proposals must fit a phone without page overflow')
  await page.screenshot({path:`test-results/building-intake-${width}.png`,fullPage:true})
  await page.reload();await proposed.getByText('Föreslaget arbetsrum',{exact:true}).waitFor()
  // Explicit receipt links must never fall back to a different building.
  await page.goto(base+'#/building?building=10000000-0000-4000-8000-000000000099')
  await page.getByRole('heading',{name:'You can’t view this building context',exact:true}).waitFor()
  assert.equal(await page.getByRole('heading',{name:'Main house',exact:true}).count(),0)
  await page.goto(base+'#/building?building='+fixture.buildingId)
  await page.getByRole('heading',{name:'Teststuga',exact:true}).waitFor()
  console.log(`Building intake chat/create/readback/reload/proposals/exact-building link passed at ${width}px; HTTP/provider fixtures.`)
}
