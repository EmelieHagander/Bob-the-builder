// Production React/data layer, fixture HTTP only. This proves UI consumption,
// NOT hosted SQL, independent model choices, or a completed drawing/Shopping flow.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = 'http://127.0.0.1:4184/Bob-the-builder/'
const api = 'https://pwa-proof.invalid'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--base', '/Bob-the-builder/', '--host', '127.0.0.1', '--port', '4184', '--strictPort'], { stdio: ['ignore','pipe','pipe'] })
let output = '', browser, activePage, activeWidth
server.stdout.on('data', data => { output += data })
server.stderr.on('data', data => { output += data })
const user = { id:'00000000-0000-4000-8000-000000000003', email:'catalog-fixture@example.test', aud:'authenticated', role:'authenticated', app_metadata:{ provider:'email' }, user_metadata:{}, created_at:'2026-09-21T00:00:00Z' }
const expiry = Math.floor(Date.now()/1000)+3600
const token = [JSON.stringify({alg:'HS256',typ:'JWT'}), JSON.stringify({sub:user.id,exp:expiry,role:'authenticated'}), 'fixture-signature'].map(s=>Buffer.from(s).toString('base64url')).join('.')
const projects = ['A','B'].map(id=>({ id,slug:id.toLowerCase(),name:`Catalog ${id}`,description:'',location:'',type:'Renovation',theme:'birch',start_label:'',start_date:null,end_date:null }))
const definitionId = '10000000-0000-4000-8000-000000000001'
const label = 'Plywood specification with a deliberately long descriptive name'
try {
  for(let attempt=0;;attempt++) {
    try { if((await fetch(base)).ok) break } catch { /* preview starting */ }
    assert(attempt<40 && server.exitCode===null, `Preview unavailable: ${output}`)
    await new Promise(resolve=>setTimeout(resolve,250))
  }
  browser = await chromium.launch({ executablePath:process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  await mkdir('test-results',{recursive:true})
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:1280,height:900}]) {
    const context = await browser.newContext({ viewport,serviceWorkers:'block' })
    const histories = new Map(['A','B'].map(id=>[id,{thread:null,nextSeq:1,messages:[]}]))
    const completed = new Map(), requests = [], errors = []
    let definitions=0, revisions=0, currentRevision=0
    await context.route('**/*',async route=>{
      const request=route.request(), url=new URL(request.url())
      if(url.origin===new URL(base).origin) return route.continue()
      if(url.origin!==api) {
        if(!['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname)) errors.push(`Unapproved network destination: ${url.origin}`)
        return route.abort()
      }
      const respond = options=>route.fulfill({...options,headers:{
        'Access-Control-Allow-Origin':'*',
        'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile',
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
      }})
      if(request.method()==='OPTIONS') return respond({status:204})
      if(url.pathname==='/rest/v1/rpc/project_plan_read') return respond({json:{record:null}})
      if(url.pathname==='/auth/v1/token') return respond({json:{access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,expires_at:expiry,user}})
      if(url.pathname==='/auth/v1/user') return respond({json:user})
      if(url.pathname==='/auth/v1/logout') return respond({json:{}})
      if(url.pathname==='/functions/v1/ask-bob') {
        assert.equal(request.headers().authorization,`Bearer ${token}`)
        const body=request.postDataJSON()
        assert.deepEqual(Object.keys(body).sort(),['action','clientTurnId','message','projectId'])
        assert.equal(body.action,'send');assert.equal(body.projectId,'A')
        requests.push(body)
        if(completed.has(body.clientTurnId)) return respond({json:completed.get(body.clientTurnId)})
        let operation, summary
        if(body.message==='Create catalog definition') {operation='created';summary='Material definition created.';definitions++;revisions++;currentRevision=1}
        else if(body.message==='Reuse catalog definition') {operation='reused';summary='Existing definition reused.'}
        else if(body.message==='Revise catalog definition') {operation='updated';summary='Same definition revised.';revisions++;currentRevision=2}
        else if(body.message.startsWith('Forged ')) {operation='reused';summary='INVALID CATALOG RESULT'}
        else throw new Error('Unexpected catalog fixture message')
        const receipt={projectId:'A',dataset:'catalog',recordId:definitionId,revision:currentRevision,label,operation,savedAt:'2026-09-21T11:00:00Z'}
        if(body.message==='Forged foreign') receipt.projectId='B'
        if(body.message==='Forged operation') receipt.dataset='tasks'
        const response={ok:true,backend:'openai',status:'completed',projectId:'A',summary,evidence:{kind:'ai_assessment',partial:false,
          sources:[{projectId:'A',dataset:'catalog',recordId:`${definitionId}@${currentRevision}`,label,truth:'ai_assessment',retrievedAt:'2026-09-21T11:00:00Z',updatedAt:'2026-09-21T11:00:00Z'}],writes:[receipt]}}
        if(body.message.startsWith('Forged ')) return respond({json:response})
        completed.set(body.clientTurnId,response)
        const h=histories.get('A');h.thread='catalog-thread-A'
        h.messages.push({role:'user',text:body.message,turn_id:body.clientTurnId,evidence:null,delivery_state:'completed',seq:h.nextSeq++})
        h.messages.push({role:'assistant',text:summary,turn_id:body.clientTurnId,evidence:response.evidence,delivery_state:'completed',seq:h.nextSeq++})
        // The operation has settled, but its first HTTP answer is lost.
        if(operation==='reused') return route.abort('failed')
        return respond({json:response})
      }
      if(url.pathname==='/rest/v1/bob_threads') {
        const id=url.searchParams.get('project_id')?.replace(/^eq\./,'')
        const owner=url.searchParams.get('owner_user_id')?.replace(/^eq\./,'')
        const h=histories.get(id), row=owner===user.id&&h?.thread?{id:h.thread,revision:1}:null
        return respond({json:(request.headers().accept??'').includes('application/vnd.pgrst.object+json')?row:row?[row]:[]})
      }
      if(url.pathname==='/rest/v1/bob_messages') {
        const id=url.searchParams.get('thread_id')?.replace(/^eq\./,'')
        const h=[...histories.values()].find(h=>h.thread===id)
        return respond({json:h?.messages??[]})
      }
      if(url.pathname==='/rest/v1/rpc/claim_project_invites') return respond({json:0})
      if(url.pathname==='/rest/v1/rpc/project_invitations') return respond({json:[]})
      if(url.pathname==='/rest/v1/projects') return respond({json:projects})
      if(url.pathname==='/rest/v1/account') return respond({json:{id:'account',name:'Catalog fixture account',owner_name:'',email:''}})
      if(url.pathname==='/rest/v1/people') {
        // getCurrentUser resolves actual project membership before chat hydration.
        // A missing member would exercise join_project, not this receipt journey.
        const pid=url.searchParams.get('project_id')?.replace(/^eq\./,'')??'A'
        const row={id:`catalog-member-${pid}`,name:'Catalog fixture member',initials:'CM',color:'#41513f',role:'Organiser',diet:'',person_skills:[]}
        return respond({json:(request.headers().accept??'').includes('application/vnd.pgrst.object+json')?row:[row]})
      }
      if(url.pathname.startsWith('/rest/v1/')&&request.method()==='GET') return respond({json:[]})
      errors.push(`Unexpected request: ${request.method()} ${url.pathname}`)
      return respond({status:500,json:{error:'unexpected_fixture_request'}})
    })
    const page=await context.newPage()
    activePage=page;activeWidth=viewport.width
    page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(12000)
    page.on('pageerror',e=>errors.push(e.message))
    const openBob=async id=>{
      await page.getByRole('button',{name:'Ask bob',exact:true}).click()
      const drawer=page.getByRole('complementary',{name:`Ask bob for Catalog ${id}`})
      await drawer.waitFor()
      await drawer.getByRole('button',{name:'Send',exact:true}).waitFor()
      return drawer
    }
    const requestFromAction=async action=>Promise.all([
      page.waitForRequest(r=>r.url()===`${api}/functions/v1/ask-bob`&&r.method()==='POST'),
      action(),
    ])
    const send=async text=>{
      await page.getByRole('textbox',{name:'Question for bob'}).fill(text)
      await requestFromAction(()=>page.getByRole('button',{name:'Send',exact:true}).click())
    }
    const switchProject=async id=>{
      await page.getByRole('button',{name:'Close Ask bob',exact:true}).click()
      await page.getByRole('link',{name:'Account',exact:true}).click()
      await page.locator('.card').filter({hasText:`Catalog ${id}`}).getByRole('button',{name:'Open',exact:true}).click()
      return openBob(id)
    }
    await page.goto(`${base}#/signin`)
    await page.getByRole('button',{name:'Continue as guest',exact:true}).click()
    await page.getByRole('heading',{name:'Catalog fixture account',exact:true}).waitFor()
    let drawer=await openBob('A')
    await send('Create catalog definition')
    await drawer.getByText('Material definition created.',{exact:true}).waitFor()
    await drawer.getByLabel('Saved project changes').getByText('· Definition v1',{exact:true}).waitFor()
    await send('Reuse catalog definition')
    const turnId=requests.at(-1).clientTurnId
    await drawer.getByRole('button',{name:'Retry request',exact:true}).waitFor()
    await requestFromAction(()=>drawer.getByRole('button',{name:'Retry request',exact:true}).click())
    await drawer.getByText('Existing definition reused.',{exact:true}).waitFor()
    assert.equal(requests.at(-1).clientTurnId,turnId)
    await drawer.getByText('Reused existing definitions',{exact:true}).waitFor()
    assert.equal(definitions,1);assert.equal(revisions,1)
    await send('Revise catalog definition')
    await drawer.getByText('Same definition revised.',{exact:true}).waitFor()
    await drawer.getByLabel('Saved project changes').last().getByText('· Definition v2',{exact:true}).waitFor()
    assert.equal(definitions,1);assert.equal(revisions,2)
    await page.reload();drawer=await openBob('A')
    await drawer.getByText('Same definition revised.',{exact:true}).waitFor()
    assert.equal(await drawer.getByLabel('Saved project changes').count(),3)
    assert.equal(await drawer.getByText('· Definition v1',{exact:true}).count(),2)
    await drawer.getByText('Reused existing definitions',{exact:true}).waitFor()
    assert(await drawer.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'Catalog receipts must not overflow horizontally')
    await drawer.getByLabel('Saved project changes').last().scrollIntoViewIfNeeded()
    await page.screenshot({path:`test-results/material-catalog-receipts-${viewport.width}.png`,fullPage:true})
    for(const text of ['Forged foreign','Forged operation']) {
      await send(text)
      await drawer.getByText('I could not retrieve an answer for this project. Please try again.',{exact:true}).last().waitFor()
      assert.equal(await drawer.getByText('INVALID CATALOG RESULT',{exact:true}).count(),0)
      assert.equal(await drawer.getByLabel('Saved project changes').count(),3)
    }
    drawer=await switchProject('B')
    assert.equal(await drawer.getByLabel('Saved project changes').count(),0)
    assert.equal(await drawer.getByText(label,{exact:true}).count(),0)
    drawer=await switchProject('A')
    await drawer.getByText('Same definition revised.',{exact:true}).waitFor()
    assert.equal(await drawer.getByLabel('Saved project changes').count(),3)
    assert.equal(histories.get('A').messages.length,6,'Lost-response retry does not duplicate server transcript')
    assert.deepEqual(errors,[])
    await context.close();activePage=undefined
    console.log(`Catalog receipts ${viewport.width}px: created/reused/revised, exact revision, lost-response retry, reload, forged receipt denial and A/B isolation passed. HTTP fixtures, not live model/SQL.`)
  }
} catch(error) {
  if(activePage&&!activePage.isClosed()) await activePage.screenshot({path:`test-results/material-catalog-failure-${activeWidth}.png`,fullPage:true}).catch(()=>{})
  throw error
} finally {
  if(browser) await browser.close()
  server.kill('SIGTERM')
}
