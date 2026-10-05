// Production React/data paths with HTTP fixtures. SQL/authority is covered by
// unified-project-work.test.ts; this checks visible ownership and persistence.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base='http://127.0.0.1:4179/Bob-the-builder/',api='https://pwa-proof.invalid'
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--base','/Bob-the-builder/','--host','127.0.0.1','--port','4179','--strictPort'],{stdio:['ignore','pipe','pipe']})
let logs='',browser
server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d)
const user={id:'00000000-0000-4000-8000-000000000001',email:'work@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-09-24T00:00:00Z'}
const expiresAt=Math.floor(Date.now()/1000)+3600
const token=[{alg:'HS256',typ:'JWT'},{sub:user.id,exp:expiresAt,role:'authenticated'},'fixture'].map(p=>Buffer.from(typeof p==='string'?p:JSON.stringify(p)).toString('base64url')).join('.')
const description = ['One shared plan', ...Array.from({length:24},(_,i)=>`Recorded note ${i+1}: panel 1200 × 600 mm; verify against Measurements.`)].join('\n')
const project={id:'P',slug:'build',name:'Build together',description,location:'',type:'Renovation',theme:'birch',phase:'build',start_label:'',start_date:null,end_date:null}
const area={id:'kitchen',slug:'kitchen',name:'Kitchen',phase:'design',description:'',icon:'hammer',lead_id:null,assigned_pct:0,materials_pct:0,done_pct:0,task_summary:'',area_crew:[],area_reference_images:[]}
const step=(id,title,area_id,phase)=>({id,title,area_id,phase,position:1,goal:`Complete ${title.toLowerCase()}`,notes:'',state:'active',responsible_kind:'bob',responsible_person_id:null,tasks:[],related_tasks:[],requirements:[]})
try{
 for(let i=0;;i++){
  try{if((await fetch(base)).ok)break}catch{}
  assert(i<40&&server.exitCode===null,logs);await new Promise(r=>setTimeout(r,250))
 }
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'})
 await mkdir('test-results',{recursive:true})
 for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),errors=[]
  const root=step('30000000-0000-4000-8000-000000000001','Drawers',null,'build')
  const grouped=step('30000000-0000-4000-8000-000000000002','Floor','kitchen','design')
  const tasks=[{id:'cut',project_id:'P',primary_step_id:root.id,area_id:null,name:'Cut panels',status:'doing',skill:'novice',hours:'1h',materials:'0 / 0',task_assignees:[],instructions:'Follow the saved cutting list',updated_at:'2026-09-24T00:00:00Z'},
   {id:'legacy',project_id:'P',primary_step_id:null,area_id:'kitchen',name:'Inspect existing floor',status:'done',skill:'novice',hours:'1h',materials:'0 / 0',task_assignees:[],instructions:'',updated_at:'2026-09-24T00:00:00Z'}]
  let creates=0,reads=0,requestsVisible=false,grants=0,grantId=null,cancels=0,contextFailures=0
  const sentScreens=[]
  const requestWork={request:{id:'40000000-0000-4000-8000-000000000001',revision:3,status:'needs_data',reason:null,artifact_id:null,artifact_revision:null,scope:{step_id:root.id}},gaps:[
   {id:'50000000-0000-4000-8000-000000000002',action:'prerequisite',blocking:true,observed_revision:3,task_id:null,task_name:null,label:'Inspect floor before placing drawers',owner_label:null,step_title:grouped.title,area_id:'kitchen',step_id:grouped.id},
   {id:'50000000-0000-4000-8000-000000000001',action:'measurement',blocking:true,observed_revision:3,task_id:'cut',task_name:'Cut panels',label:'Record panel width',owner_label:'Bob',step_title:root.title,area_id:null,step_id:root.id},
  ],can_manage:true,resume_state:'waiting_for_change',budget:{revision:1,calls:24,call_limit:24,spent_usd:0.35,usd_limit:1,outcome_unknown:false}}
  await context.route('https://fonts.googleapis.com/**',r=>r.abort())
  await context.route(`${api}/**`,async route=>{
      const inboxPath = new URL(route.request().url()).pathname
      if (inboxPath === '/rest/v1/rpc/drawing_work_list') return route.fulfill({status:200,json:{items:requestsVisible?[requestWork]:[],next_cursor:null},headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}})
      if (inboxPath === '/functions/v1/ask-bob' && route.request().method()==='POST' && route.request().postDataJSON()?.action==='renew_requests') return route.fulfill({status:200,json:{ok:true,renewed:0},headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}})

      if (['/rest/v1/rpc/bob_chat_inbox','/rest/v1/rpc/bob_mark_chat_read','/rest/v1/bob_delegation_notices'].includes(inboxPath)) return route.fulfill({status:200,json:inboxPath.endsWith('bob_delegation_notices')?[]:null,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}})
   const req=route.request(),url=new URL(req.url()),path=url.pathname
   const respond=(json,status=200)=>route.fulfill({status,json,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}})
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}})
   if(path==='/auth/v1/token')return respond({access_token:token,refresh_token:'fixture',expires_in:3600,expires_at:expiresAt,token_type:'bearer',user})
   if(path==='/auth/v1/user')return respond(user)
   if(path==='/functions/v1/ask-bob'){
    const b=req.postDataJSON();sentScreens.push(b.screen)
    assert.equal(b.projectId,'P');assert.deepEqual(Object.keys(b).sort(),['action','background','clientTurnId','message','projectId','screen'])
    if(b.message==='Retry after changed page context'&&contextFailures++===0)return respond({ok:false,error:'context_unavailable'},503)
    const focusedStep={id:root.id,name:root.title,state:root.state,planRevision:1,goal:root.goal,notes:root.notes,responsible:{kind:'bob'}}
    const focus=b.screen.taskId?{task:{id:'cut',name:'Cut panels',status:'doing',instructions:tasks[0].instructions,assignees:[]},planStep:focusedStep}:b.screen.planStepId?{planStep:focusedStep}:{}
    return respond({ok:true,status:'completed',projectId:'P',summary:'Read this page from saved project records.',evidence:{kind:'ai_assessment',partial:false,sources:[],currentView:{status:'ok',projectId:'P',project:{id:'P',name:project.name},surface:b.screen.surface,focus,sources:[],warnings:[],retrievedAt:new Date().toISOString()}}})
   }
   if(path==='/rest/v1/bob_threads')return respond(null)
   if(path==='/rest/v1/projects')return respond(req.headers().accept?.includes('object+json')?project:[project])
   if(path==='/rest/v1/account')return respond({id:'account',name:'Work fixture',owner_name:'',email:''})
   if(path==='/rest/v1/areas')return respond([area])
   if(path==='/rest/v1/events')return respond(['one','two'].map(id=>({id:`day-${id}`,project_id:'P',slug:`day-${id}`,title:`Build day ${id}`,day:'Saturday',time:'10:00',place:'Workshop',spots:'0 / 8',status:'open',food:'Bring lunch',event_attendees:[]})))
   if(path==='/rest/v1/event_tasks'){
    assert.equal(url.searchParams.get('project_id'),'eq.P')
    return respond([{task_id:url.searchParams.get('event_id')==='eq.day-one'?'cut':'legacy'}])
   }
   if(path==='/rest/v1/rpc/claim_project_invites')return respond(0)
   if(path==='/rest/v1/rpc/join_project')return respond({})
   if(path==='/rest/v1/rpc/project_invitations')return respond([])
   if(path==='/rest/v1/rpc/project_work_read'){
    assert.equal(req.postDataJSON().p_project,'P');reads++
    root.tasks=tasks.filter(t=>t.primary_step_id===root.id)
    grouped.related_tasks=[root.tasks[0]]
    return respond({project_id:'P',vocabulary_version:'2026-09-24.1',status:'approved',revision:1,focus_step_id:grouped.id,areas:[area],steps:[root,grouped],unorganised_tasks:tasks.filter(t=>!t.primary_step_id)})
   }
   if(path==='/rest/v1/rpc/grant_drawing_budget'){
    const b=req.postDataJSON();assert.equal(b.p_project,'P');assert.equal(b.p_id,requestWork.request.id);assert.equal(b.p_expected,1)
    if(!grantId){grantId=b.p_grant;grants++;requestWork.budget={...requestWork.budget,revision:2,call_limit:48,usd_limit:2};return respond({error:'lost_response'},503)}
    assert.equal(b.p_grant,grantId,'retry keeps the allocation idempotency key');return respond({revision:2})
   }
   if(path==='/rest/v1/rpc/cancel_drawing_request'){
    const b=req.postDataJSON();assert.equal(b.p_expected,3);cancels++;requestWork.request.status='cancelled';requestWork.request.revision++;requestWork.resume_state='cancelled';return respond({status:'cancelled',revision:4})
   }
   if(path==='/rest/v1/rpc/create_work_task'){
    const b=req.postDataJSON();assert.equal(b.p_project,'P');assert.equal(b.p_step,root.id);assert.equal(b.p_area,null)
    const row={...tasks[0],id:'new-task',name:b.p_name,status:'todo'};tasks.push(row);creates++;return respond(row)
   }
   if(path==='/rest/v1/tasks'){
    if(url.searchParams.get('project_id')==='in.(P)')return respond(tasks)
    assert.equal(url.searchParams.get('project_id'),'eq.P');assert(!url.searchParams.get('select')?.includes('areas!inner'))
    return respond(req.headers().accept?.includes('object+json')?tasks.find(t=>'eq.'+t.id===url.searchParams.get('id')):tasks)
   }
   if(path.startsWith('/rest/v1/')&&req.method()==='GET')return respond([])
   errors.push(`${req.method()} ${path}`);return respond({error:'unexpected_request'},500)
  })
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+'#/signin');await page.getByRole('button',{name:'Continue as guest',exact:true}).click()
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  await page.getByRole('button',{name:'Open project Build together',exact:true}).click()
  const plan=page.getByRole('region',{name:'Project plan',exact:true}),drawers=plan.locator('.work-step').filter({hasText:'Complete drawers'})
  await drawers.getByRole('link',{name:'Cut panels',exact:true}).waitFor()
  const projectDescription=page.locator('.project-description')
  assert.equal(await projectDescription.getAttribute('open'),null,'Long saved notes do not push the Plan off the opening screen')
  const planBox=await plan.boundingBox()
  assert(planBox && planBox.y<520,`Plan is easy to reach at ${width}px: ${JSON.stringify(planBox)}`)
  const shortcuts=page.getByRole('navigation',{name:'Project tools',exact:true})
  for(const link of await shortcuts.getByRole('link').all()){
   const box=await link.boundingBox()
   assert(box && box.height>=44 && box.x>=0 && box.x+box.width<=width,'Every project shortcut remains touchable and inside the phone')
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1))
  await page.screenshot({path:`test-results/mobile-project-overview-${width}.png`})
  await projectDescription.getByText('Project description',{exact:true}).click()
  assert.equal(await projectDescription.locator('.instruction-text').textContent(),description,'All saved notes and dimensions remain available verbatim')
  await projectDescription.getByText('Project description',{exact:true}).click()
  await page.getByRole('button',{name:'Go to Plan',exact:true}).click()
  assert.equal(await plan.evaluate(el=>el===document.activeElement),true)
  assert.equal(await page.getByRole('heading',{name:'Workstreams',exact:true}).count(),0)
  assert.equal(await drawers.getByText('Bob’s focus',{exact:true}).count(),0)
  await plan.locator('.work-step').filter({hasText:'Complete floor'}).getByText('Bob’s focus',{exact:true}).waitFor()
  await plan.getByText('Tasks to organise · 1',{exact:true}).click()
  await plan.getByRole('link',{name:'Inspect existing floor',exact:true}).waitFor()
  await drawers.getByRole('button',{name:'Add task',exact:true}).click()
  const modal=page.getByRole('dialog',{name:'Add task',exact:true})
  assert.equal(await modal.getByLabel('Area *',{exact:true}).count(),0)
  await modal.getByLabel('Task *',{exact:true}).fill('Assemble drawers')
  await modal.getByRole('button',{name:'Add task',exact:true}).click();await modal.waitFor({state:'hidden'})
  await drawers.getByRole('link',{name:'Assemble drawers',exact:true}).waitFor();assert.equal(creates,1)
  await drawers.getByRole('link',{name:'Cut panels',exact:true}).click()
  await page.getByRole('heading',{name:'Cut panels',exact:true}).waitFor()
  await page.getByText('Follow the saved cutting list',{exact:true}).waitFor()
  await page.getByRole('link',{name:'Drawers',exact:true}).click()
  await drawers.getByRole('link',{name:'Assemble drawers',exact:true}).waitFor()
  await page.reload();await drawers.getByRole('link',{name:'Assemble drawers',exact:true}).waitFor()
  await drawers.getByText('In progress · 2 tasks',{exact:true}).waitFor()
  assert(reads>=4)
  const floor=plan.locator('.work-step').filter({hasText:'Complete floor'})
  await floor.getByText('In progress · 0 tasks',{exact:true}).waitFor()
  await floor.getByText('Related work',{exact:true}).click()
  assert.equal(await plan.getByRole('link',{name:'Cut panels',exact:true}).count(),2,'One primary plus one reference, never a second owned Task')
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'No horizontal overflow')
  await page.screenshot({path:`test-results/project-work-${width}.png`,fullPage:true})
  await page.goto(base+'#/events/day-one')
  await page.getByRole('heading',{name:'Build day one',exact:true}).waitFor()
  await page.getByRole('link',{name:'Cut panels',exact:true}).waitFor()
  assert.equal(await page.getByRole('link',{name:'Inspect existing floor',exact:true}).count(),0)
  await page.goto(base+'#/events/day-two')
  await page.getByRole('heading',{name:'Build day two',exact:true}).waitFor()
  await page.getByRole('link',{name:'Inspect existing floor',exact:true}).waitFor()
  assert.equal(await page.getByRole('link',{name:'Cut panels',exact:true}).count(),0)
  await page.reload();await page.getByRole('link',{name:'Inspect existing floor',exact:true}).waitFor()
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'Build day has no horizontal overflow')
  await page.screenshot({path:`test-results/build-day-${width}.png`,fullPage:true})
  requestsVisible=true
  await page.goto(base+'#/project');await page.reload()
  const requests=page.getByRole('region',{name:'Drawing requests',exact:true})
  await requests.getByRole('heading',{name:'Waiting for information',exact:true}).waitFor()
  await requests.getByText('Record panel width',{exact:true}).waitFor()
  await requests.getByText('Responsible: Bob',{exact:true}).waitFor()
  await requests.getByRole('link',{name:'Open linked task',exact:true}).waitFor()
  const requestDestination=requests.locator('.drawing-request-card > p').getByRole('link',{name:root.title,exact:true})
  assert.equal(await requestDestination.getAttribute('href'),'#/project?step='+encodeURIComponent(root.id),'Destination label belongs to the request Step, even when its first prerequisite belongs to another Step')
  assert.equal(await requests.getByRole('link',{name:grouped.title,exact:true}).getAttribute('href'),'#/project?step='+encodeURIComponent(grouped.id),'The prerequisite retains its own linked Step')
  await page.goto(base+'#/?step='+encodeURIComponent(root.id))
  await page.waitForURL('**/#/project?step='+encodeURIComponent(root.id))
  await page.getByRole('region',{name:'Project plan',exact:true}).waitFor()
  await requests.getByRole('button',{name:'Add request budget',exact:true}).click()
  const budgetDialog=page.getByRole('dialog',{name:'Add request budget',exact:true})
  assert.equal(grants,0,'opening the budget decision never spends money')
  await budgetDialog.getByRole('button',{name:'Add $1 / 24 calls',exact:true}).click()
  await budgetDialog.getByRole('alert').waitFor()
  await budgetDialog.getByRole('button',{name:'Add $1 / 24 calls',exact:true}).click()
  await budgetDialog.waitFor({state:'hidden'});assert.equal(grants,1)
  await requests.getByText('24 / 48 calls · $0.35 / $2.00',{exact:true}).waitFor()
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'Requests fit mobile viewport')
  await page.screenshot({path:`test-results/drawing-requests-${width}.png`,fullPage:true})
  const drawer=page.getByRole('complementary',{name:'Ask bob for Build together'})
  await requests.getByRole('button',{name:'Ask Bob from this Step',exact:true}).click()
  await drawer.getByLabel('Bob page context').getByText('Plan Step · Drawers',{exact:true}).waitFor()
  await drawer.getByRole('textbox',{name:'Question for bob'}).fill('What is missing for this Step?')
  await drawer.getByRole('button',{name:'Send',exact:true}).click()
  await drawer.getByText('Page records used · Drawers',{exact:true}).waitFor()
  assert.deepEqual(sentScreens.at(-1),{surface:'project',planStepId:root.id},'Request action opens its actual destination Step context')
  await drawer.getByRole('textbox',{name:'Question for bob'}).fill('Retry after changed page context')
  await drawer.getByRole('button',{name:'Send',exact:true}).click()
  await drawer.getByText('Bob could not safely use the page, project or conversation context. The records may have changed while he was working. Review any saved changes, then use Retry request to reread the original selection.',{exact:true}).waitFor()
  await drawer.getByRole('button',{name:'Retry request',exact:true}).click()
  await drawer.getByRole('button',{name:'Retry request',exact:true}).waitFor({state:'hidden'})
  await drawer.locator('.bob-working').waitFor({state:'hidden'})
  assert.equal(contextFailures,2,'Changed-context recovery makes one explicit retry')
  assert.deepEqual(sentScreens.at(-1),{surface:'project',planStepId:root.id},'Changed-context retry retains the original Step selection')
  await drawer.getByRole('button',{name:'Close Ask bob',exact:true}).click()
  await requests.getByRole('link',{name:'Open linked task',exact:true}).click()
  await page.getByRole('heading',{name:'Cut panels',exact:true}).waitFor()
  await page.getByRole('button',{name:'Ask bob',exact:true}).click()
  await drawer.getByText('Task · Cut panels',{exact:true}).waitFor()
  await drawer.getByRole('textbox',{name:'Question for bob'}).fill('What do I do here?')
  await drawer.getByRole('button',{name:'Send',exact:true}).click()
  await drawer.getByText('Page records used · Drawers / Cut panels',{exact:true}).waitFor()
  assert.deepEqual(sentScreens.at(-1),{surface:'task',taskId:'cut',planStepId:root.id})
  await drawer.getByText('Page records used · Drawers / Cut panels',{exact:true}).waitFor()
  await drawer.getByRole('button',{name:'Close Ask bob',exact:true}).click()
  await page.goto(base+'#/events/day-one')
  await page.getByRole('heading',{name:'Build day one',exact:true}).waitFor()
  await page.getByRole('button',{name:'Ask bob',exact:true}).click()
  await drawer.getByText('Build day · Build day one',{exact:true}).waitFor()
  await drawer.getByRole('textbox',{name:'Question for bob'}).fill('Who is coming here?')
  const eventAnswer=page.waitForResponse(response=>response.url().includes('/functions/v1/ask-bob')&&response.request().postDataJSON()?.message==='Who is coming here?')
  await drawer.getByRole('button',{name:'Send',exact:true}).click()
  await eventAnswer
  await drawer.getByText('Read this page from saved project records.',{exact:true}).last().waitFor()
  assert.deepEqual(sentScreens.at(-1),{surface:'event',eventId:'day-one'},'An already-mounted drawer reads the new page at send time')
  await page.screenshot({path:`test-results/bob-current-view-${width}.png`,fullPage:true})
  await drawer.getByRole('button',{name:'Close Ask bob',exact:true}).click()
  await page.goto(base+'#/tasks/cut')
  await page.getByRole('heading',{name:'Cut panels',exact:true}).waitFor()
  await page.getByRole('region',{name:'Drawing requests',exact:true}).getByRole('button',{name:'Cancel request',exact:true}).click()
  await page.getByRole('heading',{name:'Cancelled',exact:true}).waitFor();assert.equal(cancels,1)
  await page.reload();await page.getByRole('heading',{name:'Cancelled',exact:true}).waitFor()
  assert.deepEqual(errors,[]);await context.close()
  console.log(`Unified work ${width}px: root/Area Steps, Task creation/readback, navigation/reload, references, legacy work and focus OK`)
 }
}finally{await browser?.close();server.kill()}
