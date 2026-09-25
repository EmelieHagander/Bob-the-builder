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
const project={id:'P',slug:'build',name:'Build together',description:'One shared plan',location:'',type:'Renovation',theme:'birch',phase:'build',start_label:'',start_date:null,end_date:null}
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
  let creates=0,reads=0
  await context.route('https://fonts.googleapis.com/**',r=>r.abort())
  await context.route(`${api}/**`,async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname
   const respond=(json,status=200)=>route.fulfill({status,json,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}})
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}})
   if(path==='/auth/v1/token')return respond({access_token:token,refresh_token:'fixture',expires_in:3600,expires_at:expiresAt,token_type:'bearer',user})
   if(path==='/auth/v1/user')return respond(user)
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
   if(path==='/rest/v1/rpc/create_work_task'){
    const b=req.postDataJSON();assert.equal(b.p_project,'P');assert.equal(b.p_step,root.id);assert.equal(b.p_area,null)
    const row={...tasks[0],id:'new-task',name:b.p_name,status:'todo'};tasks.push(row);creates++;return respond(row)
   }
   if(path==='/rest/v1/tasks'){
    assert.equal(url.searchParams.get('project_id'),'eq.P');assert(!url.searchParams.get('select')?.includes('areas!inner'))
    return respond(req.headers().accept?.includes('object+json')?tasks.find(t=>'eq.'+t.id===url.searchParams.get('id')):tasks)
   }
   if(path.startsWith('/rest/v1/')&&req.method()==='GET')return respond([])
   errors.push(`${req.method()} ${path}`);return respond({error:'unexpected_request'},500)
  })
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+'#/signin');await page.getByRole('button',{name:'Continue as guest',exact:true}).click()
  await page.getByRole('heading',{name:'Work fixture',exact:true}).waitFor()
  await page.getByRole('button',{name:'Open',exact:true}).click()
  const plan=page.getByRole('region',{name:'Project plan',exact:true}),drawers=plan.locator('.work-step').filter({hasText:'Complete drawers'})
  await drawers.getByRole('link',{name:'Cut panels',exact:true}).waitFor()
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
  assert.deepEqual(errors,[]);await context.close()
  console.log(`Unified work ${width}px: root/Area Steps, Task creation/readback, navigation/reload, references, legacy work and focus OK`)
 }
}finally{await browser?.close();server.kill()}
